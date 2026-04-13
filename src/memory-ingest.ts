/**
 * Memory ingestion — fully local, no external API required.
 *
 * Strategy: Save more, decay naturally. Better to capture too much
 * (SQLite FTS5 handles search) than miss important context.
 * Salience decay (0.95^days) handles cleanup of stale memories.
 */

import { saveStructuredMemory, getDb } from './db.js';

/**
 * Check if a very similar memory already exists (deduplication).
 * Uses FTS5 to find similar memories, then checks text similarity.
 */
function isDuplicateMemory(chatId: string, summary: string): boolean {
  const words = summary
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length >= 3)
    .slice(0, 4);
  if (words.length === 0) return false;

  const ftsQuery = words.map(w => `"${w}"`).join(' AND ');
  try {
    const existing = getDb()
      .prepare(
        `SELECT m.summary FROM memories m
         JOIN memories_fts ON m.id = memories_fts.rowid
         WHERE memories_fts MATCH ? AND m.chat_id = ? AND m.deleted_at IS NULL
         ORDER BY m.created_at DESC LIMIT 5`
      )
      .all(ftsQuery, chatId) as Array<{ summary: string }>;

    const summaryWords = new Set(summary.toLowerCase().split(/\s+/).filter(w => w.length >= 3));
    for (const row of existing) {
      const existingWords = new Set(row.summary.toLowerCase().split(/\s+/).filter(w => w.length >= 3));
      if (summaryWords.size === 0 || existingWords.size === 0) continue;
      const intersection = [...summaryWords].filter(w => existingWords.has(w)).length;
      const similarity = intersection / Math.max(summaryWords.size, existingWords.size);
      if (similarity > 0.8) return true;
    }
  } catch { /* FTS5 not ready — skip dedup */ }
  return false;
}
import { logger } from './logger.js';
import { writeMemoryToFile } from './memory-files.js';

let onHighImportanceMemory: ((memoryId: number, summary: string, importance: number) => void) | null = null;

export function setHighImportanceCallback(cb: (memoryId: number, summary: string, importance: number) => void): void {
  onHighImportanceMemory = cb;
}

// ── Skip patterns (definitely ephemeral) ─────────────────────────────

const SKIP_PATTERNS = [
  /^\/\w+/,                                           // Commands
  /^(ok|yes|no|si|thanks|grazie|got it|sure|done|bye|hi|hello|hey|ciao)\s*[.!?]*$/i,
  /^\[Voice transcribed\]:\s*(ok|yes|no|si|thanks|grazie)\s*$/i,
  /^(👍|👎|✅|❌|🙏|😊|🎉)\s*$/,                      // Emoji-only
];

// ── High-importance patterns ─────────────────────────────────────────

