/**
 * Canonical Claude model IDs — single source of truth.
 *
 * WildClaude scatters model strings across agent definitions, the router,
 * the dashboard, and dozens of call sites. When Anthropic ships a newer model
 * (e.g. Opus 4.6 → 4.8) you only edit this file: `normalizeModel()` maps every
 * legacy/alias string flowing through `runAgent` to the current canonical ID,
 * so old agent .md frontmatter or saved overrides are auto-upgraded at runtime.
 *
 * Tier mapping mirrors CLAUDE.md: Opus = think, Sonnet = do, Haiku = route.
 */

export const MODELS = {
  /** Top tier — Anthropic's most powerful model (above Opus). 2x Opus price. */
  fable: 'claude-fable-5',
  /** Most capable Opus — architecture, creative, life planning, system design. */
  opus: 'claude-opus-4-8',
  /** Balanced — code tasks, searches, edits, standard Q&A. */
  sonnet: 'claude-sonnet-4-6',
  /** Fast/cheap — classification, status, greetings, sidecar replies. */
  haiku: 'claude-haiku-4-5',
} as const;

export type ModelTier = keyof typeof MODELS;

/**
 * Router tier → canonical model ID. COMPLEX stays on Opus (Fable costs 2x);
 * use `/model fable` to pin the top tier for a chat.
 */
export const TIER_MODELS = {
  SIMPLE: MODELS.haiku,
  MEDIUM: MODELS.sonnet,
  COMPLEX: MODELS.opus,
} as const;

/**
 * Models offered in pickers (Telegram /model, dashboard dropdowns).
 * Keep descriptions short — they render in inline keyboards.
 */
export const SELECTABLE_MODELS: Array<{ id: string; alias: string; label: string; description: string }> = [
  { id: MODELS.fable, alias: 'fable', label: 'Fable 5', description: 'Most powerful — hardest problems ($$$$)' },
  { id: MODELS.opus, alias: 'opus', label: 'Opus 4.8', description: 'Deep thinking, planning, architecture ($$$)' },
  { id: MODELS.sonnet, alias: 'sonnet', label: 'Sonnet 4.6', description: 'Balanced — code & everyday tasks ($$)' },
  { id: MODELS.haiku, alias: 'haiku', label: 'Haiku 4.5', description: 'Fast & cheap — simple stuff ($)' },
];

/**
 * Map any model string — short alias (`opus`, `fable`), legacy version
 * (`claude-opus-4-6`), or dated ID — to the current canonical ID for its
 * family. Unknown strings (including future model families Anthropic ships
 * under new names) pass through unchanged so they're immediately usable via
 * `/model <id>` or agent config without a code change.
 */
export function normalizeModel(model?: string): string | undefined {
  if (!model) return model;
  const m = model.toLowerCase();
  if (m.includes('fable')) return MODELS.fable;
  if (m.includes('opus')) return MODELS.opus;
  if (m.includes('sonnet')) return MODELS.sonnet;
  if (m.includes('haiku')) return MODELS.haiku;
  return model;
}
