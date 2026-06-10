/**
 * Part B — Nightly self-IMPROVEMENT of the SOURCE CODE (human-in-the-loop).
 *
 * Off by default (SELF_IMPROVE_CODE_ENABLED). When enabled, each night it:
 *   1. Gathers code-level signals (errors, failed runs, eval failures).
 *   2. Creates an ISOLATED git worktree on a throwaway branch so the running
 *      service's checkout is never disturbed.
 *   3. Runs a bounded Claude coding session there to fix bugs / optimise / add
 *      small features / polish the frontend.
 *   4. GATES the result on `typecheck + build + test` — changes are discarded
 *      unless all three pass.
 *   5. On green, commits to the branch and records a PENDING proposal, then
 *      pings the owner. It NEVER merges or deploys on its own.
 *
 * The owner reviews and decides: `/selfimprove approve` merges the branch into
 * the running branch (then restart to apply); `/selfimprove reject` discards it.
 */

import fs from 'fs';
import path from 'path';
import { execSync, spawnSync } from 'child_process';

import { runAgent } from './agent.js';
import { MODELS } from './models.js';
import { logger } from './logger.js';
import { PROJECT_ROOT, SELF_IMPROVE_CODE_ENABLED, SELF_IMPROVE_MAX_FILES } from './config.js';
import { USER_DATA_DIR } from './paths.js';
import { getRecentBlockedActions, getAuditLog } from './db.js';

const STATE_DIR = path.join(USER_DATA_DIR, 'self-improve');
const PENDING_FILE = path.join(STATE_DIR, 'pending.json');
const WORKTREE_DIR = path.join(path.dirname(PROJECT_ROOT), 'wc-selfimprove');
const GATE_TIMEOUT_MS = 12 * 60 * 1000;
const AGENT_TIMEOUT_MS = 20 * 60 * 1000;

export interface CodeProposal {
  branch: string;
  worktree: string;
  summary: string;
  diffstat: string;
  filesChanged: number;
  createdAt: number;
}

function loadPending(): CodeProposal | null {
  try { return JSON.parse(fs.readFileSync(PENDING_FILE, 'utf-8')); } catch { return null; }
}
function savePending(p: CodeProposal | null): void {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  if (p) fs.writeFileSync(PENDING_FILE, JSON.stringify(p, null, 2));
  else { try { fs.unlinkSync(PENDING_FILE); } catch { /* */ } }
}

function git(args: string, cwd = PROJECT_ROOT, timeout = 60000): string {
  return execSync(`git ${args}`, { cwd, stdio: 'pipe', timeout }).toString();
}

function gitSafe(args: string, cwd = PROJECT_ROOT): void {
  try { git(args, cwd); } catch { /* best-effort cleanup */ }
}

/** Remove any stale worktree/branch from a previous run. */
function cleanupWorktree(branch?: string): void {
  gitSafe(`worktree remove --force "${WORKTREE_DIR}"`);
  try { fs.rmSync(WORKTREE_DIR, { recursive: true, force: true }); } catch { /* */ }
  gitSafe('worktree prune');
  if (branch) gitSafe(`branch -D ${branch}`);
}

function gatherSignals(): string {
  const lines: string[] = [];
  try {
    const blocked = getRecentBlockedActions(10);
    if (blocked.length) lines.push('Blocked/failed actions:\n' + blocked.map((b) => `- ${b.action}: ${(b.detail || '').slice(0, 120)}`).join('\n'));
  } catch { /* */ }
  try {
    const audit = getAuditLog(40).filter((e) => /fail|error|timeout/i.test(e.action + ' ' + (e.detail || '')));
    if (audit.length) lines.push('Recent error-ish audit entries:\n' + audit.slice(0, 10).map((e) => `- ${e.action}: ${(e.detail || '').slice(0, 120)}`).join('\n'));
  } catch { /* */ }
  return lines.join('\n\n') || '(no specific error signals — look for general correctness, robustness, and frontend polish opportunities)';
}

const IMPROVE_PROMPT = (signals: string) => `You are improving the WildClaude codebase autonomously overnight. You are working in an ISOLATED git worktree; your changes will be GATED by \`npm run typecheck\`, \`npm run build\`, and \`npm test\`, then reviewed by a human before merge. If the gate fails, your work is discarded — so keep changes small, correct, and verifiable.

Signals from the last day:
${signals}

Your task: pick the SINGLE highest-value, low-risk improvement and implement it well. Categories, in priority order:
1. A real bug fix (correctness, crash, edge case) backed by the signals or visible in the code.
2. A robustness/efficiency improvement.
3. A small, clearly useful feature or frontend polish.

Hard rules:
- Touch at most ${SELF_IMPROVE_MAX_FILES} files, all under src/ or dashboard-ui/.
- NEVER edit: package.json, package-lock.json, .env, secrets, .github/, anything outside the repo.
- Keep the existing code style. Add/adjust tests when you change logic.
- typecheck + build + test MUST still pass — verify your reasoning before finishing.
- If you change behaviour, keep it backward compatible.
- When done, end your final message with: a one-paragraph SUMMARY of what you changed and why.

Work now. Make the change, then briefly summarise it.`;

