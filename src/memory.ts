import { agentObsidianConfig } from './config.js';
import {
  backupDatabase,
  batchUpdateMemoryRelevance,
  checkDatabaseIntegrity,
  decayMemories,
  getOtherAgentActivity,
  getRecentConsolidations,
  getRecentHighImportanceMemories,
  logConversationTurn,
  pruneConversationLog,
  pruneSlackMessages,
  pruneWaMessages,
  searchConsolidations,
  searchConversationHistory,
  searchMemories,
} from './db.js';
import { logger } from './logger.js';
import { ingestConversationTurn } from './memory-ingest.js';
import { buildObsidianContext } from './obsidian.js';
import { archiveActivityLog, logActivity } from './activity-log.js';

/**
 * Build a structured memory context string to prepend to the user's message.
 *
 * Three-layer retrieval:
 *   Layer 1: FTS5 keyword search on summary + raw_text + entities + topics (top 5)
 *   Layer 2: Recent high-importance memories (importance >= 0.5, top 5 by accessed_at)
 *   Layer 3: Relevant consolidation insights
 *
 * Deduplicates across layers. Returns formatted context with structure.
 */
export interface MemoryContextResult {
  contextText: string;
  surfacedMemoryIds: number[];
  surfacedMemorySummaries: Map<number, string>;
}

export async function buildMemoryContext(
  chatId: string,
  userMessage: string,
  agentId = 'main',
): Promise<MemoryContextResult> {
  const seen = new Set<number>();
  const summaryMap = new Map<number, string>();
  const memLines: string[] = [];

  // Layer 1: FTS5 keyword search (fully local, no external API)
  const searched = searchMemories(chatId, userMessage, 5, undefined, agentId);
  for (const mem of searched) {
    seen.add(mem.id);
    summaryMap.set(mem.id, mem.summary);
    const topics = safeParse(mem.topics);
    const topicStr = topics.length > 0 ? ` (${topics.join(', ')})` : '';
    memLines.push(`- [${mem.importance.toFixed(1)}] ${mem.summary}${topicStr}`);
  }

  // Layer 2: recent high-importance memories (deduplicated)
  const recent = getRecentHighImportanceMemories(chatId, 5);
  for (const mem of recent) {
    if (seen.has(mem.id)) continue;
    seen.add(mem.id);
    summaryMap.set(mem.id, mem.summary);
    const topics = safeParse(mem.topics);
    const topicStr = topics.length > 0 ? ` (${topics.join(', ')})` : '';
    memLines.push(`- [${mem.importance.toFixed(1)}] ${mem.summary}${topicStr}`);
  }

  // Layer 3: consolidation insights (keyword search, fully local)
  const insightLines: string[] = [];
  const consolidations = searchConsolidations(chatId, userMessage, 2);
  if (consolidations.length === 0) {
    const recentInsights = getRecentConsolidations(chatId, 2);
    for (const c of recentInsights) {
      insightLines.push(`- ${c.insight}`);
    }
  } else {
    for (const c of consolidations) {
      insightLines.push(`- ${c.insight}`);
    }
  }

  if (memLines.length === 0 && insightLines.length === 0 && !agentObsidianConfig) {
    return { contextText: '', surfacedMemoryIds: [], surfacedMemorySummaries: new Map() };
  }

  const parts: string[] = [];

  if (memLines.length > 0 || insightLines.length > 0) {
    const blocks: string[] = ['[Memory context]'];
    if (memLines.length > 0) {
      blocks.push('Relevant memories:');
      blocks.push(...memLines);
    }
    if (insightLines.length > 0) {
      blocks.push('');
      blocks.push('Insights:');
      blocks.push(...insightLines);
    }
    blocks.push('[End memory context]');
    parts.push(blocks.join('\n'));
  }

  // Layer 4: Cross-agent activity awareness
  const teamActivity = getOtherAgentActivity(agentId, 24, 10);
  if (teamActivity.length > 0) {
    const activityLines = teamActivity.map((entry) => {
      // Note: created_at is unix seconds, Date.now() is ms, so divide by 1000
      const ago = Math.round((Date.now() / 1000 - entry.created_at) / 60);
      const timeStr = ago < 60 ? `${ago}m ago` : `${Math.round(ago / 60)}h ago`;
      return `- [${entry.agent_id}] ${timeStr}: ${entry.summary}`;
    });
    parts.push(`[Team activity — what other agents have done recently]\n${activityLines.join('\n')}\n[End team activity]`);
  }

  // Layer 5: Conversation history recall
  // When the user is asking about past conversations, search the conversation_log
  // for matching exchanges. This gives the agent access to the full context that
  // memory extraction may have compressed into a single sentence.
  const recallKeywords = /\bremember\b|\brecall\b|\byesterday\b|\blast time\b|\bwe talked\b|\bwe discussed\b|\bwhat do you know\b|\bdo you know\b|\bwhat did we\b|\bpreviously\b|\bearlier\b|\blast week\b|\bfew days\b/i;
  if (recallKeywords.test(userMessage)) {
    const historyTurns = searchConversationHistory(chatId, userMessage, agentId, 7, 10);
    if (historyTurns.length > 0) {
      const historyLines = historyTurns
        .reverse() // chronological
        .map((t) => {
          const daysAgo = Math.round((Date.now() / 1000 - t.created_at) / 86400);
          const timeStr = daysAgo === 0 ? 'today' : daysAgo === 1 ? 'yesterday' : `${daysAgo}d ago`;
          const role = t.role === 'user' ? 'User' : 'You';
          return `[${timeStr}] ${role}: ${t.content.slice(0, 300)}`;
        });
      parts.push(`[Conversation history recall]\n${historyLines.join('\n')}\n[End conversation history]`);
    }
  }

  const obsidianBlock = buildObsidianContext(agentObsidianConfig);
  if (obsidianBlock) parts.push(obsidianBlock);

  return { contextText: parts.join('\n\n'), surfacedMemoryIds: [...seen], surfacedMemorySummaries: summaryMap };
}

