/**
 * Memory consolidation — fully local, no external API required.
 *
 * Groups unconsolidated memories by topic and creates synthesis records.
 * Uses simple topic clustering instead of Gemini.
 */

import {
  getUnconsolidatedMemories,
  markMemoriesConsolidated,
  saveConsolidation,
  supersedeMemory,
  updateMemoryConnections,
} from './db.js';
import { logger } from './logger.js';

const consolidatingChats = new Set<string>();

/**
 * Run consolidation for a given chat. Groups memories by topic,
 * creates synthesis records. No external API calls.
 */
export async function runConsolidation(chatId: string): Promise<void> {
  if (consolidatingChats.has(chatId)) return;

  consolidatingChats.add(chatId);
  try {
    const memories = getUnconsolidatedMemories(chatId, 20);

    if (memories.length < 3) {
      logger.debug({ count: memories.length }, 'Not enough memories to consolidate');
      return;
    }

    // Group memories by topic
    const topicGroups = new Map<string, typeof memories>();
    for (const mem of memories) {
      let topics: string[] = [];
      try { topics = JSON.parse(mem.topics); } catch { /* empty */ }
      if (topics.length === 0) topics = ['general'];

      for (const topic of topics) {
        if (!topicGroups.has(topic)) topicGroups.set(topic, []);
        topicGroups.get(topic)!.push(mem);
      }
    }

    // Create consolidation for each topic group with 2+ memories
    let totalConsolidated = 0;
    for (const [topic, mems] of topicGroups) {
      if (mems.length < 2) continue;

      const summaries = mems.map(m => m.summary).join('; ');
      const summary = `[${topic}] ${summaries.slice(0, 500)}`;
      const insight = `Pattern in ${topic}: ${mems.length} related memories spanning ${mems.map(m => m.summary.slice(0, 40)).join(', ')}`;
      const sourceIds = mems.map(m => m.id);

      saveConsolidation(chatId, sourceIds, summary, insight);

      // Connect memories in the same group
      for (let i = 0; i < mems.length; i++) {
        for (let j = i + 1; j < mems.length; j++) {
          updateMemoryConnections(mems[i]!.id, [
            { linked_to: mems[j]!.id, relationship: `same topic: ${topic}` },
          ]);
        }
      }

      totalConsolidated += mems.length;
    }

    // Check for contradictions: same entities but different summaries
    const entityMap = new Map<string, typeof memories>();
    for (const mem of memories) {
      let entities: string[] = [];
      try { entities = JSON.parse(mem.entities); } catch { /* empty */ }
      for (const entity of entities) {
        const key = entity.toLowerCase();
        if (!entityMap.has(key)) entityMap.set(key, []);
        entityMap.get(key)!.push(mem);
      }
    }

    for (const [, mems] of entityMap) {
      if (mems.length < 2) continue;
      // Sort by creation time, newest first
      const sorted = [...mems].sort((a, b) => b.created_at - a.created_at);
      // If importance differs significantly, newer one supersedes older
      for (let i = 1; i < sorted.length; i++) {
        const newer = sorted[0]!;
        const older = sorted[i]!;
        if (newer.importance > older.importance && newer.importance - older.importance > 0.2) {
          supersedeMemory(older.id, newer.id);
          logger.info({ staleId: older.id, supersededBy: newer.id }, 'Memory superseded (local)');
        }
      }
    }

    // Mark all as consolidated
    const allIds = memories.map(m => m.id);
    markMemoriesConsolidated(allIds);

    logger.info(
      { chatId, sourceCount: allIds.length, consolidated: totalConsolidated },
      'Consolidation complete (local)',
    );
  } catch (err) {
    logger.error({ err }, 'Consolidation failed');
  } finally {
    consolidatingChats.delete(chatId);
  }
}
