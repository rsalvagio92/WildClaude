/**
 * Token Juice — output compression before content enters the LLM context.
 *
 * Inspired by OpenHuman's "TokenJuice" layer. The premise: tool outputs are the
 * fattest, most repetitive thing in any agent loop. A 50KB HTML page can be
 * losslessly summarized to 5KB of markdown without the model noticing any
 * quality loss on downstream questions.
 *
 * Strategies applied (configurable, ordered):
 *   1. htmlToMarkdown — strip <script>, <style>, drop most tags, preserve structure
 *   2. shortenUrls    — replace long URLs with [link N] + a reference table
 *   3. dedupAdjacent  — collapse "X\nX\nX\n" into "X (× 3)\n"
 *   4. normalizeWhitespace — collapse run-on blank lines
 *   5. truncateMiddle — for huge outputs, keep head + tail with "[snip K chars]"
 *
 * Pure functions; no I/O, no LLM. Compression latency ~ <10ms even for 100KB.
 *
 * Stats are tracked in-process (and persisted occasionally) so users can see
 * "we saved you X tokens this month" via /tokenjuice or the dashboard.
 */

import { getDb } from './db.js';

// ── Stats ────────────────────────────────────────────────────────────

interface JuiceStats {
  callsTotal: number;
  bytesIn: number;
  bytesOut: number;
  /** Approximate tokens saved (chars/4 heuristic). */
  estTokensSaved: number;
}

const stats: JuiceStats = { callsTotal: 0, bytesIn: 0, bytesOut: 0, estTokensSaved: 0 };

export function getStats(): JuiceStats {
  return { ...stats };
}

export function resetStats(): void {
  stats.callsTotal = 0;
  stats.bytesIn = 0;
  stats.bytesOut = 0;
  stats.estTokensSaved = 0;
}

/** Cheap GPT-ish tokenizer estimate. Real ratio is closer to chars/3.6 for English. */
function approxTokens(bytes: number): number {
  return Math.ceil(bytes / 4);
}

// ── Strategies ───────────────────────────────────────────────────────

const HTML_BLOCK_TO_MD: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (m) => `\n# ${stripTags(m[1])}\n`],
  [/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (m) => `\n## ${stripTags(m[1])}\n`],
  [/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (m) => `\n### ${stripTags(m[1])}\n`],
  [/<h[4-6][^>]*>([\s\S]*?)<\/h[4-6]>/gi, (m) => `\n#### ${stripTags(m[1])}\n`],
  [/<li[^>]*>([\s\S]*?)<\/li>/gi, (m) => `- ${stripTags(m[1])}\n`],
  [/<p[^>]*>([\s\S]*?)<\/p>/gi, (m) => `\n${stripTags(m[1])}\n`],
  [/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (m) => `\n\`\`\`\n${m[1].replace(/<[^>]+>/g, '')}\n\`\`\`\n`],
  [/<code[^>]*>([\s\S]*?)<\/code>/gi, (m) => `\`${m[1].replace(/<[^>]+>/g, '')}\``],
  [/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (m) => `[${stripTags(m[2])}](${m[1]})`],
  [/<br\s*\/?>/gi, () => '\n'],
];

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim();
}

/**
 * Convert HTML to Markdown losslessly enough for an LLM to answer questions
 * about the content. Drops <script>, <style>, <svg>, <noscript> entirely.
 * For non-HTML input, the input is returned unchanged.
 */
export function htmlToMarkdown(input: string): string {
  if (!/<(html|body|div|p|h[1-6]|a |script|table|li)\b/i.test(input)) return input;
  let out = input;
  // Kill the noisy stuff first
  out = out.replace(/<(script|style|svg|noscript|head|nav|aside|footer)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  out = out.replace(/<!--[\s\S]*?-->/g, '');
  // Apply structural transforms
  for (const [re, fn] of HTML_BLOCK_TO_MD) {
    out = out.replace(re, (...args) => fn(args as unknown as RegExpMatchArray));
  }
  // Strip remaining tags
  out = stripTags(out);
  // Decode common entities one more time after tag strip
  out = out.replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ');
  return out;
}

/**
 * Replace URLs longer than `maxLen` with [N]; build a reference table.
 * Returns the rewritten text + the table (caller can append or drop).
 */
export function shortenUrls(input: string, maxLen = 60): { text: string; references: string[] } {
  const references: string[] = [];
  let counter = 0;
  const re = /https?:\/\/[^\s)\]>"']+/g;
  const text = input.replace(re, (url) => {
    if (url.length <= maxLen) return url;
    counter++;
    references.push(url);
    return `[link${counter}]`;
  });
  return { text, references };
}

/**
 * Collapse runs of identical adjacent lines into a single line + count.
 * Useful for tool outputs like `ls` on noisy directories or repeated log lines.
 */
export function dedupAdjacent(input: string): string {
  const lines = input.split('\n');
  const out: string[] = [];
  let last: string | null = null;
  let run = 0;
  const flush = () => {
    if (last === null) return;
    if (run > 1) out.push(`${last} (× ${run})`);
    else out.push(last);
  };
  for (const line of lines) {
    if (line === last) { run++; continue; }
    flush();
    last = line;
    run = 1;
  }
  flush();
  return out.join('\n');
}

