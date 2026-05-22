/**
 * Reflection automation — surface emergent patterns the user hasn't noticed.
 *
 * Runs daily (08:30) and weekly (Sun 19:00). Pulls from:
 *   - conversation_log (what was discussed)
 *   - tool_sequences   (what was done repeatedly)
 *   - memories         (what was flagged important)
 *   - mission_tasks    (what was started vs finished)
 * Composes a Haiku prompt to spot patterns ("you keep asking about X but never
 * act on it"). Stores in `reflections`. Notifies via Telegram when acknowledged=0.
 */

import { getDb } from './db.js';
import { runAgent } from './agent.js';
import { logger } from './logger.js';

export interface Reflection {
  id: number;
  period: string;
  summary: string;
  patterns: string[];
  acknowledged: boolean;
  createdAt: number;
}

interface ReflectionRow {
  id: number;
  period: string;
  summary: string;
  patterns: string;
  acknowledged: number;
  created_at: number;
}

function rowToReflection(r: ReflectionRow): Reflection {
  return {
    id: r.id,
    period: r.period,
    summary: r.summary,
    patterns: (() => { try { return JSON.parse(r.patterns) as string[]; } catch { return []; } })(),
    acknowledged: r.acknowledged === 1,
    createdAt: r.created_at,
  };
}

// ── Data collection ──────────────────────────────────────────────────

interface Sample {
  topics: Array<{ topic: string; count: number }>;
  toolPatterns: Array<{ signature: string; count: number }>;
  unfinishedTasks: Array<{ title: string }>;
  highMemories: Array<{ summary: string; importance: number }>;
  turnCount: number;
}

function sampleWindow(sinceMs: number): Sample {
  // Legacy tables (memories, conversation_log) store created_at in SECONDS.
  // New tables I own (tool_sequences, mission_tasks) store ms.
  const sinceSec = Math.floor(sinceMs / 1000);
  const db = getDb();
  const turnCount = (db.prepare(`SELECT COUNT(*) AS n FROM conversation_log WHERE created_at >= ?`).get(sinceSec) as { n: number }).n;

  const topics = db.prepare(
    `SELECT topics, COUNT(*) AS count
       FROM memories
      WHERE created_at >= ?
      GROUP BY topics
      ORDER BY count DESC
      LIMIT 8`,
  ).all(sinceSec) as Array<{ topics: string; count: number }>;

  const toolPatterns = db.prepare(
    `SELECT signature, count FROM tool_sequences
      WHERE last_seen >= ?
      ORDER BY count DESC
      LIMIT 5`,
  ).all(sinceMs) as Array<{ signature: string; count: number }>;

  const unfinishedTasks = db.prepare(
    `SELECT title FROM mission_tasks
      WHERE created_at >= ? AND status NOT IN ('completed', 'cancelled')
      LIMIT 10`,
  ).all(sinceMs) as Array<{ title: string }>;

  const highMemories = db.prepare(
    `SELECT summary, importance FROM memories
      WHERE created_at >= ? AND importance >= 0.7
      ORDER BY importance DESC
      LIMIT 6`,
  ).all(sinceSec) as Array<{ summary: string; importance: number }>;

  return {
    topics: topics.map((t) => ({ topic: t.topics, count: t.count })),
    toolPatterns,
    unfinishedTasks,
    highMemories,
    turnCount,
  };
}

// ── Generation ───────────────────────────────────────────────────────

const REFLECTION_PROMPT = (period: string, s: Sample) => `
You are a thoughtful coach reviewing the past ${period} of someone's AI assistant activity. Spot the 1-3 most useful PATTERNS the user themself may not have noticed.

Activity:
  Conversation turns: ${s.turnCount}

  Top topics:
${s.topics.map((t) => `    ${t.topic}: ${t.count}`).join('\n') || '    (none)'}

  Repeated tool sequences (count × pattern):
${s.toolPatterns.map((t) => `    ${t.count} × ${t.signature.slice(0, 100)}`).join('\n') || '    (none)'}

  Unfinished tasks:
${s.unfinishedTasks.map((t) => `    - ${t.title}`).join('\n') || '    (none)'}

  High-importance memories:
${s.highMemories.map((m) => `    [${m.importance.toFixed(1)}] ${m.summary.slice(0, 200)}`).join('\n') || '    (none)'}

Write a JSON object exactly like this (no surrounding markdown fences):

{
  "summary": "one-paragraph summary, max 60 words",
  "patterns": [
    "First pattern as one sentence (≤ 20 words)",
    "Second pattern",
    "Third pattern"
  ]
}

Patterns should be actionable, surprising, or counter-intuitive. Skip the obvious. If there's not enough data, return patterns: [].
`.trim();

