/**
 * Skill path sync.
 *
 * WildClaude creates/imports skills into USER_DATA_DIR/skills (and ships
 * built-ins in PROJECT_ROOT/skills), but the model (Claude Code) only
 * auto-discovers skills under ~/.claude/skills. Without bridging the two, every
 * WildClaude-created skill is invisible to the model — it can be listed and
 * installed but never actually loaded.
 *
 * This links each WildClaude skill into ~/.claude/skills so the model picks it
 * up automatically (progressive disclosure by description). Symlink on POSIX;
 * copy fallback where symlinks aren't permitted (e.g. Windows without rights).
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

import { USER_DATA_DIR, PROJECT_ROOT } from './paths.js';
import { logger } from './logger.js';

const CLAUDE_SKILLS = path.join(os.homedir(), '.claude', 'skills');

function linkOne(srcDir: string, name: string): boolean {
  const dest = path.join(CLAUDE_SKILLS, name);
  try {
    // Already linked/present and pointing at a real SKILL.md — leave it.
    if (fs.existsSync(path.join(dest, 'SKILL.md'))) return false;
    if (fs.existsSync(dest)) return false; // some other dir already owns this name
    try {
      fs.symlinkSync(srcDir, dest, 'dir');
    } catch {
      // Symlink not permitted — copy the SKILL.md (+ any sibling files).
      fs.mkdirSync(dest, { recursive: true });
      for (const f of fs.readdirSync(srcDir)) {
        try { fs.copyFileSync(path.join(srcDir, f), path.join(dest, f)); } catch { /* dirs skipped */ }
      }
    }
    return true;
  } catch (err) {
    logger.warn({ err, name }, 'skill-sync: link failed');
    return false;
  }
}

/** Link a single named skill (call right after creating/importing it). */
export function syncSkill(name: string): void {
  fs.mkdirSync(CLAUDE_SKILLS, { recursive: true });
  for (const base of [path.join(USER_DATA_DIR, 'skills'), path.join(PROJECT_ROOT, 'skills')]) {
    const dir = path.join(base, name);
    if (fs.existsSync(path.join(dir, 'SKILL.md'))) { linkOne(dir, name); return; }
  }
}

/**
 * Link every WildClaude skill (built-in + user) into ~/.claude/skills so the
 * model can auto-load them. Call once at startup. Returns the count newly
 * linked. Skips `_proposals` and anything already present.
 */
export function syncAllSkills(): number {
  try { fs.mkdirSync(CLAUDE_SKILLS, { recursive: true }); } catch { return 0; }
  let linked = 0;
  for (const base of [path.join(USER_DATA_DIR, 'skills'), path.join(PROJECT_ROOT, 'skills')]) {
    if (!fs.existsSync(base)) continue;
    for (const name of fs.readdirSync(base)) {
      if (name.startsWith('_') || name.startsWith('.')) continue;
      const dir = path.join(base, name);
      try { if (!fs.statSync(dir).isDirectory()) continue; } catch { continue; }
      if (!fs.existsSync(path.join(dir, 'SKILL.md'))) continue;
      if (linkOne(dir, name)) linked++;
    }
  }
  if (linked > 0) logger.info({ linked }, 'skill-sync: linked WildClaude skills into ~/.claude/skills');
  return linked;
}
