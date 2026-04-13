/**
 * File-based memory layer for WildClaude.
 *
 * Memories are stored as readable .md files in ~/.wild-claude-pi/memories/
 * organized by date and topic. SQLite remains the search index.
 *
 * Structure:
 *   ~/.wild-claude-pi/memories/
 *     2026-04/
 *       2026-04-08-preferences.md
 *       2026-04-08-decisions.md
 *       2026-04-08-general.md
 *     index.md                    (auto-generated summary)
 *
 * Each .md file contains timestamped entries that are human-readable
 * and git-trackable. The SQLite DB indexes them for fast search.
 */

import fs from 'fs';
import path from 'path';
import { USER_DATA_DIR } from './paths.js';
import { logger } from './logger.js';

const MEMORIES_DIR = path.join(USER_DATA_DIR, 'memories');

/**
 * Get the file path for a memory entry based on date and topic.
 */
function getMemoryFilePath(date: Date, topic: string): string {
  const yearMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  const day = String(date.getDate()).padStart(2, '0');
  const safeTopic = topic.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
  const dir = path.join(MEMORIES_DIR, yearMonth);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${yearMonth}-${day}-${safeTopic}.md`);
}

/**
 * Append a memory entry to the appropriate .md file.
 */
export function writeMemoryToFile(
  summary: string,
  topics: string[],
  importance: number,
  source: string,
  rawText?: string,
): void {
  try {
    const now = new Date();
    const timestamp = now.toISOString().replace('T', ' ').slice(0, 19);
    const topic = topics[0] || 'general';
    const filePath = getMemoryFilePath(now, topic);

    const importanceLabel = importance >= 0.8 ? 'HIGH' : importance >= 0.5 ? 'MEDIUM' : 'LOW';
    const rawBlock = rawText && rawText !== summary ? `\n\n<details><summary>Raw</summary>\n\n${rawText.slice(0, 2000)}\n\n</details>` : '';
    const entry = `\n## ${timestamp} [${importanceLabel}]\n\n${summary}${rawBlock}\n\n- Source: ${source}\n- Topics: ${topics.join(', ') || 'general'}\n\n---\n`;

    // Create file with header if it doesn't exist
    if (!fs.existsSync(filePath)) {
      const header = `# Memories: ${topic}\n\nDate: ${now.toISOString().slice(0, 10)}\n\n---\n`;
      fs.writeFileSync(filePath, header);
    }

    fs.appendFileSync(filePath, entry);
    logger.debug({ topic, filePath: path.basename(filePath) }, 'Memory written to file');
  } catch (err) {
    logger.warn({ err }, 'Failed to write memory file (non-fatal)');
  }
}

/**
 * Write a decision to the life log.
 */
export function logDecision(decision: string, context?: string): void {
  try {
    const now = new Date();
    const timestamp = now.toISOString().replace('T', ' ').slice(0, 19);
    const logPath = path.join(USER_DATA_DIR, 'life', 'me', '_kernel', 'log.md');

    fs.mkdirSync(path.dirname(logPath), { recursive: true });

    const entry = `\n## ${timestamp} — Decision\n\n${decision}${context ? `\n\nContext: ${context}` : ''}\n\n---\n`;

    // Prepend to log (newest first)
    let existing = '';
    if (fs.existsSync(logPath)) {
      existing = fs.readFileSync(logPath, 'utf-8');
    } else {
      existing = '# Life Log\n\n';
    }

    // Insert after the header
    const headerEnd = existing.indexOf('\n\n');
    if (headerEnd > 0) {
      const header = existing.slice(0, headerEnd + 2);
      const rest = existing.slice(headerEnd + 2);
      fs.writeFileSync(logPath, header + entry + rest);
    } else {
      fs.writeFileSync(logPath, existing + entry);
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to log decision (non-fatal)');
  }
}

/**
 * Rebuild the memory index (summary of all memory files).
 */
export function rebuildMemoryIndex(): void {
  try {
    if (!fs.existsSync(MEMORIES_DIR)) return;

    const months = fs.readdirSync(MEMORIES_DIR).filter(d =>
      fs.statSync(path.join(MEMORIES_DIR, d)).isDirectory()
    ).sort().reverse();

    const lines: string[] = ['# Memory Index\n', `Updated: ${new Date().toISOString().slice(0, 19)}\n`];

    for (const month of months.slice(0, 6)) {
      const files = fs.readdirSync(path.join(MEMORIES_DIR, month)).filter(f => f.endsWith('.md'));
      lines.push(`\n## ${month}\n`);
      for (const file of files) {
        const filePath = path.join(MEMORIES_DIR, month, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        const entryCount = (content.match(/^## \d{4}-/gm) || []).length;
        lines.push(`- [${file}](${month}/${file}) (${entryCount} entries)`);
      }
    }

    fs.writeFileSync(path.join(MEMORIES_DIR, 'index.md'), lines.join('\n'));
  } catch (err) {
    logger.warn({ err }, 'Failed to rebuild memory index');
  }
}

/**
 * Read all memories from files for a given month (for display/export).
 */
export function readMemoriesForMonth(yearMonth: string): string {
  const dir = path.join(MEMORIES_DIR, yearMonth);
  if (!fs.existsSync(dir)) return `No memories for ${yearMonth}`;

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.md')).sort();
  const parts: string[] = [];
  for (const file of files) {
    parts.push(fs.readFileSync(path.join(dir, file), 'utf-8'));
  }
  return parts.join('\n\n');
}
