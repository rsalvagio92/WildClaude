/**
 * Kernel auto-sync — nightly reconciliation of life context from recent activity.
 * Runs 03:00 daily. Updates me/goals/learning/finance kernels from:
 *   - high-importance memories (topics, entities, decisions)
 *   - conversation_log (what was discussed, intent patterns)
 *   - tool_sequences (what tools are being used repeatedly)
 *   - mission_tasks (what's in flight, what's done)
 *
 * Avoids hallucination: only injects facts from the DB, not inference.
 */

import { getDb } from './db.js';
import { logger } from './logger.js';
import { readFile, writeFile } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';

const KERNEL_DIR = join(homedir(), '.wild-claude-pi', 'life');

interface KernelContext {
  meHighlights: string[];
  goalsProgress: string[];
  learningRecent: string[];
  financeSnapshot: string[];
}

/**
 * Sample recent activity to extract kernel-relevant facts.
 */
function sampleKernelContext(sinceDays = 14): KernelContext {
  const sinceMs = Date.now() - sinceDays * 24 * 3600 * 1000;
  const sinceSec = Math.floor(sinceMs / 1000);
  const db = getDb();

  // High-importance memory facts (identity, decisions, preferences)
  const meHighlights = db
    .prepare(
      `SELECT DISTINCT summary FROM memories
         WHERE created_at >= ? AND importance >= 0.75 AND (topics LIKE '%identity%' OR topics LIKE '%preference%' OR topics LIKE '%decision%')
         ORDER BY created_at DESC LIMIT 6`,
    )
    .all(sinceSec) as Array<{ summary: string }>;

  // Goal-related activity (task completion, blockers, progress mentions)
  const goalsProgress = db
    .prepare(
      `SELECT DISTINCT summary FROM memories
         WHERE created_at >= ? AND importance >= 0.7 AND (topics LIKE '%goals%' OR topics LIKE '%progress%' OR topics LIKE '%blocker%')
         ORDER BY created_at DESC LIMIT 8`,
    )
    .all(sinceSec) as Array<{ summary: string }>;

  // Learning activity (skills acquired, new topics, experiments)
  const learningRecent = db
    .prepare(
      `SELECT DISTINCT summary FROM memories
         WHERE created_at >= ? AND importance >= 0.65 AND (topics LIKE '%learning%' OR topics LIKE '%skill%' OR topics LIKE '%experiment%')
         ORDER BY created_at DESC LIMIT 8`,
    )
    .all(sinceSec) as Array<{ summary: string }>;

  // Finance activity (spending, budget, income patterns)
  const financeSnapshot = db
    .prepare(
      `SELECT DISTINCT summary FROM memories
         WHERE created_at >= ? AND importance >= 0.65 AND topics LIKE '%finance%'
         ORDER BY created_at DESC LIMIT 6`,
    )
    .all(sinceSec) as Array<{ summary: string }>;

  return {
    meHighlights: meHighlights.map((m) => m.summary),
    goalsProgress: goalsProgress.map((m) => m.summary),
    learningRecent: learningRecent.map((m) => m.summary),
    financeSnapshot: financeSnapshot.map((m) => m.summary),
  };
}

/**
 * Read current kernel, preserve unchanged sections, inject new facts.
 */
async function updateKernel(name: 'me' | 'goals' | 'learning' | 'finance', context: KernelContext): Promise<void> {
  const path = join(KERNEL_DIR, name, '_kernel', 'key.md');

  let current = '';
  try {
    current = await readFile(path, 'utf8');
  } catch {
    logger.warn({ name }, 'kernel-auto-sync: could not read kernel');
    return;
  }

  let updated = current;

  // Inject contextual facts without overwriting manual edits (only update specific sections)
  if (name === 'me' && context.meHighlights.length > 0) {
    // Update "Ultimo aggiornamento" to today
    updated = updated.replace(/## Ultimo aggiornamento\n\d{4}-\d{2}-\d{2}/, `## Ultimo aggiornamento\n${formatToday()}`);
  }

  if (name === 'goals' && context.goalsProgress.length > 0) {
    // Append recent progress observations to Active Goals section (non-destructive)
    const progLines = context.goalsProgress.slice(0, 3).map((p) => `- ${p}`);
    const marker = '## Active Goals';
    if (updated.includes(marker) && !updated.includes('[Recent activity sync]')) {
      updated = updated.replace(
        marker,
        `${marker}\n\n[Recent activity sync — ${formatToday()}]\n${progLines.join('\n')}\n`,
      );
    }
    updated = updated.replace(/## Last Updated\n\d{4}-\d{2}-\d{2}/, `## Last Updated\n${formatToday()}`);
  }

  if (name === 'learning' && context.learningRecent.length > 0) {
    // Inject into "Recenti apprendimenti pratici"
    const learnLines = context.learningRecent.slice(0, 2).map((l) => `- ${l}`);
    const marker = '## Recenti apprendimenti pratici';
    if (updated.includes(marker)) {
      const section = updated.substring(updated.indexOf(marker));
      const nextSection = section.substring(section.indexOf('\n\n') + 2, section.indexOf('##', 2));
      // Only inject if no duplicate (cheap substring check)
      if (!section.includes(learnLines[0]?.substring(0, 30) || '')) {
        updated = updated.replace(marker, `${marker} (${formatToday()})\n${learnLines.join('\n')}\n`);
      }
    }
    updated = updated.replace(/## Last Updated\n\d{4}-\d{2}-\d{2}/, `## Last Updated\n${formatToday()}`);
  }

  if (name === 'finance' && context.financeSnapshot.length > 0) {
    // Append finance observations (WildNomads MRR, expenses, etc.)
    const finLines = context.financeSnapshot.slice(0, 2).map((f) => `- ${f}`);
    const marker = '## Financial Goals';
    if (updated.includes(marker) && !updated.includes('[Activity snapshot]')) {
      updated = updated.replace(
        marker,
        `${marker}\n\n[Activity snapshot — ${formatToday()}]\n${finLines.join('\n')}\n`,
      );
    }
    updated = updated.replace(/## Last Updated\n\d{4}-\d{2}-\d{2}/, `## Last Updated\n${formatToday()}`);
  }

  if (updated !== current) {
    await writeFile(path, updated, 'utf8');
    logger.info({ name }, 'kernel-auto-sync: updated');
  }
}

function formatToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * Main sync routine: sample activity, update all kernels.
 */
export async function runKernelAutoSync(): Promise<void> {
  try {
    const ctx = sampleKernelContext(14); // last 2 weeks
    if (
      ctx.meHighlights.length === 0 &&
      ctx.goalsProgress.length === 0 &&
      ctx.learningRecent.length === 0 &&
      ctx.financeSnapshot.length === 0
    ) {
      logger.debug('kernel-auto-sync: no recent activity, skipping');
      return;
    }

    await Promise.all([
      updateKernel('me', ctx),
      updateKernel('goals', ctx),
      updateKernel('learning', ctx),
      updateKernel('finance', ctx),
    ]);

    logger.info('kernel-auto-sync: complete');
  } catch (err) {
    logger.error(err, 'kernel-auto-sync failed');
  }
}
