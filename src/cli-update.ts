/**
 * Claude CLI version check + auto-update.
 *
 * WildClaude shells out to the `claude` CLI for every agent call, so a stale
 * CLI means stale models and missing features. The weekly maintenance run
 * checks the installed version against the npm registry and (unless
 * CLAUDE_CLI_AUTO_UPDATE=false) updates it, reporting the result in the
 * maintenance summary that lands in Telegram.
 */

import { execSync } from 'child_process';

import { logger } from './logger.js';

const NPM_PACKAGE = '@anthropic-ai/claude-code';

function run(cmd: string, timeoutMs = 30000): string | null {
  try {
    return execSync(cmd, { stdio: 'pipe', timeout: timeoutMs }).toString().trim();
  } catch {
    return null;
  }
}

export interface CliVersionStatus {
  installed: string | null;
  latest: string | null;
  updateAvailable: boolean;
}

/** Compare installed `claude` CLI version against the npm registry. */
export function checkClaudeCliVersion(): CliVersionStatus {
  const versionOut = run('claude --version', 10000);
  // Output looks like "2.1.170 (Claude Code)" — take the leading semver.
  const installed = versionOut?.match(/\d+\.\d+\.\d+/)?.[0] ?? null;
  const latest = run(`npm view ${NPM_PACKAGE} version`, 20000);
  const updateAvailable = !!installed && !!latest && installed !== latest;
  return { installed, latest, updateAvailable };
}

/**
 * Update the CLI. Tries the CLI's own updater first (handles native installs),
 * then falls back to npm. Returns a human-readable result line.
 */
export function updateClaudeCli(): string {
  const before = checkClaudeCliVersion();
  if (!before.installed) return 'Claude CLI not found on PATH — skipping update';
  if (!before.updateAvailable) return `Claude CLI up to date (${before.installed})`;

  logger.info({ from: before.installed, to: before.latest }, 'Updating Claude CLI');
  let ok = run('claude update', 120000) !== null;
  if (!ok) ok = run(`npm install -g ${NPM_PACKAGE}@latest`, 180000) !== null;

  const after = checkClaudeCliVersion();
  if (ok && after.installed && after.installed !== before.installed) {
    return `Claude CLI updated ${before.installed} → ${after.installed}`;
  }
  if (!ok) {
    logger.warn({ before }, 'Claude CLI update failed');
    return `Claude CLI update available (${before.installed} → ${before.latest}) but auto-update failed — run "claude update" manually`;
  }
  return `Claude CLI update attempted (${before.installed} → ${before.latest}); restart to pick it up`;
}

/** Weekly maintenance hook. Honors CLAUDE_CLI_AUTO_UPDATE=false (check-only). */
export function runCliUpdateCheck(): string {
  try {
    if (process.env.CLAUDE_CLI_AUTO_UPDATE === 'false') {
      const s = checkClaudeCliVersion();
      return s.updateAvailable
        ? `Claude CLI ${s.installed} — ${s.latest} available (auto-update disabled)`
        : `Claude CLI up to date (${s.installed ?? 'not found'})`;
    }
    return updateClaudeCli();
  } catch (err) {
    logger.warn({ err }, 'cli-update: check failed');
    return 'Claude CLI version check failed';
  }
}
