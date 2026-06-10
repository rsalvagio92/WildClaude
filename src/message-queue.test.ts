import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

// message-queue.ts lazily `import('./db.js')` for persistence — db.ts loads
// better-sqlite3 which cannot load under Node 24 locally, so stub it out.
const dbStubs = vi.hoisted(() => ({
  insertBufferedMessage: vi.fn(),
  deleteBufferedMessages: vi.fn(),
  loadBufferedMessages: vi.fn((): Map<string, string[]> => new Map()),
}));

vi.mock('./db.js', () => dbStubs);

import { messageQueue } from './message-queue.js';

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

// The module exports a singleton — use a unique chatId per test case to
// avoid cross-test interference.
describe('messageQueue', () => {
  beforeAll(async () => {
    // Sanity: the mocked db.js resolves to our stubs from the test file.
    const mod = await import('./db.js');
    expect(mod.insertBufferedMessage).toBe(dbStubs.insertBufferedMessage);

    // Warm up message-queue.ts's OWN dynamic `import('./db.js')` serially.
    // The very first internal import must not happen concurrently: two
    // concurrent first-time dynamic imports of a mocked module race the
    // mock interceptor and can cache the REAL db.ts (which then poisons
    // every later import). One serial round-trip pins the mock in cache.
    messageQueue.bufferMessage('mq-warmup', 'warmup');
    await tick(50);
    messageQueue.flushBuffer('mq-warmup');
    await tick(50);
  });

  beforeEach(() => {
    dbStubs.insertBufferedMessage.mockClear();
    dbStubs.deleteBufferedMessages.mockClear();
    dbStubs.loadBufferedMessages.mockClear();
    dbStubs.loadBufferedMessages.mockImplementation(() => new Map());
  });

  it('runs handlers for the same chatId sequentially', async () => {
    const chatId = 'mq-seq';
    const order: string[] = [];
    const gate = deferred();

    expect(messageQueue.enqueue(chatId, async () => {
      order.push('a-start');
      await gate.promise;
      order.push('a-end');
    })).toBe(true);

    expect(messageQueue.enqueue(chatId, async () => {
      order.push('b-start');
    })).toBe(true);

    await tick();
    // Second handler must not start while the first is in flight
    expect(order).toEqual(['a-start']);

    gate.resolve();
    await tick();
    expect(order).toEqual(['a-start', 'a-end', 'b-start']);
    expect(messageQueue.queuedFor(chatId)).toBe(0);
  });

  it('runs handlers for different chatIds in parallel', async () => {
    const order: string[] = [];
    const gate = deferred();

    messageQueue.enqueue('mq-par-a', async () => {
      order.push('a-start');
      await gate.promise;
      order.push('a-end');
    });
    messageQueue.enqueue('mq-par-b', async () => {
      order.push('b-done');
    });

    await tick();
    // Chat B finished while chat A is still blocked
    expect(order).toContain('b-done');
    expect(order).not.toContain('a-end');

    gate.resolve();
    await tick();
    expect(order).toContain('a-end');
  });

  it('enqueue returns true normally', async () => {
    const ok = messageQueue.enqueue('mq-true', async () => { /* no-op */ });
    expect(ok).toBe(true);
    await tick();
  });

  it('enqueue returns false beyond MAX_QUEUE_DEPTH=50 pending handlers', async () => {
    const chatId = 'mq-depth';
    const gate = deferred();
    let completed = 0;

    for (let i = 0; i < 50; i++) {
      const ok = messageQueue.enqueue(chatId, async () => {
        await gate.promise;
        completed++;
      });
      expect(ok).toBe(true);
    }
    expect(messageQueue.queuedFor(chatId)).toBe(50);

    // 51st is rejected without enqueuing
    const overflow = messageQueue.enqueue(chatId, async () => { completed++; });
    expect(overflow).toBe(false);
    expect(messageQueue.queuedFor(chatId)).toBe(50);

    // Unblock and let the queue drain
    gate.resolve();
    expect(await messageQueue.drain(10000)).toBe(true);
    expect(completed).toBe(50);
    expect(messageQueue.queuedFor(chatId)).toBe(0);
  });

  it('bufferMessage / hasBuffered / flushBufferedCount / flushBuffer semantics', async () => {
    const chatId = 'mq-buffer';

    expect(messageQueue.hasBuffered(chatId)).toBe(false);
    expect(messageQueue.flushBufferedCount(chatId)).toBe(0);

    // Serialize the two calls: each bufferMessage fires a `void import('./db.js')`,
    // and vitest's mocker mis-resolves a mocked module when two dynamic imports
    // are in flight at the same time (second one gets the real db.ts).
    messageQueue.bufferMessage(chatId, 'first');
    await tick();
    messageQueue.bufferMessage(chatId, 'second');
    await tick();

    expect(messageQueue.hasBuffered(chatId)).toBe(true);
    expect(messageQueue.flushBufferedCount(chatId)).toBe(2);
    expect(dbStubs.insertBufferedMessage).toHaveBeenCalledWith(chatId, 'first');
    expect(dbStubs.insertBufferedMessage).toHaveBeenCalledWith(chatId, 'second');

    // flushBuffer returns messages in order and clears the buffer
    expect(messageQueue.flushBuffer(chatId)).toEqual(['first', 'second']);
    expect(messageQueue.hasBuffered(chatId)).toBe(false);
    expect(messageQueue.flushBufferedCount(chatId)).toBe(0);
    expect(messageQueue.flushBuffer(chatId)).toEqual([]);

    await tick();
    expect(dbStubs.deleteBufferedMessages).toHaveBeenCalledWith(chatId);
  });

  it('restorePersistedBuffers merges persisted messages before live ones and returns count', async () => {
    const chatId = 'mq-restore';

    messageQueue.bufferMessage(chatId, 'live-1');
    // Let bufferMessage's in-flight `void import('./db.js')` settle before
    // restorePersistedBuffers issues its own awaited import (see note above
    // about concurrent dynamic imports of a mocked module).
    await tick();
    dbStubs.loadBufferedMessages.mockImplementation(
      () => new Map([[chatId, ['persisted-1', 'persisted-2']]]),
    );

    const restored = await messageQueue.restorePersistedBuffers();
    expect(restored).toBe(2);

    // Persisted (pre-crash) messages come BEFORE live-buffered ones
    expect(messageQueue.flushBuffer(chatId)).toEqual(['persisted-1', 'persisted-2', 'live-1']);
  });

  it('drain resolves true when idle', async () => {
    expect(await messageQueue.drain(1000)).toBe(true);
  });

  it('drain resolves true after in-flight handlers finish', async () => {
    const chatId = 'mq-drain';
    let finished = false;
    messageQueue.enqueue(chatId, async () => {
      await tick(150);
      finished = true;
    });

    expect(await messageQueue.drain(5000)).toBe(true);
    expect(finished).toBe(true);
  });
});
