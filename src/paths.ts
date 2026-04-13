/**
 * Data directory management for WildClaude.
 *
 * Separates CODE (project repo) from USER DATA (~/.wild-claude-pi/).
 * NOTE: The ~/.wild-claude-pi/ path is preserved for backward compatibility.
 *
 * Resolution:
 *   Code/templates  → PROJECT_ROOT/agents/, skills/, life/
 *   User data       → USER_DATA_DIR/life/, agents/, skills/, store/
 *   Secrets         → USER_DATA_DIR/secrets.enc.json
 *   System prompt   → USER_DATA_DIR/CLAUDE.md
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Project root — where the code lives. */
export const PROJECT_ROOT = path.resolve(__dirname, '..');

/** User data directory — where personal data lives. */
export const USER_DATA_DIR = path.join(
  process.env.WILD_DATA_DIR || path.join(os.homedir(), '.wild-claude-pi'),
);

/** Ensure all user data subdirectories exist. */
export function ensureUserDataDirs(): void {
  const dirs = [
    USER_DATA_DIR,
    path.join(USER_DATA_DIR, 'life', 'me', '_kernel'),
    path.join(USER_DATA_DIR, 'life', 'goals', '_kernel'),
    path.join(USER_DATA_DIR, 'life', 'health', '_kernel'),
    path.join(USER_DATA_DIR, 'life', 'finance', '_kernel'),
    path.join(USER_DATA_DIR, 'life', 'learning', '_kernel'),
    path.join(USER_DATA_DIR, 'store'),
    path.join(USER_DATA_DIR, 'agents'),
    path.join(USER_DATA_DIR, 'skills'),
    path.join(USER_DATA_DIR, 'personalities'),
    path.join(USER_DATA_DIR, 'session-handoffs'),
    path.join(USER_DATA_DIR, 'uploads'),
  ];
  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ── Path resolution helpers ──────────────────────────────────────────

/** Life context: always from user data dir. */
export function lifePath(...segments: string[]): string {
  return path.join(USER_DATA_DIR, 'life', ...segments);
}

/** SQLite store: always in user data dir. */
export function storePath(filename?: string): string {
  if (filename) return path.join(USER_DATA_DIR, 'store', filename);
  return path.join(USER_DATA_DIR, 'store');
}

/** Evolution log: in user data dir. */
export function evolutionLogPath(): string {
  return path.join(USER_DATA_DIR, 'evolution.log.json');
}

/** System prompt (CLAUDE.md): user data dir. */
export function systemPromptPath(): string {
  return path.join(USER_DATA_DIR, 'CLAUDE.md');
}

/**
 * Resolve an agent definition file.
 * User agents (~/.wild-claude-pi/agents/) override project defaults.
 * (path preserved for backward compatibility)
 */
export function resolveAgentPath(lane: string, id: string): string | null {
  // Check user override first
  const userPath = path.join(USER_DATA_DIR, 'agents', lane, `${id}.md`);
  if (fs.existsSync(userPath)) return userPath;

  // Fall back to project default
  const projectPath = path.join(PROJECT_ROOT, 'agents', lane, `${id}.md`);
  if (fs.existsSync(projectPath)) return projectPath;

  // Try without lane (flat structure)
  const userFlat = path.join(USER_DATA_DIR, 'agents', `${id}.md`);
  if (fs.existsSync(userFlat)) return userFlat;

  return null;
}

/**
 * Resolve a skill definition file.
 * User skills (~/.wild-claude-pi/skills/) override project defaults.
 * (path preserved for backward compatibility)
 */
export function resolveSkillPath(name: string): string | null {
  const userPath = path.join(USER_DATA_DIR, 'skills', name, 'SKILL.md');
  if (fs.existsSync(userPath)) return userPath;

  const projectPath = path.join(PROJECT_ROOT, 'skills', name, 'SKILL.md');
  if (fs.existsSync(projectPath)) return projectPath;

  return null;
}

/**
 * Get the registry.yaml path (always from project, user can overlay).
 */
export function registryPath(): string {
  const userRegistry = path.join(USER_DATA_DIR, 'agents', 'registry.yaml');
  if (fs.existsSync(userRegistry)) return userRegistry;
  return path.join(PROJECT_ROOT, 'agents', 'registry.yaml');
}

/**
 * Copy template kernel files to user data dir if they don't exist yet.
 * Only copies files that have [FILL IN] or don't exist in user dir.
 */
export function seedKernelTemplates(): void {
  const templateDir = path.join(PROJECT_ROOT, 'life');
  if (!fs.existsSync(templateDir)) return;

  const domains = ['me', 'goals', 'health', 'finance', 'learning'];
  for (const domain of domains) {
    const templateFile = path.join(templateDir, domain, '_kernel', 'key.md');
    const userFile = lifePath(domain, '_kernel', 'key.md');

    if (!fs.existsSync(userFile) && fs.existsSync(templateFile)) {
      fs.mkdirSync(path.dirname(userFile), { recursive: true });
      fs.copyFileSync(templateFile, userFile);
    }
  }
}
