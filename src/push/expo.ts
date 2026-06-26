/**
 * Expo push dispatcher.
 *
 * Talks to Expo's push service (https://exp.host/--/api/v2/push/send). No SDK —
 * the wire format is a simple JSON POST, and keeping the dep list lean matches
 * how the rest of WildClaude treats third-party transports.
 *
 * Responsibilities:
 *   - chunk messages (Expo caps a single request at 100 messages)
 *   - attach the optional EXPO_ACCESS_TOKEN for enhanced-security projects
 *   - read ticket responses and prune tokens Expo reports as dead
 *     (DeviceNotRegistered) so the registry self-heals
 *
 * Auth token (optional): EXPO_ACCESS_TOKEN, read via getSecret(). Expo's push
 * API works without it for most projects; it's only required when a project has
 * enhanced push security enabled.
 */

import { logger } from '../logger.js';
import { getSecret } from '../secrets.js';
import { getEligibleTokens, removeDevice, touchDevices } from './devices.js';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const CHUNK_SIZE = 100;

/** A high-level notification to fan out to every eligible device. */
export interface PushNotification {
  /** Notification title (the bold first line). */
  title?: string;
  /** Notification body text. */
  body: string;
  /** Arbitrary data delivered to the app (e.g. a deep link / sessionId). */
  data?: Record<string, unknown>;
  /**
   * Category used to honor per-device opt-outs (e.g. 'chat', 'agent', 'system').
   * Devices that disabled this category are skipped. Omit to deliver to all.
   */
  category?: string;
  /** Sound to play. 'default' or null (silent). Defaults to 'default'. */
  sound?: 'default' | null;
  /** iOS badge count to set. */
  badge?: number;
  /** Android notification channel id. */
  channelId?: string;
}

/** The on-the-wire Expo message shape. */
interface ExpoMessage {
  to: string;
  title?: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: 'default' | null;
  badge?: number;
  channelId?: string;
  priority?: 'default' | 'normal' | 'high';
}

interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

export interface PushDispatchResult {
  /** How many devices were eligible before sending. */
  targeted: number;
  /** Tickets Expo accepted. */
  ok: number;
  /** Tickets Expo rejected. */
  failed: number;
  /** Tokens pruned because Expo said the device is no longer registered. */
  pruned: number;
  /** Set when push could not run at all (e.g. network error). */
  error?: string;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Send already-built Expo messages. Returns the parallel array of tickets
 * (one per message, in order). Throws only on a total transport failure.
 */
export async function sendExpoMessages(messages: ExpoMessage[]): Promise<ExpoTicket[]> {
  if (messages.length === 0) return [];
  const accessToken = getSecret('EXPO_ACCESS_TOKEN');
  const tickets: ExpoTicket[] = [];

  for (const batch of chunk(messages, CHUNK_SIZE)) {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(batch),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Expo push HTTP ${res.status}: ${text.slice(0, 300)}`);
    }

    const json = (await res.json()) as { data?: ExpoTicket[]; errors?: unknown };
    if (Array.isArray(json.data)) {
      tickets.push(...json.data);
    } else {
      // Defensive: if Expo returns an unexpected shape, mark the batch errored.
      for (let i = 0; i < batch.length; i++) tickets.push({ status: 'error', message: 'malformed Expo response' });
    }
  }

  return tickets;
}

/**
 * Fan a notification out to every eligible device, honoring per-category
 * opt-outs, then prune tokens Expo reports as dead.
 */
export async function pushNotify(notification: PushNotification): Promise<PushDispatchResult> {
  const tokens = getEligibleTokens(notification.category);
  if (tokens.length === 0) {
    return { targeted: 0, ok: 0, failed: 0, pruned: 0 };
  }

  const messages: ExpoMessage[] = tokens.map((to) => ({
    to,
    title: notification.title,
    body: notification.body,
    data: notification.data,
    sound: notification.sound === undefined ? 'default' : notification.sound,
    badge: notification.badge,
    channelId: notification.channelId,
    priority: 'high',
  }));

  let tickets: ExpoTicket[];
  try {
    tickets = await sendExpoMessages(messages);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ err: message }, 'push: Expo dispatch failed');
    return { targeted: tokens.length, ok: 0, failed: tokens.length, pruned: 0, error: message };
  }

  let ok = 0;
  let failed = 0;
  const dead: string[] = [];
  tickets.forEach((ticket, i) => {
    if (ticket.status === 'ok') {
      ok++;
      return;
    }
    failed++;
    const reason = ticket.details?.error;
    // DeviceNotRegistered / InvalidCredentials(token) → the token is dead, drop it.
    if (reason === 'DeviceNotRegistered' && tokens[i]) dead.push(tokens[i]);
  });

  for (const token of dead) removeDevice(token);
  touchDevices(tokens.filter((t) => !dead.includes(t)));

  if (failed > 0) {
    logger.warn({ ok, failed, pruned: dead.length }, 'push: some Expo tickets failed');
  }

  return { targeted: tokens.length, ok, failed, pruned: dead.length };
}
