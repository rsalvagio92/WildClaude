/**
 * Outbox for memory writes on secondary machines.
 * When primary is unreachable, queue locally and flush when back online.
 */

import path from 'path';
import fs from 'fs';
import { USER_DATA_DIR } from './paths.js';
import { logger } from './logger.js';

export interface OutboxEntry {
  id: string;
  timestamp: number;
  type: 'memory' | 'consolidation' | 'block'; // memory_block type
  payload: unknown;
  retries: number;
  lastError?: string;
}

const OUTBOX_DIR = path.join(USER_DATA_DIR, 'outbox');

function ensureOutboxDir() {
  if (!fs.existsSync(OUTBOX_DIR)) {
    fs.mkdirSync(OUTBOX_DIR, { recursive: true });
  }
}

export function enqueueOutbox(type: OutboxEntry['type'], payload: unknown): string {
  ensureOutboxDir();
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const entry: OutboxEntry = {
    id,
    timestamp: Date.now(),
    type,
    payload,
    retries: 0,
  };
  const file = path.join(OUTBOX_DIR, `${id}.json`);
  fs.writeFileSync(file, JSON.stringify(entry, null, 2));
  logger.info({ id, type }, 'Outbox enqueued (primary unreachable)');
  return id;
}

export function listOutbox(): OutboxEntry[] {
  ensureOutboxDir();
  const files = fs.readdirSync(OUTBOX_DIR).filter(f => f.endsWith('.json'));
  return files.map(f => JSON.parse(fs.readFileSync(path.join(OUTBOX_DIR, f), 'utf8')) as OutboxEntry);
}

export function removeOutboxEntry(id: string): void {
  const file = path.join(OUTBOX_DIR, `${id}.json`);
  if (fs.existsSync(file)) {
    fs.unlinkSync(file);
    logger.info({ id }, 'Outbox entry flushed');
  }
}

export function updateOutboxRetry(id: string, error: string): void {
  const file = path.join(OUTBOX_DIR, `${id}.json`);
  if (!fs.existsSync(file)) return;
  const entry = JSON.parse(fs.readFileSync(file, 'utf8')) as OutboxEntry;
  entry.retries++;
  entry.lastError = error;
  fs.writeFileSync(file, JSON.stringify(entry, null, 2));
}
