/**
 * Session Continuity — generates and injects session handoff summaries.
 *
 * When the user runs /newchat, a compact summary of the session is written to
 * ~/.wild-claude-pi/session-handoffs/<chatId>-<timestamp>.md
 *
 * On the first message of the next session the summary is injected as context
 * so the bot can pick up naturally without requiring /respin.
 */

import fs from 'fs';
import path from 'path';
import { getRecentConversation, ConversationTurn } from './db.js';
import { USER_DATA_DIR } from './paths.js';
import { logger } from './logger.js';

const HANDOFFS_DIR = path.join(USER_DATA_DIR, 'session-handoffs');

function ensureHandoffsDir(): void {
  fs.mkdirSync(HANDOFFS_DIR, { recursive: true });
}

// ── Pattern matching helpers ─────────────────────────────────────────

const ACCOMPLISHED_PATTERNS = /\b(done|completed|created|fixed|finished|deployed|added|built|wrote|sent|saved|updated|set up|ho fatto|finito|creato|sistemato)\b/i;
const PENDING_PATTERNS = /\b(todo|to-do|next|will|later|remaining|still need|should|need to|devo ancora|da fare|poi|dopo)\b/i;
const PREFERENCE_PATTERNS = /\b(prefer|like|want|always|never|from now on|d'ora in poi|preferisco|voglio)\b/i;

function extractTopics(turns: ConversationTurn[]): string[] {
  const topics = new Set<string>();
  for (const turn of turns) {
    if (turn.role !== 'user') continue;
    const text = turn.content.toLowerCase();

    if (/\b(code|function|bug|deploy|npm|git|typescript|python|programming)\b/.test(text)) topics.add('development');
    if (/\b(email|message|slack|telegram|whatsapp)\b/.test(text)) topics.add('communication');
    if (/\b(money|budget|expense|payment|finance|cost)\b/.test(text)) topics.add('finance');
    if (/\b(health|workout|gym|sleep|exercise)\b/.test(text)) topics.add('health');
    if (/\b(goal|plan|strategy|milestone)\b/.test(text)) topics.add('goals');
    if (/\b(learn|study|course|book|tutorial)\b/.test(text)) topics.add('learning');
    if (/\b(schedule|calendar|appointment|meeting)\b/.test(text)) topics.add('scheduling');
    if (/\b(memory|remember|recall)\b/.test(text)) topics.add('memory');
    if (/\b(agent|mcp|plugin|integration|skill)\b/.test(text)) topics.add('tools');
  }
  return [...topics];
}

function extractAccomplishments(turns: ConversationTurn[]): string[] {
  const items: string[] = [];
  for (const turn of turns) {
    if (turn.role !== 'assistant') continue;
    const lines = turn.content.split(/\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (ACCOMPLISHED_PATTERNS.test(trimmed) && trimmed.length > 10 && trimmed.length < 200) {
        items.push(trimmed.replace(/^[-*•]\s*/, '').slice(0, 150));
        if (items.length >= 4) return items;
      }
    }
  }
  return items;
}

function extractPending(turns: ConversationTurn[]): string[] {
  const items: string[] = [];
  for (const turn of turns) {
    const lines = turn.content.split(/\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (PENDING_PATTERNS.test(trimmed) && trimmed.length > 10 && trimmed.length < 200) {
        items.push(trimmed.replace(/^[-*•]\s*/, '').slice(0, 150));
        if (items.length >= 4) return items;
      }
    }
  }
  return items;
}

function extractPreferences(turns: ConversationTurn[]): string[] {
  const items: string[] = [];
  for (const turn of turns) {
    if (turn.role !== 'user') continue;
    if (PREFERENCE_PATTERNS.test(turn.content) && turn.content.length > 15 && turn.content.length < 300) {
      items.push(turn.content.slice(0, 150));
      if (items.length >= 3) return items;
    }
  }
  return items;
}

/**
 * Generate a session handoff summary and write it to disk.
 * Called just before clearSession() in the /newchat handler.
 * Returns the handoff file path, or null if the session was too short to bother.
 */
export function generateSessionHandoff(chatId: string, agentId: string): string | null {
  try {
    ensureHandoffsDir();

    // Get the last 20 turns in reverse-chronological order, then flip to chronological
    const turnsDesc = getRecentConversation(chatId, 20);
    if (turnsDesc.length < 2) return null;

    const turns = [...turnsDesc].reverse();
    const topics = extractTopics(turns);
    const accomplishments = extractAccomplishments(turns);
    const pending = extractPending(turns);
    const preferences = extractPreferences(turns);

    // Build a first-message snippet to give "what we were doing" context
    const firstUserMsg = turns.find(t => t.role === 'user')?.content?.slice(0, 120) || '';
    const lastUserMsg = [...turns].reverse().find(t => t.role === 'user')?.content?.slice(0, 120) || '';

    const lines: string[] = [];
    lines.push(`# Session Handoff`);
    lines.push(`Agent: ${agentId} | Chat: ${chatId} | ${new Date().toISOString()}`);
    lines.push('');

    if (topics.length > 0) {
      lines.push(`**Topics discussed:** ${topics.join(', ')}`);
      lines.push('');
    }

    if (firstUserMsg) {
      lines.push(`**Session started with:** "${firstUserMsg}${firstUserMsg.length >= 120 ? '...' : ''}"`);
    }
    if (lastUserMsg && lastUserMsg !== firstUserMsg) {
      lines.push(`**Last user message:** "${lastUserMsg}${lastUserMsg.length >= 120 ? '...' : ''}"`);
    }
    lines.push('');

    if (accomplishments.length > 0) {
      lines.push('**Accomplished:**');
      for (const item of accomplishments) lines.push(`- ${item}`);
      lines.push('');
    }

    if (pending.length > 0) {
      lines.push('**Pending / next steps:**');
      for (const item of pending) lines.push(`- ${item}`);
      lines.push('');
    }

    if (preferences.length > 0) {
      lines.push('**User preferences expressed:**');
      for (const item of preferences) lines.push(`- ${item}`);
      lines.push('');
    }

    const content = lines.join('\n');
    const timestamp = Date.now();
    const fileName = `${chatId}-${timestamp}.md`;
    const filePath = path.join(HANDOFFS_DIR, fileName);
    fs.writeFileSync(filePath, content, 'utf8');

    logger.info({ chatId, agentId, filePath }, 'Session handoff written');
    return filePath;
  } catch (err) {
    logger.warn({ err, chatId }, 'Failed to generate session handoff');
    return null;
  }
}

/**
 * Return the content of the most recent handoff file for this chat,
 * or null if none exists.
 */
export function getLastHandoff(chatId: string): string | null {
  try {
    if (!fs.existsSync(HANDOFFS_DIR)) return null;

    const files = fs.readdirSync(HANDOFFS_DIR)
      .filter(f => f.startsWith(`${chatId}-`) && f.endsWith('.md'))
      .sort(); // lexicographic sort — timestamps in name give chronological order

    if (files.length === 0) return null;

    const latest = files[files.length - 1];
    return fs.readFileSync(path.join(HANDOFFS_DIR, latest), 'utf8');
  } catch (err) {
    logger.warn({ err, chatId }, 'Failed to read session handoff');
    return null;
  }
}

/**
 * Returns a formatted context block to inject at the start of a new session.
 * Returns empty string if there is no handoff for this chat.
 */
export function injectHandoffContext(chatId: string): string {
  const handoff = getLastHandoff(chatId);
  if (!handoff) return '';

  return `[Previous session context]\n${handoff.trim()}\n[End previous session context]`;
}
