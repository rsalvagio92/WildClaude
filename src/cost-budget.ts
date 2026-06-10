/**
 * Cost budget alerts + soft-throttle.
 *
 * Reads from token_usage (created_at = SECONDS). Tracks monthly spend and:
 *   - sends an alert at 80% of MONTHLY_BUDGET_USD
 *   - sends a hard-cap notice at 100%
 *   - exposes shouldDowngradeForBudget() so the router can switch from
 *     Opus/Sonnet to Haiku once the cap is hit (soft-throttle).
 *
 * Set MONTHLY_BUDGET_USD=0 (default) to disable.
 */

import { getDb } from './db.js';
import { logger } from './logger.js';

const BUDGET_USD = parseFloat(process.env.MONTHLY_BUDGET_USD ?? '0');

// Alert state: don't spam the user. Once we cross 80 or 100, remember until next month.
let lastAlertMonth = '';
let alerted80 = false;
let alerted100 = false;

function currentMonthKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function resetIfNewMonth(): void {
  const m = currentMonthKey();
  if (m !== lastAlertMonth) {
    lastAlertMonth = m;
    alerted80 = false;
    alerted100 = false;
  }
}

export interface BudgetStatus {
  monthKey: string;
  /** Real API spend this month (auth_mode='api' rows only). */
  spentUsd: number;
  /** What this month's usage WOULD cost at API rates, across all modes.
   *  For subscription users this is informational, not billed. */
  equivalentUsd: number;
  budgetUsd: number;
  /** spentUsd / budgetUsd, capped at unbounded if no budget configured. */
  ratio: number;
  /** Number of turns this month. */
  turns: number;
  enabled: boolean;
}

export function getBudgetStatus(): BudgetStatus {
  const month = currentMonthKey();
  const startSec = Math.floor(new Date(`${month}-01T00:00:00`).getTime() / 1000);
  // Only auth_mode='api' rows represent real dollars. Subscription/CLI turns
  // report a cost figure too, but it's covered by the plan — counting it
  // would fire fake budget alerts and downgrade the router for no reason.
  const row = getDb().prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN auth_mode = 'api' THEN cost_usd ELSE 0 END), 0) AS apiCost,
       COALESCE(SUM(cost_usd), 0) AS allCost,
       COUNT(*) AS turns
     FROM token_usage WHERE created_at >= ?`,
  ).get(startSec) as { apiCost: number; allCost: number; turns: number };

  return {
    monthKey: month,
    spentUsd: row.apiCost,
    equivalentUsd: row.allCost,
    budgetUsd: BUDGET_USD,
    ratio: BUDGET_USD > 0 ? row.apiCost / BUDGET_USD : 0,
    turns: row.turns,
    enabled: BUDGET_USD > 0,
  };
}

/** Returns true when we're past the cap and the caller should consider downgrading. */
export function shouldDowngradeForBudget(): boolean {
  if (BUDGET_USD <= 0) return false;
  const s = getBudgetStatus();
  return s.ratio >= 1.0;
}

/**
 * Called by the daily cron. Sends Telegram alerts at 80% and 100% thresholds
 * (each at most once per month).
 */
export async function checkBudgetAndAlert(send: (text: string) => Promise<void>): Promise<void> {
  if (BUDGET_USD <= 0) {
    logger.debug('cost-budget: MONTHLY_BUDGET_USD not set, skipping');
    return;
  }
  resetIfNewMonth();
  const s = getBudgetStatus();
  if (s.ratio >= 1.0 && !alerted100) {
    alerted100 = true;
    await send(
      `🔴 <b>Budget exceeded</b>\n` +
      `Mese ${s.monthKey}: spesi $${s.spentUsd.toFixed(4)} / $${BUDGET_USD.toFixed(2)} ` +
      `(${(s.ratio * 100).toFixed(0)}%)\n` +
      `Da ora il router fa downgrade auto a Haiku per i task non-critici.`,
    );
  } else if (s.ratio >= 0.8 && !alerted80) {
    alerted80 = true;
    await send(
      `🟡 <b>Budget alert (80%)</b>\n` +
      `Mese ${s.monthKey}: spesi $${s.spentUsd.toFixed(4)} / $${BUDGET_USD.toFixed(2)} ` +
      `(${(s.ratio * 100).toFixed(0)}%) — ${s.turns} turni`,
    );
  }
}

export function registerBudgetCommand(
  bot: import('grammy').Bot,
  isAuthorised: (chatId: number) => boolean,
): void {
  bot.command('budget', async (ctx) => {
    if (!isAuthorised(ctx.chat!.id)) return;
    const s = getBudgetStatus();
    const lines: string[] = [`<b>Budget</b> — ${s.monthKey}`];
    if (!s.enabled) {
      lines.push('Nessun budget mensile impostato. Imposta <code>MONTHLY_BUDGET_USD=10</code> in .env per abilitare.');
      lines.push(`Spesa API reale: $${s.spentUsd.toFixed(4)} su ${s.turns} turni.`);
      if (s.equivalentUsd > s.spentUsd) {
        lines.push(`Uso subscription (equivalente API, non fatturato): $${(s.equivalentUsd - s.spentUsd).toFixed(4)}`);
      }
    } else {
      const pct = (s.ratio * 100).toFixed(0);
      const bar = renderBar(s.ratio);
      lines.push(`Spesa API: $${s.spentUsd.toFixed(4)} / $${s.budgetUsd.toFixed(2)} (${pct}%)`);
      lines.push(`Turni: ${s.turns}`);
      if (s.equivalentUsd > s.spentUsd) {
        lines.push(`Uso subscription (non fatturato): $${(s.equivalentUsd - s.spentUsd).toFixed(4)}`);
      }
      lines.push(bar);
      if (s.ratio >= 1.0) lines.push('⚠️ Cap raggiunto. Router fa downgrade automatico a Haiku.');
      else if (s.ratio >= 0.8) lines.push('🟡 Avvicinandoti al cap.');
    }
    await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' });
  });
}

function renderBar(ratio: number, width = 20): string {
  const filled = Math.min(width, Math.max(0, Math.floor(ratio * width)));
  return '[' + '█'.repeat(filled) + '░'.repeat(width - filled) + ']';
}
