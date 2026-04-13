/**
 * ralph.ts — Autonomous development loop bridge for WildClaude.
 *
 * Inspired by frankbria/ralph-claude-code's bash loop but implemented in
 * TypeScript so it integrates naturally with the Telegram bot and runAgent().
 *
 * Flow: decompose goal into task checklist → iterate through unchecked tasks
 * → mark done → report progress via Telegram updates.
 *
 * Circuit breaker: stop after 3 consecutive iterations with no new tasks
 * completed.
 * Rate limiting: track call timestamps, pause when maxCallsPerHour exceeded.
 */

import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';

import { runAgent } from './agent.js';
import { PROJECT_ROOT } from './config.js';
import { logger } from './logger.js';
import { createMissionTask, completeMissionTask } from './db.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface RalphConfig {
  goal: string;
  maxIterations: number;
  maxCallsPerHour: number;
  projectDir: string;
}

export interface RalphStatus {
  running: boolean;
  iteration: number;
  maxIterations: number;
  lastOutput: string;
  startedAt: number | null;
  completedTasks: number;
  totalTasks: number;
}

// ── Module state ─────────────────────────────────────────────────────────────

let stopRequested = false;

const status: RalphStatus = {
  running: false,
  iteration: 0,
  maxIterations: 0,
  lastOutput: '',
  startedAt: null,
  completedTasks: 0,
  totalTasks: 0,
};

/** Rolling window of call timestamps for rate limiting. */
const callTimestamps: number[] = [];

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Count completed tasks ([x] prefix) in fix_plan.md content. */
function countCompleted(content: string): number {
  return (content.match(/^- \[x\]/gim) ?? []).length;
}

/** Count total tasks (checked or unchecked) in fix_plan.md content. */
function countTotal(content: string): number {
  return (content.match(/^- \[[ x]\]/gim) ?? []).length;
}

/** Parse all task texts from plan content. */
function parsePlan(content: string): string[] {
  return content
    .split('\n')
    .filter((line) => /^- \[[ x]\]/.test(line))
    .map((line) => line.replace(/^- \[[ x]\]\s*/, '').trim());
}

