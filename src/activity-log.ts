/**
 * Activity Log — Append-only JSONL for multi-agent coordination and session recovery.
 *
 * Location: ~/.wild-claude-pi/activity.jsonl
 * Archive on size > 10MB: activity-YYYY-MM-DD.jsonl (7-day rolling window)
 *
 * Format:
 * {
 *   timestamp: number (unix seconds),
 *   sessionId: string,
 *   agentId: string,
 *   action: string ('start' | 'query' | 'response' | 'error' | 'complete' | 'delegate'),
 *   payload: object | null,
 *   status: 'ok' | 'error' | 'pending',
 *   error?: string,
 *   durationMs?: number
 * }
 *
 * No external locks. Safe for concurrent writes (OS-level append).
 * Used for:
 * - Multi-agent session coordination
 * - Failure recovery (resume from last checkpoint)
 * - Audit trail
 * - Activity feed in dashboard
 */

import fs from 'fs';
import path from 'path';
import { logger } from './logger.js';
import { STORE_DIR } from './config.js';

// ── Types ────────────────────────────────────────────────────────────

export interface ActivityLogEntry {
  timestamp: number;
  sessionId: string;
  agentId: string;
  action: string;
  payload?: Record<string, any>;
  status: 'ok' | 'error' | 'pending';
  error?: string;
  durationMs?: number;
}

export interface SessionRecoveryPoint {
  sessionId: string;
  lastAgentId: string;
  lastAction: string;
  lastTimestamp: number;
  taskCompleted: boolean;
  status: string;
}

// ── Paths ────────────────────────────────────────────────────────────

function getActivityLogPath(): string {
  return path.join(STORE_DIR, 'activity.jsonl');
}

function getActivityArchivePath(date: Date = new Date()): string {
  const isoDate = date.toISOString().slice(0, 10);
  return path.join(STORE_DIR, `activity-${isoDate}.jsonl`);
}

// ── Write ────────────────────────────────────────────────────────────

/**
 * Append an activity entry to activity.jsonl.
 * Automatically archives if file exceeds 10MB.
 */
export function logActivity(
  sessionId: string,
  agentId: string,
  action: string,
  payload?: Record<string, any>,
  status: 'ok' | 'error' | 'pending' = 'ok',
  error?: string,
  durationMs?: number,
): void {
  try {
    const entry: ActivityLogEntry = {
      timestamp: Math.floor(Date.now() / 1000),
      sessionId,
      agentId,
      action,
      payload,
      status,
      error,
      durationMs,
    };

    const logPath = getActivityLogPath();
    const line = JSON.stringify(entry) + '\n';

    // Append to file (OS guarantees atomicity for small writes)
    fs.appendFileSync(logPath, line);

    // Check size and archive if needed
    const stat = fs.statSync(logPath);
    if (stat.size > 10 * 1024 * 1024) {
      archiveActivityLog();
    }
  } catch (err) {
    logger.error({ err, sessionId, agentId, action }, 'Failed to log activity');
  }
}

/**
 * Archive current activity.jsonl to activity-YYYY-MM-DD.jsonl and reset.
 * Keeps only last 7 archived logs.
 */
export function archiveActivityLog(): void {
  try {
    const logPath = getActivityLogPath();
    if (!fs.existsSync(logPath)) return;

    const archivePath = getActivityArchivePath();

    // Rename to archive (atomic on same filesystem)
    fs.renameSync(logPath, archivePath);
    logger.info({ archivePath }, 'Activity log archived');

    // Clean up old archives (keep last 7 days)
    const dir = STORE_DIR;
    const files = fs.readdirSync(dir)
      .filter(f => f.startsWith('activity-') && f.endsWith('.jsonl'))
      .sort()
      .reverse();

    for (const old of files.slice(7)) {
      fs.unlinkSync(path.join(dir, old));
    }
  } catch (err) {
    logger.error({ err }, 'Failed to archive activity log');
  }
}

// ── Read ─────────────────────────────────────────────────────────────

/**
 * Get recent activities for a session (last N entries).
 */
export function getSessionActivities(sessionId: string, limit = 50): ActivityLogEntry[] {
  const logPath = getActivityLogPath();
  if (!fs.existsSync(logPath)) return [];

  try {
    const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(l => l);
    const entries = lines.map(l => JSON.parse(l) as ActivityLogEntry);
    return entries
      .filter(e => e.sessionId === sessionId)
      .slice(-limit);
  } catch (err) {
    logger.error({ err }, 'Failed to read session activities');
    return [];
  }
}

