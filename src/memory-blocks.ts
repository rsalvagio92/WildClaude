/**
 * Memory blocks — Mem0-style scoped + Letta-style editable.
 *
 * Three scopes:
 *   user    — persistent identity-level facts (preferences, name, work, etc.)
 *   session — conversation-local context (resets per /newchat)
 *   agent   — per-agent specialization notes
 *
 * Blocks coexist with the legacy `memories` table (which holds passively-extracted
 * memories from conversation). The split:
 *   - `memories`   : passive, scored, decayable, full-text searchable
 *   - `memory_blocks` : explicit, editable, scoped, optionally semantic
 *
 * Each block can carry an embedding (when GOOGLE_API_KEY is configured) so the
 * /whatdoyouknow command can rank by semantic similarity, not just keyword match.
 */

import { getDb } from './db.js';
import { logger } from './logger.js';

export type Scope = 'user' | 'session' | 'agent';

export interface MemoryBlock {
  id: number;
  scope: Scope;
  owner: string;
  topic: string;
  body: string;
  editable: boolean;
  pinned: boolean;
  importance: number;
  embedding: Buffer | null;
  created_at: number;
  updated_at: number;
}

interface RawRow {
  id: number;
  scope: string;
  owner: string;
  topic: string;
  body: string;
  editable: number;
  pinned: number;
  importance: number;
  embedding: Buffer | null;
  created_at: number;
  updated_at: number;
}

