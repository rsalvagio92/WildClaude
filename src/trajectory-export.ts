/**
 * Export conversation trajectories as JSONL for fine-tuning, analysis, or
 * trajectory-based RL experiments.
 *
 * Reads from `conversation_log` (joined with `token_usage` for cost metadata
 * when available). Writes one JSON object per line to
 * USER_DATA_DIR/exports/trajectories-<timestamp>.jsonl.
 *
 * PII discipline:
 *   - chat_id is hashed (sha1, 12 chars) by default. Pass { raw: true } to
 *     skip — only do this for purely local fine-tuning.
 *   - content is run through a scrubber that masks emails, phone numbers,
 *     long alphanumeric tokens (likely API keys), and IPv4 addresses.
 *   - Trajectories that look like single-user identity statements ("My name
 *     is …") are skipped entirely unless raw=true.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { getDb } from './db.js';
import { USER_DATA_DIR } from './paths.js';
import { logger } from './logger.js';

export interface ExportOptions {
  /** Earliest created_at to include (ms epoch). */
  since?: number;
  /** Latest created_at to include (ms epoch). */
  until?: number;
  /** Restrict to a single chat_id. */
  chatId?: string;
  /** Skip PII scrubbing and skip chat_id hashing. ONLY for local fine-tuning. */
  raw?: boolean;
  /** Output file path. Defaults to USER_DATA_DIR/exports/trajectories-<ts>.jsonl. */
  outputPath?: string;
  /** Max rows. Default: no cap. */
  limit?: number;
}

export interface ExportResult {
  outputPath: string;
  rowsExported: number;
  rowsSkipped: number;
  bytesWritten: number;
  durationMs: number;
}

interface ConversationRow {
  id: number;
  chat_id: string;
  session_id: string | null;
  role: string;
  content: string;
  created_at: number;
  agent_id: string | null;
}

const SCRUBBERS: Array<{ name: string; re: RegExp; replace: string }> = [
  { name: 'email', re: /\b[\w._%+-]+@[\w.-]+\.[a-z]{2,}\b/gi, replace: '[EMAIL]' },
  // International phone numbers, at least 7 digits with optional separators
  { name: 'phone', re: /\+?\d[\d\s().-]{6,}\d/g, replace: '[PHONE]' },
  // Long alphanumeric tokens: 24+ chars with mixed case or underscores
  { name: 'token', re: /\b[A-Za-z0-9_-]{24,}\b/g, replace: '[TOKEN]' },
  // Common API key prefixes
  { name: 'api-key', re: /\b(sk|pk|ghp|ghs|gho|ghu|github_pat|xoxb|xoxp|xoxa)[-_][A-Za-z0-9_-]{8,}\b/g, replace: '[API_KEY]' },
  // IPv4 addresses (skip 0.0.0.0 / 127.0.0.1 / localhost which aren't PII)
  { name: 'ipv4', re: /\b(?!0\.0\.0\.0|127\.0\.0\.1)(\d{1,3}\.){3}\d{1,3}\b/g, replace: '[IP]' },
];

const IDENTITY_PATTERNS = [
  /\bmy name is\b/i,
  /\bi (live|work) (in|at)\b/i,
  /\bmy (phone|email|address) is\b/i,
];

export function scrubContent(text: string): { content: string; redactions: number } {
  let out = text;
  let redactions = 0;
  for (const s of SCRUBBERS) {
    out = out.replace(s.re, () => {
      redactions++;
      return s.replace;
    });
  }
  return { content: out, redactions };
}

function hashChatId(id: string): string {
  return crypto.createHash('sha1').update(id).digest('hex').slice(0, 12);
}

function isIdentityLeak(text: string): boolean {
  return IDENTITY_PATTERNS.some((p) => p.test(text));
}

function defaultOutputPath(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(USER_DATA_DIR, 'exports', `trajectories-${stamp}.jsonl`);
}