const HIGH_IMPORTANCE_PATTERNS = [
  { pattern: /\b(my name is|i am|i live|i work at|my job|mi chiamo|sono|abito)\b/i, score: 0.9 },
  { pattern: /\b(from now on|going forward|d'ora in poi|the rule|the policy|always|never|mai|sempre)\b/i, score: 0.85 },
  { pattern: /\b(i decided|we decided|ho deciso|abbiamo deciso|the decision)\b/i, score: 0.8 },
  { pattern: /\b(remember that|keep in mind|ricorda|importante)\b/i, score: 0.85 },
  { pattern: /\b(i prefer|i like|i hate|i don't like|preferisco|mi piace|odio|non mi piace)\b/i, score: 0.7 },
  { pattern: /\b(don't do|stop doing|no more|never again|non fare|smetti)\b/i, score: 0.75 },
  { pattern: /\b(my goal|i want to|i'm trying to|obiettivo|voglio)\b/i, score: 0.65 },
  { pattern: /\b(budget|salary|income|earn|stipendio|guadagno)\b/i, score: 0.65 },
  { pattern: /\b(install|installa|configura|setup|mcp)\b/i, score: 0.55 },
];

// ── Topic extraction ─────────────────────────────────────────────────

const TOPIC_MAP: Record<string, string> = {
  'code|programming|function|api|bug|deploy|npm|git|typescript|python': 'development',
  'meeting|calendar|schedule|appointment|riunione|calendario': 'scheduling',
  'money|budget|expense|payment|invoice|cost|soldi|spesa|pagamento': 'finance',
  'health|workout|exercise|gym|sleep|energy|salute|palestra|sonno': 'health',
  'goal|plan|strategy|milestone|target|obiettivo|piano': 'goals',
  'learn|study|course|book|tutorial|studiare|corso|libro': 'learning',
  'email|message|slack|telegram|whatsapp|notion': 'communication',
  'design|architecture|system|structure|architettura': 'architecture',
  'test|coverage|assertion|verify|testing': 'testing',
  'security|password|auth|token|key|sicurezza': 'security',
  'mcp|plugin|integration|server|integrazione': 'tools',
  'memory|remember|recall|memoria|ricorda': 'memory',
};

function extractTopics(text: string): string[] {
  const topics: string[] = [];
  const lower = text.toLowerCase();
  for (const [pattern, topic] of Object.entries(TOPIC_MAP)) {
    if (new RegExp(pattern, 'i').test(lower)) {
      topics.push(topic);
    }
  }
  return topics.length > 0 ? topics : ['general'];
}

function extractEntities(text: string): string[] {
  const entities: string[] = [];

  // Capitalized words (names, projects, tools)
  const caps = text.match(/\b[A-Z][a-z]{2,}\b/g);
  if (caps) entities.push(...[...new Set(caps)].slice(0, 5));

  // @mentions
  const mentions = text.match(/@(\w+)/g);
  if (mentions) entities.push(...mentions.slice(0, 3));

  // Quoted strings (often important references)
  const quoted = text.match(/"([^"]{3,30})"/g);
  if (quoted) entities.push(...quoted.map(q => q.replace(/"/g, '')).slice(0, 3));

  return entities;
}

function createSummary(userMessage: string, assistantResponse: string): string {
  // Use user message as base, add key info from response
  let summary = userMessage
    .replace(/^(hey|hi|ok so|so|well|actually|by the way|btw|allora|comunque)\s*,?\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  // If user message is very short, include some response context
  if (summary.length < 40 && assistantResponse.length > 20) {
    const responseSnippet = assistantResponse
      .replace(/<[^>]+>/g, '')     // strip HTML
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100);
    summary = `${summary} → ${responseSnippet}`;
  }

  return summary.slice(0, 300);
}

/**
 * Analyze a conversation turn and extract structured memory if warranted.
 * Strategy: inclusive extraction, let decay handle cleanup.
 */
export async function ingestConversationTurn(
  chatId: string,
  userMessage: string,
  assistantResponse: string,
  agentId = 'main',
): Promise<boolean> {
  // Hard skip: very short or commands
  if (userMessage.length <= 10 || userMessage.startsWith('/')) return false;

  const trimmed = userMessage.trim();

  // Skip definitely-ephemeral messages
  for (const pattern of SKIP_PATTERNS) {
    if (pattern.test(trimmed)) return false;
  }

  // Calculate importance
  let importance = 0.5; // default: medium

  // Check high-importance patterns
  for (const { pattern, score } of HIGH_IMPORTANCE_PATTERNS) {
    if (pattern.test(trimmed)) {
      importance = Math.max(importance, score);
    }
  }

  // Longer messages are usually more important
  if (trimmed.length > 200) importance = Math.max(importance, 0.6);
  if (trimmed.length > 500) importance = Math.max(importance, 0.7);

  // Questions often contain important context
  if (trimmed.includes('?') && trimmed.length > 30) {
    importance = Math.max(importance, 0.55);
  }

  // Messages with the assistant's substantial response are worth keeping
  if (assistantResponse.length > 500) {
    importance = Math.max(importance, 0.55);
  }

  try {
    const summary = createSummary(userMessage, assistantResponse);
    const entities = extractEntities(userMessage + ' ' + assistantResponse);
    const topics = extractTopics(userMessage + ' ' + assistantResponse);

    // Dedup: skip if very similar memory already exists
    if (isDuplicateMemory(chatId, summary)) {
      logger.debug({ chatId, summary: summary.slice(0, 60) }, 'Memory skipped (duplicate)');
      return false;
    }

    const memoryId = saveStructuredMemory(
      chatId,
      userMessage,
      summary,
      entities,
      topics,
      importance,
      'conversation',
      agentId,
    );

    // Write to .md file for human-readable persistence
    writeMemoryToFile(summary, topics, importance, 'conversation', userMessage);

    if (importance >= 0.8 && onHighImportanceMemory) {
      try { onHighImportanceMemory(memoryId, summary, importance); } catch { /* non-fatal */ }
    }

    logger.info(
      { chatId, importance: importance.toFixed(2), memoryId, topics, summary: summary.slice(0, 80) },
      'Memory ingested',
    );
    return true;
  } catch (err) {
    logger.error({ err }, 'Memory ingestion failed');
    return false;
  }
}