function parseReflection(raw: string): { summary: string; patterns: string[] } | null {
  // Extract first JSON object
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const obj = JSON.parse(m[0]) as { summary?: string; patterns?: unknown };
    if (typeof obj.summary !== 'string') return null;
    const patterns = Array.isArray(obj.patterns) ? obj.patterns.filter((p): p is string => typeof p === 'string') : [];
    return { summary: obj.summary, patterns };
  } catch { return null; }
}

export async function generateReflection(period: 'day' | 'week'): Promise<Reflection | null> {
  const sinceMs = Date.now() - (period === 'day' ? 24 : 7 * 24) * 3600 * 1000;
  const sample = sampleWindow(sinceMs);
  if (sample.turnCount === 0 && sample.toolPatterns.length === 0 && sample.highMemories.length === 0) {
    logger.info({ period }, 'reflection: no activity, skipping');
    return null;
  }

  const result = await runAgent(REFLECTION_PROMPT(period, sample), undefined, () => {}, undefined, 'claude-haiku-4-5');
  const parsed = parseReflection(result.text ?? '');
  if (!parsed) {
    logger.warn({ period }, 'reflection: failed to parse model output');
    return null;
  }

  const now = Date.now();
  const info = getDb().prepare(
    `INSERT INTO reflections (period, summary, patterns, acknowledged, created_at)
     VALUES (?, ?, ?, 0, ?)`,
  ).run(period, parsed.summary, JSON.stringify(parsed.patterns), now);

  return {
    id: Number(info.lastInsertRowid),
    period,
    summary: parsed.summary,
    patterns: parsed.patterns,
    acknowledged: false,
    createdAt: now,
  };
}

export function listReflections(limit = 10): Reflection[] {
  const rows = getDb().prepare(
    `SELECT * FROM reflections ORDER BY created_at DESC LIMIT ?`,
  ).all(limit) as ReflectionRow[];
  return rows.map(rowToReflection);
}

export function acknowledgeReflection(id: number): boolean {
  const info = getDb().prepare(`UPDATE reflections SET acknowledged = 1 WHERE id = ?`).run(id);
  return info.changes > 0;
}

// ── Telegram ─────────────────────────────────────────────────────────

export function registerReflectionCommands(
  bot: import('grammy').Bot,
  isAuthorised: (chatId: number) => boolean,
): void {
  bot.command('reflect', async (ctx) => {
    if (!isAuthorised(ctx.chat!.id)) return;
    const arg = (ctx.match ?? '').trim().toLowerCase();

    if (arg === 'today' || arg === 'day' || arg === '' || arg === 'now') {
      await ctx.reply('Generating today\'s reflection…');
      const r = await generateReflection('day');
      if (!r) {
        await ctx.reply('No reflection generated (insufficient activity, or model returned bad output).');
        return;
      }
      const lines = [`<b>Today's reflection</b>\n${r.summary}`];
      if (r.patterns.length > 0) {
        lines.push('\n<b>Patterns:</b>');
        lines.push(...r.patterns.map((p, i) => `${i + 1}. ${p}`));
      }
      await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' });
      return;
    }
    if (arg === 'week') {
      await ctx.reply('Generating this week\'s reflection…');
      const r = await generateReflection('week');
      if (!r) { await ctx.reply('No reflection generated.'); return; }
      const lines = [`<b>Weekly reflection</b>\n${r.summary}`];
      if (r.patterns.length > 0) {
        lines.push('\n<b>Patterns:</b>');
        lines.push(...r.patterns.map((p, i) => `${i + 1}. ${p}`));
      }
      await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' });
      return;
    }
    if (arg === 'list' || arg === 'recent') {
      const list = listReflections(5);
      if (list.length === 0) { await ctx.reply('No reflections yet.'); return; }
      await ctx.reply(list.map((r) => `[${r.period}] ${new Date(r.createdAt).toISOString().slice(0, 10)}: ${r.summary.slice(0, 200)}`).join('\n\n'));
      return;
    }
    await ctx.reply('Usage:\n/reflect today\n/reflect week\n/reflect recent');
  });
}
