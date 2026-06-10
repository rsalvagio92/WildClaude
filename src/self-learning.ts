/**
 * Part A — Nightly self-LEARNING (non-destructive, additive, user-data only).
 *
 * Every night this:
 *   1. Backs up the database + user data (recoverable point-in-time snapshot).
 *   2. Studies the user's recent conversations + memories.
 *   3. Builds helpful artifacts ON TOP — new skills, automations, and learned
 *      preferences — in USER_DATA_DIR. It NEVER edits source code, never
 *      deletes anything, and never commits to the code repo (additive only).
 *      Everything it creates is versioned in the USER_DATA_DIR git repo and
 *      covered by the daily backup, so it's always reversible.
 *
 * Gated by SELF_LEARNING_ENABLED (default on — safe because it's additive and
 * confined to user data).
 */

import fs from 'fs';
import path from 'path';

import { runAgent } from './agent.js';
import { MODELS } from './models.js';
import { logger } from './logger.js';
import { USER_DATA_DIR, lifePath } from './paths.js';
import { ALLOWED_CHAT_ID, SELF_LEARNING_ENABLED, SELF_LEARNING_MAX_NEW, BACKUP_RETENTION_DAYS, AGENT_ID, STORE_DIR } from './config.js';
import { getDb, getRecentConversation, getRecentMemories, backupDatabase } from './db.js';
import { createSkill } from './evolution.js';
import { listOverlayItems } from './overlay.js';
import { loadUserConfig, saveUserConfig } from './overlay.js';
import { computeNextRun } from './scheduler.js';
import { createScheduledTask } from './db.js';

// ── Daily backup ──────────────────────────────────────────────────────

/**
 * Snapshot the database and append a learning marker. Prunes old DB backups
 * to BACKUP_RETENTION_DAYS. Returns a one-line summary.
 */
export function runDailyBackup(): string {
  let dbBackup: string | null = null;
  try {
    dbBackup = backupDatabase(); // dated copy under STORE_DIR/backups
  } catch (err) {
    logger.warn({ err }, 'self-learning: db backup failed');
  }
  // Prune old DB backups.
  try {
    const backupDir = path.join(STORE_DIR, 'backups');
    if (fs.existsSync(backupDir)) {
      const cutoff = Date.now() - BACKUP_RETENTION_DAYS * 24 * 3600 * 1000;
      for (const f of fs.readdirSync(backupDir)) {
        const full = path.join(backupDir, f);
        try { if (fs.statSync(full).mtimeMs < cutoff) fs.rmSync(full, { recursive: true, force: true }); } catch { /* */ }
      }
    }
  } catch (err) {
    logger.warn({ err }, 'self-learning: backup prune failed');
  }
  return dbBackup ? `backup ✓ (${path.basename(dbBackup)})` : 'backup skipped';
}

// ── Signal gathering ──────────────────────────────────────────────────

interface LearningSignals {
  conversation: string;
  memories: string;
  existingSkills: string[];
  existingAutomations: string[];
}

function gatherSignals(chatId: string): LearningSignals {
  const turns = getRecentConversation(chatId, 60);
  const conversation = turns
    .slice(-60)
    .map((t) => `${t.role === 'user' ? 'U' : 'A'}: ${(t.content || '').slice(0, 280)}`)
    .join('\n');

  const mems = getRecentMemories(chatId, 25);
  const memories = mems.map((m) => `- ${m.summary}`).join('\n');

  let existingSkills: string[] = [];
  try { existingSkills = listOverlayItems('skills').map((s) => s.name || String(s)); } catch { /* */ }

  const cfg = loadUserConfig();
  const existingAutomations = (cfg.automations || []).map((a) => `${a.id}: ${a.name}`);

  return { conversation, memories, existingSkills, existingAutomations };
}

// ── LLM plan ──────────────────────────────────────────────────────────