/** Check if a specific task is marked done. */
function isTaskDone(content: string, task: string): boolean {
  const escaped = task.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^- \\[x\\]\\s*${escaped}`, 'im').test(content);
}

/** Return lines for tasks that are still unchecked. */
function getUnfinishedTasks(content: string): string[] {
  return content
    .split('\n')
    .filter((line) => /^- \[ \]/.test(line))
    .map((line) => line.replace(/^- \[ \]\s*/, '').trim());
}

/**
 * Mark a task as done in fix_plan.md.
 * Replaces the first unchecked checkbox whose text matches the task (case-insensitive prefix).
 */
function markTaskDone(content: string, task: string): string {
  // Escape special regex chars in task text
  const escaped = task.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return content.replace(
    new RegExp(`^(- \\[ \\]\\s*)${escaped}`, 'im'),
    `- [x] ${task}`,
  );
}

/**
 * Enforce rate limiting. Returns the number of milliseconds to wait (0 if ok).
 */
function rateLimitDelay(maxCallsPerHour: number): number {
  const now = Date.now();
  const oneHourAgo = now - 3_600_000;
  // Drop timestamps older than 1 hour
  while (callTimestamps.length > 0 && callTimestamps[0] < oneHourAgo) {
    callTimestamps.shift();
  }
  if (callTimestamps.length < maxCallsPerHour) return 0;
  // Next slot opens when the oldest call ages out
  return callTimestamps[0] + 3_600_000 - now;
}

/** Record a call for rate-limit accounting. */
function recordCall(): void {
  callTimestamps.push(Date.now());
}

// ── Core loop ─────────────────────────────────────────────────────────────────

/**
 * Start the Ralph autonomous loop.
 *
 * @param config    Configuration including goal, limits, and project directory.
 * @param onUpdate  Called after each iteration with the current status snapshot.
 */
export async function startRalph(
  config: RalphConfig,
  onUpdate: (status: RalphStatus) => void,
): Promise<void> {
  if (status.running) {
    logger.warn('Ralph is already running — ignoring duplicate startRalph call');
    return;
  }

  stopRequested = false;
  callTimestamps.length = 0;

  const ralphDir = path.join(config.projectDir, '.ralph');
  const promptFile = path.join(ralphDir, 'PROMPT.md');
  const planFile = path.join(ralphDir, 'fix_plan.md');

  // ── Set up .ralph/ directory ──────────────────────────────────────────────
  fs.mkdirSync(ralphDir, { recursive: true });
  fs.writeFileSync(promptFile, `# Ralph Goal\n\n${config.goal}\n`, 'utf8');

  logger.info({ goal: config.goal, projectDir: config.projectDir }, 'Ralph starting');

  // ── Track in Mission Control ──────────────────────────────────────────────
  const missionId = 'ralph-' + randomBytes(4).toString('hex');
  try {
    createMissionTask(missionId, `Ralph: ${config.goal.slice(0, 80)}`, config.goal, 'orchestrator', 'ralph', 8);
  } catch (err) {
    logger.warn({ err }, 'Failed to create mission task for Ralph — continuing without tracking');
  }

  // ── Initialise status ─────────────────────────────────────────────────────
  Object.assign(status, {
    running: true,
    iteration: 0,
    maxIterations: config.maxIterations,
    lastOutput: 'Decomposing goal into tasks…',
    startedAt: Date.now(),
    completedTasks: 0,
    totalTasks: 0,
  });
  onUpdate({ ...status });

  try {
    // ── Step 1: Decompose goal into fix_plan.md ─────────────────────────────
    const decomposePrompt =
      `You are a planning assistant. Decompose the following goal into a concise ` +
      `numbered task checklist using GitHub-style Markdown checkboxes.\n\n` +
      `Rules:\n` +
      `- Each task must start with exactly "- [ ] " (dash space bracket space bracket space)\n` +
      `- Tasks should be concrete, actionable, and independently executable\n` +
      `- Aim for 3-10 tasks; merge trivial steps\n` +
      `- Output ONLY the checklist — no preamble, no explanation\n\n` +
      `Goal:\n${config.goal}`;

    recordCall();
    const decomposeResult = await runAgent(
      decomposePrompt,
      undefined,
      () => {},
      undefined,
      undefined,
      undefined,
    );

    const planContent = decomposeResult.text ?? '';
    fs.writeFileSync(planFile, `# Fix Plan\n\n${planContent}\n`, 'utf8');

    status.totalTasks = countTotal(planContent);
    status.completedTasks = 0;
    status.lastOutput = `Plan ready: ${status.totalTasks} task(s)`;
    onUpdate({ ...status });

    // ── Step 2: Iterate through tasks ────────────────────────────────────────
    let noProgressStreak = 0;
    const CIRCUIT_BREAKER_LIMIT = 5;  // raised from 3: complex tasks need more iterations
    let retryWithDifferentApproach = false;
    let sessionId: string | undefined;

    for (let iter = 1; iter <= config.maxIterations; iter++) {
      if (stopRequested) {
        status.lastOutput = 'Stopped by user request.';
        break;
      }

      // Read current plan state
      const currentPlan = fs.readFileSync(planFile, 'utf8');
      const pending = getUnfinishedTasks(currentPlan);

      if (pending.length === 0) {
        status.lastOutput = 'All tasks completed.';
        break;
      }

      // Rate limiting
      const waitMs = rateLimitDelay(config.maxCallsPerHour);
      if (waitMs > 0) {
        const waitSec = Math.ceil(waitMs / 1000);
        status.lastOutput = `Rate limit reached — waiting ${waitSec}s…`;
        onUpdate({ ...status });
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }

      if (stopRequested) break;

      // Take the first unchecked task
      const currentTask = pending[0];
      status.iteration = iter;
      status.lastOutput = `[${iter}/${config.maxIterations}] Working on: ${currentTask}`;
      onUpdate({ ...status });

      logger.info({ iter, task: currentTask }, 'Ralph iteration');

      // Call agent for this task
      recordCall();
      const taskPrompt = retryWithDifferentApproach
        ? `Context — overall goal:\n${config.goal}\n\n` +
          `Your current task:\n${currentTask}\n\n` +
          `IMPORTANT: Previous attempts at this task failed. Try a DIFFERENT approach:\n` +
          `- Break it into smaller steps\n` +
          `- Use simpler tools or methods\n` +
          `- If something is blocked, work around it or skip the blocked part\n\n` +
          `Complete this task fully. When done, say exactly: TASK COMPLETE`
        : `Context — overall goal:\n${config.goal}\n\n` +
          `Your current task:\n${currentTask}\n\n` +
          `Complete this task fully. When done, say exactly: TASK COMPLETE`;

      const result = await runAgent(
        taskPrompt,
        sessionId,
        () => {},
        undefined,
        undefined,
        undefined,
      );

      // Persist session for context continuity
      if (result.newSessionId) sessionId = result.newSessionId;

      const agentOutput = result.text ?? '';
      const taskDone = /TASK COMPLETE/i.test(agentOutput);

      if (taskDone) {
        // Mark task done in plan
        const updatedPlan = markTaskDone(fs.readFileSync(planFile, 'utf8'), currentTask);
        fs.writeFileSync(planFile, updatedPlan, 'utf8');
        status.completedTasks = countCompleted(updatedPlan);
        noProgressStreak = 0;
        status.lastOutput =
          `[${iter}/${config.maxIterations}] Done: ${currentTask}\n` +
          `Progress: ${status.completedTasks}/${countTotal(updatedPlan)} tasks`;
      } else {
        noProgressStreak++;

        // After 3 failed attempts on same task, try a different approach
        if (noProgressStreak === 3 && !retryWithDifferentApproach) {
          retryWithDifferentApproach = true;
          status.lastOutput =
            `[${iter}/${config.maxIterations}] Retrying "${currentTask}" with different approach...`;
          logger.info({ task: currentTask }, 'Ralph: switching strategy after 3 no-progress iterations');
          // Reset streak partially — give 2 more tries with the new approach
          noProgressStreak = 3;
        } else {
          status.lastOutput =
            `[${iter}/${config.maxIterations}] No completion signal for: ${currentTask} ` +
            `(streak ${noProgressStreak}/${CIRCUIT_BREAKER_LIMIT})`;
        }
      }

      onUpdate({ ...status });

      // Circuit breaker
      if (noProgressStreak >= CIRCUIT_BREAKER_LIMIT) {
        // Skip this task and try the next one instead of stopping entirely
        const plan = fs.readFileSync(planFile, 'utf8');
        const allTasks = parsePlan(plan);
        const nextTask = allTasks.find(t => t !== currentTask && !isTaskDone(plan, t));
        if (nextTask && !retryWithDifferentApproach) {
          status.lastOutput =
            `Skipping stuck task "${currentTask.slice(0, 50)}..." — moving to next task`;
          logger.warn({ skipped: currentTask, next: nextTask }, 'Ralph: skipping stuck task');
          noProgressStreak = 0;
          retryWithDifferentApproach = false;
          continue;
        }
        status.lastOutput =
          `Circuit breaker: ${CIRCUIT_BREAKER_LIMIT} iterations with no progress. Stopping.`;
        logger.warn({ noProgressStreak }, 'Ralph circuit breaker triggered');
        break;
      }
    }
  } catch (err) {
    logger.error({ err }, 'Ralph loop error');
    status.lastOutput = `Error: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    status.running = false;
    onUpdate({ ...status });
    logger.info({ completedTasks: status.completedTasks, totalTasks: status.totalTasks }, 'Ralph stopped');

    // ── Complete Mission Control task ───────────────────────────────────────
    try {
      const summary = `Ralph completed ${status.completedTasks}/${status.totalTasks} tasks. Last: ${status.lastOutput}`;
      const finalStatus = status.completedTasks === status.totalTasks && status.totalTasks > 0 ? 'completed' : 'failed';
      completeMissionTask(missionId, summary, finalStatus, finalStatus === 'failed' ? status.lastOutput : undefined);
    } catch { /* mission tracking is best-effort */ }
  }
}

// ── Control ───────────────────────────────────────────────────────────────────

/** Request the loop to stop after the current iteration completes. */
export function stopRalph(): void {
  stopRequested = true;
}

/** Return a snapshot of the current Ralph status. */
export function getRalphStatus(): RalphStatus {
  return { ...status };
}

// ── Telegram command registration ─────────────────────────────────────────────

/**
 * Register /ralph commands on the grammY bot.
 *
 * /ralph <goal>   — Start a new Ralph loop with the given goal
 * /ralph status   — Show current Ralph status
 * /ralph stop     — Stop the running loop
 */
export function registerRalphCommand(
  bot: import('grammy').Bot,
  isAuthorised: (chatId: number) => boolean,
): void {
  bot.command('ralph', async (ctx) => {
    if (!isAuthorised(ctx.chat!.id)) return;

    const args = (ctx.match ?? '').trim();

    // /ralph status
    if (args.toLowerCase() === 'status') {
      const s = getRalphStatus();
      if (!s.running && s.startedAt === null) {
        await ctx.reply('Ralph is not running. Use /ralph <goal> to start.');
        return;
      }
      const elapsed = s.startedAt ? Math.round((Date.now() - s.startedAt) / 1000) : 0;
      const lines = [
        `<b>Ralph status</b>`,
        `Running: ${s.running ? 'yes' : 'no'}`,
        `Iteration: ${s.iteration}/${s.maxIterations}`,
        `Tasks: ${s.completedTasks}/${s.totalTasks}`,
        `Elapsed: ${elapsed}s`,
        `Last: ${s.lastOutput}`,
      ];
      await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' });
      return;
    }

    // /ralph stop
    if (args.toLowerCase() === 'stop') {
      if (!status.running) {
        await ctx.reply('Ralph is not running.');
        return;
      }
      stopRalph();
      await ctx.reply('Stop requested — Ralph will halt after the current iteration.');
      return;
    }

    // /ralph <goal>
    if (!args) {
      await ctx.reply(
        'Usage:\n' +
        '/ralph <goal>   — Start autonomous loop\n' +
        '/ralph status   — Show status\n' +
        '/ralph stop     — Stop loop',
      );
      return;
    }

    if (status.running) {
      await ctx.reply('Ralph is already running. Use /ralph stop to stop it first.');
      return;
    }

    const goal = args;
    const chatIdStr = ctx.chat!.id.toString();
    await ctx.reply(`Starting Ralph for goal:\n<b>${goal}</b>`, { parse_mode: 'HTML' });

    const config: RalphConfig = {
      goal,
      maxIterations: 20,
      maxCallsPerHour: 30,
      projectDir: PROJECT_ROOT,
    };

    // Run loop in background — send Telegram updates after each iteration
    startRalph(config, async (s) => {
      const summary =
        `<b>Ralph</b> [${s.iteration}/${s.maxIterations}] ` +
        `${s.completedTasks}/${s.totalTasks} tasks\n` +
        `${s.lastOutput}`;
      try {
        await ctx.api.sendMessage(parseInt(chatIdStr), summary, { parse_mode: 'HTML' });
      } catch (err) {
        logger.warn({ err }, 'Ralph: failed to send Telegram update');
      }
    }).catch((err) => {
      logger.error({ err }, 'Ralph: unhandled loop error');
      ctx.api
        .sendMessage(parseInt(chatIdStr), `Ralph loop error: ${err instanceof Error ? err.message : String(err)}`)
        .catch(() => {});
    });
  });
}
