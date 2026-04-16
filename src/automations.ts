/**
 * Scheduled automations for WildClaude.
 *
 * Pre-configured cron tasks for life management:
 * - Morning briefing at 08:00
 * - Evening review prompt at 20:00
 * - Weekly review on Sunday at 18:00
 *
 * syncAutomations() is called at startup to insert/update defaults into
 * the scheduled_tasks DB, respecting user overrides from config.json.
 */

import { PROJECT_ROOT } from './config.js';
import { logger } from './logger.js';
import { createScheduledTask, getAllScheduledTasks, deleteScheduledTask, updateScheduledTaskPrompt, updateScheduledTaskSchedule } from './db.js';
import { loadUserConfig } from './overlay.js';
import { computeNextRun } from './scheduler.js';

export interface AutomationDef {
  id: string;
  name: string;
  prompt: string;
  cron: string;
  description: string;
}

export const DEFAULT_AUTOMATIONS: AutomationDef[] = [
  {
    id: 'morning-brief',
    name: 'Morning Briefing',
    prompt:
      'Fai il mio briefing mattutino. Leggi i miei obiettivi da life/goals/_kernel/key.md e il log recente da life/me/_kernel/log.md. ' +
      'Dammi un briefing mattutino stringato: i 3 principali obiettivi per oggi, eventuali impegni di ieri che devo seguire, ' +
      'e chiedimi del mio livello di energia.',
    cron: '0 8 * * *',
    description: 'Briefing mattutino alle 8 del mattino ogni giorno',
  },
  {
    id: 'evening-review',
    name: 'Evening Review',
    prompt:
      'Fai la mia revisione serale. Chiedimi: 1) Cosa ho realizzato oggi? 2) Livello di energia 1-10? ' +
      '3) Una cosa che ho imparato o che farei diversamente. Poi registra le mie risposte in life/me/_kernel/log.md.',
    cron: '0 20 * * *',
    description: 'Revisione serale alle 20 ogni giorno',
  },
  {
    id: 'weekly-review',
    name: 'Weekly Review',
    prompt:
      'Fai la mia revisione settimanale. Leggi gli entry di life/me/_kernel/log.md di questa settimana e life/goals/_kernel/key.md. ' +
      'Genera uno scorecard: progresso obiettivi, vittorie, lezioni, impegni aperti. ' +
      'Poi chiedimi: cosa renderebbe la prossima settimana un successo? Suggerisci i 3 principali obiettivi per la prossima settimana.',
    cron: '0 18 * * 0',
    description: 'Revisione settimanale domenica alle 18',
  },
];

/**
 * Sync automations into the scheduled_tasks DB.
 *
 * Logic:
 *  1. Load user config automations (for enabled/disabled overrides + custom schedule + custom prompts)
 *  2. For each DEFAULT_AUTOMATION:
 *     - If user config has a matching id with enabled=false → DELETE from DB (disable)
 *     - If user config has a matching id with custom prompt/cron → UPDATE in DB
 *     - If not already in the DB → insert it
 *     - If already in the DB and no overrides → leave it alone (preserves last_run etc.)
 *  3. For each user config automation that isn't in DEFAULT_AUTOMATIONS:
 *     - If enabled=false and exists in DB → DELETE it
 *     - If enabled=true and not in DB → insert it
 *     - If enabled=true and in DB → update prompt/cron if changed
 *
 * Safe to call multiple times — never creates duplicates.
 */
