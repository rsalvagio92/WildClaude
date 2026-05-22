/**
 * Digest — "what changed today" rollup.
 *
 * Cheap to compute (pure SQL), runs on demand or via cron. Surfaces:
 *   - new memories
 *   - completed/failed tasks
 *   - skill proposals
 *   - workflow runs
 *   - eval runs
 *   - cost for the period
 */

import { getDb } from './db.js';

export interface DigestMetrics {
  newMemories: number;
  tasksCompleted: number;
  tasksFailed: number;
  skillProposals: number;
  workflowRuns: number;
  evalRuns: number;
  costUsd: number;
  turns: number;
}

export interface Digest {
  periodStart: number;
  periodEnd: number;
  body: string;
  metrics: DigestMetrics;
}

export function computeDigest(periodStart: number, periodEnd: number): Digest {
  // periodStart/End are ms. Legacy tables (memories, conversation_log,
  // token_usage, audit_log) store timestamps in SECONDS; new tables we own
  // (mission_tasks, tool_sequences, workflow_runs, eval_runs, reflections,
  // sandboxes, digests) store ms. Convert per-query.
  const startSec = Math.floor(periodStart / 1000);
  const endSec = Math.floor(periodEnd / 1000);
  const db = getDb();
  const betweenSec = (table: string, col = 'created_at') =>
    db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${col} >= ? AND ${col} < ?`).get(startSec, endSec) as { n: number };

  const newMemories = betweenSec('memories').n;
  const tasksCompleted = (db.prepare(
    `SELECT COUNT(*) AS n FROM mission_tasks WHERE completed_at >= ? AND completed_at < ? AND status = 'completed'`,
  ).get(periodStart, periodEnd) as { n: number }).n;
  const tasksFailed = (db.prepare(
    `SELECT COUNT(*) AS n FROM mission_tasks WHERE completed_at >= ? AND completed_at < ? AND status = 'failed'`,
  ).get(periodStart, periodEnd) as { n: number }).n;

  const skillProposals = (db.prepare(
    `SELECT COUNT(*) AS n FROM tool_sequences WHERE last_seen >= ? AND last_seen < ? AND status = 'proposed'`,
  ).get(periodStart, periodEnd) as { n: number }).n;

  const workflowRuns = (db.prepare(
    `SELECT COUNT(*) AS n FROM workflow_runs WHERE started_at >= ? AND started_at < ?`,
  ).get(periodStart, periodEnd) as { n: number }).n;

  const evalRuns = (db.prepare(
    `SELECT COUNT(*) AS n FROM eval_runs WHERE started_at >= ? AND started_at < ?`,
  ).get(periodStart, periodEnd) as { n: number }).n;

  const costRow = db.prepare(
    `SELECT COALESCE(SUM(cost_usd), 0) AS cost, COUNT(*) AS turns FROM token_usage WHERE created_at >= ? AND created_at < ?`,
  ).get(startSec, endSec) as { cost: number; turns: number };

  const metrics: DigestMetrics = {
    newMemories,
    tasksCompleted,
    tasksFailed,
    skillProposals,
    workflowRuns,
    evalRuns,
    costUsd: costRow.cost,
    turns: costRow.turns,
  };

  const lines: string[] = [
    `Digest: ${new Date(periodStart).toISOString().slice(0, 10)} → ${new Date(periodEnd).toISOString().slice(0, 10)}`,
    `  Turns:           ${metrics.turns}`,
    `  Cost:            $${metrics.costUsd.toFixed(4)}`,
    `  New memories:    ${metrics.newMemories}`,
    `  Tasks completed: ${metrics.tasksCompleted}  (failed: ${metrics.tasksFailed})`,
    `  Workflows run:   ${metrics.workflowRuns}`,
    `  Eval runs:       ${metrics.evalRuns}`,
    `  Skill proposals: ${metrics.skillProposals}`,
  ];

  return { periodStart, periodEnd, body: lines.join('\n'), metrics };
}

export function persistDigest(d: Digest): void {
  getDb().prepare(
    `INSERT INTO digests (period_start, period_end, body, metrics, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(d.periodStart, d.periodEnd, d.body, JSON.stringify(d.metrics), Date.now());
}

export function registerDigestCommand(
  bot: import('grammy').Bot,
  isAuthorised: (chatId: number) => boolean,
): void {
  bot.command('digest', async (ctx) => {
    if (!isAuthorised(ctx.chat!.id)) return;
    const arg = (ctx.match ?? '').trim().toLowerCase() || 'today';
    const now = Date.now();
    let start: number;
    let end = now;
    if (arg === 'today' || arg === 'day') {
      start = now - 24 * 3600 * 1000;
    } else if (arg === 'week') {
      start = now - 7 * 24 * 3600 * 1000;
    } else if (arg === 'month') {
      start = now - 30 * 24 * 3600 * 1000;
    } else {
      await ctx.reply('Usage: /digest [today|week|month]');
      return;
    }
    const d = computeDigest(start, end);
    persistDigest(d);
    await ctx.reply(`<pre>${escapeHtml(d.body)}</pre>`, { parse_mode: 'HTML' });
  });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
