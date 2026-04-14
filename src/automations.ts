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
import { createScheduledTask, getAllScheduledTasks } from './db.js';
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
  {
    id: 'nightly-self-review',
    name: 'Nightly Self-Review',
    prompt: `You are the WildClaude self-improvement agent. Analyze yesterday's changes and find bugs, misunderstandings, or inefficiencies.

## Steps

### 1. Review yesterday's commits
Execute: \`git log --since='yesterday 00:00' --until='today 00:00' --oneline --all\`

If no commits yesterday, stop and report "No commits yesterday".

For each commit, examine: \`git show <hash>\`

### 2. Categorize findings

**CODE_FIX** — buggy or broken code:
- Logic errors, async failures, missing null checks
- Security issues (unvalidated input, exposed paths, missing auth)
- TypeScript errors or runtime crash patterns
- Repeated error patterns
- Missing error handling at boundaries

**LESSON_LEARNED** — process issues (NOT code):
- Misunderstandings of intent
- Wrong assumptions
- Suboptimal workflow choices
- Communication patterns that failed
- Things that worked well (repeat these)

### 3. For CODE_FIX items

Apply fixes directly to repo files. Keep changes minimal — no refactoring.

Run: \`npx tsc --noEmit\` (ignore *.test.ts pre-existing errors)

Commit: \`fix(self-review YYYY-MM-DD): <description>\`

### 4. For LESSON_LEARNED items

Append to \`~/.wild-claude-pi/lessons-learned.md\` (create if missing):

\`\`\`
## YYYY-MM-DD
- **[category]** What happened. Why wrong. What to do differently.
\`\`\`

Commit lessons separately or with code fixes.

### 5. Push all commits

\`git push origin master\`

### 6. Summary

Report:
- N commits reviewed
- N CODE_FIX items applied
- N LESSON_LEARNED items saved
- Key findings (2-3 bullets)

## Important

- Only touch files related to findings — no speculative improvements
- Fix bugs only, do not add features
- If risky/unclear, document as LESSON_LEARNED instead of code fix
- Lessons go to ~/.wild-claude-pi/, NEVER to docs/ in the repo
`,
    cron: '0 2 * * *',
    description: 'Nightly self-review alle 02:00 (analizza commit e applica fix)',
  },
];

/**
 * Sync automations into the scheduled_tasks DB.
 *
 * Logic:
 *  1. Load user config automations (for enabled/disabled overrides + custom schedule)
 *  2. For each DEFAULT_AUTOMATION:
 *     - If user config has a matching id with enabled=false → skip (disabled)
 *     - If user config has a matching id with a custom cron → use that cron
 *     - If not already in the DB → insert it
 *     - If already in the DB → leave it alone (preserves last_run, next_run etc.)
 *  3. For each user config automation that isn't in DEFAULT_AUTOMATIONS → insert if missing
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
      logger.info({ id: def.id }, 'Automation disabled by user config, skipping');
      continue;
    }

    // Already in the DB — don't touch it (preserves schedule, last_run, etc.)
    if (existingById.has(def.id)) {
      logger.debug({ id: def.id }, 'Automation already exists in DB, skipping');
      continue;
    }

    // Use user's custom cron if provided, otherwise fall back to default
    const cron = userOverride?.cron || def.cron;

    try {
      const nextRun = computeNextRun(cron);
      createScheduledTask(def.id, def.prompt, cron, nextRun, agentId);
      logger.info({ id: def.id, cron }, 'Automation installed');
    } catch (err) {
      logger.warn({ err, id: def.id }, 'Failed to install automation (non-fatal)');
    }
  }

  // --- User-defined custom automations ---
  for (const userAuto of userAutomations) {
    // Skip ones that match a default id (handled above)
    if (DEFAULT_AUTOMATIONS.some((d) => d.id === userAuto.id)) continue;

    // Skip disabled
    if (userAuto.enabled === false) continue;

    // Already in the DB
    if (existingById.has(userAuto.id)) {
      logger.debug({ id: userAuto.id }, 'Custom automation already in DB, skipping');
      continue;
    }

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
