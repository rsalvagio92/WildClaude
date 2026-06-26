import { CronExpressionParser } from 'cron-parser';

import { AGENT_ID, ALLOWED_CHAT_ID } from './config.js';
import {
  getDueTasks,
  getSession,
  logConversationTurn,
  markTaskRunning,
  updateTaskAfterRun,
  resetStuckTasks,
  claimNextMissionTask,
  completeMissionTask,
  resetStuckMissionTasks,
} from './db.js';
import { logger } from './logger.js';
import { messageQueue } from './message-queue.js';
import { runAgent } from './agent.js';
import { formatForTelegram, splitMessage } from './bot.js';
import { emitChatEvent } from './state.js';
import { isSecondary } from './config-role.js';

type Sender = (text: string) => Promise<void>;

/**
 * Fleet task policy. With shared memory living on the primary, routine and
 * housekeeping tasks must run ONLY on the primary — otherwise secondaries
 * duplicate digests/reflections/cleanup against their own (non-shared) data.
 *
 * Sentinels NOT listed here are "fleet" tasks: they may run on secondaries
 * too, and their results are forwarded to the primary (see self-learning /
 * self-improvement forwarding).
 */
const PRIMARY_ONLY_SENTINELS = new Set([
  '__internal:reflect:day',
  '__internal:reflect:week',
  '__internal:digest:day',
  '__internal:budget:check',
  '__internal:cleanup:run',
  '__internal:wiki_curate:run',
]);

/**
 * Internal sentinel prompts trigger local handlers without calling the LLM.
 * Used by auto-cron tasks (reflection, digest, budget check) so cron jobs
 * don't burn tokens just to dispatch their work.
 */
async function handleInternalSentinel(prompt: string, send: Sender): Promise<void> {
  // Role gating: routine/housekeeping sentinels are primary-only. On a
  // secondary they're no-ops (the primary owns the shared data they operate on).
  if (isSecondary() && PRIMARY_ONLY_SENTINELS.has(prompt)) {
    logger.info({ prompt }, 'Skipping primary-only sentinel on secondary');
    return;
  }
  if (prompt === '__internal:reflect:day' || prompt === '__internal:reflect:week') {
    const { generateReflection } = await import('./reflection.js');
    const period = prompt.endsWith(':week') ? 'week' : 'day';
    try {
      const r = await generateReflection(period);
      if (!r) {
        await send(`Auto-reflection (${period}): nessuna attività rilevante da analizzare.`);
        return;
      }
      const lines = [`<b>Auto-reflection (${period})</b>`, r.summary];
      if (r.patterns.length > 0) {
        lines.push('');
        lines.push('<b>Patterns:</b>');
        lines.push(...r.patterns.map((p, i) => `${i + 1}. ${p}`));
      }
      await send(lines.join('\n'));
    } catch (err) {
      logger.warn({ err, period }, 'auto-reflection failed');
    }
    return;
  }
  if (prompt === '__internal:digest:day') {
    const { computeDigest, persistDigest } = await import('./digest.js');
    const now = Date.now();
    const d = computeDigest(now - 24 * 3600 * 1000, now);
    persistDigest(d);
    await send(`<pre>${d.body.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>`);
    return;
  }
  if (prompt === '__internal:budget:check') {
    const { checkBudgetAndAlert } = await import('./cost-budget.js');
    await checkBudgetAndAlert(send);
    return;
  }
  if (prompt === '__internal:agent_improve:run') {
    const { runSelfImprovementCycle } = await import('./agent-self-improvement.js');
    await runSelfImprovementCycle(send);
    return;
  }
  if (prompt === '__internal:cleanup:run') {
    const { runMaintenanceCleanup } = await import('./maintenance.js');
    const summary = await runMaintenanceCleanup();
    await send(`🧹 Cleanup: ${summary}`);
    return;
  }
  if (prompt === '__internal:self_learn:run') {
    // Part A — non-destructive nightly learning + daily backup (user data only).
    const { runSelfLearning } = await import('./self-learning.js');
    try { await runSelfLearning(send); } catch (err) { logger.warn({ err }, 'self-learning failed'); }
    return;
  }
  if (prompt === '__internal:self_improve_code:run') {
    // Part B — code self-improvement (gated, human-in-the-loop; opt-in).
    const { runCodeImprovement } = await import('./self-improvement.js');
    try { await runCodeImprovement(send); } catch (err) { logger.warn({ err }, 'self-improvement failed'); }
    return;
  }
  if (prompt === '__internal:wiki_curate:run') {
    // Distill recurring important-memory topics into DRAFT wiki articles.
    const { runWikiCuration } = await import('./wiki.js');
    try { await runWikiCuration(send); } catch (err) { logger.warn({ err }, 'wiki curation failed'); }
    return;
  }
  if (prompt === '__internal:kernel_sync:run') {
    // Reconcile life kernel files (me/goals/learning/finance) from recent activity.
    const { runKernelAutoSync } = await import('./kernel-auto-sync.js');
    try { await runKernelAutoSync(); } catch (err) { logger.warn({ err }, 'kernel auto-sync failed'); }
    return;
  }
  logger.warn({ prompt }, 'unknown internal sentinel');
}

