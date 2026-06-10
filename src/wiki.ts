/**
 * Knowledge Wiki — a curated, durable, topic-keyed layer over memory_blocks.
 *
 * The memory system is great at atomic, decaying observations; it lacks a
 * durable, editable, topic-indexed reference. The Wiki fills that gap WITHOUT a
 * new store: an article is just a memory_block with scope='user' and a reserved
 * owner:
 *   owner = 'wiki'        → published article (recalled on mention, listed)
 *   owner = 'wiki-draft'  → suggested article awaiting approval (curator output)
 *
 * - Articles are durable (importance high, not decayed) and freely editable/expandable.
 * - On the chat hot path, any published article whose topic is mentioned is injected
 *   as reference context (cheap substring match, capped) — "recalled when mentioned".
 * - A curator distills high-importance memories about a topic into a DRAFT article
 *   and pings the user; approving publishes it.
 */

import { getDb } from './db.js';
import { logger } from './logger.js';
import { createBlock, updateBlock, deleteBlock, getById, listByScope, type MemoryBlock } from './memory-blocks.js';

const PUB = 'wiki';
const DRAFT = 'wiki-draft';
const ARTICLE_IMPORTANCE = 0.85;

export interface WikiArticle {
  id: number;
  topic: string;
  body: string;
  draft: boolean;
  pinned: boolean;
  importance: number;
  createdAt: number;
  updatedAt: number;
}

function toArticle(b: MemoryBlock): WikiArticle {
  return {
    id: b.id, topic: b.topic, body: b.body, draft: b.owner === DRAFT,
    pinned: b.pinned, importance: b.importance, createdAt: b.created_at, updatedAt: b.updated_at,
  };
}

// ── Read ───────────────────────────────────────────────────────────────

export function listArticles(opts: { includeDrafts?: boolean } = {}): WikiArticle[] {
  const pub = listByScope('user', PUB, 500).map(toArticle);
  if (!opts.includeDrafts) return pub;
  const drafts = listByScope('user', DRAFT, 200).map(toArticle);
  return [...pub, ...drafts];
}

export function listDrafts(): WikiArticle[] {
  return listByScope('user', DRAFT, 200).map(toArticle);
}

export function getArticleById(id: number): WikiArticle | null {
  const b = getById(id);
  if (!b || (b.owner !== PUB && b.owner !== DRAFT)) return null;
  return toArticle(b);
}

/** Find a published article by exact (case-insensitive) topic. */
export function getArticleByTopic(topic: string, opts: { includeDrafts?: boolean } = {}): WikiArticle | null {
  const t = topic.trim().toLowerCase();
  return listArticles(opts).find((a) => a.topic.toLowerCase() === t) || null;
}

export function searchArticles(query: string): WikiArticle[] {
  const like = `%${query.replace(/[%_]/g, '\\$&')}%`;
  const rows = getDb().prepare(
    `SELECT * FROM memory_blocks WHERE owner IN (?, ?) AND (topic LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\')
     ORDER BY (owner = ?) DESC, updated_at DESC LIMIT 50`,
  ).all(PUB, DRAFT, like, like, PUB) as Array<Record<string, unknown>>;
  return rows.map((r) => toArticle(blockFromRow(r)));
}

// Minimal row→block (memory-blocks doesn't export rowToBlock).
function blockFromRow(r: Record<string, unknown>): MemoryBlock {
  return {
    id: Number(r.id), scope: String(r.scope) as MemoryBlock['scope'], owner: String(r.owner),
    topic: String(r.topic), body: String(r.body), editable: r.editable === 1, pinned: r.pinned === 1,
    importance: Number(r.importance), embedding: null, attachments: [],
    created_at: Number(r.created_at), updated_at: Number(r.updated_at),
  };
}

// ── Write ──────────────────────────────────────────────────────────────