/**
 * Run the nightly code-improvement cycle. Returns a status string and pings the
 * owner via `send`. Never merges — leaves a pending proposal on success.
 */
export async function runCodeImprovement(send: (text: string) => Promise<void>): Promise<string> {
  if (!SELF_IMPROVE_CODE_ENABLED) {
    return 'self-improvement (code) disabled';
  }
  // Don't stack proposals — wait for the owner to clear the last one.
  const existing = loadPending();
  if (existing) {
    await send(`🛠️ Code self-improvement skipped — a proposal on \`${existing.branch}\` is still pending review. /selfimprove review`);
    return 'pending proposal exists';
  }

  // Verify git + clean working tree (don't fight uncommitted work).
  let baseBranch: string;
  try {
    baseBranch = git('rev-parse --abbrev-ref HEAD').trim();
    const dirty = git('status --porcelain').trim();
    if (dirty) { await send('🛠️ Code self-improvement skipped — working tree is dirty.'); return 'dirty tree'; }
  } catch (err) {
    logger.warn({ err }, 'self-improve: git unavailable'); return 'git unavailable';
  }

  const date = new Date().toISOString().slice(0, 10);
  const branch = `auto/code-${date}-${Date.now().toString(36).slice(-4)}`;
  cleanupWorktree();

  try {
    git(`worktree add -b ${branch} "${WORKTREE_DIR}" HEAD`);
    // Worktrees don't get node_modules (not tracked) — link the real one so
    // typecheck/build/test can run. POSIX symlink; on failure the gate will
    // report and we discard.
    const nm = path.join(WORKTREE_DIR, 'node_modules');
    if (!fs.existsSync(nm)) {
      try { fs.symlinkSync(path.join(PROJECT_ROOT, 'node_modules'), nm, 'dir'); }
      catch { gitSafe(`worktree remove --force "${WORKTREE_DIR}"`); await send('🛠️ Could not prepare worktree deps — skipped.'); return 'worktree deps failed'; }
    }
  } catch (err) {
    cleanupWorktree(branch);
    logger.warn({ err }, 'self-improve: worktree setup failed');
    await send('🛠️ Code self-improvement: worktree setup failed.');
    return 'worktree setup failed';
  }

  // ── Bounded coding session in the worktree ──
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), AGENT_TIMEOUT_MS);
  let agentSummary = '';
  try {
    const result = await runAgent(
      IMPROVE_PROMPT(gatherSignals()),
      undefined, () => {}, undefined, MODELS.opus, abort,
      undefined, undefined, WORKTREE_DIR, // cwdOverride → tools operate in the worktree
    );
    agentSummary = (result.text || '').trim().slice(-800);
  } catch (err) {
    logger.warn({ err }, 'self-improve: agent session failed');
  } finally {
    clearTimeout(timer);
  }

  // Did it actually change anything?
  const changed = (() => { try { return git('status --porcelain', WORKTREE_DIR).trim(); } catch { return ''; } })();
  if (!changed) {
    cleanupWorktree(branch);
    await send('🛠️ Code self-improvement: no change proposed tonight.');
    return 'no change';
  }

  // Guard: file count + forbidden paths.
  const files = changed.split('\n').map((l) => l.slice(3).trim()).filter(Boolean);
  const forbidden = files.find((f) => /^(package(-lock)?\.json|\.env|\.github\/)/.test(f) || /secrets/i.test(f) || !/^(src\/|dashboard-ui\/)/.test(f));
  if (forbidden || files.length > SELF_IMPROVE_MAX_FILES) {
    cleanupWorktree(branch);
    await send(`🛠️ Code self-improvement: change rejected pre-gate (touched ${files.length} files${forbidden ? `, incl. forbidden \`${forbidden}\`` : ''}).`);
    return 'rejected: scope';
  }

  // ── GATE: typecheck → build → test ──
  const gate = (cmd: string): boolean => {
    const r = spawnSync(cmd, { cwd: WORKTREE_DIR, shell: true, timeout: GATE_TIMEOUT_MS, env: process.env, stdio: 'pipe' });
    return r.status === 0;
  };
  await send('🛠️ Code self-improvement: changes made, running typecheck + build + test…');
  const typeOk = gate('npm run typecheck');
  const buildOk = typeOk && gate('npm run build');
  const testOk = buildOk && gate('npm test');
  if (!typeOk || !buildOk || !testOk) {
    cleanupWorktree(branch);
    const failed = !typeOk ? 'typecheck' : !buildOk ? 'build' : 'test';
    await send(`🛠️ Code self-improvement discarded — ${failed} failed on the proposed change. Nothing merged.`);
    return `gate failed: ${failed}`;
  }

  // ── Green: commit on the branch, record pending proposal ──
  let diffstat = '';
  try {
    git('add -A', WORKTREE_DIR);
    git(`commit -m "auto(self-improve): ${date}\n\n${agentSummary.slice(0, 400).replace(/"/g, "'")}"`, WORKTREE_DIR);
    diffstat = git(`diff --stat ${baseBranch} ${branch}`, PROJECT_ROOT).trim().slice(-600);
  } catch (err) {
    cleanupWorktree(branch);
    logger.warn({ err }, 'self-improve: commit failed');
    await send('🛠️ Code self-improvement: commit failed after gate passed.');
    return 'commit failed';
  }

  // Remove the worktree dir but KEEP the branch for review/merge.
  gitSafe(`worktree remove --force "${WORKTREE_DIR}"`);
  gitSafe('worktree prune');

  const proposal: CodeProposal = { branch, worktree: WORKTREE_DIR, summary: agentSummary, diffstat, filesChanged: files.length, createdAt: Date.now() };
  savePending(proposal);

  await send(
    `✅ <b>Code self-improvement ready for review</b>\n` +
    `Branch: <code>${branch}</code> · ${files.length} file(s), all gates green.\n\n` +
    `<b>Summary:</b>\n${agentSummary.slice(0, 600)}\n\n` +
    `<pre>${diffstat.replace(/</g, '&lt;')}</pre>\n` +
    `Review: <code>/selfimprove review</code> · Apply: <code>/selfimprove approve</code> · Discard: <code>/selfimprove reject</code>`,
  );
  logger.info({ branch, files: files.length }, 'self-improve: proposal ready');
  return `proposal ready: ${branch}`;
}