/** Max time (ms) a scheduled task can run before being killed. */
const TASK_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

let sender: Sender;

/**
 * In-memory set of task IDs currently being executed.
 * Acts as a fast-path guard alongside the DB-level lock in markTaskRunning.
 */
const runningTaskIds = new Set<string>();

/**
 * Initialise the scheduler. Call once after the Telegram bot is ready.
 * @param send  Function that sends a message to the user's Telegram chat.
 */
let schedulerAgentId = 'main';

export function initScheduler(send: Sender, agentId = 'main'): void {
  if (!ALLOWED_CHAT_ID) {
    logger.warn('ALLOWED_CHAT_ID not set — scheduler will not send results');
  }
  sender = send;
  schedulerAgentId = agentId;

  // Recover tasks stuck in 'running' from a previous crash
  const recovered = resetStuckTasks(agentId);
  if (recovered > 0) {
    logger.warn({ recovered, agentId }, 'Reset stuck tasks from previous crash');
  }
  const recoveredMission = resetStuckMissionTasks(agentId);
  if (recoveredMission > 0) {
    logger.warn({ recovered: recoveredMission, agentId }, 'Reset stuck mission tasks from previous crash');
  }

  setInterval(() => void runDueTasks(), 60_000);
  logger.info({ agentId }, 'Scheduler started (checking every 60s)');
}

async function runDueTasks(): Promise<void> {
  const tasks = getDueTasks(schedulerAgentId);

  if (tasks.length > 0) {
    logger.info({ count: tasks.length }, 'Running due scheduled tasks');
  }

  for (const task of tasks) {
    // In-memory guard: skip if already running in this process
    if (runningTaskIds.has(task.id)) {
      logger.warn({ taskId: task.id }, 'Task already running, skipping duplicate fire');
      continue;
    }

    // Compute next occurrence BEFORE executing so we can lock the task
    // in the DB immediately, preventing re-fire on subsequent ticks.
    const nextRun = computeNextRun(task.schedule);
    runningTaskIds.add(task.id);
    markTaskRunning(task.id, nextRun);

    logger.info({ taskId: task.id, prompt: task.prompt.slice(0, 60) }, 'Firing task');

    // Route through the message queue so scheduled tasks wait for any
    // in-flight user message to finish before running. This prevents
    // two Claude processes from hitting the same session simultaneously.
    const chatId = ALLOWED_CHAT_ID || 'scheduler';
    const accepted = messageQueue.enqueue(chatId, async () => {
      const abortController = new AbortController();
      const timeout = setTimeout(() => abortController.abort(), TASK_TIMEOUT_MS);

      try {
        // ── Internal sentinel tasks: don't call the LLM, route to local handlers ──
        if (task.prompt.startsWith('__internal:')) {
          await handleInternalSentinel(task.prompt, sender);
          updateTaskAfterRun(task.id, nextRun, '(internal sentinel)', 'success');
          return;
        }

        await sender(`Scheduled task running: "${task.prompt.slice(0, 80)}${task.prompt.length > 80 ? '...' : ''}"`);

        // Run as a fresh agent call (no session — scheduled tasks are autonomous)
        const result = await runAgent(task.prompt, undefined, () => {}, undefined, undefined, abortController);

        if (result.aborted) {
          updateTaskAfterRun(task.id, nextRun, 'Timed out after 10 minutes', 'timeout');
          await sender(`⏱ Task timed out after 10m: "${task.prompt.slice(0, 60)}..." — killed.`);
          logger.warn({ taskId: task.id }, 'Task timed out');
          return;
        }

        const text = result.text?.trim() || 'Task completed with no output.';
        for (const chunk of splitMessage(formatForTelegram(text))) {
          await sender(chunk);
        }

        // Inject task output into the active chat session so user replies have context
        if (ALLOWED_CHAT_ID) {
          const activeSession = getSession(ALLOWED_CHAT_ID, schedulerAgentId);
          logConversationTurn(ALLOWED_CHAT_ID, 'user', `[Scheduled task]: ${task.prompt}`, activeSession ?? undefined, schedulerAgentId);
          logConversationTurn(ALLOWED_CHAT_ID, 'assistant', text, activeSession ?? undefined, schedulerAgentId);
        }

        updateTaskAfterRun(task.id, nextRun, text, 'success');

        logger.info({ taskId: task.id, nextRun }, 'Task complete, next run scheduled');
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        updateTaskAfterRun(task.id, nextRun, errMsg.slice(0, 500), 'failed');

        logger.error({ err, taskId: task.id }, 'Scheduled task failed');
        try {
          await sender(`❌ Task failed: "${task.prompt.slice(0, 60)}..." — ${errMsg.slice(0, 200)}`);
        } catch {
          // ignore send failure
        }
      } finally {
        clearTimeout(timeout);
        runningTaskIds.delete(task.id);
      }
    });
    if (!accepted) {
      // Queue full — release the in-memory lock so the task can fire on a
      // later tick instead of being stuck "running" forever.
      runningTaskIds.delete(task.id);
      updateTaskAfterRun(task.id, nextRun, 'Skipped: message queue full', 'failed');
      logger.warn({ taskId: task.id }, 'Scheduled task skipped — message queue full');
    }
  }

  // Also check for queued mission tasks (one-shot async tasks from Mission Control)
  await runDueMissionTasks();
}