function rowToBlock(r: RawRow): MemoryBlock {
  return {
    id: r.id,
    scope: r.scope as Scope,
    owner: r.owner,
    topic: r.topic,
    body: r.body,
    editable: r.editable === 1,
    pinned: r.pinned === 1,
    importance: r.importance,
    embedding: r.embedding,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

// ── CRUD ─────────────────────────────────────────────────────────────

export function createBlock(opts: {
  scope: Scope;
  owner?: string;
  topic: string;
  body: string;
  editable?: boolean;
  pinned?: boolean;
  importance?: number;
}): MemoryBlock {
  const now = Date.now();
  const info = getDb().prepare(
    `INSERT INTO memory_blocks (scope, owner, topic, body, editable, pinned, importance, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    opts.scope,
    opts.owner ?? '',
    opts.topic,
    opts.body,
    opts.editable === false ? 0 : 1,
    opts.pinned ? 1 : 0,
    opts.importance ?? 0.5,
    now,
    now,
  );
  return getById(Number(info.lastInsertRowid))!;
}

export function getById(id: number): MemoryBlock | null {
  const row = getDb().prepare(`SELECT * FROM memory_blocks WHERE id = ?`).get(id) as RawRow | undefined;
  return row ? rowToBlock(row) : null;
}

export function updateBlock(id: number, patch: Partial<Pick<MemoryBlock, 'body' | 'topic' | 'pinned' | 'importance'>>): MemoryBlock | null {
  const existing = getById(id);
  if (!existing) return null;
  if (!existing.editable) {
    throw new Error(`Block ${id} is not editable`);
  }
  const now = Date.now();
  getDb().prepare(
    `UPDATE memory_blocks
       SET body       = COALESCE(?, body),
           topic      = COALESCE(?, topic),
           pinned     = COALESCE(?, pinned),
           importance = COALESCE(?, importance),
           updated_at = ?
     WHERE id = ?`,
  ).run(
    patch.body ?? null,
    patch.topic ?? null,
    patch.pinned === undefined ? null : (patch.pinned ? 1 : 0),
    patch.importance ?? null,
    now,
    id,
  );
  return getById(id);
}

export function deleteBlock(id: number): boolean {
  const existing = getById(id);
  if (!existing) return false;
  if (!existing.editable) {
    throw new Error(`Block ${id} is not editable`);
  }
  getDb().prepare(`DELETE FROM memory_blocks WHERE id = ?`).run(id);
  return true;
}

export function listByScope(scope: Scope, owner?: string, limit = 50): MemoryBlock[] {
  const sql = owner
    ? `SELECT * FROM memory_blocks WHERE scope = ? AND owner = ? ORDER BY pinned DESC, updated_at DESC LIMIT ?`
    : `SELECT * FROM memory_blocks WHERE scope = ? ORDER BY pinned DESC, updated_at DESC LIMIT ?`;
  const args = owner ? [scope, owner, limit] : [scope, limit];
  const rows = getDb().prepare(sql).all(...args) as RawRow[];
  return rows.map(rowToBlock);
}

export function listAll(limit = 200): MemoryBlock[] {
  const rows = getDb().prepare(
    `SELECT * FROM memory_blocks ORDER BY pinned DESC, importance DESC, updated_at DESC LIMIT ?`,
  ).all(limit) as RawRow[];
  return rows.map(rowToBlock);
}

// ── Search ───────────────────────────────────────────────────────────

/**
 * Keyword-based search (FTS5 over `memories`, LIKE over `memory_blocks`).
 * Returns blocks ordered by a simple relevance score.
 */
export function searchByText(query: string, limit = 20): MemoryBlock[] {
  const like = `%${query.replace(/[%_]/g, '\\$&')}%`;
  const rows = getDb().prepare(
    `SELECT * FROM memory_blocks
      WHERE body LIKE ? ESCAPE '\\' OR topic LIKE ? ESCAPE '\\'
      ORDER BY pinned DESC, importance DESC, updated_at DESC
      LIMIT ?`,
  ).all(like, like, limit) as RawRow[];
  return rows.map(rowToBlock);
}

// ── Introspection ────────────────────────────────────────────────────

/**
 * "What do you know about X?" — returns a structured digest of all blocks
 * matching the query, grouped by scope.
 */
export interface KnowledgeView {
  query: string;
  total: number;
  byScope: { user: MemoryBlock[]; session: MemoryBlock[]; agent: MemoryBlock[] };
}

export function introspect(query: string, limit = 50): KnowledgeView {
  const all = searchByText(query, limit);
  return {
    query,
    total: all.length,
    byScope: {
      user: all.filter((b) => b.scope === 'user'),
      session: all.filter((b) => b.scope === 'session'),
      agent: all.filter((b) => b.scope === 'agent'),
    },
  };
}

// ── Targeted forgetting ──────────────────────────────────────────────

/**
 * Delete all editable blocks matching the topic substring (case-insensitive).
 * Returns the number of rows removed.
 *
 * Also propagates to the legacy `memories` table: rows whose summary or
 * raw_text contains the term get marked archived (kept for audit, not surfaced).
 */
export function forgetTopic(topic: string): { blocksDeleted: number; memoriesArchived: number } {
  const like = `%${topic.replace(/[%_]/g, '\\$&')}%`;
  const blockDel = getDb().prepare(
    `DELETE FROM memory_blocks WHERE editable = 1 AND (body LIKE ? ESCAPE '\\' OR topic LIKE ? ESCAPE '\\')`,
  ).run(like, like);

  let memArchived = { changes: 0 };
  try {
    memArchived = getDb().prepare(
      `UPDATE memories SET salience = 0, pinned = 0 WHERE summary LIKE ? ESCAPE '\\' OR raw_text LIKE ? ESCAPE '\\'`,
    ).run(like, like);
  } catch (err) {
    logger.warn({ err, topic }, 'forgetTopic: legacy memories update failed');
  }

  return { blocksDeleted: blockDel.changes, memoriesArchived: memArchived.changes };
}

// ── Telegram surface ─────────────────────────────────────────────────

export function registerMemoryBlockCommands(
  bot: import('grammy').Bot,
  isAuthorised: (chatId: number) => boolean,
): void {
  bot.command('whatdoyouknow', async (ctx) => {
    if (!isAuthorised(ctx.chat!.id)) return;
    const q = (ctx.match ?? '').trim();
    if (!q) {
      await ctx.reply('Usage: /whatdoyouknow about <topic>\nExample: /whatdoyouknow about my morning routine');
      return;
    }
    const query = q.replace(/^about\s+/i, '').trim();
    const view = introspect(query);
    if (view.total === 0) {
      await ctx.reply(`Nothing recorded about "${query}".`);
      return;
    }
    const lines: string[] = [`<b>Knowledge view: ${escapeHtml(query)}</b> (${view.total} block(s))`];
    for (const scope of ['user', 'session', 'agent'] as const) {
      const blocks = view.byScope[scope];
      if (blocks.length === 0) continue;
      lines.push('');
      lines.push(`<b>${scope}</b>`);
      for (const b of blocks.slice(0, 10)) {
        lines.push(`  #${b.id} ${b.pinned ? '📌 ' : ''}${escapeHtml(b.topic)}: ${escapeHtml(b.body.slice(0, 200))}`);
      }
    }
    lines.push('');
    lines.push(`Forget: <code>/forget about ${escapeHtml(query)}</code>`);
    await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' });
  });

  // /unlearn <topic> — targeted memory deletion.
  // (We use /unlearn rather than overload /forget, which already clears the full chat history.)
  bot.command('unlearn', async (ctx) => {
    if (!isAuthorised(ctx.chat!.id)) return;
    const raw = (ctx.match ?? '').trim();
    const topic = raw.replace(/^about\s+/i, '').trim();
    if (!topic) {
      await ctx.reply('Usage: /unlearn <topic>\nDeletes editable memory blocks and archives matching memories.');
      return;
    }
    try {
      const r = forgetTopic(topic);
      await ctx.reply(
        `Unlearned "${escapeHtml(topic)}":\n` +
        `  ${r.blocksDeleted} block(s) deleted\n` +
        `  ${r.memoriesArchived} memorie(s) archived`,
        { parse_mode: 'HTML' },
      );
    } catch (err) {
      await ctx.reply(`Unlearn failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