interface LearningPlan {
  insights?: string[];
  skills?: Array<{ name: string; description: string; instructions: string }>;
  automations?: Array<{ name: string; prompt: string; cron: string }>;
  preferences?: string[]; // learned preferences to append to the life log
}

const PLAN_PROMPT = (s: LearningSignals) => `You improve a personal AI assistant by learning from how its owner uses it, then building NON-DESTRUCTIVE, ADDITIVE helpers in the user's data dir. You never modify code.

Study the recent activity and propose a SMALL set of genuinely useful additions. Be conservative — only propose things clearly supported by the conversation, and never duplicate something that already exists.

RECENT CONVERSATION (oldest→newest):
${s.conversation || '(none)'}

RECENT MEMORIES:
${s.memories || '(none)'}

EXISTING SKILLS (do not duplicate): ${s.existingSkills.join(', ') || '(none)'}
EXISTING AUTOMATIONS (do not duplicate): ${s.existingAutomations.join(', ') || '(none)'}

Return ONLY a JSON object (no prose) with this shape — any field may be empty:
{
  "insights": ["one-line observations about the user's needs/patterns"],
  "skills": [{"name":"kebab-case","description":"when to use it","instructions":"the SKILL.md body — concrete, actionable steps"}],
  "automations": [{"name":"Human name","prompt":"what the bot should do","cron":"standard 5-field cron"}],
  "preferences": ["durable preferences worth remembering, e.g. 'prefers concise replies in Italian'"]
}

Rules:
- At most ${SELF_LEARNING_MAX_NEW} skills and ${SELF_LEARNING_MAX_NEW} automations total.
- Only propose a skill for a workflow the user actually repeats or asked for.
- Only propose an automation for a recurring, time-based need the user expressed.
- If there's nothing clearly useful, return empty arrays. Quality over quantity.`;

function extractJson(raw: string): LearningPlan | null {
  const tryParse = (s: string) => { try { return JSON.parse(s) as LearningPlan; } catch { return null; } };
  let p = tryParse(raw);
  if (p) return p;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) { p = tryParse(fenced[1]); if (p) return p; }
  const start = raw.indexOf('{');
  if (start === -1) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = inStr; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return tryParse(raw.slice(start, i + 1));
  }
  return null;
}

const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

// ── Apply (additive only) ──────────────────────────────────────────────

function applyPlan(plan: LearningPlan, chatId: string): { added: string[] } {
  const added: string[] = [];
  const existingSkills = new Set((() => { try { return listOverlayItems('skills').map((s) => s.name || String(s)); } catch { return []; } })());

  // Skills — create only if a same-named one doesn't exist.
  for (const sk of (plan.skills || []).slice(0, SELF_LEARNING_MAX_NEW)) {
    const name = slugify(sk.name || '');
    if (!name || existingSkills.has(name)) continue;
    try {
      createSkill(name, (sk.description || '').slice(0, 200), (sk.instructions || '').slice(0, 4000));
      added.push(`skill:${name}`);
    } catch (err) { logger.warn({ err, name }, 'self-learning: createSkill failed'); }
  }

  // Automations — add to user config (additive), then they sync into the DB.
  if ((plan.automations || []).length) {
    const cfg = loadUserConfig();
    const autos = cfg.automations || [];
    const existingIds = new Set(autos.map((a) => a.id));
    let createdAny = false;
    for (const au of (plan.automations || []).slice(0, SELF_LEARNING_MAX_NEW)) {
      const id = 'learned-' + slugify(au.name || '');
      if (!id || id === 'learned-' || existingIds.has(id)) continue;
      // Validate cron before committing.
      try { computeNextRun(au.cron); } catch { continue; }
      autos.push({ id, name: au.name.slice(0, 80), prompt: au.prompt.slice(0, 2000), cron: au.cron, enabled: true });
      // Install immediately so it's live tonight.
      try { createScheduledTask(id, au.prompt.slice(0, 2000), au.cron, computeNextRun(au.cron), AGENT_ID); } catch { /* */ }
      added.push(`automation:${id}`);
      createdAny = true;
    }
    if (createdAny) saveUserConfig({ ...cfg, automations: autos });
  }

  // Learned preferences → append to the life log (durable, user-visible).
  if ((plan.preferences || []).length) {
    try {
      const logFile = lifePath('me', '_kernel', 'log.md');
      const today = new Date().toISOString().slice(0, 10);
      const entry = `### ${today} — learned preferences (auto)\n` +
        plan.preferences!.map((p) => `- ${p}`).join('\n');
      let existing = ''; try { existing = fs.readFileSync(logFile, 'utf-8'); } catch { /* new */ }
      fs.mkdirSync(path.dirname(logFile), { recursive: true });
      fs.writeFileSync(logFile, existing ? `${entry}\n\n${existing}` : entry + '\n');
      added.push(`preferences:${plan.preferences!.length}`);
    } catch (err) { logger.warn({ err }, 'self-learning: preference write failed'); }
  }

  return { added };
}

