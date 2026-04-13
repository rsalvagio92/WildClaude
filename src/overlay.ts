/**
 * Overlay system for WildClaude.
 *
 * Core principle: codebase provides the engine + defaults.
 * Everything user-created lives in USER_DATA_DIR and gets
 * merged/overlaid at runtime.
 *
 * Resolution for any resource:
 *   1. USER_DATA_DIR/<resource>  (user override/custom, takes priority)
 *   2. PROJECT_ROOT/<resource>   (built-in default)
 *
 * This applies to:
 *   - agents/          (agent definitions .md)
 *   - skills/          (skill definitions SKILL.md)
 *   - dashboards/      (custom dashboard service configs .json)
 *   - hooks/           (event hooks)
 *   - config.json      (user preferences overlay)
 *
 * New resources created via the bot or dashboard are ALWAYS
 * written to USER_DATA_DIR — never to PROJECT_ROOT.
 */

import fs from 'fs';
import path from 'path';
import { PROJECT_ROOT } from './config.js';
import { USER_DATA_DIR } from './paths.js';
import { logger } from './logger.js';

// ── Generic overlay resolution ───────────────────────────────────────

/**
 * List all items of a type, merging user and project directories.
 * User items override project items with the same name.
 */
export function listOverlayItems(subdir: string): Array<{ name: string; path: string; source: 'user' | 'built-in' }> {
  const items = new Map<string, { name: string; path: string; source: 'user' | 'built-in' }>();

  // Project defaults first
  const projectDir = path.join(PROJECT_ROOT, subdir);
  if (fs.existsSync(projectDir) && fs.statSync(projectDir).isDirectory()) {
    for (const name of fs.readdirSync(projectDir)) {
      const fullPath = path.join(projectDir, name);
      items.set(name, { name, path: fullPath, source: 'built-in' });
    }
  }

  // User overrides (take priority)
  const userDir = path.join(USER_DATA_DIR, subdir);
  if (fs.existsSync(userDir) && fs.statSync(userDir).isDirectory()) {
    for (const name of fs.readdirSync(userDir)) {
      const fullPath = path.join(userDir, name);
      items.set(name, { name, path: fullPath, source: 'user' });
    }
  }

  return Array.from(items.values());
}

/**
 * Resolve a single file, user override first.
 */
export function resolveOverlayFile(subdir: string, filename: string): string | null {
  const userPath = path.join(USER_DATA_DIR, subdir, filename);
  if (fs.existsSync(userPath)) return userPath;

  const projectPath = path.join(PROJECT_ROOT, subdir, filename);
  if (fs.existsSync(projectPath)) return projectPath;

  return null;
}

/**
 * Write a file to the user overlay (never to project root).
 */
export function writeOverlayFile(subdir: string, filename: string, content: string): string {
  const dir = path.join(USER_DATA_DIR, subdir);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, content);
  return filePath;
}

/**
 * Delete a file from the user overlay.
 * Cannot delete built-in files (returns false).
 */
export function deleteOverlayFile(subdir: string, filename: string): boolean {
  const userPath = path.join(USER_DATA_DIR, subdir, filename);
  if (fs.existsSync(userPath)) {
    fs.unlinkSync(userPath);
    return true;
  }
  return false;
}

// ── User config overlay ──────────────────────────────────────────────

export interface UserConfig {
  /** Custom dashboard service definitions */
  dashboards?: Array<{
    id: string;
    name: string;
    icon: string;
    secretKey: string;
    baseUrl: string;
    authHeader?: string; // 'Bearer', 'token', 'Basic', custom template
    endpoints: Array<{
      id: string;
      name: string;
      path: string;
    }>;
  }>;
  /** Bot identity / branding */
  botIdentity?: {
    name?: string;          // Display name (default: "WildClaude")
    emoji?: string;         // Bot icon/emoji (default: "🐺")
    tagline?: string;       // Short description shown in /start and dashboard
    welcomeMessage?: string; // Custom /start message
    theme?: 'dark' | 'purple' | 'blue' | 'green'; // Dashboard accent color
  };
  /** User preferences */
  preferences?: {
    language?: string;
    defaultModel?: string;
    morningTime?: string;
    eveningTime?: string;
    timezone?: string;
  };
  /** Verbosity: how much detail to show in Telegram messages */
  verbosity?: {
    level: 'minimal' | 'normal' | 'detailed' | 'debug';
    showTools: boolean;        // Show "Reading file...", "Running command..." etc.
    showSubAgents: boolean;    // Show "Sub-agent started/completed" messages
    showRouting: boolean;      // Show "Routed: Sonnet (200ms)" after response
    showMemory: boolean;       // Show "New memory #123 [0.8]: ..." notifications
    showProgress: boolean;     // Show progress updates during long tasks
  };
  /** Custom automations beyond the defaults */
  automations?: Array<{
    id: string;
    name: string;
    prompt: string;
    cron: string;
    enabled: boolean;
  }>;
  /** Personality / communication style settings */
  personality?: {
    preset?: string;
    tone?: 'direct' | 'friendly' | 'formal' | 'casual' | 'warm';
    responseLength?: 'brief' | 'balanced' | 'detailed';
    humor?: number;
    emoji?: boolean;
    language?: string;
    pushback?: 'gentle' | 'normal' | 'assertive';
    customPrompt?: string;
  };
}

export interface BotIdentity {
  name: string;
  emoji: string;
  tagline: string;
  welcomeMessage: string;
  theme: string;
}

const DEFAULT_IDENTITY: BotIdentity = {
  name: 'WildClaude',
  emoji: '🐺',
  tagline: 'Personal AI Operating System',
  welcomeMessage: '',
  theme: 'purple',
};

export interface VerbosityConfig {
  level: 'minimal' | 'normal' | 'detailed' | 'debug';
  showTools: boolean;
  showSubAgents: boolean;
  showRouting: boolean;
  showMemory: boolean;
  showProgress: boolean;
}

const DEFAULT_VERBOSITY: VerbosityConfig = {
  level: 'normal',
  showTools: true,
  showSubAgents: true,
  showRouting: false,
  showMemory: true,
  showProgress: true,
};

/**
 * Get verbosity settings with defaults.
 */
export function getVerbosity(): VerbosityConfig {
  const config = loadUserConfig();
  const v = config.verbosity || {};
  return { ...DEFAULT_VERBOSITY, ...v };
}

/**
 * Get bot identity (name, emoji, tagline) with defaults.
 */
export function getBotIdentity(): BotIdentity {
  const config = loadUserConfig();
  const id = config.botIdentity || {};
  return {
    name: id.name || DEFAULT_IDENTITY.name,
    emoji: id.emoji || DEFAULT_IDENTITY.emoji,
    tagline: id.tagline || DEFAULT_IDENTITY.tagline,
    welcomeMessage: id.welcomeMessage || DEFAULT_IDENTITY.welcomeMessage,
    theme: id.theme || DEFAULT_IDENTITY.theme,
  };
}

const CONFIG_FILE = path.join(USER_DATA_DIR, 'config.json');

/**
 * Load user config (from ~/.wild-claude-pi/config.json — path is preserved for backward compatibility).
 */
export function loadUserConfig(): UserConfig {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to load user config');
  }
  return {};
}

/**
 * Save user config.
 */
export function saveUserConfig(config: UserConfig): void {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

/**
 * Update a section of user config (merge, not replace).
 */
export function updateUserConfig(patch: Partial<UserConfig>): UserConfig {
  const config = loadUserConfig();
  const merged = { ...config, ...patch };
  saveUserConfig(merged);
  return merged;
}
