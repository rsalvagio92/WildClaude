/**
 * Daily memory file creation — runs at 03:00 every night.
 *
 * Reads memories and conversation log from yesterday's SQLite records
 * and writes a structured Markdown recap to:
 *   ~/.wild-claude-pi/memories/YYYY-MM/YYYY-MM-DD-daily.md
 *
 * Fully local — no API calls.
 */

import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { USER_DATA_DIR } from './paths.js';
import { logger } from './logger.js';

const MEMORIES_DIR = path.join(USER_DATA_DIR, 'memories');
const DB_PATH = path.join(USER_DATA_DIR, 'store', 'wild-claude.db');

/** True if the daily file for `date` already exists. */
function dailyFileExists(date: string): boolean {
  const [year, month] = date.split('-');
  const dir = path.join(MEMORIES_DIR, `${year}-${month}`);
  const file = path.join(dir, `${date}-daily.md`);
  return fs.existsSync(file);
}

/** Write the daily recap file. */
function writeDailyFile(date: string, content: string): void {
  const [year, month] = date.split('-');
  const dir = path.join(MEMORIES_DIR, `${year}-${month}`);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${date}-daily.md`);
  fs.writeFileSync(file, content, 'utf-8');
  logger.info({ file }, 'Daily memory file written');
}

/** Format a Unix timestamp (ms or s) to HH:MM */
function fmtTime(ts: number): string {
  const d = new Date(ts > 1e12 ? ts : ts * 1000);
  return d.toTimeString().slice(0, 5);
}

/**
 * Create the daily memory file for yesterday.
 * Safe to call multiple times — skips if file already exists.
 */
export function createDailyMemoryFile(): void {
  // Use local date math so the correct calendar day is chosen regardless of timezone.
  // toISOString() returns UTC, which can give the wrong date for users in UTC+ zones
  // running close to midnight.
  const now = new Date();
  const localYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const y = localYesterday.getFullYear();
  const m = String(localYesterday.getMonth() + 1).padStart(2, '0');
  const d = String(localYesterday.getDate()).padStart(2, '0');
  const date = `${y}-${m}-${d}`;

  if (dailyFileExists(date)) {
    logger.debug({ date }, 'Daily memory file already exists, skipping');
    return;
  }

  if (!fs.existsSync(DB_PATH)) {
    logger.warn({ DB_PATH }, 'DB not found, skipping daily memory');
    return;
  }

  let db: Database.Database;
  try {
    db = new Database(DB_PATH, { readonly: true });
  } catch (err) {
    logger.error({ err }, 'Failed to open DB for daily memory');
    return;
  }

  try {
    // Use local-time boundaries so DB records (stored in local ms) are matched correctly.
    const startOfDay = new Date(localYesterday.getFullYear(), localYesterday.getMonth(), localYesterday.getDate(), 0, 0, 0, 0).getTime();
    const endOfDay   = new Date(localYesterday.getFullYear(), localYesterday.getMonth(), localYesterday.getDate(), 23, 59, 59, 999).getTime();

    // --- Memories created yesterday ---
    type MemRow = { summary: string; importance: number; topics: string; entities: string; created_at: number };
    const memories = db.prepare(
      `SELECT summary, importance, topics, entities, created_at
       FROM memories
       WHERE created_at >= ? AND created_at <= ?
       ORDER BY importance DESC, created_at ASC`,
    ).all(startOfDay, endOfDay) as MemRow[];

    // --- Conversation turns from yesterday ---
    type ConvRow = { role: string; content: string; created_at: number };
    const convRows = db.prepare(
      `SELECT role, content, created_at
       FROM conversation_log
       WHERE created_at >= ? AND created_at <= ?
       ORDER BY created_at ASC`,
    ).all(startOfDay, endOfDay) as ConvRow[];

    // --- Aggregate topics & entities from memories ---
    const topicCounts = new Map<string, number>();
    const entitySet = new Set<string>();

    for (const mem of memories) {
      try {
        const topics: string[] = JSON.parse(mem.topics);
        for (const t of topics) topicCounts.set(t, (topicCounts.get(t) ?? 0) + 1);
      } catch { /* ignore */ }
      try {
        const entities: string[] = JSON.parse(mem.entities);
        for (const e of entities) entitySet.add(e);
      } catch { /* ignore */ }
    }

    const topTopics = [...topicCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([t, n]) => `${t} (×${n})`);

    const entities = [...entitySet].slice(0, 20);

    // --- Build conversation summary (user turns only, truncated) ---
    const userTurns = convRows
      .filter(r => r.role === 'user')
      .map(r => `- [${fmtTime(r.created_at)}] ${r.content.slice(0, 120)}${r.content.length > 120 ? '…' : ''}`)
      .slice(0, 30);

    // --- Build significant memories section ---
    const significantMems = memories
      .filter(m => m.importance >= 0.5)
      .map(m => `- [${m.importance.toFixed(2)}] ${m.summary}`)
      .slice(0, 40);

    // --- Compose file ---
    const lines: string[] = [
      `# Daily Memory — ${date}`,
      '',
      `> Creato automaticamente alle 03:00 del ${new Date().toISOString().slice(0, 10)}`,
      `> Memorie: ${memories.length} | Turni di conversazione: ${convRows.length}`,
      '',
    ];

    if (topTopics.length) {
      lines.push('## Argomenti principali', '');
      for (const t of topTopics) lines.push(`- ${t}`);
      lines.push('');
    }

    if (entities.length) {
      lines.push('## Entità menzionate', '');
      lines.push(entities.join(', '));
      lines.push('');
    }

    if (significantMems.length) {
      lines.push('## Memorie significative (importance ≥ 0.5)', '');
      lines.push(...significantMems);
      lines.push('');
    } else {
      lines.push('## Memorie significative', '', '_Nessuna memoria rilevante registrata ieri._', '');
    }

    if (userTurns.length) {
      lines.push('## Conversazioni (messaggi utente)', '');
      lines.push(...userTurns);
      lines.push('');
    } else {
      lines.push('## Conversazioni', '', '_Nessuna conversazione registrata ieri._', '');
    }

    writeDailyFile(date, lines.join('\n'));
  } catch (err) {
    logger.error({ err }, 'Error creating daily memory file');
  } finally {
    db.close();
  }
}

/**
 * Start the daily memory scheduler.
 * Checks every hour whether it's time to create yesterday's recap.
 * Runs once on startup (in case bot was down at 03:00).
 */
export function startDailyMemoryScheduler(): void {
  const checkAndCreate = () => {
    const now = new Date();
    const hour = now.getHours();
    // Create between 03:00–03:59 local time (startup handles the missed-03:00 case)
    if (hour === 3) {
      createDailyMemoryFile();
    }
  };

  // Run immediately at startup — catches the case where the bot was down at 03:00
  createDailyMemoryFile();

  // Check every hour
  setInterval(checkAndCreate, 60 * 60 * 1000);
  logger.info('Daily memory scheduler started (checks hourly, fires at 03:00)');
}
