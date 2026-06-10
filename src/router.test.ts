import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

// router.ts dynamically imports ./cost-budget.js, which imports ./db.js
// (better-sqlite3 — unloadable under Node 24). Stub it before importing.
vi.mock('./cost-budget.js', () => ({
  shouldDowngradeForBudget: () => false,
}));

// Force pattern-only mode: no API key found in .env regardless of the
// machine this runs on, so classifyMessage never calls the Anthropic API.
vi.mock('./env.js', () => ({
  readEnvFile: () => ({}),
}));

import { classifyMessage, tierLabel } from './router.js';
import { TIER_MODELS } from './models.js';

const savedApiKey = process.env.ANTHROPIC_API_KEY;

beforeAll(() => {
  delete process.env.ANTHROPIC_API_KEY;
});

afterAll(() => {
  if (savedApiKey !== undefined) process.env.ANTHROPIC_API_KEY = savedApiKey;
});

describe('classifyMessage (pattern-only mode, no API key)', () => {
  describe('SIMPLE tier', () => {
    const simpleInputs = [
      'ciao',          // short, no question mark
      'ok',            // force-simple acknowledgment
      'thanks',        // force-simple acknowledgment
      '/status',       // slash command
      'hi there',      // force-simple greeting
      'hello',         // force-simple greeting
      'yes',           // force-simple
    ];

    for (const input of simpleInputs) {
      it(`classifies ${JSON.stringify(input)} as SIMPLE`, async () => {
        const result = await classifyMessage(input);
        expect(result.tier).toBe('SIMPLE');
        expect(result.model).toBe(TIER_MODELS.SIMPLE);
      });
    }

    it('classifies short simple lookup questions as SIMPLE', async () => {
      // SIMPLE_QUESTION_PATTERNS: "what time" with len < 80
      const result = await classifyMessage('what time is it in Tokyo right now?');
      expect(result.tier).toBe('SIMPLE');
    });
  });

  describe('MEDIUM tier (code / task requests)', () => {
    const mediumInputs = [
      'fix the bug in the date parser module',       // fix/bug keywords
      'write a unit test for the queue module',      // write/test keywords
      'install the docker container and run it',     // install/docker/run keywords
      'update the function to handle null input',    // update/function keywords
    ];

    for (const input of mediumInputs) {
      it(`classifies ${JSON.stringify(input)} as MEDIUM or higher`, async () => {
        const result = await classifyMessage(input);
        expect(['MEDIUM', 'COMPLEX']).toContain(result.tier);
        expect([TIER_MODELS.MEDIUM, TIER_MODELS.COMPLEX]).toContain(result.model);
      });
    }

    it('defaults to MEDIUM for ordinary requests with no matching patterns', async () => {
      const result = await classifyMessage('tell me about the roman empire in a sentence');
      expect(result.tier).toBe('MEDIUM');
      expect(result.model).toBe(TIER_MODELS.MEDIUM);
    });
  });

  describe('COMPLEX tier (architecture / planning)', () => {
    it('force-routes architecture keywords to COMPLEX', async () => {
      // FORCE_COMPLEX: \b(architect|design|plan|strategy|...)\b
      const result = await classifyMessage('design a new architecture for the bot');
      expect(result.tier).toBe('COMPLEX');
      expect(result.model).toBe(TIER_MODELS.COMPLEX);
    });

    it('force-routes life-planning keywords to COMPLEX', async () => {
      // Note: must not START with "help" — /^(status|ping|help)\b/ force-routes to SIMPLE
      const result = await classifyMessage('i want to plan my career strategy for the next five years');
      expect(result.tier).toBe('COMPLEX');
      expect(result.model).toBe(TIER_MODELS.COMPLEX);
    });

    it('heuristically classifies "what do you think" deliberation as COMPLEX', async () => {
      // COMPLEX_HEURISTIC_PATTERNS: "what do you think"
      const result = await classifyMessage('what do you think about moving from sqlite to postgres for this workload');
      expect(result.tier).toBe('COMPLEX');
    });

    it('classifies very long messages (>500 chars) as COMPLEX', async () => {
      const long = 'this message keeps going on and on about many different topics. '.repeat(10);
      expect(long.length).toBeGreaterThan(500);
      const result = await classifyMessage(long);
      expect(result.tier).toBe('COMPLEX');
    });
  });

  describe('manual override', () => {
    it('respects chatModelOverride and skips classification', async () => {
      const result = await classifyMessage('hi', 'claude-opus-4-8');
      expect(result.model).toBe('claude-opus-4-8');
      expect(result.tier).toBe('MEDIUM');
      expect(result.latencyMs).toBe(0);
    });
  });

  it('pattern path always reports zero latency (no API call)', async () => {
    const result = await classifyMessage('fix the bug in the date parser module');
    expect(result.latencyMs).toBe(0);
  });
});

describe('tierLabel', () => {
  it('maps tiers to display names', () => {
    expect(tierLabel('SIMPLE')).toBe('Haiku');
    expect(tierLabel('MEDIUM')).toBe('Sonnet');
    expect(tierLabel('COMPLEX')).toBe('Opus');
  });
});
