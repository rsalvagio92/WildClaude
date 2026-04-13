/**
 * Personality customization system for WildClaude.
 *
 * Allows structured configuration of Claude's communication style,
 * stored in config.json and rendered into the system prompt via markers.
 */

import fs from 'fs';
import path from 'path';
import { USER_DATA_DIR, lifePath } from './paths.js';
import { loadUserConfig, saveUserConfig, getBotIdentity } from './overlay.js';
import { logger } from './logger.js';

// ── Types ────────────────────────────────────────────────────────────

export interface PersonalityConfig {
  preset?: string;
  tone?: 'direct' | 'friendly' | 'formal' | 'casual' | 'warm';
  responseLength?: 'brief' | 'balanced' | 'detailed';
  humor?: number; // 0-10
  emoji?: boolean;
  language?: string; // 'auto' | 'en' | 'it' | 'es' | 'de' | 'fr' | 'pt'
  pushback?: 'gentle' | 'normal' | 'assertive';
  customPrompt?: string;
}

export interface Preset {
  id: string;
  name: string;
  description: string;
  config: PersonalityConfig;
  source: 'built-in' | 'user';
}

// ── Built-in presets ─────────────────────────────────────────────────

export const BUILT_IN_PRESETS: Preset[] = [
  {
    id: 'default',
    name: 'Default',
    description: 'Direct and balanced — the classic WildClaude style',
    source: 'built-in',
    config: {
      preset: 'default',
      tone: 'direct',
      responseLength: 'balanced',
      humor: 2,
      emoji: false,
      language: 'auto',
      pushback: 'normal',
    },
  },
  {
    id: 'professional',
    name: 'Professional',
    description: 'Formal, thorough, no humor — for work contexts',
    source: 'built-in',
    config: {
      preset: 'professional',
      tone: 'formal',
      responseLength: 'detailed',
      humor: 0,
      emoji: false,
      language: 'auto',
      pushback: 'gentle',
    },
  },
  {
    id: 'casual',
    name: 'Casual',
    description: 'Relaxed, brief, emoji-friendly — for everyday chat',
    source: 'built-in',
    config: {
      preset: 'casual',
      tone: 'casual',
      responseLength: 'brief',
      humor: 6,
      emoji: true,
      language: 'auto',
      pushback: 'gentle',
    },
  },
  {
    id: 'coach',
    name: 'Coach',
    description: 'Warm and supportive — for goals, habits, and planning',
    source: 'built-in',
    config: {
      preset: 'coach',
      tone: 'warm',
      responseLength: 'detailed',
      humor: 3,
      emoji: false,
      language: 'auto',
      pushback: 'assertive',
    },
  },
  {
    id: 'debug',
    name: 'Debug',
    description: 'Direct and precise — for technical work and debugging',
    source: 'built-in',
    config: {
      preset: 'debug',
      tone: 'direct',
      responseLength: 'detailed',
      humor: 0,
      emoji: false,
      language: 'auto',
      pushback: 'assertive',
    },
  },
  {
    id: 'creative',
    name: 'Creative',
    description: 'Friendly with a spark — for brainstorming and writing',
    source: 'built-in',
    config: {
      preset: 'creative',
      tone: 'friendly',
      responseLength: 'balanced',
      humor: 5,
      emoji: true,
      language: 'auto',
      pushback: 'gentle',
    },
  },
];

// ── Defaults ─────────────────────────────────────────────────────────

const DEFAULT_CONFIG: Required<PersonalityConfig> = {
  preset: 'default',
  tone: 'direct',
  responseLength: 'balanced',
  humor: 2,
  emoji: false,
  language: 'auto',
  pushback: 'normal',
  customPrompt: '',
};

// ── Config I/O ────────────────────────────────────────────────────────

/**
 * Load the active personality config, applying defaults for missing fields.
 * If a preset name is saved but individual fields are missing, resolve from the preset's config.
 */
export function loadPersonalityConfig(): Required<PersonalityConfig> {
  try {
    const userConfig = loadUserConfig();
    const saved = userConfig.personality as PersonalityConfig | undefined;
    if (!saved) return { ...DEFAULT_CONFIG };

    // Resolve base config: if a preset is named, use its config as the base instead of bare defaults
    let base = DEFAULT_CONFIG;
    if (saved.preset) {
      const preset = BUILT_IN_PRESETS.find(p => p.id === saved.preset);
      if (preset) {
        base = { ...DEFAULT_CONFIG, ...preset.config };
      }
    }

    return {
      preset: saved.preset ?? base.preset,
      tone: saved.tone ?? base.tone,
      responseLength: saved.responseLength ?? base.responseLength,
      humor: saved.humor ?? base.humor,
      emoji: saved.emoji ?? base.emoji,
      language: saved.language ?? base.language,
      pushback: saved.pushback ?? base.pushback,
      customPrompt: saved.customPrompt ?? base.customPrompt,
    };
  } catch (err) {
    logger.warn({ err }, 'Failed to load personality config, using defaults');
    return { ...DEFAULT_CONFIG };
  }
}