/**
 * Process a conversation turn: log it and fire async memory extraction.
 * Called AFTER Claude responds, with both user message and Claude's response.
 *
 * The conversation log is written synchronously (for /respin support).
 * Memory extraction via Gemini is fire-and-forget (never blocks the response).
 */
export function saveConversationTurn(
  chatId: string,
  userMessage: string,
  claudeResponse: string,
  sessionId?: string,
  agentId = 'main',
): void {
  try {
    // Always log full conversation to conversation_log (for /respin)
    logConversationTurn(chatId, 'user', userMessage, sessionId, agentId);
    logConversationTurn(chatId, 'assistant', claudeResponse, sessionId, agentId);
  } catch (err) {
    logger.error({ err }, 'Failed to log conversation turn');
  }

  // Fire-and-forget: LLM-powered memory extraction via Gemini
  // This runs async and never blocks the user's response
  void ingestConversationTurn(chatId, userMessage, claudeResponse, agentId).catch((err) => {
    logger.error({ err }, 'Memory ingestion fire-and-forget failed');
  });
}

/**
 * Run the daily decay sweep. Call once on startup and every 24h.
 * Also prunes old conversation_log entries to prevent unbounded growth.
 *
 * MESSAGE RETENTION POLICY:
 * WhatsApp and Slack messages are auto-deleted after 3 days.
 * This is a security measure: message bodies contain personal
 * conversations that must not persist on disk indefinitely.
 */
export function runDecaySweep(): void {
  const start = Date.now();

  // Daily backup before any destructive operation
  backupDatabase();
  checkDatabaseIntegrity();

  decayMemories();
  pruneConversationLog(500);

  // Enforce 30-day retention on messaging data
  const wa = pruneWaMessages(30);
  const slack = pruneSlackMessages(30);
  if (wa.messages + wa.outbox + wa.map + slack > 0) {
    logger.info(
      { wa_messages: wa.messages, wa_outbox: wa.outbox, wa_map: wa.map, slack },
      'Retention pruning complete',
    );
  }

  // Archive activity log if needed and log this sweep
  const durationMs = Date.now() - start;
  archiveActivityLog();
  logActivity('system', 'memory-sweep', 'decay-sweep', {
    waMessages: wa.messages,
    waOutbox: wa.outbox,
    waMap: wa.map,
    slackMessages: slack,
  }, 'ok', undefined, durationMs);
}

/**
 * After an agent response, evaluate which surfaced memories were useful.
 * Fire-and-forget, never blocks the user. Has a 5-second timeout.
 */
export async function evaluateMemoryRelevance(
  surfacedMemoryIds: number[],
  memorySummaries: Map<number, string>,
  userMessage: string,
  assistantResponse: string,
): Promise<void> {
  if (surfacedMemoryIds.length === 0) return;

  try {
    // Simple heuristic: if the assistant response contains words from the memory summary,
    // that memory was likely relevant. No external API needed.
    const responseLower = assistantResponse.toLowerCase();
    const usefulIds = new Set<number>();

    for (const id of surfacedMemoryIds) {
      const summary = memorySummaries.get(id) ?? '';
      const words = summary.toLowerCase().split(/\s+/).filter(w => w.length > 4);
      const matches = words.filter(w => responseLower.includes(w));
      if (matches.length >= 2) {
        usefulIds.add(id);
      }
    }

    batchUpdateMemoryRelevance(surfacedMemoryIds, usefulIds);
  } catch {
    // Non-fatal, never block
  }
}

/** Safely parse a JSON array string, returning [] on failure. */
function safeParse(json: string): string[] {
  try {
    return JSON.parse(json);
  } catch {
    return [];
  }
}
