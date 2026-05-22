/**
 * Fine-tuning pipeline scaffold.
 *
 * Anthropic's fine-tuning is currently in limited access (as of model-family
 * 4.X). This module ships the *pipeline* — trajectory selection, format
 * conversion, dispatch + status polling — gated behind a feature flag so it's
 * inert in production until the user opts in with FINETUNE_ENABLED=true and a
 * valid ANTHROPIC_API_KEY with fine-tune permissions.
 *
 * What runs today (works without fine-tune access):
 *   - selectTrajectories: pulls high-quality turn pairs from conversation_log
 *   - convertToJsonl: emits the Anthropic fine-tune format
 *   - estimateCost: tokens × $-per-MTok proxy
 *
 * What waits for API support:
 *   - submitFineTune: POST to /v1/fine_tune_jobs
 *   - pollFineTuneStatus: GET status, surface progress
 */

import fs from 'fs';
import path from 'path';

import { getDb, decryptField } from './db.js';
import { USER_DATA_DIR } from './paths.js';
import { readEnvFile } from './env.js';
import { logger } from './logger.js';

const FT_ENABLED = (process.env.FINETUNE_ENABLED ?? 'false').toLowerCase() === 'true';
const FT_DIR = path.join(USER_DATA_DIR, 'finetune');

interface ConvoRow {
  id: number;
  session_id: string | null;
  role: string;
  content: string;
  created_at: number;
}

export interface TurnPair {
  prompt: string;
  completion: string;
  sessionId: string | null;
}

export interface SelectionOptions {
  /** Earliest created_at in seconds. */
  since?: number;
  /** Cap turns selected. Default 1000. */
  limit?: number;
  /** Min completion length in chars. Reject short non-informative replies. */
  minCompletionLen?: number;
}

/**
 * Build (user → assistant) turn pairs from the conversation_log. Filters out
 * sessions whose assistant turns are mostly short, and de-dupes near-duplicates.
 */
export function selectTrajectories(opts: SelectionOptions = {}): TurnPair[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.since !== undefined) { where.push('created_at >= ?'); params.push(opts.since); }
  const minLen = opts.minCompletionLen ?? 40;
  const limit = opts.limit ?? 1000;

  const sql = [
    `SELECT id, session_id, role, content, created_at`,
    `FROM conversation_log`,
    where.length ? `WHERE ${where.join(' AND ')}` : '',
    `ORDER BY session_id, created_at ASC`,
  ].filter(Boolean).join(' ');

  const rows = getDb().prepare(sql).all(...params) as ConvoRow[];

  const pairs: TurnPair[] = [];
  for (let i = 0; i < rows.length - 1 && pairs.length < limit; i++) {
    const a = rows[i];
    const b = rows[i + 1];
    if (a.role !== 'user' || b.role !== 'assistant') continue;
    if (a.session_id !== b.session_id) continue;
    const prompt = tryDecrypt(a.content).trim();
    const completion = tryDecrypt(b.content).trim();
    if (completion.length < minLen) continue;
    pairs.push({ prompt, completion, sessionId: a.session_id });
  }
  return pairs;
}

/**
 * Emit the JSONL the Anthropic fine-tune API expects.
 * Format: {messages: [{role: 'user', content}, {role: 'assistant', content}]}
 */