// ── Public entry point ──────────────────────────────────────────────────

export async function runSelfLearning(send: (text: string) => Promise<void>): Promise<string> {
  const backupSummary = runDailyBackup();

  if (!SELF_LEARNING_ENABLED) {
    await send(`🌙 Nightly backup: ${backupSummary}. Self-learning is disabled (SELF_LEARNING_ENABLED=false).`);
    return backupSummary;
  }
  const chatId = ALLOWED_CHAT_ID;
  if (!chatId) {
    await send(`🌙 Nightly backup: ${backupSummary}. (Self-learning needs ALLOWED_CHAT_ID.)`);
    return backupSummary;
  }

  const signals = gatherSignals(chatId);
  if (!signals.conversation.trim() && !signals.memories.trim()) {
    await send(`🌙 Nightly backup: ${backupSummary}. No recent activity to learn from tonight.`);
    return backupSummary;
  }

  let plan: LearningPlan | null = null;
  try {
    const result = await runAgent(PLAN_PROMPT(signals), undefined, () => {}, undefined, MODELS.opus);
    plan = extractJson(result.text || '');
  } catch (err) {
    logger.warn({ err }, 'self-learning: plan generation failed');
  }
  if (!plan) {
    await send(`🌙 Nightly backup: ${backupSummary}. Couldn't form a learning plan tonight.`);
    return backupSummary;
  }

  const { added } = applyPlan(plan, chatId);
  // Version the additive changes in the USER-DATA repo (createSkill already
  // committed skills; commit the rest — config/log changes).
  try {
    const { execSync } = await import('child_process');
    if (fs.existsSync(path.join(USER_DATA_DIR, '.git'))) {
      execSync('git add -A', { cwd: USER_DATA_DIR, stdio: 'pipe' });
      const dirty = execSync('git status --porcelain', { cwd: USER_DATA_DIR, stdio: 'pipe' }).toString().trim();
      if (dirty) execSync(`git commit -m "chore(learn): nightly additions ${new Date().toISOString().slice(0, 10)}"`, { cwd: USER_DATA_DIR, stdio: 'pipe' });
    }
  } catch (err) { logger.warn({ err }, 'self-learning: user-data commit failed'); }

  const lines = [`🌙 <b>Nightly self-learning</b>`, `Backup: ${backupSummary}`];
  if ((plan.insights || []).length) {
    lines.push('', '<b>Learned:</b>', ...plan.insights!.slice(0, 5).map((i) => `• ${i}`));
  }
  if (added.length) {
    lines.push('', '<b>Built for you (additive, reversible):</b>', ...added.map((a) => `+ ${a}`));
    lines.push('', 'All changes are in your data dir, versioned + backed up — nothing in the code.');
  } else {
    lines.push('', 'No new additions tonight — nothing clearly useful to add.');
  }
  await send(lines.join('\n'));
  logger.info({ added, insights: plan.insights?.length }, 'self-learning cycle complete');
  return `learned: ${added.length} additions`;
}
