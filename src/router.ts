/**
 * Multi-model router for WildClaude.
 *
 * Uses Haiku to classify each incoming message into a complexity tier,
 * then routes to the appropriate model (Haiku / Sonnet / Opus).
 *
 * Cost: ~$0.001 per classification
 * Latency: ~200-400ms
 * Savings: ~60-80% vs always-Opus
 */

import Anthropic from '@anthropic-ai/sdk';

import { readEnvFile } from './env.js';
import { logger } from './logger.js';

export type ComplexityTier = 'SIMPLE' | 'MEDIUM' | 'COMPLEX';

export interface RoutingResult {
  tier: ComplexityTier;
  model: string;
  /** Time in ms the classification took */
  latencyMs: number;
}

const TIER_TO_MODEL: Record<ComplexityTier, string> = {
  SIMPLE: 'claude-haiku-4-5',
  MEDIUM: 'claude-sonnet-4-6',
  COMPLEX: 'claude-opus-4-6',
};

const CLASSIFICATION_PROMPT = `Classify this user message into exactly one complexity tier:

SIMPLE: Greetings, status checks, yes/no questions, simple lookups, definitions, acknowledgments, short factual answers.
MEDIUM: Code tasks, file edits, searches, standard questions requiring some reasoning, explanations, summaries.
COMPLEX: Architecture design, creative writing, life planning, goal strategy, multi-step reasoning, system design, complex analysis, debugging complex issues, long-form content.

Message: "{MESSAGE}"

Respond with exactly one word: SIMPLE, MEDIUM, or COMPLEX`;

/** Patterns that skip classification and route directly */
const FORCE_SIMPLE_PATTERNS = [
  /^\/\w+/,                       // Slash commands
  /^(hi|hello|hey|thanks|ok|yes|no|sure|bye)\b/i,
  /^(status|ping|help)\b/i,
];

const FORCE_COMPLEX_PATTERNS = [
  /\b(architect|design|plan|strategy|review|analyze|create.*system)\b/i,
  /\b(ralph|autonomous|build me|end.to.end)\b/i,
];

let client: Anthropic | null = null;
let apiKeyAvailable: boolean | null = null;

function getClient(): Anthropic | null {
  if (apiKeyAvailable === false) return null;
  if (!client) {
    const secrets = readEnvFile(['ANTHROPIC_API_KEY']);
    const apiKey = secrets.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      apiKeyAvailable = false;
      logger.info('No ANTHROPIC_API_KEY — router using pattern-only mode (Opus subscription via CLI)');
      return null;
    }
    apiKeyAvailable = true;
    client = new Anthropic({ apiKey });
  }
  return client;
}

/** Heuristic patterns for COMPLEX tier (deep reasoning) */
const COMPLEX_HEURISTIC_PATTERNS = [
  /\b(miglior|improv|ottimizz|refactor|redesign|riprogett)\w*/i,
  /\b(analiz|compar|valut|evaluat|assess|consider)\w*/i,
  /\b(perch[eé]|why|how would|come fares|cosa ne pens|what do you think)\b/i,
  /\b(strateg|plan|roadmap|architect|approach|approccio)\b/i,
  /\b(pro e contro|trade.?off|vantagg|svantag|pros and cons)\b/i,
  /\b(creative|creativ|brainstorm|idea|scrivi.*lungo|write.*long)\b/i,
  /\b(review|revis|audit|assess)\b.*\b(code|system|architettur)/i,
];

