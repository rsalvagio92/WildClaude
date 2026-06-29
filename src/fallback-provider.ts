/**
 * OpenAI fallback provider — activates when Anthropic is unavailable.
 * Chat-only (no tools). Clearly marked as degraded mode.
 * Requires OPENAI_API_KEY in the secrets store.
 */

import OpenAI from 'openai';

import { getSecret } from './secrets.js';
import { logger } from './logger.js';

let _client: OpenAI | null = null;

async function getClient(): Promise<OpenAI | null> {
  if (_client) return _client;
  try {
    const apiKey = await getSecret('OPENAI_API_KEY');
    if (!apiKey) return null;
    _client = new OpenAI({ apiKey });
    return _client;
  } catch {
    return null;
  }
}

/** Reset cached client (e.g. after secret update) */
export function resetFallbackClient(): void {
  _client = null;
}

/** True if OpenAI fallback is configured (async check) */
export async function hasFallbackProvider(): Promise<boolean> {
  try {
    const apiKey = await getSecret('OPENAI_API_KEY');
    return !!apiKey;
  } catch {
    return false;
  }
}

/** Detect Anthropic errors that warrant fallback */
export function isProviderError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('429') ||
    msg.includes('529') ||
    msg.includes('overloaded') ||
    msg.toLowerCase().includes('rate limit') ||
    msg.toLowerCase().includes('service unavailable') ||
    msg.includes('ECONNREFUSED') ||
    msg.includes('ETIMEDOUT') ||
    msg.includes('ENOTFOUND') ||
    msg.toLowerCase().includes('network') ||
    msg.toLowerCase().includes('connection error') ||
    msg.includes('anthropic.com')
  );
}

/**
 * Run message through OpenAI gpt-4o as a chat-only fallback.
 * Returns the response text or null if OpenAI is also unavailable.
 * @param onNotify - called immediately before the OpenAI call so the user
 *   sees a warning before we wait.
 */
export async function runOpenAIFallback(
  message: string,
  onNotify: (msg: string) => void,
): Promise<string | null> {
  const client = await getClient();
  if (!client) return null;

  onNotify('⚠️ Anthropic non disponibile — fallback a OpenAI (modalità degradata, no strumenti)');
  logger.warn('Anthropic unavailable — switching to OpenAI fallback');

  try {
    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 4096,
      messages: [{ role: 'user', content: message }],
    });

    const text = response.choices[0]?.message?.content ?? null;
    if (!text) return null;

    return `⚠️ _[OpenAI fallback — Anthropic non disponibile, nessun tool use]_\n\n${text}`;
  } catch (err) {
    logger.error({ err }, 'OpenAI fallback also failed');
    return null;
  }
}