export function exportTrajectories(opts: ExportOptions = {}): ExportResult {
  const start = Date.now();
  const outputPath = opts.outputPath ?? defaultOutputPath();
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.since !== undefined) { where.push('created_at >= ?'); params.push(opts.since); }
  if (opts.until !== undefined) { where.push('created_at <= ?'); params.push(opts.until); }
  if (opts.chatId) { where.push('chat_id = ?'); params.push(opts.chatId); }
  const sql = [
    `SELECT id, chat_id, session_id, role, content, created_at, agent_id`,
    `FROM conversation_log`,
    where.length ? `WHERE ${where.join(' AND ')}` : '',
    `ORDER BY created_at ASC`,
    opts.limit ? `LIMIT ${Math.max(0, Math.floor(opts.limit))}` : '',
  ].filter(Boolean).join(' ');

  const rows = getDb().prepare(sql).all(...params) as ConversationRow[];

  let rowsExported = 0;
  let rowsSkipped = 0;
  let bytesWritten = 0;
  const stream = fs.createWriteStream(outputPath, { encoding: 'utf8' });

  for (const row of rows) {
    if (!opts.raw && isIdentityLeak(row.content)) {
      rowsSkipped++;
      continue;
    }
    const scrubbed = opts.raw
      ? { content: row.content, redactions: 0 }
      : scrubContent(row.content);

    const out = {
      id: row.id,
      chat_id: opts.raw ? row.chat_id : hashChatId(row.chat_id),
      session_id: row.session_id,
      agent_id: row.agent_id ?? 'main',
      role: row.role,
      content: scrubbed.content,
      created_at: row.created_at,
      ...(scrubbed.redactions > 0 ? { redactions: scrubbed.redactions } : {}),
    };
    const line = JSON.stringify(out) + '\n';
    stream.write(line);
    bytesWritten += Buffer.byteLength(line, 'utf8');
    rowsExported++;
  }
  stream.end();

  const durationMs = Date.now() - start;
  logger.info({ outputPath, rowsExported, rowsSkipped, bytesWritten, durationMs }, 'Trajectories exported');
  return { outputPath, rowsExported, rowsSkipped, bytesWritten, durationMs };
}

// ── Telegram surface ─────────────────────────────────────────────────

/**
 * Register /export trajectories [--since YYYY-MM-DD] [--raw] [--limit N].
 */
export function registerExportCommands(
  bot: import('grammy').Bot,
  isAuthorised: (chatId: number) => boolean,
): void {
  bot.command('export', async (ctx) => {
    if (!isAuthorised(ctx.chat!.id)) return;
    const raw = (ctx.match ?? '').trim();
    const parts = raw.split(/\s+/).filter(Boolean);
    const sub = parts[0]?.toLowerCase();

    if (sub !== 'trajectories' && sub !== 'traj') {
      await ctx.reply(
        'Usage:\n' +
        '/export trajectories [--since YYYY-MM-DD] [--limit N] [--raw]\n\n' +
        'Default: PII-scrubbed, chat IDs hashed. Pass --raw to disable scrubbing (local fine-tuning only).',
      );
      return;
    }

    const opts: ExportOptions = {};
    for (let i = 1; i < parts.length; i++) {
      const p = parts[i]!;
      if (p === '--raw') opts.raw = true;
      else if (p === '--since' && parts[i + 1]) {
        const d = new Date(parts[++i]!);
        if (!isNaN(d.getTime())) opts.since = d.getTime();
      } else if (p === '--limit' && parts[i + 1]) {
        const n = parseInt(parts[++i]!, 10);
        if (Number.isFinite(n)) opts.limit = n;
      }
    }

    if (opts.raw) {
      await ctx.reply('⚠️ Raw export requested — PII scrubbing disabled, chat IDs not hashed.');
    } else {
      await ctx.reply('Exporting trajectories (PII-scrubbed)…');
    }

    try {
      const r = exportTrajectories(opts);
      await ctx.reply(
        `✓ Exported ${r.rowsExported} rows (skipped ${r.rowsSkipped}) — ` +
        `${(r.bytesWritten / 1024).toFixed(1)}KB in ${r.durationMs}ms\n` +
        `File: ${r.outputPath}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await ctx.reply(`Export failed: ${msg}`);
      logger.warn({ err }, 'Trajectory export failed');
    }
  });
}