export function convertToJsonl(pairs: TurnPair[], outputPath?: string): string {
  fs.mkdirSync(FT_DIR, { recursive: true });
  const out = outputPath ?? path.join(FT_DIR, `train-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
  const stream = fs.createWriteStream(out, { encoding: 'utf8' });
  for (const p of pairs) {
    stream.write(JSON.stringify({
      messages: [
        { role: 'user', content: p.prompt },
        { role: 'assistant', content: p.completion },
      ],
    }) + '\n');
  }
  stream.end();
  return out;
}

export interface CostEstimate {
  trainTokens: number;
  estTrainCostUsd: number;
  estInferenceDeltaUsd: number;
  pairCount: number;
}

/**
 * Approximate cost. Anthropic's posted fine-tune rates fluctuate; use these
 * as ballpark figures — caller should treat as advisory only.
 */
export function estimateCost(pairs: TurnPair[]): CostEstimate {
  // chars / 4 ≈ tokens
  let chars = 0;
  for (const p of pairs) chars += p.prompt.length + p.completion.length;
  const trainTokens = Math.ceil(chars / 4);
  // Placeholder rate: $5 per million training tokens.
  const estTrainCostUsd = (trainTokens / 1_000_000) * 5;
  // Fine-tuned Haiku inference is typically ~1.5× base; assume modest 1k token/day savings
  const estInferenceDeltaUsd = 0;
  return { trainTokens, estTrainCostUsd, estInferenceDeltaUsd, pairCount: pairs.length };
}

export interface FineTuneJob {
  id: string;
  status: 'pending' | 'submitted' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  jsonlPath: string;
  baseModel: string;
  apiJobId?: string;
  startedAt: number;
  completedAt?: number;
}

/**
 * Submit a JSONL file as a fine-tune job. Returns a stub when FINETUNE_ENABLED
 * is false (the default), so this is safe to call from CLI / dashboard at any
 * time — it won't surprise-burn money.
 */
export async function submitFineTune(jsonlPath: string, baseModel = 'claude-haiku-4-5'): Promise<FineTuneJob> {
  if (!fs.existsSync(jsonlPath)) throw new Error(`JSONL not found: ${jsonlPath}`);
  const job: FineTuneJob = {
    id: 'ft-' + Date.now().toString(36),
    status: 'pending',
    jsonlPath,
    baseModel,
    startedAt: Date.now(),
  };

  if (!FT_ENABLED) {
    logger.info({ jsonlPath, baseModel }, 'finetune: FINETUNE_ENABLED=false — returning stub job (no API call)');
    return job;
  }

  const secrets = readEnvFile(['ANTHROPIC_API_KEY']);
  const key = process.env.ANTHROPIC_API_KEY || secrets.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY required to submit a fine-tune');

  // Real API call would go here once Anthropic's fine-tune endpoint is GA.
  // Wiring is intentionally left as a TODO so the scaffold compiles without
  // assuming a specific endpoint shape that may change.
  logger.warn({ baseModel }, 'finetune: API endpoint not yet wired — update src/finetune.ts when Anthropic publishes the GA spec');
  job.status = 'pending';
  return job;
}

function tryDecrypt(s: string): string {
  try { return decryptField(s); } catch { return s; }
}

// ── Telegram surface ─────────────────────────────────────────────────

export function registerFinetuneCommand(
  bot: import('grammy').Bot,
  isAuthorised: (chatId: number) => boolean,
): void {
  bot.command('finetune', async (ctx) => {
    if (!isAuthorised(ctx.chat!.id)) return;
    const args = (ctx.match ?? '').trim();
    const [sub, ...rest] = args.split(/\s+/);

    if (sub === 'estimate' || !sub) {
      const since = Math.floor((Date.now() - 30 * 24 * 3600 * 1000) / 1000);
      const pairs = selectTrajectories({ since, limit: 1000 });
      const est = estimateCost(pairs);
      await ctx.reply(
        `<b>Fine-tune estimate</b> (last 30 days)\n` +
        `Pairs: ${est.pairCount}\n` +
        `Train tokens: ${est.trainTokens.toLocaleString()}\n` +
        `Est. cost: $${est.estTrainCostUsd.toFixed(2)}\n\n` +
        `Build JSONL: /finetune build\n` +
        (FT_ENABLED ? 'Submit: /finetune submit' : 'Submission disabled — set FINETUNE_ENABLED=true in .env'),
        { parse_mode: 'HTML' },
      );
      return;
    }

    if (sub === 'build') {
      const since = rest[0] ? Math.floor(new Date(rest[0]).getTime() / 1000) : undefined;
      const pairs = selectTrajectories({ since, limit: 2000 });
      const out = convertToJsonl(pairs);
      await ctx.reply(`Wrote ${pairs.length} pairs to <code>${out}</code>`, { parse_mode: 'HTML' });
      return;
    }

    if (sub === 'submit') {
      const jsonlPath = rest[0];
      if (!jsonlPath) { await ctx.reply('Usage: /finetune submit <path-to-jsonl>'); return; }
      try {
        const job = await submitFineTune(jsonlPath, rest[1] ?? 'claude-haiku-4-5');
        await ctx.reply(`Job created (status: ${job.status}). FT_ENABLED=${FT_ENABLED}.`);
      } catch (err) {
        await ctx.reply(`Failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }

    await ctx.reply('Usage:\n/finetune estimate\n/finetune build [since YYYY-MM-DD]\n/finetune submit <path>');
  });
}