// ── Human-in-the-loop controls ──────────────────────────────────────────

export function getPendingProposal(): CodeProposal | null { return loadPending(); }

/** Merge the approved branch into the running branch. Caller restarts to apply. */
export function approveProposal(): { ok: boolean; message: string } {
  const p = loadPending();
  if (!p) return { ok: false, message: 'No pending proposal.' };
  try {
    const dirty = git('status --porcelain').trim();
    if (dirty) return { ok: false, message: 'Working tree is dirty — resolve before merging.' };
    git(`merge --no-ff ${p.branch} -m "Merge self-improvement ${p.branch}"`);
    gitSafe(`branch -D ${p.branch}`);
    savePending(null);
    return { ok: true, message: `Merged ${p.branch}. Restart the service to apply (/selfimprove or system restart).` };
  } catch (err) {
    return { ok: false, message: `Merge failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** Discard the pending proposal and its branch. */
export function rejectProposal(): { ok: boolean; message: string } {
  const p = loadPending();
  if (!p) return { ok: false, message: 'No pending proposal.' };
  cleanupWorktree(p.branch);
  savePending(null);
  return { ok: true, message: `Discarded ${p.branch}.` };
}

// ── Telegram surface ─────────────────────────────────────────────────────

/** Registers /selfimprove (code, human-in-loop) and /selflearn (user-data). */
export function registerSelfImprovementCommands(
  bot: import('grammy').Bot,
  isAuthorised: (chatId: number) => boolean,
): void {
  const html = (ctx: import('grammy').Context, t: string) => ctx.reply(t, { parse_mode: 'HTML' });

  bot.command('selfimprove', async (ctx) => {
    if (!isAuthorised(ctx.chat!.id)) return;
    const sub = (ctx.match || '').trim().toLowerCase();

    if (sub === 'review' || sub === '') {
      const p = getPendingProposal();
      if (!p) { await html(ctx, 'No pending code proposal.' + (SELF_IMPROVE_CODE_ENABLED ? '' : '\n(Code self-improvement is off — set SELF_IMPROVE_CODE_ENABLED=true to enable nightly runs.)')); return; }
      await html(ctx, `<b>Pending code proposal</b>\nBranch: <code>${p.branch}</code> · ${p.filesChanged} file(s)\n\n<b>Summary:</b>\n${p.summary.slice(0, 700)}\n\n<pre>${p.diffstat.replace(/</g, '&lt;')}</pre>\n/selfimprove approve · /selfimprove reject`);
      return;
    }
    if (sub === 'approve') {
      const r = approveProposal();
      await html(ctx, (r.ok ? '✅ ' : '⚠️ ') + r.message);
      return;
    }
    if (sub === 'reject') {
      const r = rejectProposal();
      await html(ctx, (r.ok ? '🗑️ ' : '⚠️ ') + r.message);
      return;
    }
    if (sub === 'run') {
      if (!SELF_IMPROVE_CODE_ENABLED) { await html(ctx, 'Code self-improvement is disabled (SELF_IMPROVE_CODE_ENABLED=false).'); return; }
      await html(ctx, '🛠️ Running code self-improvement now (this can take several minutes)…');
      runCodeImprovement((t) => html(ctx, t).then(() => {})).catch((err) => { logger.warn({ err }, 'manual self-improve failed'); });
      return;
    }
    await html(ctx, 'Usage: /selfimprove review | approve | reject | run');
  });

  bot.command('selflearn', async (ctx) => {
    if (!isAuthorised(ctx.chat!.id)) return;
    await html(ctx, '🌙 Running self-learning + backup now…');
    const { runSelfLearning } = await import('./self-learning.js');
    runSelfLearning((t) => html(ctx, t).then(() => {})).catch((err) => { logger.warn({ err }, 'manual self-learn failed'); });
  });
}