// ── Prompt generation ─────────────────────────────────────────────────

/**
 * Convert structured PersonalityConfig into natural-language instructions.
 */
export function generatePersonalityPrompt(config: PersonalityConfig): string {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const lines: string[] = [];

  // Tone
  switch (cfg.tone) {
    case 'direct':
      lines.push('Be direct. No filler, no preamble. Lead with the answer or action.');
      break;
    case 'friendly':
      lines.push('Be friendly and approachable. Warm but not over the top.');
      break;
    case 'formal':
      lines.push('Maintain a professional, formal tone. Avoid contractions and colloquialisms.');
      break;
    case 'casual':
      lines.push('Be relaxed and conversational. Write like you\'re texting a friend.');
      break;
    case 'warm':
      lines.push('Be warm and encouraging. Show genuine care and interest.');
      break;
  }

  // Response length
  switch (cfg.responseLength) {
    case 'brief':
      lines.push('Keep responses short and punchy. Get to the point fast.');
      break;
    case 'balanced':
      lines.push('Match response length to the complexity of the request.');
      break;
    case 'detailed':
      lines.push('Be thorough. Cover edge cases, tradeoffs, and context where relevant.');
      break;
  }

  // Humor
  if (cfg.humor === 0) {
    lines.push('No humor or jokes. Stay focused and serious.');
  } else if (cfg.humor <= 3) {
    lines.push('Light touches of humor are fine, but keep it subtle.');
  } else if (cfg.humor <= 6) {
    lines.push('A reasonable amount of humor is welcome — wit, irony, dry observations.');
  } else {
    lines.push('Use humor naturally. Witty observations, wordplay, and playful tangents are welcome.');
  }

  // Emoji
  if (cfg.emoji) {
    lines.push('Emoji are fine when they add clarity or warmth. Don\'t overdo it.');
  } else {
    lines.push('Do not use emoji.');
  }

  // Language
  if (cfg.language === 'auto' || !cfg.language) {
    lines.push('Respond in the same language the user writes in.');
  } else {
    const langNames: Record<string, string> = {
      en: 'English', it: 'Italian', es: 'Spanish',
      de: 'German', fr: 'French', pt: 'Portuguese',
    };
    const langName = langNames[cfg.language] || cfg.language;
    lines.push(`Always respond in ${langName}, regardless of what language the user writes in.`);
  }

  // Pushback
  switch (cfg.pushback) {
    case 'gentle':
      lines.push('Suggest alternatives gently. Don\'t challenge unless something is clearly wrong.');
      break;
    case 'normal':
      lines.push('Push back when there\'s a real reason — a missed detail, a risk, something overlooked. Not to seem smart.');
      break;
    case 'assertive':
      lines.push('Challenge assumptions directly. If you see a better approach or a real risk, say so clearly and confidently.');
      break;
  }

  // No sycophancy (always)
  lines.push('No AI clichés. Never say "Certainly!", "Great question!", "I\'d be happy to", "As an AI".');
  lines.push('No sycophancy. Don\'t validate or flatter. Just help.');
  lines.push('No em dashes.');

  // Custom prompt appended last
  if (cfg.customPrompt && cfg.customPrompt.trim()) {
    lines.push('');
    lines.push(cfg.customPrompt.trim());
  }

  return lines.join('\n');
}

// ── Full system prompt builder ────────────────────────────────────────

const MARKER_START = '<!-- PERSONALITY_START -->';
const MARKER_END = '<!-- PERSONALITY_END -->';
const CLAUDE_MD_PATH = path.join(USER_DATA_DIR, 'CLAUDE.md');

/**
 * Build the full system prompt by injecting personality into CLAUDE.md.
 * Replaces content between PERSONALITY_START and PERSONALITY_END markers.
 * Falls back to appending after "## How You Behave" if markers not found.
 */
