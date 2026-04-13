import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { runAgent, UsageInfo } from './agent.js';
import { loadAgentConfig, listAgentIds, resolveAgentClaudeMd } from './agent-config.js';
import { getRegisteredAgents, getAgentSystemPrompt } from './agent-registry.js';
import { PROJECT_ROOT } from './config.js';
import { logToHiveMind, createInterAgentTask, completeInterAgentTask } from './db.js';
import { logger } from './logger.js';
import { buildMemoryContext } from './memory.js';
import { logActivity, getSessionRecoveryPoint } from './activity-log.js';

// ── Types ────────────────────────────────────────────────────────────

export interface DelegationResult {
  agentId: string;
  text: string | null;
  usage: UsageInfo | null;
  taskId: string;
  durationMs: number;
}

export interface AgentInfo {
  id: string;
  name: string;
  description: string;
  /** Populated for custom registry agents (from agents/registry.yaml). */
  model?: string;
  /** Lane this agent belongs to (custom agents only). */
  lane?: string;
  /** Whether this agent comes from agents/registry.yaml vs agents/<id>/agent.yaml. */
  isCustom?: boolean;
}

// ── Registry ─────────────────────────────────────────────────────────

/** Cache of available agents loaded at startup. */
let agentRegistry: AgentInfo[] = [];

/** Default timeout for a delegated task (5 minutes). */
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Initialize the orchestrator by scanning `agents/` for valid configs
 * AND loading all custom agents from agents/registry.yaml.
 * Safe to call even if no agents are configured — the registry will be empty.
 */
export function initOrchestrator(): void {
  const ids = listAgentIds();
  agentRegistry = [];

  // 1. Load classic agents (agents/<id>/agent.yaml with Telegram bot tokens)
  for (const id of ids) {
    try {
      const config = loadAgentConfig(id);
      agentRegistry.push({
        id,
        name: config.name,
        description: config.description,
        model: config.model,
      });
    } catch (err) {
      // Agent config is broken (e.g. missing token) — skip it but warn
      logger.warn({ agentId: id, err }, 'Skipping agent — config load failed');
    }
  }

  // 2. Merge custom registry agents (agents/registry.yaml) — no bot token required
  //    Prefer existing entry if the same id was already loaded above.
  const existingIds = new Set(agentRegistry.map((a) => a.id));
  for (const reg of getRegisteredAgents()) {
    if (!existingIds.has(reg.id)) {
      agentRegistry.push({
        id: reg.id,
        name: reg.name,
        description: reg.description,
        model: reg.model,
        lane: reg.lane,
        isCustom: true,
      });
    }
  }

  logger.info(
    { agents: agentRegistry.map((a) => a.id) },
    'Orchestrator initialized',
  );
}

/** Return all agents that were successfully loaded. */
export function getAvailableAgents(): AgentInfo[] {
  return [...agentRegistry];
}

// ── Delegation ───────────────────────────────────────────────────────

/**
 * Parse a user message for delegation syntax.
 *
 * Supported forms:
 *   @agentId: prompt text
 *   @agentId prompt text   (only if agentId is a known agent)
 *   /delegate agentId prompt text
 *
 * Returns `{ agentId, prompt }` or `null` if no delegation detected.
 */
export function parseDelegation(
  message: string,
): { agentId: string; prompt: string } | null {
  // /delegate agentId prompt
  const cmdMatch = message.match(
    /^\/delegate\s+(\S+)\s+([\s\S]+)/i,
  );
  if (cmdMatch) {
    return { agentId: cmdMatch[1], prompt: cmdMatch[2].trim() };
  }

  // @agentId: prompt
  const atMatch = message.match(
    /^@(\S+?):\s*([\s\S]+)/,
  );
  if (atMatch) {
    return { agentId: atMatch[1], prompt: atMatch[2].trim() };
  }

  // @agentId prompt (only for known agents to avoid false positives)
  const atMatchNoColon = message.match(
    /^@(\S+)\s+([\s\S]+)/,
  );
  if (atMatchNoColon) {
    const candidate = atMatchNoColon[1];
    if (agentRegistry.some((a) => a.id === candidate)) {
      return { agentId: candidate, prompt: atMatchNoColon[2].trim() };
    }
  }

  return null;
}

/**
 * Delegate a task to another agent. Runs the agent's Claude Code session
 * in-process (same Node.js process) with the target agent's cwd and
 * system prompt.
 *
 * The delegation is logged to both `inter_agent_tasks` and `hive_mind`.
 *
 * @param agentId    Target agent identifier (must exist in agents/)
 * @param prompt     The task to delegate
 * @param chatId     Telegram chat ID (for DB tracking)
 * @param fromAgent  The requesting agent's ID (usually 'main')
 * @param onProgress Optional callback for status updates
 * @param timeoutMs  Maximum execution time (default 5 min)
 */
