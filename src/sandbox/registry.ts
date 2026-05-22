/**
 * In-process and SQLite-backed registry of sandbox lifecycles.
 *
 * Keeps two views:
 *   - in-memory map of active Sandbox instances (for /sandbox list, /sandbox kill)
 *   - sandboxes table in SQLite for audit / dashboard / cleanup
 *
 * The SQL inserts are best-effort: a missing table never blocks sandbox creation.
 */

import { getDb } from '../db.js';
import { logger } from '../logger.js';

export interface SandboxRecord {
  id: string;
  kind: string;
  label: string;
  startedAt: number;
  completedAt: number | null;
}

const liveSandboxes = new Map<string, SandboxRecord>();

export function recordSandbox(id: string, kind: string, label: string): void {
  const startedAt = Date.now();
  liveSandboxes.set(id, { id, kind, label, startedAt, completedAt: null });
  try {
    getDb()
      .prepare(
        `INSERT OR REPLACE INTO sandboxes (id, kind, label, started_at, completed_at)
         VALUES (?, ?, ?, ?, NULL)`,
      )
      .run(id, kind, label, startedAt);
  } catch (err) {
    logger.warn({ err, id }, 'recordSandbox: db insert failed (table missing?)');
  }
}

export function completeSandbox(id: string): void {
  const completedAt = Date.now();
  const rec = liveSandboxes.get(id);
  if (rec) {
    rec.completedAt = completedAt;
    liveSandboxes.delete(id);
  }
  try {
    getDb()
      .prepare(`UPDATE sandboxes SET completed_at = ? WHERE id = ?`)
      .run(completedAt, id);
  } catch (err) {
    logger.warn({ err, id }, 'completeSandbox: db update failed');
  }
}

export function listLiveSandboxes(): SandboxRecord[] {
  return Array.from(liveSandboxes.values());
}

export function listRecentSandboxes(limit = 20): SandboxRecord[] {
  try {
    const rows = getDb()
      .prepare(
        `SELECT id, kind, label, started_at AS startedAt, completed_at AS completedAt
         FROM sandboxes ORDER BY started_at DESC LIMIT ?`,
      )
      .all(limit) as SandboxRecord[];
    return rows;
  } catch {
    return Array.from(liveSandboxes.values()).slice(0, limit);
  }
}
