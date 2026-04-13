import { logger } from './logger.js';

/**
 * Per-chat message queue with batching and buffer support.
 *
 * - Messages from same chatId run sequentially (prevents session conflicts)
 * - Different chatIds run in parallel
 * - When queue is busy, new messages are buffered for BATCH_WINDOW_MS
 *   to combine rapid follow-ups into a single query
 * - Buffered messages from a running task are stored for context injection
 */
class MessageQueue {
  private chains = new Map<string, Promise<void>>();
  private pending = new Map<string, number>();

  /** Messages buffered while a task was running (for context injection) */
  private buffered = new Map<string, string[]>();

  /**
   * Enqueue a message handler. Handlers for same chatId run sequentially.
   */
  enqueue(chatId: string, handler: () => Promise<void>): void {
    const queued = (this.pending.get(chatId) ?? 0) + 1;
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
  }

  /** Number of chats with pending messages. */
  get activeChats(): number {
    return this.chains.size;
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
    logger.info({ chatId, buffered: existing.length }, 'Message buffered for context injection');
  }

  /** Get and clear buffered messages for a chat. */
  flushBuffer(chatId: string): string[] {
    const messages = this.buffered.get(chatId) ?? [];
    this.buffered.delete(chatId);
    return messages;
  }

  /** Check if there are buffered messages. */
  hasBuffered(chatId: string): boolean {
    return (this.buffered.get(chatId)?.length ?? 0) > 0;
  }
}

export const messageQueue = new MessageQueue();
