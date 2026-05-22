/**
 * Trace Inspector — assemble per-turn agent traces from existing SQLite tables.
 *
 * We don't add new tracing infrastructure. We promote what we already log:
 *   - conversation_log : user + assistant text turns
 *   - token_usage      : per-turn cost / tokens / cache stats
 *   - tool_sequences   : canonical tool patterns
 *   - mission_tasks    : multi-step task records
 *   - audit_log        : security/permission events
 *
 * The inspector composes them into a Langfuse-style timeline keyed by session_id.
 */

import { getDb } from './db.js';
import { decryptField } from './db.js';

export interface TurnTrace {
  id: number;
  session_id: string | null;
  chat_id: string;
  agent_id: string;
  role: string;
  content: string;
  created_at: number;
  /** Usage stats from the same session/window if available. */
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheRead: number;
    contextTokens: number;
    costUsd: number;
  } | null;
}

export interface SessionTrace {
  sessionId: string;
  chatId: string;
  agentId: string;
  turns: TurnTrace[];
  totals: {
    turnCount: number;
    inputTokens: number;
    outputTokens: number;
    cacheRead: number;
    costUsd: number;
  };
  startedAt: number;
  lastActivity: number;
}

interface ConvoRow {
  id: number;
  chat_id: string;
  session_id: string | null;
  agent_id: string | null;
  role: string;
  content: string;
  created_at: number;
}

interface UsageRow {
  session_id: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_read: number;
  context_tokens: number;
  cost_usd: number;
  created_at: number;
}

// ── Queries ──────────────────────────────────────────────────────────

export function listRecentSessions(limit = 25): SessionTrace[] {
  // Pull recent conversation turns and group by session_id.
  // For each session, compute totals from token_usage.
  const convoRows = getDb().prepare(
    `SELECT id, chat_id, session_id, agent_id, role, content, created_at
       FROM conversation_log
      WHERE session_id IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 500`,
  ).all() as ConvoRow[];

  const usageRows = getDb().prepare(
    `SELECT session_id, input_tokens, output_tokens, cache_read, context_tokens, cost_usd, created_at
       FROM token_usage
      WHERE session_id IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 1000`,
  ).all() as UsageRow[];

  const usageBySession = new Map<string, UsageRow[]>();
  for (const u of usageRows) {
    if (!u.session_id) continue;
    if (!usageBySession.has(u.session_id)) usageBySession.set(u.session_id, []);
    usageBySession.get(u.session_id)!.push(u);
  }

  const bySession = new Map<string, ConvoRow[]>();
  for (const r of convoRows) {
    if (!r.session_id) continue;
    if (!bySession.has(r.session_id)) bySession.set(r.session_id, []);
    bySession.get(r.session_id)!.push(r);
  }

  const sessions: SessionTrace[] = [];
  for (const [sessionId, rows] of bySession) {
    rows.sort((a, b) => a.created_at - b.created_at);
    const usage = usageBySession.get(sessionId) ?? [];
    const totals = usage.reduce(
      (acc, u) => ({
        turnCount: rows.length,
        inputTokens: acc.inputTokens + u.input_tokens,
        outputTokens: acc.outputTokens + u.output_tokens,
        cacheRead: acc.cacheRead + u.cache_read,
        costUsd: acc.costUsd + u.cost_usd,
      }),
      { turnCount: rows.length, inputTokens: 0, outputTokens: 0, cacheRead: 0, costUsd: 0 },
    );
    sessions.push({
      sessionId,
      chatId: rows[0].chat_id,
      agentId: rows[0].agent_id ?? 'main',
      turns: rows.map((r) => ({
        id: r.id,
        session_id: r.session_id,
        chat_id: r.chat_id,
        agent_id: r.agent_id ?? 'main',
        role: r.role,
        content: tryDecrypt(r.content),
        created_at: r.created_at,
      })),
      totals,
      startedAt: rows[0].created_at,
      lastActivity: rows[rows.length - 1].created_at,
    });
  }
  sessions.sort((a, b) => b.lastActivity - a.lastActivity);
  return sessions.slice(0, limit);
}

