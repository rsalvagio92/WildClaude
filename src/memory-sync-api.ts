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
import { isSecondary } from './config-role.js';
import { listOutbox, removeOutboxEntry, updateOutboxRetry } from './memory-outbox.js';

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
        }
      } catch (err) {
        logger.warn({ err, entryId: entry.id }, 'Sync: outbox entry flush failed, will retry');
      }
    }

    return c.json({ flushed, total: entries?.length || 0 });
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

  logger.info({}, 'Sync API routes registered (primary only)');
}