export function buildFullSystemPrompt(): string {
  let content = '';
  try {
    if (fs.existsSync(CLAUDE_MD_PATH)) {
      content = fs.readFileSync(CLAUDE_MD_PATH, 'utf-8');
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to read CLAUDE.md');
    return content;
  }

  // Inject bot identity (name, emoji) from config.json
  try {
    const identity = getBotIdentity();
    const idBlock = `\n## Your Identity\nYour name is **${identity.name}**. Your icon is ${identity.emoji}. ${identity.tagline ? `You are: ${identity.tagline}.` : ''}\nAlways introduce yourself as "${identity.name}" — never use other names like "WildClaude" or "ClaudeClaw" or "Ralph" unless that IS your configured name.\n`;
    // Insert after the first heading or at the beginning
    const firstHeading = content.indexOf('\n## ');
    if (firstHeading > 0) {
      content = content.slice(0, firstHeading) + idBlock + content.slice(firstHeading);
    } else {
      content = idBlock + content;
    }
  } catch { /* overlay not available */ }

  // Inject user profile from kernel files (so the bot knows who the user is)
  try {
    const kernelFiles = [
      { label: 'User Profile', path: lifePath('me', '_kernel', 'key.md') },
      { label: 'User Goals', path: lifePath('goals', '_kernel', 'key.md') },
    ];
    const kernelBlocks: string[] = [];
    for (const kf of kernelFiles) {
      if (fs.existsSync(kf.path)) {
        const kContent = fs.readFileSync(kf.path, 'utf-8').trim();
        if (kContent && !kContent.includes('[FILL IN]')) {
          kernelBlocks.push(kContent);
        }
      }
    }
    if (kernelBlocks.length > 0) {
      const userContext = `\n## User Context (from onboarding)\n${kernelBlocks.join('\n\n')}\n`;
      content += userContext;
    }
  } catch { /* kernel files not available */ }

  const config = loadPersonalityConfig();
  const personalityText = generatePersonalityPrompt(config);

  const startIdx = content.indexOf(MARKER_START);
  const endIdx = content.indexOf(MARKER_END);

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    // Replace between markers
    const before = content.slice(0, startIdx + MARKER_START.length);
    const after = content.slice(endIdx);
    return `${before}\n${personalityText}\n${after}`;
  }

  // No markers — append after "## How You Behave" heading
  const headingIdx = content.indexOf('## How You Behave');
  if (headingIdx !== -1) {
    // Find the end of the heading line
    const lineEnd = content.indexOf('\n', headingIdx);
    const insertAt = lineEnd !== -1 ? lineEnd : content.length;
    const before = content.slice(0, insertAt);
    const after = content.slice(insertAt);
    const section = `\n\n${MARKER_START}\n${personalityText}\n${MARKER_END}`;
    return `${before}${section}${after}`;
  }

  // Last resort: append at end
  return `${content}\n\n${MARKER_START}\n${personalityText}\n${MARKER_END}\n`;
}

// ── Presets ───────────────────────────────────────────────────────────

const PERSONALITIES_DIR = path.join(USER_DATA_DIR, 'personalities');

/**
 * List all presets: built-in + user-saved presets from ~/.wild-claude-pi/personalities/*.json
 */
export function listPresets(): Preset[] {
  const result: Preset[] = [...BUILT_IN_PRESETS];

  try {
    if (fs.existsSync(PERSONALITIES_DIR)) {
      for (const file of fs.readdirSync(PERSONALITIES_DIR)) {
        if (!file.endsWith('.json')) continue;
        try {
          const raw = fs.readFileSync(path.join(PERSONALITIES_DIR, file), 'utf-8');
          const data = JSON.parse(raw) as Preset;
          result.push({ ...data, source: 'user' });
        } catch { /* skip malformed */ }
      }
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to list user presets');
  }

  return result;
}

/**
 * Load a preset by ID (built-in or user).
 */
export function loadPreset(id: string): Preset | null {
  const builtin = BUILT_IN_PRESETS.find((p) => p.id === id);
  if (builtin) return builtin;

  const file = path.join(PERSONALITIES_DIR, `${id}.json`);
  try {
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf-8')) as Preset;
      return { ...data, source: 'user' };
    }
  } catch (err) {
    logger.warn({ err, id }, 'Failed to load preset');
  }
  return null;
}

/**
 * Save a user preset to ~/.wild-claude-pi/personalities/<id>.json
 */
export function savePreset(id: string, name: string, description: string, config: PersonalityConfig): void {
  fs.mkdirSync(PERSONALITIES_DIR, { recursive: true });
  const preset: Preset = { id, name, description, config, source: 'user' };
  fs.writeFileSync(path.join(PERSONALITIES_DIR, `${id}.json`), JSON.stringify(preset, null, 2));
}

/**
 * Delete a user preset (cannot delete built-in presets).
 */
export function deletePreset(id: string): boolean {
  const file = path.join(PERSONALITIES_DIR, `${id}.json`);
  if (fs.existsSync(file)) {
    fs.unlinkSync(file);
    return true;
  }
  return false;
}
