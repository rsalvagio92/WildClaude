import { logger } from './logger.js';

/** Hard cap on queued handlers per chat — beyond this, enqueue() rejects. */
const MAX_QUEUE_DEPTH = 50;

/**
 * Per-chat message queue with batching and buffer support.
 *
 * - Messages from same chatId run sequentially (prevents session conflicts)
 * - Different chatIds run in parallel
 * - When queue is busy, new messages are buffered for BATCH_WINDOW_MS
 *   to combine rapid follow-ups into a single query
 * - Buffered messages from a running task are stored for context injection
 *   and mirrored to SQLite so a crash doesn't drop them
 */
class MessageQueue {
  private chains = new Map<string, Promise<void>>();
  private pending = new Map<string, number>();

  /** Messages buffered while a task was running (for context injection) */
  private buffered = new Map<string, string[]>();

  /**
   * Enqueue a message handler. Handlers for same chatId run sequentially.
   * Returns false (without enqueuing) when the per-chat queue is full.
   */
  enqueue(chatId: string, handler: () => Promise<void>): boolean {
    const queued = (this.pending.get(chatId) ?? 0) + 1;
    if (queued > MAX_QUEUE_DEPTH) {
      logger.warn({ chatId, queued }, 'Message queue full — rejecting handler');
      return false;
    }
    this.pending.set(chatId, queued);

    if (queued > 1) {
      logger.info({ chatId, queued }, 'Message queued (another is processing)');
    }

    const prev = this.chains.get(chatId) ?? Promise.resolve();
    const next = prev.then(async () => {
      try {
        await handler();
      } catch (err) {
        logger.error({ err, chatId }, 'Unhandled message error');
      } finally {
        const remaining = (this.pending.get(chatId) ?? 1) - 1;
        if (remaining <= 0) {
          this.pending.delete(chatId);
          this.chains.delete(chatId);
        } else {
          this.pending.set(chatId, remaining);
        }
      }
    });

    this.chains.set(chatId, next);
    return true;
  }

  /** Number of chats with pending messages. */
  get activeChats(): number {
    return this.chains.size;
  }

  /** Total pending messages across all chats (used for fleet least-loaded routing). */
  get totalQueued(): number {
    let sum = 0;
    for (const n of this.pending.values()) sum += n;
    return sum;
  }

  /** Number of pending messages for a given chat. */
  queuedFor(chatId: string): number {
    return this.pending.get(chatId) ?? 0;
  }

  /** Buffer a message text received while a task is running. */
  bufferMessage(chatId: string, text: string): void {
    const existing = this.buffered.get(chatId) ?? [];
    existing.push(text);
    this.buffered.set(chatId, existing);
    // Mirror to SQLite so a crash doesn't drop the message. Lazy import
    // keeps this module loadable in tests without a database.
    void import('./db.js')
      .then(({ insertBufferedMessage }) => insertBufferedMessage(chatId, text))
      .catch((err) => logger.warn({ err, chatId }, 'Failed to persist buffered message'));
    logger.info({ chatId, buffered: existing.length }, 'Message buffered for context injection');
  }

  /** Get and clear buffered messages for a chat. */
  flushBuffer(chatId: string): string[] {
    const messages = this.buffered.get(chatId) ?? [];
    this.buffered.delete(chatId);
    if (messages.length > 0) {
      void import('./db.js')
        .then(({ deleteBufferedMessages }) => deleteBufferedMessages(chatId))
        .catch((err) => logger.warn({ err, chatId }, 'Failed to clear persisted buffer'));
    }
    return messages;
  }

  /** Check if there are buffered messages. */
  hasBuffered(chatId: string): boolean {
    return (this.buffered.get(chatId)?.length ?? 0) > 0;
  }

  /** Count buffered messages for a chat without clearing. */
  flushBufferedCount(chatId: string): number {
    return this.buffered.get(chatId)?.length ?? 0;
  }

  /**
   * Restore buffered messages persisted before a crash/restart. Call once at
   * startup after the database is ready. Restored messages are injected as
   * context on the next message for their chat, same as live-buffered ones.
   */
  async restorePersistedBuffers(): Promise<number> {
    try {
      const { loadBufferedMessages } = await import('./db.js');
      const persisted = loadBufferedMessages();
      let count = 0;
      for (const [chatId, messages] of persisted) {
        const existing = this.buffered.get(chatId) ?? [];
        this.buffered.set(chatId, [...messages, ...existing]);
        count += messages.length;
      }
      if (count > 0) logger.info({ count }, 'Restored buffered messages from previous run');
      return count;
    } catch (err) {
      logger.warn({ err }, 'Failed to restore persisted buffered messages');
      return 0;
    }
  }

  /**
   * Wait for all in-flight handlers to finish (used during graceful shutdown).
   * Resolves true when drained, false on timeout.
   */
  async drain(timeoutMs = 30000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (this.chains.size > 0) {
      if (Date.now() >= deadline) return false;
      await new Promise((r) => setTimeout(r, 100));
    }
    return true;
  }
}

export const messageQueue = new MessageQueue();
