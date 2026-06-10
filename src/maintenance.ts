/**
 * Maintenance — periodic cleanup of artifacts WildClaude accumulates.
 *
 * Runs weekly via __internal:cleanup:run sentinel. Targets:
 *   - sandboxes/ : scratch dirs older than SANDBOX_PRUNE_AGE_MS
 *   - uploads/ : telegram media older than 30 days
 *   - skills/_proposals/ : auto-skill proposals older than 14 days (rejected ones)
 *   - agents/_self-improvement-proposals/ : older than 14 days
 *   - exports/ : trajectory exports older than 60 days
 *   - finetune/ : older than 60 days
 */

import fs from 'fs';
import path from 'path';

import { USER_DATA_DIR } from './paths.js';
import { SANDBOX_PRUNE_AGE_MS } from './config.js';
import { pruneScratchDirs } from './sandbox/local.js';
import { runDbMaintenance } from './db.js';
import { runCliUpdateCheck } from './cli-update.js';
import { logger } from './logger.js';

const DAY = 24 * 3600 * 1000;

interface CleanupResult {
  category: string;
  removed: number;
  bytesFreed: number;
}

function dirSize(p: string): number {
  let total = 0;
  try {
    for (const entry of fs.readdirSync(p, { withFileTypes: true })) {
      const full = path.join(p, entry.name);
      try {
        if (entry.isDirectory()) total += dirSize(full);
        else total += fs.statSync(full).size;
      } catch { /* */ }
    }
  } catch { /* */ }
  return total;
}

/** Remove files in `dir` older than `maxAgeMs`. Returns count + bytes freed. */
function pruneFiles(dir: string, maxAgeMs: number, extensionFilter?: string[]): CleanupResult {
  if (!fs.existsSync(dir)) return { category: path.basename(dir), removed: 0, bytesFreed: 0 };
  const now = Date.now();
  let removed = 0;
  let bytesFreed = 0;
  for (const name of fs.readdirSync(dir)) {
    if (extensionFilter && !extensionFilter.some((ext) => name.endsWith(ext))) continue;
    const full = path.join(dir, name);
    try {
      const st = fs.statSync(full);
      if (now - st.mtimeMs < maxAgeMs) continue;
      const size = st.isDirectory() ? dirSize(full) : st.size;
      if (st.isDirectory()) fs.rmSync(full, { recursive: true, force: true });
      else fs.unlinkSync(full);
      removed++;
      bytesFreed += size;
    } catch (err) {
      logger.warn({ err, full }, 'maintenance: failed to remove');
    }
  }
  return { category: path.basename(dir), removed, bytesFreed };
}

function fmt(b: number): string {
  if (b < 1024) return `${b}B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)}KB`;
  return `${(b / 1024 / 1024).toFixed(2)}MB`;
}

export async function runMaintenanceCleanup(): Promise<string> {
  const results: CleanupResult[] = [];

  // Sandboxes use a dedicated pruner that handles nested dirs
  if (SANDBOX_PRUNE_AGE_MS > 0) {
    const r = pruneScratchDirs(SANDBOX_PRUNE_AGE_MS);
    results.push({ category: 'sandboxes', removed: r.deleted, bytesFreed: r.bytes });
  }

  results.push(pruneFiles(path.join(USER_DATA_DIR, 'uploads'), 30 * DAY));
  results.push(pruneFiles(path.join(USER_DATA_DIR, 'skills', '_proposals'), 14 * DAY, ['.md']));
  results.push(pruneFiles(path.join(USER_DATA_DIR, 'agents', '_self-improvement-proposals'), 14 * DAY, ['.md']));
  results.push(pruneFiles(path.join(USER_DATA_DIR, 'exports'), 60 * DAY));
  results.push(pruneFiles(path.join(USER_DATA_DIR, 'finetune'), 60 * DAY, ['.jsonl']));
  results.push(pruneFiles(path.join(USER_DATA_DIR, 'session-handoffs'), 60 * DAY, ['.md']));

  // Database: trim audit_log to 90 days + truncate the WAL so it can't grow
  // unbounded on long-running devices.
  let dbSummary = '';
  try {
    const db = runDbMaintenance(90);
    dbSummary = `, db: ${db.auditDeleted} audit row(s) pruned, WAL checkpointed (${db.walPages} pages)`;
  } catch (err) {
    logger.warn({ err }, 'maintenance: db maintenance failed');
  }

  // Keep the Claude CLI current — stale CLI means stale models.
  // CLAUDE_CLI_AUTO_UPDATE=false switches this to check-only.
  const cliSummary = runCliUpdateCheck();

  const totalRemoved = results.reduce((a, r) => a + r.removed, 0);
  const totalBytes = results.reduce((a, r) => a + r.bytesFreed, 0);
  const summary = results
    .filter((r) => r.removed > 0)
    .map((r) => `${r.category}: ${r.removed} (${fmt(r.bytesFreed)})`)
    .join(', ') || 'nothing to prune';

  logger.info({ totalRemoved, totalBytes, results }, 'maintenance: cleanup done');
  return `${totalRemoved} item(s), ${fmt(totalBytes)} freed — ${summary}${dbSummary}\n${cliSummary}`;
}
