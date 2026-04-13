import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./db.js', () => ({
  saveStructuredMemory: vi.fn(() => 1),
}));

vi.mock('./memory-files.js', () => ({
  writeMemoryToFile: vi.fn(),
}));

vi.mock('./logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { ingestConversationTurn } from './memory-ingest.js';
import { saveStructuredMemory } from './db.js';

const mockSave = vi.mocked(saveStructuredMemory);

describe('ingestConversationTurn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Hard filters ─────────────────────────────────────────────────────

  it('skips messages <= 10 characters', async () => {
    const result = await ingestConversationTurn('chat1', 'short msg', 'ok');
    expect(result).toBe(false);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('skips messages exactly 10 characters', async () => {
    const result = await ingestConversationTurn('chat1', '1234567890', 'ok');
    expect(result).toBe(false);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('processes messages of 11 characters', async () => {
    const result = await ingestConversationTurn('chat1', '12345678901', 'ok');
    // 11 chars passes the length check; default importance is 0.5 so it saves
    expect(result).toBe(true);
    expect(mockSave).toHaveBeenCalled();
  });

  it('skips messages starting with /', async () => {
    const result = await ingestConversationTurn('chat1', '/chatid some long command text here', 'Your ID is 12345');
    expect(result).toBe(false);
    expect(mockSave).not.toHaveBeenCalled();
  });

  // ── Skip-pattern matching ─────────────────────────────────────────────

  it('skips ephemeral one-word responses like "thanks"', async () => {
    const result = await ingestConversationTurn('chat1', 'thanks', 'ok');
    expect(result).toBe(false);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('skips emoji-only messages', async () => {
    const result = await ingestConversationTurn('chat1', '👍', 'ok');
    expect(result).toBe(false);
    expect(mockSave).not.toHaveBeenCalled();
  });

  // ── Saves a valid memory ──────────────────────────────────────────────

  it('saves a memory for a high-importance message', async () => {
    const result = await ingestConversationTurn(
      'chat1',
      'I always want dark mode enabled in everything',
      'Got it, I will remember your dark mode preference.',
    );

    expect(result).toBe(true);
    expect(mockSave).toHaveBeenCalledWith(
      'chat1',
      'I always want dark mode enabled in everything',
      expect.any(String),  // summary created locally
      expect.any(Array),   // entities extracted locally
      expect.any(Array),   // topics extracted locally
      expect.any(Number),  // importance computed locally
      'conversation',
      'main',
    );
  });

  it('saves a memory with importance >= 0.5 (default)', async () => {
    const result = await ingestConversationTurn('chat1', 'some useful message longer than fifteen', 'ok');
    expect(result).toBe(true);
    expect(mockSave).toHaveBeenCalled();
  });

  // ── High-importance patterns boost score ─────────────────────────────

  it('boosts importance for "my name is" pattern', async () => {
    await ingestConversationTurn('chat1', 'My name is Riccardo and I work here', 'Nice to meet you Riccardo!');
    const callArgs = mockSave.mock.calls[0]!;
    const importance = callArgs[5] as number;
    expect(importance).toBeGreaterThanOrEqual(0.9);
  });

  it('boosts importance for "from now on" pattern', async () => {
    await ingestConversationTurn('chat1', 'From now on always reply in Italian please', 'Certo!');
    const callArgs = mockSave.mock.calls[0]!;
    const importance = callArgs[5] as number;
    expect(importance).toBeGreaterThanOrEqual(0.85);
  });

  it('boosts importance for "i prefer" pattern', async () => {
    await ingestConversationTurn('chat1', 'I prefer dark mode in all my apps please', 'Noted!');
    const callArgs = mockSave.mock.calls[0]!;
    const importance = callArgs[5] as number;
    expect(importance).toBeGreaterThanOrEqual(0.7);
  });

  // ── Long messages get higher importance ──────────────────────────────

  it('gives importance >= 0.6 for messages > 200 chars', async () => {
    const longMsg = 'a '.repeat(101); // ~202 chars
    await ingestConversationTurn('chat1', longMsg, 'ok');
    const callArgs = mockSave.mock.calls[0]!;
    const importance = callArgs[5] as number;
    expect(importance).toBeGreaterThanOrEqual(0.6);
  });

  it('gives importance >= 0.7 for messages > 500 chars', async () => {
    const longMsg = 'a '.repeat(251); // ~502 chars
    await ingestConversationTurn('chat1', longMsg, 'ok');
    const callArgs = mockSave.mock.calls[0]!;
    const importance = callArgs[5] as number;
    expect(importance).toBeGreaterThanOrEqual(0.7);
  });

  // ── Topic extraction ──────────────────────────────────────────────────

  it('extracts development topic from code-related message', async () => {
    await ingestConversationTurn('chat1', 'I need to fix this TypeScript bug in the function', 'Sure!');
    const callArgs = mockSave.mock.calls[0]!;
    const topics = callArgs[4] as string[];
    expect(topics).toContain('development');
  });

  it('extracts communication topic from telegram-related message', async () => {
    await ingestConversationTurn('chat1', 'Send me a message via Telegram when done', 'Will do!');
    const callArgs = mockSave.mock.calls[0]!;
    const topics = callArgs[4] as string[];
    expect(topics).toContain('communication');
  });

  it('falls back to general topic when no keywords match', async () => {
    // Use a message with no topic-map keywords at all (avoid: message, key, test, token, etc.)
    await ingestConversationTurn('chat1', 'The quick brown fox jumps over the lazy dog indeed', 'ok');
    const callArgs = mockSave.mock.calls[0]!;
    const topics = callArgs[4] as string[];
    expect(topics).toContain('general');
  });

  // ── Summary creation ─────────────────────────────────────────────────

  it('creates a non-empty summary', async () => {
    await ingestConversationTurn('chat1', 'I prefer dark mode in all my apps', 'Noted!');
    const callArgs = mockSave.mock.calls[0]!;
    const summary = callArgs[2] as string;
    expect(summary.length).toBeGreaterThan(0);
  });

  it('summary is at most 300 chars', async () => {
    const longMsg = 'x '.repeat(300);
    await ingestConversationTurn('chat1', longMsg, 'ok');
    const callArgs = mockSave.mock.calls[0]!;
    const summary = callArgs[2] as string;
    expect(summary.length).toBeLessThanOrEqual(300);
  });

  // ── Error handling ────────────────────────────────────────────────────

  it('returns false when saveStructuredMemory throws', async () => {
    mockSave.mockImplementationOnce(() => { throw new Error('DB error'); });
    const result = await ingestConversationTurn('chat1', 'this message should not crash the bot', 'response');
    expect(result).toBe(false);
  });

  // ── Agent ID forwarding ───────────────────────────────────────────────

  it('passes custom agentId to saveStructuredMemory', async () => {
    await ingestConversationTurn('chat1', 'I prefer dark mode in all my apps', 'Noted!', 'custom-agent');
    expect(mockSave).toHaveBeenCalledWith(
      'chat1',
      expect.any(String),
      expect.any(String),
      expect.any(Array),
      expect.any(Array),
      expect.any(Number),
      'conversation',
      'custom-agent',
    );
  });
});
