import { describe, it, expect } from 'vitest';
import { contextWindowFor, CONTEXT_WINDOWS } from './models.js';
// The dashboard UI helpers are framework-free ES modules; their pure
// formatters import cleanly in node (no DOM touched until a builder is called).
import { fmtUsd, fmtBytes, fmtAgo, truncate, escapeHtml } from '../dashboard-ui/js/ui.js';

describe('contextWindowFor', () => {
  it('returns 1M for the large-window families', () => {
    expect(contextWindowFor('claude-opus-4-8')).toBe(1_000_000);
    expect(contextWindowFor('claude-sonnet-4-6')).toBe(1_000_000);
    expect(contextWindowFor('claude-fable-5')).toBe(1_000_000);
  });
  it('returns 200K for haiku', () => {
    expect(contextWindowFor('claude-haiku-4-5')).toBe(200_000);
  });
  it('resolves aliases and legacy ids via normalizeModel', () => {
    expect(contextWindowFor('opus')).toBe(1_000_000);
    expect(contextWindowFor('claude-opus-4-6')).toBe(1_000_000);
    expect(contextWindowFor('claude-haiku-4-5-20251001')).toBe(200_000);
  });
  it('falls back to the smallest window for unknown/undefined', () => {
    expect(contextWindowFor(undefined)).toBe(200_000);
    expect(contextWindowFor('totally-unknown')).toBe(200_000);
  });
  it('CONTEXT_WINDOWS covers every model in the map', () => {
    expect(Object.keys(CONTEXT_WINDOWS).length).toBeGreaterThanOrEqual(4);
  });
});

describe('dashboard ui formatters', () => {
  it('fmtUsd formats to 4 decimals with $', () => {
    expect(fmtUsd(0)).toBe('$0.0000');
    expect(fmtUsd(1.23456)).toBe('$1.2346');
    expect(fmtUsd(undefined)).toBe('$0.0000');
  });
  it('fmtBytes scales units', () => {
    expect(fmtBytes(512)).toBe('512 B');
    expect(fmtBytes(2048)).toBe('2.0 KB');
    expect(fmtBytes(5 * 1048576)).toBe('5.0 MB');
    expect(fmtBytes(null)).toBe('—');
  });
  it('truncate adds ellipsis past the limit', () => {
    expect(truncate('hello', 10)).toBe('hello');
    expect(truncate('hello world', 5)).toBe('hello…');
    expect(truncate(undefined)).toBe('');
  });
  it('escapeHtml neutralizes markup', () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(escapeHtml("a & b 'c'")).toBe('a &amp; b &#39;c&#39;');
    expect(escapeHtml(null)).toBe('');
  });
  it('fmtAgo handles seconds and ms timestamps', () => {
    const nowSec = Math.floor(Date.now() / 1000);
    expect(fmtAgo(nowSec)).toMatch(/s ago|^0s/);
    expect(fmtAgo(0)).toBe('—');
    expect(fmtAgo(Date.now() - 2 * 3600 * 1000)).toMatch(/h ago/);
  });
});
