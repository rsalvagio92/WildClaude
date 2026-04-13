import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./db.js', () => ({
  getUnconsolidatedMemories: vi.fn(),
  saveConsolidation: vi.fn(() => 1),
  supersedeMemory: vi.fn(),
  markMemoriesConsolidated: vi.fn(),
  updateMemoryConnections: vi.fn(),
}));

vi.mock('./logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { runConsolidation } from './memory-consolidate.js';
import {
  getUnconsolidatedMemories,
  saveConsolidation,
  markMemoriesConsolidated,
  updateMemoryConnections,
  supersedeMemory,
} from './db.js';

const mockGetUnconsolidated = vi.mocked(getUnconsolidatedMemories);
const mockSaveConsolidation = vi.mocked(saveConsolidation);
const mockMarkConsolidated = vi.mocked(markMemoriesConsolidated);
const mockUpdateConnections = vi.mocked(updateMemoryConnections);
const mockSupersedeMemory = vi.mocked(supersedeMemory);

function makeMemory(id: number, summary: string, topics = '[]', entities = '[]', importance = 0.6, created_at?: number) {
  return {
    id,
    chat_id: 'chat1',
    source: 'conversation',
    agent_id: 'main',
    raw_text: 'raw',
    summary,
    entities,
    topics,
    connections: '[]',
    importance,
    salience: 1.0,
    consolidated: 0,
    pinned: 0,
    embedding: null,
    created_at: created_at ?? Math.floor(Date.now() / 1000) - 3600,
    accessed_at: Math.floor(Date.now() / 1000) - 3600,
  };
}

describe('runConsolidation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Skip conditions ───────────────────────────────────────────────────

  it('skips when fewer than 3 unconsolidated memories', async () => {
    mockGetUnconsolidated.mockReturnValue([makeMemory(1, 'only one'), makeMemory(2, 'only two')]);
    await runConsolidation('chat1');
    expect(mockSaveConsolidation).not.toHaveBeenCalled();
    expect(mockMarkConsolidated).not.toHaveBeenCalled();
  });

  it('skips when zero unconsolidated memories', async () => {
    mockGetUnconsolidated.mockReturnValue([]);
    await runConsolidation('chat1');
    expect(mockSaveConsolidation).not.toHaveBeenCalled();
  });

  it('skips when exactly 2 unconsolidated memories', async () => {
    mockGetUnconsolidated.mockReturnValue([makeMemory(1, 'one'), makeMemory(2, 'two')]);
    await runConsolidation('chat1');
    expect(mockSaveConsolidation).not.toHaveBeenCalled();
  });

  // ── Successful consolidation ──────────────────────────────────────────

  it('consolidates memories sharing the same topic and marks them consolidated', async () => {
    const memories = [
      makeMemory(10, 'User prefers morning email triage', '["routine"]'),
      makeMemory(20, 'User checks Slack after email', '["routine"]'),
      makeMemory(30, 'User blocks 9-10am for admin tasks', '["routine"]'),
    ];
    mockGetUnconsolidated.mockReturnValue(memories);

    await runConsolidation('chat1');

    // Should save one consolidation record for the "routine" topic group
    expect(mockSaveConsolidation).toHaveBeenCalledWith(
      'chat1',
      [10, 20, 30],
      expect.stringContaining('routine'),
      expect.stringContaining('routine'),
    );

    // Should mark all memories as consolidated
    expect(mockMarkConsolidated).toHaveBeenCalledWith([10, 20, 30]);
  });

  it('creates pairwise connections between memories in same topic group', async () => {
    const memories = [
      makeMemory(10, 'mem A', '["dev"]'),
      makeMemory(20, 'mem B', '["dev"]'),
      makeMemory(30, 'mem C', '["dev"]'),
    ];
    mockGetUnconsolidated.mockReturnValue(memories);

    await runConsolidation('chat1');

    // Should wire connections between all pairs: (10,20), (10,30), (20,30)
    expect(mockUpdateConnections).toHaveBeenCalledWith(10, [
      { linked_to: 20, relationship: expect.stringContaining('dev') },
    ]);
    expect(mockUpdateConnections).toHaveBeenCalledWith(10, [
      { linked_to: 30, relationship: expect.stringContaining('dev') },
    ]);
    expect(mockUpdateConnections).toHaveBeenCalledWith(20, [
      { linked_to: 30, relationship: expect.stringContaining('dev') },
    ]);
  });

  it('groups memories into separate consolidations by topic', async () => {
    const memories = [
      makeMemory(10, 'code memory 1', '["development"]'),
      makeMemory(20, 'code memory 2', '["development"]'),
      makeMemory(30, 'health memory 1', '["health"]'),
      makeMemory(40, 'health memory 2', '["health"]'),
      makeMemory(50, 'lone memory', '["finance"]'),  // only 1 in group, won't consolidate
    ];
    mockGetUnconsolidated.mockReturnValue(memories);

    await runConsolidation('chat1');

    // Should create 2 consolidations (development and health), not finance (only 1)
    expect(mockSaveConsolidation).toHaveBeenCalledTimes(2);
    expect(mockMarkConsolidated).toHaveBeenCalledWith([10, 20, 30, 40, 50]);
  });

  it('handles memories with no topics by grouping them under "general"', async () => {
    const memories = [
      makeMemory(10, 'no topic memory 1', '[]'),
      makeMemory(20, 'no topic memory 2', '[]'),
      makeMemory(30, 'no topic memory 3', '[]'),
    ];
    mockGetUnconsolidated.mockReturnValue(memories);

    await runConsolidation('chat1');

    expect(mockSaveConsolidation).toHaveBeenCalledWith(
      'chat1',
      expect.arrayContaining([10, 20, 30]),
      expect.stringContaining('general'),
      expect.stringContaining('general'),
    );
  });

  // ── Contradiction detection ───────────────────────────────────────────

  it('supersedes older memory when newer has significantly higher importance', async () => {
    const now = Math.floor(Date.now() / 1000);
    const memories = [
      makeMemory(10, 'old memory about Project', '["dev"]', '["Project"]', 0.5, now - 7200),
      makeMemory(20, 'new memory about Project', '["dev"]', '["Project"]', 0.9, now - 100),
      makeMemory(30, 'another dev memory', '["dev"]', '[]', 0.6, now - 3600),
    ];
    mockGetUnconsolidated.mockReturnValue(memories);

    await runConsolidation('chat1');

    // Newer (20) has importance 0.9, older (10) has 0.5 — diff > 0.2 so supersede
    expect(mockSupersedeMemory).toHaveBeenCalledWith(10, 20);
  });

  it('does not supersede when importance difference is small', async () => {
    const now = Math.floor(Date.now() / 1000);
    const memories = [
      makeMemory(10, 'old memory about Tool', '["dev"]', '["Tool"]', 0.6, now - 7200),
      makeMemory(20, 'new memory about Tool', '["dev"]', '["Tool"]', 0.75, now - 100),
      makeMemory(30, 'another memory', '["dev"]', '[]', 0.6, now - 3600),
    ];
    mockGetUnconsolidated.mockReturnValue(memories);

    await runConsolidation('chat1');

    // Diff is 0.15 which is <= 0.2, so no supersede
    expect(mockSupersedeMemory).not.toHaveBeenCalled();
  });

  // ── Error handling ────────────────────────────────────────────────────

  it('handles saveConsolidation throwing gracefully', async () => {
    const memories = [
      makeMemory(10, 'mem1', '["dev"]'),
      makeMemory(20, 'mem2', '["dev"]'),
      makeMemory(30, 'mem3', '["dev"]'),
    ];
    mockGetUnconsolidated.mockReturnValue(memories);
    mockSaveConsolidation.mockImplementationOnce(() => { throw new Error('DB error'); });

    await expect(runConsolidation('chat1')).resolves.not.toThrow();
  });

  // ── Overlap guard ─────────────────────────────────────────────────────

  it('does not run concurrently for the same chatId (overlap guard)', async () => {
    const memories = [
      makeMemory(10, 'mem1', '["dev"]'),
      makeMemory(20, 'mem2', '["dev"]'),
      makeMemory(30, 'mem3', '["dev"]'),
    ];

    // Intercept getUnconsolidatedMemories to start a second concurrent call
    // on the first invocation (simulating re-entrant call while first is running)
    let secondRun: Promise<void> | null = null;
    mockGetUnconsolidated.mockImplementationOnce(() => {
      // Kick off second call while first is still inside try block
      secondRun = runConsolidation('chat1');
      return memories;
    });
    mockGetUnconsolidated.mockReturnValue(memories);

    await runConsolidation('chat1');
    await secondRun;

    // getUnconsolidated should only be called once (second run was blocked by guard)
    expect(mockGetUnconsolidated).toHaveBeenCalledTimes(1);
  });
});