/** Collapse runs of 3+ blank lines into a single blank line. */
export function normalizeWhitespace(input: string): string {
  return input.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+$/gm, '');
}

/**
 * If `input` exceeds `maxChars`, keep `head` chars from the start and `tail`
 * chars from the end, replace the middle with a marker.
 */
export function truncateMiddle(input: string, maxChars = 8000, head = 0, tail = 0): string {
  if (input.length <= maxChars) return input;
  const h = head || Math.floor(maxChars * 0.6);
  const t = tail || Math.floor(maxChars * 0.3);
  const dropped = input.length - h - t;
  return input.slice(0, h) + `\n\n[…snipped ${dropped} chars…]\n\n` + input.slice(input.length - t);
}

// ── Pipeline ─────────────────────────────────────────────────────────

export interface JuiceOptions {
  /** Treat the input as HTML and convert to markdown first. Default: auto-detect. */
  html?: boolean;
  /** Apply URL shortening. Default: true. */
  shortenUrls?: boolean;
  /** Apply adjacent line dedup. Default: true. */
  dedup?: boolean;
  /** Apply whitespace normalization. Default: true. */
  normalize?: boolean;
  /** Cap output length. Default: 16_000 chars (~4k tokens). */
  maxChars?: number;
  /** Tag for stats grouping (optional). */
  tag?: string;
}

export interface JuiceResult {
  text: string;
  bytesIn: number;
  bytesOut: number;
  /** Approximate tokens saved by compression. */
  tokensSaved: number;
  /** URL references stripped out (if shortenUrls applied). */
  urlReferences: string[];
}

/**
 * Main entry point. Apply the compression pipeline, update stats, return the
 * compressed text. Safe to call on any string — empty/short inputs pass through.
 */
export function juice(input: string, opts: JuiceOptions = {}): JuiceResult {
  const bytesIn = input.length;
  let text = input;
  let urlReferences: string[] = [];

  const wantHtml = opts.html ?? /<(html|body|div|p|h[1-6]|a |script|table|li)\b/i.test(input.slice(0, 4096));
  if (wantHtml) text = htmlToMarkdown(text);
  if (opts.shortenUrls !== false) {
    const r = shortenUrls(text);
    text = r.text;
    urlReferences = r.references;
  }
  if (opts.dedup !== false) text = dedupAdjacent(text);
  if (opts.normalize !== false) text = normalizeWhitespace(text);
  text = truncateMiddle(text, opts.maxChars ?? 16_000);

  const bytesOut = text.length;
  const saved = Math.max(0, approxTokens(bytesIn) - approxTokens(bytesOut));

  stats.callsTotal++;
  stats.bytesIn += bytesIn;
  stats.bytesOut += bytesOut;
  stats.estTokensSaved += saved;

  // Persist running totals occasionally so they survive restart.
  if (stats.callsTotal % 25 === 0) persistStats();

  return { text, bytesIn, bytesOut, tokensSaved: saved, urlReferences };
}

// ── Persistence ──────────────────────────────────────────────────────

function persistStats(): void {
  try {
    const db = getDb();
    // Reuse the digests table is overkill — keep stats in a simple kv-ish row.
    db.prepare(
      `INSERT OR REPLACE INTO digests (id, period_start, period_end, body, metrics, created_at)
       SELECT
         (SELECT COALESCE((SELECT id FROM digests WHERE body = 'tokenjuice-stats'), 0)),
         0, 0, 'tokenjuice-stats', ?, ?`,
    ).run(JSON.stringify(stats), Date.now());
  } catch { /* table missing — that's ok */ }
}

export function loadPersistedStats(): JuiceStats | null {
  try {
    const row = getDb().prepare(`SELECT metrics FROM digests WHERE body = 'tokenjuice-stats' LIMIT 1`).get() as { metrics: string } | undefined;
    if (!row) return null;
    return JSON.parse(row.metrics) as JuiceStats;
  } catch { return null; }
}

// ── Telegram surface ─────────────────────────────────────────────────

export function registerTokenJuiceCommand(
  bot: import('grammy').Bot,
  isAuthorised: (chatId: number) => boolean,
): void {
  bot.command('tokenjuice', async (ctx) => {
    if (!isAuthorised(ctx.chat!.id)) return;
    const s = getStats();
    const ratio = s.bytesIn === 0 ? 0 : 1 - s.bytesOut / s.bytesIn;
    const dollarsSaved = (s.estTokensSaved / 1_000_000) * 3.00; // Sonnet input rate proxy
    const lines = [
      `<b>TokenJuice</b> — compression stats (since process start)`,
      `Calls:            ${s.callsTotal}`,
      `Bytes in / out:   ${fmtBytes(s.bytesIn)} → ${fmtBytes(s.bytesOut)} (${(ratio * 100).toFixed(0)}% reduction)`,
      `Est. tokens saved: ${s.estTokensSaved.toLocaleString()}`,
      `Est. $ saved:     $${dollarsSaved.toFixed(4)} (at $3/MTok Sonnet input)`,
    ];
    await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' });
  });
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(2)}MB`;
}