/** Create or update an article by topic. */
export function upsertArticle(opts: { topic: string; body: string; draft?: boolean; append?: boolean }): WikiArticle {
  const existing = getArticleByTopic(opts.topic, { includeDrafts: true });
  if (existing) {
    const body = opts.append ? `${existing.body.trimEnd()}\n\n${opts.body.trim()}` : opts.body;
    updateBlock(existing.id, { body });
    return getArticleById(existing.id)!;
  }
  const b = createBlock({
    scope: 'user', owner: opts.draft ? DRAFT : PUB, topic: opts.topic.trim(),
    body: opts.body, editable: true, pinned: false, importance: ARTICLE_IMPORTANCE,
  });
  return toArticle(b);
}

/** Edit an existing article by id (body/topic/pinned). */
export function editArticle(id: number, patch: { body?: string; topic?: string; pinned?: boolean }): WikiArticle | null {
  const b = getById(id);
  if (!b || (b.owner !== PUB && b.owner !== DRAFT)) return null;
  updateBlock(id, patch);
  return getArticleById(id);
}

export function approveArticle(id: number): boolean {
  const b = getById(id);
  if (!b || b.owner !== DRAFT) return false;
  getDb().prepare(`UPDATE memory_blocks SET owner = ?, updated_at = ? WHERE id = ?`).run(PUB, Date.now(), id);
  return true;
}

export function deleteArticle(id: number): boolean {
  const b = getById(id);
  if (!b || (b.owner !== PUB && b.owner !== DRAFT)) return false;
  return deleteBlock(id);
}

// ── Recall on mention (chat hot path) ────────────────────────────────────

/**
 * Cheap, token-bounded recall: return published articles whose topic appears in
 * the given text. Word-boundary-ish substring match (lowercased). No LLM, no
 * embeddings — safe to call on every message.
 */
export function recallForText(text: string, opts: { maxChars?: number } = {}): string {
  const t = (text || '').toLowerCase();
  if (t.length < 4) return '';
  const maxChars = opts.maxChars ?? 1800;
  const matched: WikiArticle[] = [];
  for (const a of listArticles()) {
    const topic = a.topic.toLowerCase().trim();
    if (topic.length < 4) continue; // avoid noisy 1–3 char topics ("API", "app")
    // Whole-word(ish) match so "api" doesn't fire inside "rapid"; multi-word
    // topics ("Acme API") still match as a phrase.
    const re = new RegExp(`(^|[^a-z0-9])${topic.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i');
    if (re.test(t)) matched.push(a);
  }
  if (!matched.length) return '';
  matched.sort((a, b) => b.importance - a.importance || b.updatedAt - a.updatedAt);
  const parts: string[] = ['# Knowledge wiki (relevant articles)'];
  let budget = maxChars;
  for (const a of matched) {
    if (budget <= 0) break;
    const slice = a.body.slice(0, Math.min(a.body.length, budget));
    budget -= slice.length;
    parts.push(`\n## ${a.topic}\n${slice}${a.body.length > slice.length ? '\n…(truncated)' : ''}`);
  }
  return parts.join('\n');
}

// ── LLM distillation / curation ──────────────────────────────────────────

function gatherSources(topic: string): string[] {
  const out: string[] = [];
  const like = `%${topic.replace(/[%_]/g, '\\$&')}%`;
  // High-signal memories mentioning the topic.
  try {
    const rows = getDb().prepare(
      `SELECT summary FROM memories
        WHERE deleted_at IS NULL AND importance >= 0.4
          AND (summary LIKE ? ESCAPE '\\' OR raw_text LIKE ? ESCAPE '\\' OR entities LIKE ? ESCAPE '\\' OR topics LIKE ? ESCAPE '\\')
        ORDER BY importance DESC, created_at DESC LIMIT 30`,
    ).all(like, like, like, like) as Array<{ summary: string }>;
    for (const r of rows) if (r.summary) out.push(r.summary);
  } catch (err) { logger.debug({ err }, 'wiki: memories query failed'); }
  // Curated memory_blocks mentioning the topic (excluding wiki's own).
  try {
    const rows = getDb().prepare(
      `SELECT body FROM memory_blocks WHERE owner NOT IN (?, ?) AND (topic LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\')
       ORDER BY importance DESC LIMIT 15`,
    ).all(PUB, DRAFT, like, like) as Array<{ body: string }>;
    for (const r of rows) if (r.body) out.push(r.body);
  } catch { /* */ }
  return [...new Set(out)].slice(0, 40);
}

/**
 * Draft or expand an article for a topic from gathered sources via Haiku.
 * `publish:true` writes a published article; otherwise a draft.
 */
export async function distillArticle(topic: string, opts: { publish?: boolean } = {}): Promise<{ ok: boolean; article?: WikiArticle; error?: string }> {
  const sources = gatherSources(topic);
  const existing = getArticleByTopic(topic, { includeDrafts: true });
  if (!sources.length && !existing) return { ok: false, error: `No information found about "${topic}" yet.` };
  try {
    const { runAgent } = await import('./agent.js');
    const { MODELS } = await import('./models.js');
    const prompt = `Write a concise knowledge-base article about "${topic}" for a personal AI assistant. Output ONLY the article body in Markdown — no title heading, no preamble.

${existing ? `Existing article (expand/merge, keep correct facts):\n"""\n${existing.body}\n"""\n` : ''}
Facts gathered (deduplicate, ignore irrelevant):
${sources.map((s) => `- ${s}`).join('\n') || '(none — rely on the existing article)'}

Keep it factual and skimmable: short intro line, then bullet points or short sections. No invented details.`;
    const result = await runAgent(prompt, undefined, () => {}, undefined, MODELS.haiku);
    const body = (result.text || '').trim();
    if (!body) return { ok: false, error: 'Empty article generated.' };
    const article = upsertArticle({ topic, body, draft: !opts.publish });
    logger.info({ topic, draft: !opts.publish }, 'wiki article distilled');
    return { ok: true, article };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'distill failed' };
  }
}