export function getSessionTrace(sessionId: string): SessionTrace | null {
  const rows = getDb().prepare(
    `SELECT id, chat_id, session_id, agent_id, role, content, created_at
       FROM conversation_log
      WHERE session_id = ?
      ORDER BY created_at ASC`,
  ).all(sessionId) as ConvoRow[];
  if (rows.length === 0) return null;

  const usage = getDb().prepare(
    `SELECT session_id, input_tokens, output_tokens, cache_read, context_tokens, cost_usd, created_at
       FROM token_usage
      WHERE session_id = ?
      ORDER BY created_at ASC`,
  ).all(sessionId) as UsageRow[];

  const totals = usage.reduce(
    (acc, u) => ({
      turnCount: rows.length,
      inputTokens: acc.inputTokens + u.input_tokens,
      outputTokens: acc.outputTokens + u.output_tokens,
      cacheRead: acc.cacheRead + u.cache_read,
      costUsd: acc.costUsd + u.cost_usd,
    }),
    { turnCount: rows.length, inputTokens: 0, outputTokens: 0, cacheRead: 0, costUsd: 0 },
  );

  return {
    sessionId,
    chatId: rows[0].chat_id,
    agentId: rows[0].agent_id ?? 'main',
    turns: rows.map((r, idx) => ({
      id: r.id,
      session_id: r.session_id,
      chat_id: r.chat_id,
      agent_id: r.agent_id ?? 'main',
      role: r.role,
      content: tryDecrypt(r.content),
      created_at: r.created_at,
      usage: usage[idx] ? {
        inputTokens: usage[idx].input_tokens,
        outputTokens: usage[idx].output_tokens,
        cacheRead: usage[idx].cache_read,
        contextTokens: usage[idx].context_tokens,
        costUsd: usage[idx].cost_usd,
      } : null,
    })),
    totals,
    startedAt: rows[0].created_at,
    lastActivity: rows[rows.length - 1].created_at,
  };
}

export interface CostBreakdown {
  byAgent: Array<{ agentId: string; turns: number; costUsd: number; inputTokens: number; outputTokens: number }>;
  byDay: Array<{ day: string; turns: number; costUsd: number }>;
  totalCostUsd: number;
  totalTurns: number;
}

export function getCostBreakdown(days = 30): CostBreakdown {
  const since = Date.now() - days * 24 * 3600 * 1000;
  const byAgent = getDb().prepare(
    `SELECT COALESCE(agent_id, 'main') AS agentId,
            COUNT(*) AS turns,
            COALESCE(SUM(cost_usd), 0) AS costUsd,
            COALESCE(SUM(input_tokens), 0) AS inputTokens,
            COALESCE(SUM(output_tokens), 0) AS outputTokens
       FROM token_usage
      WHERE created_at >= ?
      GROUP BY agent_id
      ORDER BY costUsd DESC`,
  ).all(since) as CostBreakdown['byAgent'];

  const byDay = getDb().prepare(
    `SELECT strftime('%Y-%m-%d', created_at / 1000, 'unixepoch') AS day,
            COUNT(*) AS turns,
            COALESCE(SUM(cost_usd), 0) AS costUsd
       FROM token_usage
      WHERE created_at >= ?
      GROUP BY day
      ORDER BY day ASC`,
  ).all(since) as CostBreakdown['byDay'];

  const totals = byAgent.reduce(
    (acc, a) => ({ totalCostUsd: acc.totalCostUsd + a.costUsd, totalTurns: acc.totalTurns + a.turns }),
    { totalCostUsd: 0, totalTurns: 0 },
  );

  return { byAgent, byDay, ...totals };
}

function tryDecrypt(s: string): string {
  try { return decryptField(s); } catch { return s; }
}
