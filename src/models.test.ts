import { describe, it, expect } from 'vitest';

import { MODELS, TIER_MODELS, SELECTABLE_MODELS, normalizeModel } from './models.js';

describe('normalizeModel', () => {
  it('passes undefined through', () => {
    expect(normalizeModel(undefined)).toBeUndefined();
  });

  it('passes empty string through (falsy)', () => {
    expect(normalizeModel('')).toBe('');
  });

  it('maps short aliases to canonical IDs', () => {
    expect(normalizeModel('opus')).toBe(MODELS.opus);
    expect(normalizeModel('sonnet')).toBe(MODELS.sonnet);
    expect(normalizeModel('haiku')).toBe(MODELS.haiku);
    expect(normalizeModel('fable')).toBe(MODELS.fable);
  });

  it('is case-insensitive for aliases', () => {
    expect(normalizeModel('OPUS')).toBe(MODELS.opus);
    expect(normalizeModel('Sonnet')).toBe(MODELS.sonnet);
  });

  it('maps legacy version IDs to current family IDs', () => {
    expect(normalizeModel('claude-opus-4-6')).toBe(MODELS.opus);
    expect(normalizeModel('claude-sonnet-4-5')).toBe(MODELS.sonnet);
    expect(normalizeModel('claude-haiku-4-5-20251001')).toBe(MODELS.haiku);
  });

  it('maps current canonical IDs to themselves', () => {
    expect(normalizeModel(MODELS.fable)).toBe(MODELS.fable);
    expect(normalizeModel(MODELS.opus)).toBe(MODELS.opus);
    expect(normalizeModel(MODELS.sonnet)).toBe(MODELS.sonnet);
    expect(normalizeModel(MODELS.haiku)).toBe(MODELS.haiku);
  });

  it('passes unknown future model families through unchanged', () => {
    expect(normalizeModel('claude-newfamily-7')).toBe('claude-newfamily-7');
    expect(normalizeModel('some-other-model')).toBe('some-other-model');
  });
});

describe('TIER_MODELS', () => {
  it('maps router tiers to the right model family', () => {
    expect(TIER_MODELS.SIMPLE).toBe(MODELS.haiku);
    expect(TIER_MODELS.MEDIUM).toBe(MODELS.sonnet);
    expect(TIER_MODELS.COMPLEX).toBe(MODELS.opus);
  });
});

describe('SELECTABLE_MODELS', () => {
  it('every entry has id, alias, label, description', () => {
    expect(SELECTABLE_MODELS.length).toBeGreaterThan(0);
    for (const entry of SELECTABLE_MODELS) {
      expect(entry.id).toBeTruthy();
      expect(entry.alias).toBeTruthy();
      expect(entry.label).toBeTruthy();
      expect(entry.description).toBeTruthy();
    }
  });

  it('every alias normalizes to its own id', () => {
    for (const entry of SELECTABLE_MODELS) {
      expect(normalizeModel(entry.alias)).toBe(entry.id);
    }
  });
});
