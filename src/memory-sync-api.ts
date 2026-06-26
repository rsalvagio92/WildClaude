/**
 * Memory Sync API — exposed by primary on port 3141.
 * Secondaries read/write-forward via HTTP.
 *
 * Endpoints:
 *   GET  /api/sync/memories?q=...      — FTS5 search
 *   POST /api/sync/memories             — write-forward (secondary → primary)
 *   GET  /api/sync/memories/pinned      — pinned memories
 *   GET  /api/sync/status               — health check
 *   POST /api/sync/outbox/flush         — drain outbox (called by secondary on reconnect)
 */

import type { Hono } from 'hono';
import { getDb } from './db.js';
import { logger } from './logger.js';
import { isSecondary, loadRoleConfig } from './config-role.js';
import { listOutbox, removeOutboxEntry, updateOutboxRetry } from './memory-outbox.js';
import { registerMachine, updateMachineStatus, getMachines } from './machine-registry.js';

const SYNC_TOKEN_HEADER = 'X-Sync-Token';

/** Gate endpoint with bearer token (set on secondary via env). */
function gateSync(expectedToken?: string) {
  return (c: any, next: any) => {
    if (!expectedToken) {
      logger.warn({}, 'Sync API: no token configured (WILD_SYNC_TOKEN), allowing all');
      return next();
    }
    const header = c.req.header(SYNC_TOKEN_HEADER) || '';
    if (header !== `Bearer ${expectedToken}`) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    return next();
  };
}