export function syncAutomations(agentId = 'main'): void {
  const userConfig = loadUserConfig();
  const userAutomations = userConfig.automations || [];

  // Index user config by id
  const userById = new Map(userAutomations.map((a) => [a.id, a]));

  // Get existing DB tasks indexed by id
  const existingTasks = getAllScheduledTasks(agentId);
  const existingById = new Map(existingTasks.map((t) => [t.id, t]));

  // --- Default automations ---
  for (const def of DEFAULT_AUTOMATIONS) {
    const userOverride = userById.get(def.id);

    // User explicitly disabled this automation
    if (userOverride && userOverride.enabled === false) {
      if (existingById.has(def.id)) {
        deleteScheduledTask(def.id);
        logger.info({ id: def.id }, 'Automation disabled by user config, deleted from DB');
      } else {
        logger.debug({ id: def.id }, 'Automation disabled by user config (was not in DB)');
      }
      continue;
    }

    // Check if user provided custom prompt or cron for an existing automation
    if (userOverride && existingById.has(def.id)) {
      if (userOverride.prompt) {
        updateScheduledTaskPrompt(def.id, userOverride.prompt);
        logger.info({ id: def.id }, 'Automation prompt updated from user config');
      }
      if (userOverride.cron) {
        const existing = existingById.get(def.id)!;
        if (existing.schedule !== userOverride.cron) {
          const nextRun = computeNextRun(userOverride.cron);
          updateScheduledTaskSchedule(def.id, userOverride.cron, nextRun);
          logger.info({ id: def.id, cron: userOverride.cron }, 'Automation schedule updated from user config');
        }
      }
    }

    // Already in the DB — don't re-insert (preserves last_run, status, etc.)
    if (existingById.has(def.id)) {
      logger.debug({ id: def.id }, 'Automation already exists in DB, skipping');
      continue;
    }

    // Use user's custom cron if provided, otherwise fall back to default
    const cron = userOverride?.cron || def.cron;
    // Use user's custom prompt if provided, otherwise use default
    const prompt = userOverride?.prompt || def.prompt;

    try {
      const nextRun = computeNextRun(cron);
      createScheduledTask(def.id, prompt, cron, nextRun, agentId);
      logger.info({ id: def.id, cron }, 'Automation installed');
    } catch (err) {
      logger.warn({ err, id: def.id }, 'Failed to install automation (non-fatal)');
    }
  }

  // --- User-defined custom automations ---
  for (const userAuto of userAutomations) {
    // Skip ones that match a default id (handled above)
    if (DEFAULT_AUTOMATIONS.some((d) => d.id === userAuto.id)) continue;

    // Handle disabled custom automations
    if (userAuto.enabled === false) {
      if (existingById.has(userAuto.id)) {
        deleteScheduledTask(userAuto.id);
        logger.info({ id: userAuto.id }, 'Custom automation disabled, deleted from DB');
      }
      continue;
    }

    // Handle enabled custom automations already in DB
    if (existingById.has(userAuto.id)) {
      if (userAuto.prompt) {
        updateScheduledTaskPrompt(userAuto.id, userAuto.prompt);
        logger.info({ id: userAuto.id }, 'Custom automation prompt updated');
      }
      if (userAuto.cron) {
        const existing = existingById.get(userAuto.id)!;
        if (existing.schedule !== userAuto.cron) {
          const nextRun = computeNextRun(userAuto.cron);
          updateScheduledTaskSchedule(userAuto.id, userAuto.cron, nextRun);
          logger.info({ id: userAuto.id, cron: userAuto.cron }, 'Custom automation schedule updated');
        }
      }
      logger.debug({ id: userAuto.id }, 'Custom automation already in DB, skipping insert');
      continue;
    }

    // Create new custom automation
    try {
      const nextRun = computeNextRun(userAuto.cron);
      createScheduledTask(userAuto.id, userAuto.prompt, userAuto.cron, nextRun, agentId);
      logger.info({ id: userAuto.id, cron: userAuto.cron }, 'Custom automation installed');
    } catch (err) {
      logger.warn({ err, id: userAuto.id }, 'Failed to install custom automation (non-fatal)');
    }
  }

  logger.info({ agentId }, 'Automation sync complete');
}

/**
 * Get the list of default automations (for display / API).
 */
export function getDefaultAutomations(): AutomationDef[] {
  return DEFAULT_AUTOMATIONS;
}

/**
 * Legacy alias kept for backward compatibility.
 * @deprecated Use syncAutomations() instead.
 */
export function installDefaultAutomations(): void {
  syncAutomations();
}