async function runDueMissionTasks(): Promise<void> {
  const mission = claimNextMissionTask(schedulerAgentId);
  if (!mission) return;

  const missionKey = 'mission-' + mission.id;
  if (runningTaskIds.has(missionKey)) return;
  runningTaskIds.add(missionKey);

  logger.info({ missionId: mission.id, title: mission.title }, 'Running mission task');

  const chatId = ALLOWED_CHAT_ID || 'mission';
  const accepted = messageQueue.enqueue(chatId, async () => {
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), TASK_TIMEOUT_MS);

    try {
      const result = await runAgent(mission.prompt, undefined, () => {}, undefined, undefined, abortController);

      if (result.aborted) {
        completeMissionTask(mission.id, null, 'failed', 'Timed out after 10 minutes');
        logger.warn({ missionId: mission.id }, 'Mission task timed out');
        try { await sender('Mission task timed out: "' + mission.title + '"'); } catch {}
      } else {
        const text = result.text?.trim() || 'Task completed with no output.';
        completeMissionTask(mission.id, text, 'completed');
        logger.info({ missionId: mission.id }, 'Mission task completed');

        // Send result to Telegram
        for (const chunk of splitMessage(formatForTelegram(text))) {
          await sender(chunk);
        }

        // Inject into conversation context so agent can reference it
        if (ALLOWED_CHAT_ID) {
          const activeSession = getSession(ALLOWED_CHAT_ID, schedulerAgentId);
          logConversationTurn(ALLOWED_CHAT_ID, 'user', '[Mission task: ' + mission.title + ']: ' + mission.prompt, activeSession ?? undefined, schedulerAgentId);
          logConversationTurn(ALLOWED_CHAT_ID, 'assistant', text, activeSession ?? undefined, schedulerAgentId);
        }
      }

      emitChatEvent({
        type: 'mission_update' as 'progress',
        chatId,
        content: JSON.stringify({
          id: mission.id,
          status: result.aborted ? 'failed' : 'completed',
          title: mission.title,
        }),
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      completeMissionTask(mission.id, null, 'failed', errMsg.slice(0, 500));
      logger.error({ err, missionId: mission.id }, 'Mission task failed');
    } finally {
      clearTimeout(timeout);
      runningTaskIds.delete(missionKey);
    }
  });
  if (!accepted) {
    runningTaskIds.delete(missionKey);
    completeMissionTask(mission.id, null, 'failed', 'Skipped: message queue full');
    logger.warn({ missionId: mission.id }, 'Mission task skipped — message queue full');
  }
}

export function computeNextRun(cronExpression: string): number {
  const interval = CronExpressionParser.parse(cronExpression);
  return Math.floor(interval.next().getTime() / 1000);
}