/** Heuristic patterns for MEDIUM tier (code/technical work) */
const MEDIUM_PATTERNS = [
  /\b(fix|bug|error|test|refactor|implement|add|update|change|modify|edit|write|create|delete|remove|rename)\b/i,
  /\b(function|class|component|api|endpoint|database|query|migration)\b/i,
  /\b(install|deploy|build|run|execute|script|command|npm|git|docker)\b/i,
  /\b(configur|setup|sett|abilit|disabilit|enabl|disabl)\b/i,
  /```/,  // Code blocks
];

/** Patterns that indicate SIMPLE even with questions */
const SIMPLE_QUESTION_PATTERNS = [
  /\b(che ore|what time|when is|quanto costa|how much|how many)\b/i,
  /\b(dov[''e]|where is|where are)\b/i,
  /\b(chi [eè]|who is|what is)\b/i,
  /\b(traduci|translat|convert)\b/i,
];

/**
 * Pattern-based classification when no API key is available.
 * Improved: considers question complexity, language nuance, message structure.
 */
function heuristicClassify(message: string): ComplexityTier {
  const len = message.length;

  // Very long messages are almost always complex
  if (len > 500) return 'COMPLEX';

  // Check for complex patterns first (deep reasoning, analysis, creativity)
  for (const pattern of COMPLEX_HEURISTIC_PATTERNS) {
    if (pattern.test(message)) return 'COMPLEX';
  }

  // Long messages with questions → complex
  if (len > 200 && message.includes('?')) return 'COMPLEX';

  // Multiple sentences with a question → likely complex
  const sentences = message.split(/[.!?]+/).filter(s => s.trim().length > 10);
  if (sentences.length >= 3) return 'COMPLEX';

  // Check for simple question patterns
  for (const pattern of SIMPLE_QUESTION_PATTERNS) {
    if (pattern.test(message) && len < 80) return 'SIMPLE';
  }

  // Check for medium-tier patterns (code/technical)
  for (const pattern of MEDIUM_PATTERNS) {
    if (pattern.test(message)) return 'MEDIUM';
  }

  // Short questions without technical keywords → simple
  if (message.includes('?') && len < 60) return 'SIMPLE';

  // Default: Sonnet (safe middle ground)
  return 'MEDIUM';
}

/**
 * Classify a message and return the recommended model.
 *
 * If `chatModelOverride` is set (user used /model), that takes priority.
 * If no API key is set, uses heuristic pattern matching (works with subscription).
 * If classification fails, defaults to Sonnet (safe middle ground).
 */
export async function classifyMessage(
  message: string,
  chatModelOverride?: string,
): Promise<RoutingResult> {
  // If user has a manual override, respect it
  if (chatModelOverride) {
    return {
      tier: 'MEDIUM',
      model: chatModelOverride,
      latencyMs: 0,
    };
  }

  // Fast-path: pattern matching (no API call needed)
  const trimmed = message.trim();

  for (const pattern of FORCE_SIMPLE_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { tier: 'SIMPLE', model: TIER_TO_MODEL.SIMPLE, latencyMs: 0 };
    }
  }

  for (const pattern of FORCE_COMPLEX_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { tier: 'COMPLEX', model: TIER_TO_MODEL.COMPLEX, latencyMs: 0 };
    }
  }

  // Short messages (< 20 chars) are almost always simple
  if (trimmed.length < 20 && !trimmed.includes('?')) {
    return { tier: 'SIMPLE', model: TIER_TO_MODEL.SIMPLE, latencyMs: 0 };
  }

  // No API key? Use heuristic classification (subscription users via CLI)
  const anthropic = getClient();
  if (!anthropic) {
    const tier = heuristicClassify(trimmed);
    logger.info({ tier, mode: 'heuristic', messagePreview: trimmed.slice(0, 60) }, 'Router classified message');
    return { tier, model: TIER_TO_MODEL[tier], latencyMs: 0 };
  }

  // Call Haiku for classification (API key available)
  const start = Date.now();
  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 10,
      messages: [
        {
          role: 'user',
          content: CLASSIFICATION_PROMPT.replace('{MESSAGE}', trimmed.slice(0, 500)),
        },
      ],
    });

    const latencyMs = Date.now() - start;
    const text = response.content[0]?.type === 'text' ? response.content[0].text.trim().toUpperCase() : '';

    let tier: ComplexityTier = 'MEDIUM'; // default fallback
    if (text === 'SIMPLE' || text === 'MEDIUM' || text === 'COMPLEX') {
      tier = text;
    }

    logger.info({ tier, latencyMs, messagePreview: trimmed.slice(0, 60) }, 'Router classified message');

    return {
      tier,
      model: TIER_TO_MODEL[tier],
      latencyMs,
    };
  } catch (err) {
    const latencyMs = Date.now() - start;
    logger.warn({ err, latencyMs }, 'Router classification failed, defaulting to Sonnet');
    return {
      tier: 'MEDIUM',
      model: TIER_TO_MODEL.MEDIUM,
      latencyMs,
    };
  }
}

/**
 * Get the model name for a given tier (for display purposes).
 */
export function tierLabel(tier: ComplexityTier): string {
  switch (tier) {
    case 'SIMPLE': return 'Haiku';
    case 'MEDIUM': return 'Sonnet';
    case 'COMPLEX': return 'Opus';
  }
}