/**
 * Get all activities from the past N hours for a specific agent.
 */
export function getAgentRecentActivities(agentId: string, hoursBack = 24, limit = 100): ActivityLogEntry[] {
  const logPath = getActivityLogPath();
  if (!fs.existsSync(logPath)) return [];

  try {
    const cutoff = Math.floor(Date.now() / 1000) - (hoursBack * 3600);
    const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(l => l);
    const entries = lines.map(l => JSON.parse(l) as ActivityLogEntry);
    return entries
      .filter(e => e.agentId === agentId && e.timestamp >= cutoff)
      .slice(-limit);
  } catch (err) {
    logger.error({ err }, 'Failed to read agent activities');
    return [];
  }
}

/**
 * Get activity feed for dashboard (all recent activities, all agents/sessions).
 */
export function getActivityFeed(limit = 100): ActivityLogEntry[] {
  const logPath = getActivityLogPath();
  if (!fs.existsSync(logPath)) return [];

  try {
    const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(l => l);
    const entries = lines.map(l => JSON.parse(l) as ActivityLogEntry);
    return entries.slice(-limit);
  } catch (err) {
    logger.error({ err }, 'Failed to read activity feed');
    return [];
  }
}

/**
 * Find the most recent completion point for a session.
 * Used for resuming after failure.
 */
export function getSessionRecoveryPoint(sessionId: string): SessionRecoveryPoint | null {
  const activities = getSessionActivities(sessionId, 500);
  if (activities.length === 0) return null;

  // Find the last 'complete' action, or the most recent activity if no complete
  const completed = activities.find(a => a.action === 'complete');
  const last = activities[activities.length - 1];

  const point: SessionRecoveryPoint = {
    sessionId,
    lastAgentId: last.agentId,
    lastAction: last.action,
    lastTimestamp: last.timestamp,
    taskCompleted: completed ? true : false,
    status: completed ? 'completed' : 'in_progress',
  };

  return point;
}

/**
 * Query activities by action type and timeframe.
 */
export function queryActivities(
  action: string,
  hoursBack = 24,
  limit = 100,
): ActivityLogEntry[] {
  const logPath = getActivityLogPath();
  if (!fs.existsSync(logPath)) return [];

  try {
    const cutoff = Math.floor(Date.now() / 1000) - (hoursBack * 3600);
    const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(l => l);
    const entries = lines.map(l => JSON.parse(l) as ActivityLogEntry);
    return entries
      .filter(e => e.action === action && e.timestamp >= cutoff)
      .slice(-limit);
  } catch (err) {
    logger.error({ err }, 'Failed to query activities');
    return [];
  }
}

/**
 * Get error rate for an agent (number of errors / total activities in past N hours).
 */
export function getAgentErrorRate(agentId: string, hoursBack = 24): { errorCount: number; totalCount: number; rate: number } {
  const activities = getAgentRecentActivities(agentId, hoursBack, 1000);
  if (activities.length === 0) return { errorCount: 0, totalCount: 0, rate: 0 };

  const errorCount = activities.filter(a => a.status === 'error').length;
  const rate = errorCount / activities.length;

  return { errorCount, totalCount: activities.length, rate };
}

/**
 * Get session duration (time from first 'start' action to last 'complete' action).
 */
export function getSessionDuration(sessionId: string): number | null {
  const activities = getSessionActivities(sessionId, 500);
  if (activities.length === 0) return null;

  const start = activities.find(a => a.action === 'start');
  const end = activities.reverse().find(a => a.action === 'complete');

  if (!start || !end) return null;
  return end.timestamp - start.timestamp;
}

/**
 * Summarize recent agent activity for context injection.
 * Returns a human-readable summary for system prompt.
 */
export function getAgentActivitySummary(agentId: string, hoursBack = 6): string {
  const activities = getAgentRecentActivities(agentId, hoursBack, 50);
  if (activities.length === 0) return '';

  const completed = activities.filter(a => a.action === 'complete').length;
  const queries = activities.filter(a => a.action === 'query').length;
  const errors = activities.filter(a => a.status === 'error').length;

  // Find most common payload context
  const payloads = activities
    .filter(a => a.payload)
    .map(a => Object.keys(a.payload || {}).join(', '))
    .filter((k, i, arr) => arr.indexOf(k) === i);

  return `Recent activity: ${completed} tasks completed, ${queries} queries, ${errors} errors. Focus areas: ${payloads.slice(0, 3).join('; ') || 'general'}`;
}
