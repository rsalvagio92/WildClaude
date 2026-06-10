/**
 * Hot-reload for user-authored agents & skills.
 *
 * Editing `~/.wild-claude-pi/agents/<lane>/<id>.md` or `skills/<x>/SKILL.md`
 * used to require a service restart: the agent registry caches metadata and the
 * Telegram command menu is built once at boot. This watches USER_DATA_DIR
 * (plus `~/.claude/skills`, the source the command menu reads) and, debounced,
 * clears the registry cache and re-registers commands so edits take effect on
 * the next message — no restart.
 *
 * chokidar is imported dynamically so a missing dependency degrades to
 * "restart required" instead of crashing the bot at boot.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

import { USER_DATA_DIR } from './paths.js';
import { reloadRegistry } from './agent-registry.js';
import { logger } from './logger.js';

let started = false;
let activeWatcher: { close: () => Promise<void> } | null = null;

/** Close the file watcher so the process can exit cleanly. */
export async function stopHotReload(): Promise<void> {
  if (activeWatcher) {
    try { await activeWatcher.close(); } catch { /* best-effort */ }
    activeWatcher = null;
  }
  started = false;
}

export async function startHotReload(opts: { onSkillsChanged?: () => void } = {}): Promise<void> {
  if (started) return;
  started = true; // set before any await so concurrent calls can't double-start

  let chokidar: typeof import('chokidar');
  try {
    chokidar = await import('chokidar');
  } catch {
    started = false;
    logger.warn('hot-reload: chokidar not installed — agent/skill edits will need a restart');
    return;
  }

  const agentsDir = path.join(USER_DATA_DIR, 'agents');
  const skillsDir = path.join(USER_DATA_DIR, 'skills');
  const claudeSkillsDir = path.join(os.homedir(), '.claude', 'skills');

  // chokidar is happiest watching dirs that exist; create them up front (cheap,
  // and the overlay system would create them on first write anyway).
  for (const d of [agentsDir, skillsDir, claudeSkillsDir]) {
    try { fs.mkdirSync(d, { recursive: true }); } catch { /* best-effort */ }
  }

  const watcher = chokidar.watch([agentsDir, skillsDir, claudeSkillsDir], {
    ignoreInitial: true,
    depth: 4,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
  });

  let timer: ReturnType<typeof setTimeout> | null = null;
  const pending = new Set<'agents' | 'skills'>();

  const flush = (): void => {
    timer = null;
    if (pending.has('agents')) {
      reloadRegistry();
      logger.info('hot-reload: agent registry reloaded from disk');
    }
    if (pending.has('skills')) {
      try { opts.onSkillsChanged?.(); }
      catch (err) { logger.warn({ err }, 'hot-reload: onSkillsChanged failed'); }
      logger.info('hot-reload: skills refreshed');
    }
    pending.clear();
  };

  const onChange = (file: string): void => {
    pending.add(file.startsWith(agentsDir) ? 'agents' : 'skills');
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, 400);
  };

  watcher
    .on('add', onChange)
    .on('change', onChange)
    .on('unlink', onChange)
    .on('error', (err: unknown) => logger.warn({ err }, 'hot-reload: watcher error'));

  activeWatcher = watcher;
  logger.info({ agentsDir, skillsDir, claudeSkillsDir }, 'hot-reload: watching for agent/skill edits');
}
