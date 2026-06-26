/**
 * Machine command queue — primary enqueues, secondaries pull and execute.
 * Commands: restart, set-config, set-stt-provider, kill-session, toggle-automation, etc.
 */

import { getDb } from './db.js';
import { logger } from './logger.js';

export type MachineCommandType =
  | 'restart'
  | 'set-config'
  | 'set-stt-provider'
  | 'kill-session'
  | 'toggle-automation'
  | 'set-model'
  | 'reload-skills'
  | 'clear-cache'
  | 'sync-memories'
  | 'upgrade'
  | 'broadcast'
  | 'run-health-check';

export interface MachineCommand {
  id: number;
  targetId: string;
  type: MachineCommandType;
  payload: Record<string, any>;
  status: 'pending' | 'sent' | 'acked' | 'failed';
  createdAt: number;
  executedAt?: number;
  result?: string;
}

/** Enqueue a command from primary to a specific secondary. */
export function enqueueCommand(
  targetId: string,
  type: MachineCommandType,
  payload: Record<string, any> = {},
): number {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const result = db.prepare(`
    INSERT INTO machine_commands (target_id, type, payload, status, created_at)
    VALUES (?, ?, ?, 'pending', ?)
  `).run(targetId, type, JSON.stringify(payload), now);

  logger.info({ targetId, type, cmdId: result.lastInsertRowid }, 'Command enqueued');
  return result.lastInsertRowid as number;
}

/** List pending commands for a secondary. */
export function getPendingCommands(machineId: string): MachineCommand[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, target_id, type, payload, status, created_at, executed_at, result
    FROM machine_commands
    WHERE target_id = ? AND status IN ('pending', 'sent')
    ORDER BY created_at ASC
    LIMIT 10
  `).all(machineId) as any[];

  return rows.map((r) => ({
    id: r.id,
    targetId: r.target_id,
    type: r.type as MachineCommandType,
    payload: JSON.parse(r.payload || '{}'),
    status: r.status,
    createdAt: r.created_at,
    executedAt: r.executed_at,
    result: r.result,
  }));
}

/** Mark a command as sent (pulled by secondary). */
export function markCommandSent(commandId: number): void {
  const db = getDb();
  db.prepare(`
    UPDATE machine_commands SET status = 'sent' WHERE id = ?
  `).run(commandId);
}

/** Secondary ACKs a command as executed. */
export function ackCommand(commandId: number, result?: string): void {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`
    UPDATE machine_commands SET status = 'acked', executed_at = ?, result = ? WHERE id = ?
  `).run(now, result || null, commandId);

  logger.info({ cmdId: commandId, result }, 'Command ACKed');
}

/** Mark a command as failed. */
export function failCommand(commandId: number, error: string): void {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`
    UPDATE machine_commands SET status = 'failed', executed_at = ?, result = ? WHERE id = ?
  `).run(now, error, commandId);

  logger.warn({ cmdId: commandId, error }, 'Command failed');
}

/** Get command history for a machine (for dashboard). */
export function getCommandHistory(machineId: string, limit = 50): MachineCommand[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, target_id, type, payload, status, created_at, executed_at, result
    FROM machine_commands
    WHERE target_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(machineId, limit) as any[];

  return rows.map((r) => ({
    id: r.id,
    targetId: r.target_id,
    type: r.type as MachineCommandType,
    payload: JSON.parse(r.payload || '{}'),
    status: r.status,
    createdAt: r.created_at,
    executedAt: r.executed_at,
    result: r.result,
  }));
}
