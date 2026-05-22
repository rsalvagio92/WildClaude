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
import { embed, embeddingToBuffer, bufferToEmbedding, cosine, embeddingsAvailable } from './embeddings-gemini.js';

export type Scope = 'user' | 'session' | 'agent';

export interface MemoryAttachment {
  /** image | audio | video | file */
  kind: string;
  /** Absolute filesystem path (typically under USER_DATA_DIR/uploads/). */
  path: string;
  /** Optional human-readable caption (e.g. vision OCR or user note). */
  caption?: string;
}

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
  attachments: MemoryAttachment[];
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
  attachments: string | null;
  created_at: number;
  updated_at: number;
}

function rowToBlock(r: RawRow): MemoryBlock {
  let attachments: MemoryAttachment[] = [];
  if (r.attachments) {
    try { attachments = JSON.parse(r.attachments) as MemoryAttachment[]; } catch { /* */ }
  }
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
    attachments,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

/**
 * Attach a file (image / audio / video / generic) to an existing memory block.
 * For image attachments, lazily generate a caption via the Vision MCP (if
 * ANTHROPIC_API_KEY is configured) and append it to the block body so semantic
 * search can find the memory by the image's content.
 */
export async function attachToBlock(
  id: number,
  attachment: MemoryAttachment,
): Promise<MemoryBlock | null> {
  const b = getById(id);
  if (!b) return null;
  if (!b.editable) throw new Error(`Block ${id} not editable`);
  const next = [...b.attachments, attachment];

  let bodyAddition = '';
  if (attachment.kind === 'image' && !attachment.caption) {
    // Best-effort vision caption. Doesn't block the attach if it fails.
    try {
      const { runVisionDescribe } = await import('./tools/vision-helper.js');
      const caption = await runVisionDescribe(attachment.path);
      if (caption) {
        attachment.caption = caption;
        bodyAddition = `\n[image: ${caption}]`;
      }
    } catch (err) {
      logger.warn({ err, id, path: attachment.path }, 'attachToBlock: vision caption failed');
    }
  }

  getDb().prepare(
    `UPDATE memory_blocks SET attachments = ?, body = ?, updated_at = ? WHERE id = ?`,
  ).run(JSON.stringify(next), b.body + bodyAddition, Date.now(), id);

  // Re-embed since body changed
  if (bodyAddition && embeddingsAvailable()) {
    embedBlock(id).catch(() => {});
  }
  return getById(id);
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
  const id = Number(info.lastInsertRowid);
  // Fire-and-forget embedding generation. Block stays usable immediately;
  // semantic search just kicks in once the embedding lands.
  if (embeddingsAvailable()) {
    embed(`${opts.topic}\n${opts.body}`)
      .then((vec) => {
        if (vec) {
          try {
            getDb().prepare(`UPDATE memory_blocks SET embedding = ? WHERE id = ?`)
              .run(embeddingToBuffer(vec), id);
          } catch (err) { logger.warn({ err, id }, 'memory-block embedding update failed'); }
        }
      })
      .catch((err) => logger.warn({ err, id }, 'memory-block embed exception'));
  }
  return getById(id)!;
}

/** Manually (re-)embed a block. Useful after updateBlock. */
export async function embedBlock(id: number): Promise<boolean> {
  const b = getById(id);
  if (!b) return false;
  const vec = await embed(`${b.topic}\n${b.body}`);
  if (!vec) return false;
  getDb().prepare(`UPDATE memory_blocks SET embedding = ? WHERE id = ?`)
    .run(embeddingToBuffer(vec), id);
  return true;
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

/**
 * Semantic search across memory_blocks. Combines:
 *   1. Embedding-based cosine similarity (when GOOGLE_API_KEY is set)
 *   2. Keyword LIKE matching as fallback / supplement
 *
 * Returns blocks ranked by relevance.
 */
export async function introspectSemantic(query: string, limit = 20): Promise<KnowledgeView & { semantic: boolean }> {
  if (!embeddingsAvailable()) {
    const view = introspect(query, limit);
    return { ...view, semantic: false };
  }
  const queryVec = await embed(query);
  if (!queryVec) {
    const view = introspect(query, limit);
    return { ...view, semantic: false };
  }

  // Load all blocks with embeddings + score
  const rows = getDb().prepare(
    `SELECT * FROM memory_blocks WHERE embedding IS NOT NULL`,
  ).all() as RawRow[];

  const scored: Array<{ block: MemoryBlock; score: number }> = [];
  for (const r of rows) {
    if (!r.embedding) continue;
    const v = bufferToEmbedding(r.embedding);
    if (!v) continue;
    const score = cosine(queryVec, v);
    scored.push({ block: rowToBlock(r), score });
  }
  scored.sort((a, b) => b.score - a.score);
  // Threshold: keep results with cosine >= 0.55 (empirical floor for "related")
  const top = scored.filter((s) => s.score >= 0.55).slice(0, limit).map((s) => s.block);

  // Backfill with keyword matches the embedding might have missed
  const kw = searchByText(query, Math.max(0, limit - top.length));
  const ids = new Set(top.map((b) => b.id));
  for (const b of kw) if (!ids.has(b.id)) top.push(b);

  return {
    query,
    total: top.length,
    byScope: {
      user: top.filter((b) => b.scope === 'user'),
      session: top.filter((b) => b.scope === 'session'),
      agent: top.filter((b) => b.scope === 'agent'),
    },
    semantic: true,
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
    const view = await introspectSemantic(query);
    if (view.total === 0) {
      await ctx.reply(`Nothing recorded about "${query}".`);
      return;
    }
    const semBadge = view.semantic ? ' 🔮 semantic' : ' 🔤 keyword';
    const lines: string[] = [`<b>Knowledge view: ${escapeHtml(query)}</b> (${view.total} block(s))${semBadge}`];
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