export function registerSyncRoutes(app: Hono, syncToken?: string): void {
  const gate = gateSync(syncToken);

  // GET /api/sync/memories?q=<query>
  app.get('/api/sync/memories', gate, (c) => {
    const q = c.req.query('q') || '';
    if (!q) return c.json({ memories: [] });

    try {
      const rows = getDb().prepare(`
        SELECT id, chat_id, source, raw_text, summary, importance, created_at
        FROM memories
        WHERE id IN (
          SELECT rowid FROM memories_fts WHERE memories_fts MATCH ?
        )
        ORDER BY importance DESC, accessed_at DESC
        LIMIT 50
      `).all(q) as any[];

      return c.json({ memories: rows });
    } catch (err) {
      logger.error({ err, q }, 'Sync: FTS search failed');
      return c.json({ error: 'Search failed' }, 500);
    }
  });

  // GET /api/sync/memories/pinned
  app.get('/api/sync/memories/pinned', gate, (c) => {
    try {
      const rows = getDb().prepare(`
        SELECT id, chat_id, source, raw_text, summary, importance
        FROM memories
        WHERE pinned = 1
        ORDER BY created_at DESC
        LIMIT 100
      `).all() as any[];

      return c.json({ memories: rows });
    } catch (err) {
      logger.error({ err }, 'Sync: pinned fetch failed');
      return c.json({ error: 'Fetch failed' }, 500);
    }
  });

  // POST /api/sync/memories (secondary writes)
  app.post('/api/sync/memories', gate, async (c) => {
    const body = await c.req.json() as any;
    const { chatId, rawText, summary, entities, topics, importance, source, agentId, machineOrigin } = body;

    if (!chatId || !rawText) {
      return c.json({ error: 'Missing chatId or rawText' }, 400);
    }

    try {
      const now = Math.floor(Date.now() / 1000);
      const id = getDb().prepare(`
        INSERT INTO memories (chat_id, source, raw_text, summary, entities, topics, importance, agent_id, origin_machine, created_at, accessed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        chatId,
        source || 'secondary',
        rawText,
        summary || '',
        JSON.stringify(entities || []),
        JSON.stringify(topics || []),
        importance || 0.5,
        agentId || 'main',
        machineOrigin || 'unknown',
        now,
        now,
      );

      logger.info({ id, machineOrigin }, 'Sync: memory ingested from secondary');
      return c.json({ success: true, id });
    } catch (err) {
      logger.error({ err }, 'Sync: memory write failed');
      return c.json({ error: 'Write failed' }, 500);
    }
  });

  // GET /api/sync/wiki?topic=<topic> (wiki articles)
  app.get('/api/sync/wiki', gate, (c) => {
    const topic = c.req.query('topic');
    if (!topic) {
      try {
        const rows = getDb().prepare(`
          SELECT id, topic, content, published_at
          FROM memory_blocks
          WHERE owner = 'wiki'
          ORDER BY published_at DESC
          LIMIT 100
        `).all() as any[];
        return c.json({ articles: rows });
      } catch (err) {
        logger.error({ err }, 'Sync: wiki fetch failed');
        return c.json({ error: 'Fetch failed' }, 500);
      }
    }

    try {
      const row = getDb().prepare(`
        SELECT id, topic, content, published_at
        FROM memory_blocks
        WHERE owner = 'wiki' AND topic = ?
        LIMIT 1
      `).get(topic) as any;
      return c.json({ article: row || null });
    } catch (err) {
      logger.error({ err, topic }, 'Sync: wiki article fetch failed');
      return c.json({ error: 'Fetch failed' }, 500);
    }
  });

  // GET /api/sync/project-context?chatId=X — the primary resolves the chat's
  // active project (or infers it) and renders the full project reference block
  // (repos/env/KB/secret availability). Secondaries inject this so they answer
  // project questions with the same context the primary has, instead of reading
  // their own (empty) local projects dir.
  app.get('/api/sync/project-context', gate, async (c) => {
    const chatId = c.req.query('chatId') || '';
    try {
      const { getActiveProjectOrInfer, buildProjectReference } = await import('./projects.js');
      const activeId = getActiveProjectOrInfer(chatId);
      if (!activeId) return c.json({ projectId: null, reference: null });
      return c.json({ projectId: activeId, reference: buildProjectReference(activeId) || null });
    } catch (err) {
      logger.error({ err, chatId }, 'Sync: project-context failed');
      return c.json({ error: 'Fetch failed' }, 500);
    }
  });

  // POST /api/sync/outbox/flush (secondary calls on reconnect)
  app.post('/api/sync/outbox/flush', gate, async (c) => {
    if (isSecondary()) {
      return c.json({ error: 'Only primary can flush outbox' }, 403);
    }

    const body = await c.req.json() as { entries: any[] };
    const { entries } = body;
    let flushed = 0;

    for (const entry of entries || []) {
      try {
        if (entry.type === 'memory') {
          const { chatId, rawText, summary, entities, topics, importance, source, agentId, machineOrigin } = entry.payload;
          const now = Math.floor(Date.now() / 1000);
          getDb().prepare(`
            INSERT INTO memories (chat_id, source, raw_text, summary, entities, topics, importance, agent_id, origin_machine, created_at, accessed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(chatId, source || 'secondary', rawText, summary || '', JSON.stringify(entities || []), JSON.stringify(topics || []), importance || 0.5, agentId || 'main', machineOrigin || 'unknown', now, now);
          flushed++;
        } else if (entry.type === 'proposal') {
          const { id, kind, title, payload, machineOrigin } = entry.payload;
          const { insertIncomingProposal } = await import('./db.js');
          insertIncomingProposal({ id, machineOrigin: machineOrigin || 'unknown', kind, title, payload });
          flushed++;
        }
      } catch (err) {
        logger.warn({ err, entryId: entry.id }, 'Sync: outbox entry flush failed, will retry');
      }
    }

    return c.json({ flushed, total: entries?.length || 0 });
  });

  // POST /api/sync/proposals (secondary forwards a learning/improvement signal)
  // The primary stores it for review; secondaries never apply learning locally.
  app.post('/api/sync/proposals', gate, async (c) => {
    if (isSecondary()) {
      return c.json({ error: 'Only primary receives proposals' }, 403);
    }
    const body = await c.req.json() as any;
    const { id, kind, title, payload, machineOrigin } = body;
    if (!id || !kind || !title) {
      return c.json({ error: 'Missing id, kind or title' }, 400);
    }
    if (!['learning', 'agent_improve', 'code_improve'].includes(kind)) {
      return c.json({ error: `Unknown kind: ${kind}` }, 400);
    }
    try {
      const { insertIncomingProposal } = await import('./db.js');
      insertIncomingProposal({ id, machineOrigin: machineOrigin || 'unknown', kind, title, payload });
      logger.info({ id, kind, machineOrigin }, 'Sync: proposal ingested from secondary');
      return c.json({ success: true, id });
    } catch (err) {
      logger.error({ err }, 'Sync: proposal write failed');
      return c.json({ error: 'Write failed' }, 500);
    }
  });

  // GET /api/sync/proposals?status=pending (primary lists forwarded proposals)
  app.get('/api/sync/proposals', gate, async (c) => {
    const status = c.req.query('status') as any;
    try {
      const { listIncomingProposals } = await import('./db.js');
      return c.json({ proposals: listIncomingProposals(status || undefined) });
    } catch (err) {
      logger.error({ err }, 'Sync: proposal list failed');
      return c.json({ error: 'Fetch failed' }, 500);
    }
  });

  // GET /api/sync/status
  app.get('/api/sync/status', (c) => {
    try {
      const memCount = (getDb().prepare('SELECT COUNT(*) as cnt FROM memories').get() as any).cnt;
      return c.json({ ok: true, memoryCount: memCount });
    } catch {
      return c.json({ ok: false }, 500);
    }
  });

  // POST /api/sync/register (secondaries auto-register on first connection)
  app.post('/api/sync/register', gate, async (c) => {
    const body = await c.req.json() as any;
    const { machineId, version, telemetry, sessionCount } = body;

    if (!machineId) {
      return c.json({ error: 'Missing machineId' }, 400);
    }

    // Import after declaration to avoid circular deps
    const { updateMachineStatus } = await import('./machine-registry.js');
    registerMachine(machineId);
    updateMachineStatus(machineId, true, undefined, telemetry, version, sessionCount);
    return c.json({ registered: true });
  });

  // GET /api/sync/machines (dashboard: list connected secondaries)
  app.get('/api/sync/machines', (c) => {
    const machines = getMachines();
    return c.json({ machines });
  });

  // GET /api/sync/blocks?scope=<user|session|agent> (editable memory blocks)
  app.get('/api/sync/blocks', gate, (c) => {
    const scope = c.req.query('scope') || 'user';
    try {
      const rows = getDb().prepare(`
        SELECT id, scope, content, created_at, updated_at
        FROM memory_blocks
        WHERE owner = 'user' AND scope = ?
        ORDER BY updated_at DESC
        LIMIT 50
      `).all(scope) as any[];
      return c.json({ blocks: rows });
    } catch (err) {
      logger.error({ err, scope }, 'Sync: blocks fetch failed');
      return c.json({ error: 'Fetch failed' }, 500);
    }
  });

  // GET /api/sync/commands?machineId=<id> (secondary pulls pending commands)
  app.get('/api/sync/commands', gate, async (c) => {
    const machineId = c.req.query('machineId');
    if (!machineId) {
      return c.json({ error: 'Missing machineId' }, 400);
    }

    try {
      const { getPendingCommands, markCommandSent } = await import('./machine-commands.js');
      const commands = getPendingCommands(machineId);
      // Mark all as sent once pulled
      for (const cmd of commands) {
        markCommandSent(cmd.id);
      }
      return c.json({ commands });
    } catch (err) {
      logger.error({ err, machineId }, 'Sync: command fetch failed');
      return c.json({ error: 'Fetch failed' }, 500);
    }
  });

  // POST /api/sync/commands/ack (secondary ACKs executed commands)
  app.post('/api/sync/commands/ack', gate, async (c) => {
    const body = await c.req.json() as any;
    const { commandId, result } = body;

    if (!commandId) {
      return c.json({ error: 'Missing commandId' }, 400);
    }

    try {
      const { ackCommand } = await import('./machine-commands.js');
      ackCommand(commandId, result);
      return c.json({ acked: true });
    } catch (err) {
      logger.error({ err, commandId }, 'Sync: command ACK failed');
      return c.json({ error: 'ACK failed' }, 500);
    }
  });

  // GET /api/sync/secrets
  // Returns all syncable secrets as plaintext key→value pairs.
  // Transport is already authenticated (X-Sync-Token) and LAN-only.
  // Machine-specific secrets (DB_ENCRYPTION_KEY, DASHBOARD_TOKEN, etc.)
  // are excluded by the syncable flag in the registry.
  app.get('/api/sync/secrets', gate, async (c) => {
    if (isSecondary()) {
      return c.json({ error: 'Only primary exposes secrets' }, 403);
    }
    try {
      const { getSyncableSecrets } = await import('./secrets.js');
      const secrets = getSyncableSecrets();
      return c.json({ secrets });
    } catch (err) {
      logger.error({ err }, 'Sync: secrets fetch failed');
      return c.json({ error: 'Fetch failed' }, 500);
    }
  });

  logger.info({}, 'Sync API routes registered (primary only)');
}
