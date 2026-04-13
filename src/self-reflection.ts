/**
 * Self-Reflection System — detects when the user corrects the bot and logs lessons.
 *
 * When a correction is detected, it is:
 *   1. Appended to ~/.wild-claude-pi/reflections.jsonl (one JSON object per line)
 *   2. Saved as a high-importance memory with topic 'self-reflection'
 *
 * The lessons are injected into the system prompt context so the bot can
 * avoid repeating the same mistakes.
 */

import fs from 'fs';
import path from 'path';
import { saveStructuredMemory } from './db.js';
import { USER_DATA_DIR } from './paths.js';
import { logger } from './logger.js';

const REFLECTIONS_FILE = path.join(USER_DATA_DIR, 'reflections.jsonl');

// ── Types ────────────────────────────────────────────────────────────

export interface Reflection {
  timestamp: string;
  sessionId: string;
  userCorrection: string;
  botMistake: string;
  lesson: string;
  category: 'misunderstanding' | 'wrong_approach' | 'style_preference' | 'factual_error';
}

// ── Correction detection patterns ────────────────────────────────────

const CORRECTION_PATTERNS: Array<{ pattern: RegExp; category: Reflection['category'] }> = [
  // Direct disagreement
  { pattern: /^(no[,. ]|non[,. ])/i, category: 'misunderstanding' },
  // User repeating themselves
  { pattern: /\b(i said|ho detto|i already said|l'avevo già detto)\b/i, category: 'misunderstanding' },
  // Explicit wrong
  { pattern: /\b(wrong|sbagliato|incorrect|errato|that's not|non è quello)\b/i, category: 'factual_error' },
  // Actually / correction
  { pattern: /^actually\b|^in realtà\b/i, category: 'factual_error' },
  // Style/approach preference
  { pattern: /\b(stop|don't|smetti|non fare|please don't|per favore non)\b/i, category: 'style_preference' },
  // "That's not what I meant"
  { pattern: /\b(not what i meant|non intendevo|not what i asked|non te l'ho chiesto)\b/i, category: 'misunderstanding' },
  // Wrong approach
  { pattern: /\b(that's not how|non è così|you shouldn't|non dovresti)\b/i, category: 'wrong_approach' },
];

/**
 * Returns true if the message looks like a correction of the previous bot response.
 */
export function detectCorrection(userMessage: string, previousBotMessage: string): boolean {
  if (!userMessage || !previousBotMessage) return false;

  // Very short messages (ok, ok thanks, etc.) are not corrections
  const trimmed = userMessage.trim();
  if (trimmed.length < 5) return false;

  for (const { pattern } of CORRECTION_PATTERNS) {
    if (pattern.test(trimmed)) return true;
  }
  return false;
}

// ── Lesson extraction ────────────────────────────────────────────────

function extractLesson(userMessage: string, botMistake: string): string {
  // Build a terse "don't do X" style lesson
  const trimmed = userMessage.trim().slice(0, 200);
  const mistake = botMistake.trim().slice(0, 100);
  return `When user says "${trimmed.slice(0, 80)}", avoid: "${mistake.slice(0, 60)}"`;
}

function categorize(userMessage: string): Reflection['category'] {
  const trimmed = userMessage.trim();
  for (const { pattern, category } of CORRECTION_PATTERNS) {
    if (pattern.test(trimmed)) return category;
  }
  return 'misunderstanding';
}

// ── Logging ──────────────────────────────────────────────────────────

/**
 * Log a correction as a reflection and save it as a high-importance memory.
 */
export function logReflection(
  chatId: string,
  userMessage: string,
  previousBotMessage: string,
  sessionId = '',
): void {
  try {
    const lesson = extractLesson(userMessage, previousBotMessage);
    const category = categorize(userMessage);

    const reflection: Reflection = {
      timestamp: new Date().toISOString(),
      sessionId,
      userCorrection: userMessage.slice(0, 500),
      botMistake: previousBotMessage.slice(0, 500),
      lesson,
      category,
    };

    // Append to JSONL file
    fs.appendFileSync(REFLECTIONS_FILE, JSON.stringify(reflection) + '\n', 'utf8');

    // Save as high-importance memory so it surfaces in future sessions
    const summary = `Self-reflection (${category}): ${lesson}`;
    saveStructuredMemory(
      chatId,
      userMessage,
      summary,
      [],
      ['self-reflection', category],
      0.85,
      'self-reflection',
      'main',
    );

    logger.info({ chatId, category, lesson }, 'Self-reflection logged');
  } catch (err) {
    logger.warn({ err, chatId }, 'Failed to log reflection');
  }
}

// ── Retrieval ────────────────────────────────────────────────────────

/**
 * Read the last N reflections from the JSONL file.
 */
export function getRecentReflections(limit = 10): Reflection[] {
  try {
    if (!fs.existsSync(REFLECTIONS_FILE)) return [];

    const raw = fs.readFileSync(REFLECTIONS_FILE, 'utf8');
    const lines = raw.split('\n').filter(l => l.trim().length > 0);
    const last = lines.slice(-limit);
    return last.map(l => JSON.parse(l) as Reflection).reverse();
  } catch (err) {
    logger.warn({ err }, 'Failed to read reflections');
    return [];
  }
}

/**
 * Returns a formatted context block summarising past mistakes.
 * Returns empty string if there are no reflections yet.
 */
export function buildReflectionContext(limit = 8): string {
  const reflections = getRecentReflections(limit);
  if (reflections.length === 0) return '';

  const lines = reflections.map(r => `- [${r.category}] ${r.lesson}`);
  return `[Lessons from past mistakes]\n${lines.join('\n')}\n[End lessons]`;
}