export async function delegateToAgent(
  agentId: string,
  prompt: string,
  chatId: string,
  fromAgent: string,
  onProgress?: (msg: string) => void,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<DelegationResult> {
  const agent = agentRegistry.find((a) => a.id === agentId);
  if (!agent) {
    const available = agentRegistry.map((a) => a.id).join(', ') || '(none)';
    throw new Error(
      `Agent "${agentId}" not found. Available: ${available}`,
    );
  }

  const taskId = crypto.randomUUID();
  const sessionId = taskId;
  const start = Date.now();

  // Record the task
  createInterAgentTask(taskId, fromAgent, agentId, chatId, prompt);
  logToHiveMind(
    fromAgent,
    chatId,
    'delegate',
    `Delegated to ${agentId}: ${prompt.slice(0, 100)}`,
  );

  // Log activity: delegation started
  logActivity(sessionId, fromAgent, 'delegate', {
    targetAgent: agentId,
    promptLength: prompt.length,
  }, 'pending');

  onProgress?.(`Delegating to ${agent.name}...`);

  try {
    // Resolve system prompt — prefer the custom registry agent's .md file,
    // then fall back to a classic agent's CLAUDE.md.
    let systemPrompt = '';
    let modelOverride: string | undefined;

    if (agent.isCustom) {
      // Custom registry agent: read system prompt from agents/{lane}/{id}.md
      systemPrompt = getAgentSystemPrompt(agentId);
      modelOverride = agent.model;
    } else {
      // Classic agent: read CLAUDE.md if present
      const claudeMdPath = resolveAgentClaudeMd(agentId);
      if (claudeMdPath) {
        try {
          systemPrompt = fs.readFileSync(claudeMdPath, 'utf-8');
        } catch {
          // No CLAUDE.md for this agent — that's fine
        }
      }
      modelOverride = agent.model;
    }

    // Build memory context for the delegated agent
    const { contextText: memCtx } = await buildMemoryContext(chatId, prompt, agentId);

    // Build the delegated prompt with agent role context + memory
    const contextParts: string[] = [];
    if (systemPrompt) {
      contextParts.push(`[Agent role — follow these instructions]\n${systemPrompt}\n[End agent role]`);
    }
    if (memCtx) {
      contextParts.push(memCtx);
    }
    contextParts.push(prompt);
    const fullPrompt = contextParts.join('\n\n');

    // Create an AbortController with timeout
    const abortCtrl = new AbortController();
    const timer = setTimeout(() => abortCtrl.abort(), timeoutMs);

    try {
      const result = await runAgent(
        fullPrompt,
        undefined, // fresh session for each delegation
        () => {}, // no typing indicator needed for sub-delegation
        undefined, // no progress callback for inner agent
        modelOverride, // honour the agent's configured model
        abortCtrl,
      );

      clearTimeout(timer);

      const durationMs = Date.now() - start;
      completeInterAgentTask(taskId, 'completed', result.text);
      logToHiveMind(
        agentId,
        chatId,
        'delegate_result',
        `Completed delegation from ${fromAgent}: ${(result.text ?? '').slice(0, 120)}`,
      );

      // Log activity: delegation completed
      logActivity(sessionId, agentId, 'complete', {
        fromAgent,
        resultLength: (result.text ?? '').length,
        inputTokens: result.usage?.inputTokens,
        outputTokens: result.usage?.outputTokens,
      }, 'ok', undefined, durationMs);

      onProgress?.(
        `${agent.name} completed (${Math.round(durationMs / 1000)}s)`,
      );

      return {
        agentId,
        text: result.text,
        usage: result.usage,
        taskId,
        durationMs,
      };
    } catch (innerErr) {
      clearTimeout(timer);
      throw innerErr;
    }
  } catch (err) {
    const durationMs = Date.now() - start;
    const errMsg = err instanceof Error ? err.message : String(err);
    completeInterAgentTask(taskId, 'failed', errMsg);
    logToHiveMind(
      agentId,
      chatId,
      'delegate_error',
      `Delegation from ${fromAgent} failed: ${errMsg.slice(0, 120)}`,
    );

    // Log activity: delegation failed
    logActivity(sessionId, agentId, 'error', {
      fromAgent,
      errorType: err instanceof Error ? err.constructor.name : 'unknown',
    }, 'error', errMsg, durationMs);

    throw err;
  }
}