/**
 * Curation pass: find recurring entities/topics in recent high-importance
 * memories that lack a published article, and distill each as a DRAFT.
 * Returns the topics drafted. Conservative: capped per run.
 */
export async function runWikiCuration(send?: (msg: string) => void, opts: { max?: number } = {}): Promise<string[]> {
  const max = opts.max ?? 3;
  const counts = new Map<string, number>();
  try {
    const rows = getDb().prepare(
      `SELECT entities, topics FROM memories WHERE deleted_at IS NULL AND importance >= 0.6 AND created_at >= ?
       ORDER BY created_at DESC LIMIT 400`,
    ).all(Math.floor(Date.now() / 1000) - 30 * 86400) as Array<{ entities: string; topics: string }>;
    for (const r of rows) {
      for (const key of ['entities', 'topics'] as const) {
        try {
          const arr = JSON.parse(r[key] || '[]') as string[];
          for (const raw of arr) {
            const e = String(raw).trim();
            if (e.length < 3 || e.length > 60) continue;
            counts.set(e, (counts.get(e) || 0) + 1);
          }
        } catch { /* */ }
      }
    }
  } catch (err) {
    logger.warn({ err }, 'wiki curation: memories scan failed');
    return [];
  }
  // Candidates: mentioned >= 3 times, no published article yet.
  const existing = new Set(listArticles({ includeDrafts: true }).map((a) => a.topic.toLowerCase()));
  const candidates = [...counts.entries()]
    .filter(([e, n]) => n >= 3 && !existing.has(e.toLowerCase()))
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([e]) => e);

  const drafted: string[] = [];
  for (const topic of candidates) {
    const res = await distillArticle(topic, { publish: false });
    if (res.ok) drafted.push(topic);
  }
  if (drafted.length && send) {
    send(`📚 Drafted ${drafted.length} wiki article${drafted.length > 1 ? 's' : ''} from recent topics: ${drafted.join(', ')}. Review & approve in the dashboard → Memory Palace → Wiki.`);
  }
  return drafted;
}
