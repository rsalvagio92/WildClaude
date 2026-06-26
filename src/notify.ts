/**
 * notifyUser() — the single proactive-notification seam.
 *
 * Anything that needs to reach the user *unprompted* (scheduled task results,
 * cron digests, agent finished, budget alerts) goes through here. It fans the
 * message out to every delivery channel IN PARALLEL:
 *
 *   - Telegram (the original channel)
 *   - Expo push (the mobile app — added in the mobile Phase 1)
 *
 * Channels are independent: a Telegram failure never blocks the push, and vice
 * versa (Promise.allSettled). Each channel is also individually skippable per
 * call (toTelegram / toPush) for cases that only make sense on one surface.
 *
 * Wiring: the Telegram backend is registered at startup via setTelegramDelivery
 * (index.ts, once the bot exists) rather than imported, so this module stays
 * free of grammy/bot.ts and avoids an import cycle. If no backend is registered
 * (e.g. dashboard-only mode), Telegram delivery is silently skipped.
 */

import { logger } from './logger.js';
import { pushNotify } from './push/index.js';

/** Minimal Telegram send options (kept loose to avoid importing grammy here). */
export interface TelegramSendOptions {
  parse_mode?: 'HTML' | 'Markdown' | 'MarkdownV2';
  disable_notification?: boolean;
  reply_markup?: unknown;
}

/** Backend that actually puts a message on Telegram (handles splitting + retry). */
export type TelegramDelivery = (text: string, opts?: TelegramSendOptions) => Promise<void>;

let telegramDelivery: TelegramDelivery | null = null;

/** Register (or clear) the Telegram backend. Called once at startup. */
export function setTelegramDelivery(fn: TelegramDelivery | null): void {
  telegramDelivery = fn;
}

export interface NotifyOptions {
  /**
   * Push category, used to honor per-device opt-outs (e.g. 'scheduled',
   * 'agent', 'system', 'chat'). Omit to deliver to all push devices.
   */
  category?: string;
  /** Telegram-specific options (parse mode, keyboard, silent). */
  telegram?: TelegramSendOptions;
  /** Push overrides. By default title = bot name, body = stripped text. */
  push?: {
    title?: string;
    /** Override the push body (otherwise derived from `text`). */
    body?: string;
    /** Arbitrary data delivered to the app (deep links, ids, …). */
    data?: Record<string, unknown>;
    /** iOS badge count. */
    badge?: number;
  };
  /** Deliver to Telegram. Default true. */
  toTelegram?: boolean;
  /** Deliver to Expo push. Default true. */
  toPush?: boolean;
}

export interface NotifyResult {
  telegram: { attempted: boolean; ok: boolean; error?: string };
  push: { attempted: boolean; ok: boolean; targeted: number; pruned: number; error?: string };
}

const PUSH_TITLE = process.env.PUSH_TITLE || 'WildClaude';
const PUSH_BODY_MAX = 200;

/**
 * Turn Telegram-flavored text (which may contain HTML tags / entities) into a
 * plain, short string suitable for a push notification body.
 */
export function toPushBody(text: string): string {
  const plain = text
    .replace(/<br\s*\/?>(?=)/gi, '\n')
    .replace(/<[^>]+>/g, '') // strip HTML tags
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{2,}/g, '\n')
    .trim();
  if (plain.length <= PUSH_BODY_MAX) return plain;
  return plain.slice(0, PUSH_BODY_MAX - 1).trimEnd() + '…';
}

/**
 * Deliver a proactive message to the user across all enabled channels in
 * parallel. Never throws — channel failures are captured in the result.
 */
export async function notifyUser(text: string, options: NotifyOptions = {}): Promise<NotifyResult> {
  const toTelegram = options.toTelegram !== false;
  const toPush = options.toPush !== false;

  const result: NotifyResult = {
    telegram: { attempted: false, ok: false },
    push: { attempted: false, ok: false, targeted: 0, pruned: 0 },
  };

  const tasks: Promise<void>[] = [];

  // ── Telegram ──────────────────────────────────────────────────────
  if (toTelegram && telegramDelivery) {
    result.telegram.attempted = true;
    const deliver = telegramDelivery;
    tasks.push(
      deliver(text, options.telegram).then(
        () => {
          result.telegram.ok = true;
        },
        (err) => {
          result.telegram.error = err instanceof Error ? err.message : String(err);
          logger.warn({ err: result.telegram.error }, 'notifyUser: Telegram delivery failed');
        },
      ),
    );
  }

  // ── Expo push ─────────────────────────────────────────────────────
  if (toPush) {
    result.push.attempted = true;
    const body = options.push?.body ?? toPushBody(text);
    tasks.push(
      pushNotify({
        title: options.push?.title ?? PUSH_TITLE,
        body: body || PUSH_TITLE,
        data: options.push?.data,
        badge: options.push?.badge,
        category: options.category,
      }).then(
        (r) => {
          result.push.targeted = r.targeted;
          result.push.pruned = r.pruned;
          result.push.ok = !r.error;
          if (r.error) result.push.error = r.error;
        },
        (err) => {
          result.push.error = err instanceof Error ? err.message : String(err);
          logger.warn({ err: result.push.error }, 'notifyUser: push delivery failed');
        },
      ),
    );
  }

  await Promise.allSettled(tasks);
  return result;
}
