/**
 * WebSocket streaming client for the WildClaude ws-chat gateway.
 *
 * Manages a single persistent WS connection per active server profile and
 * multiplexes concurrent turns over it via the `id` correlation field, so the
 * same connection can stream more than one reply at once.
 *
 * Resilience: connecting uses bounded exponential backoff with jitter, an
 * unexpected close auto-reconnects (warming the socket for the next send), and
 * send() ensures a live connection and retries once if the socket drops between
 * the readiness check and the write. A turn that is in-flight when the socket
 * closes is failed via onError — mid-stream resume isn't possible, the caller
 * decides whether to resend.
 *
 * Auth: `?token=` in the URL, matched against DASHBOARD_TOKEN by the gateway
 * (src/ws-chat.ts). The ws-chat server accepts the token only (no HMAC ticket,
 * unlike the dashboard SSE routes); this runs over the user's LAN/VPN.
 *
 * Protocol (src/ws-chat.ts):
 *   send  { type:'chat',   id, text, sessionId?, model? }
 *         { type:'cancel', id, sessionId }
 *         { type:'ping' }
 *   recv  { type:'ready'|'accepted'|'token'|'progress'|'done'|'error'|'pong'|'cancelled', id?, ... }
 */

import { useServers } from '@/store/servers';

// ── Types ──────────────────────────────────────────────────────────────

export interface ChatUsage {
  inputTokens: number;
  outputTokens: number;
  totalCostUsd: number;
}

export type WsChatFrame =
  | { type: 'ready'; sessionId: string; protocol: string }
  | { type: 'accepted'; id?: string; sessionId: string }
  | { type: 'token'; id?: string; sessionId: string; delta: string }
  | { type: 'progress'; id?: string; sessionId: string; kind: string; description: string }
  | { type: 'done'; id?: string; sessionId: string; text: string; aborted: boolean; usage?: ChatUsage | null }
  | { type: 'error'; id?: string; sessionId?: string; message: string }
  | { type: 'pong' }
  | { type: 'cancelled'; id?: string; sessionId: string; noop?: boolean };

export interface StreamCallbacks {
  onToken?: (delta: string) => void;
  onProgress?: (kind: string, description: string) => void;
  onDone?: (text: string, usage: ChatUsage | null) => void;
  onError?: (message: string) => void;
}

// ── Backoff ────────────────────────────────────────────────────────────

const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 15_000;
const CONNECT_TIMEOUT_MS = 10_000;
const SEND_CONNECT_TRIES = 4;
const WS_GATEWAY_PORT = '3142';

/** Exponential backoff with ±20% jitter, capped. */
function backoffMs(attempt: number): number {
  const base = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt);
  const jitter = base * 0.2 * (Math.random() * 2 - 1);
  return Math.max(BASE_BACKOFF_MS, Math.round(base + jitter));
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ── Connection ──────────────────────────────────────────────────────────

type PendingTurn = StreamCallbacks & { accumulated: string };

class WsChatConnection {
  private ws: WebSocket | null = null;
  private pending = new Map<string, PendingTurn>();
  private connectPromise: Promise<void> | null = null;
  private sessionId: string | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private dead = false;
  /** Consecutive failed connect attempts; reset to 0 on a `ready` frame. */
  private attempts = 0;
  private url: string;
  private token: string;

  constructor(url: string, token: string) {
    this.url = url;
    this.token = token;
  }

  private buildWsUrl(): string {
    const u = new URL(this.url);
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    u.port = WS_GATEWAY_PORT;
    u.pathname = '/';
    u.searchParams.set('token', this.token);
    return u.toString();
  }

  private isOpen(): boolean {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN && !!this.sessionId;
  }

  connect(): Promise<void> {
    if (this.connectPromise) return this.connectPromise;
    if (this.dead) return Promise.reject(new Error('connection disposed'));

    this.connectPromise = new Promise<void>((resolve, reject) => {
      let settled = false;
      let ws: WebSocket;
      try {
        ws = new WebSocket(this.buildWsUrl());
      } catch (err) {
        this.connectPromise = null;
        reject(err instanceof Error ? err : new Error('WS construct failed'));
        return;
      }
      this.ws = ws;

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.connectPromise = null;
        try { ws.close(); } catch {}
        reject(new Error('WS connect timeout'));
      }, CONNECT_TIMEOUT_MS);

      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (err) {
          this.connectPromise = null;
          reject(err);
        } else {
          resolve();
        }
      };

      ws.onmessage = (ev) => {
        let frame: WsChatFrame;
        try { frame = JSON.parse(ev.data as string) as WsChatFrame; } catch { return; }

        if (frame.type === 'ready') {
          this.sessionId = frame.sessionId;
          this.attempts = 0; // healthy connection — reset backoff
          finish();
          return;
        }

        this.dispatch(frame);
      };

      ws.onclose = () => {
        clearTimeout(timeout);
        const wasThis = this.ws === ws;
        if (wasThis) {
          this.ws = null;
          this.connectPromise = null;
          this.sessionId = null;
        }
        // Fail any in-flight turns — they can't resume across a reconnect.
        if (this.pending.size) {
          for (const [id, turn] of this.pending) {
            turn.onError?.('Connection closed');
            this.pending.delete(id);
          }
        }
        finish(new Error('WS closed before ready'));
        if (wasThis && !this.dead) this.scheduleReconnect();
      };

      ws.onerror = () => {
        // onclose follows and handles cleanup + reconnect; just settle the
        // connect promise so awaiters don't hang.
        finish(new Error('WS connection error'));
        try { ws.close(); } catch {}
      };
    });

    return this.connectPromise;
  }

  /** Route a non-`ready` frame to the turn that owns its `id`. */
  private dispatch(frame: WsChatFrame): void {
    if (frame.type === 'pong') return;
    const id = (frame as { id?: string }).id;
    if (!id) return;
    const turn = this.pending.get(id);
    if (!turn) return;

    switch (frame.type) {
      case 'token':
        turn.accumulated += frame.delta;
        turn.onToken?.(frame.delta);
        break;
      case 'progress':
        turn.onProgress?.(frame.kind, frame.description);
        break;
      case 'done':
        this.pending.delete(id);
        turn.onDone?.(frame.text || turn.accumulated, frame.usage ?? null);
        break;
      case 'error':
        this.pending.delete(id);
        turn.onError?.(frame.message);
        break;
      case 'cancelled':
        // Turn was aborted server-side; close it out locally if still open.
        if (this.pending.delete(id)) {
          turn.onDone?.(turn.accumulated, null);
        }
        break;
    }
  }

  private scheduleReconnect(): void {
    if (this.dead || this.reconnectTimer) return;
    const delay = backoffMs(this.attempts);
    this.attempts++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      // onclose reschedules on failure, so a rejection here is fine to swallow.
      this.connect().catch(() => {});
    }, delay);
  }

  /** Ensure a live connection, retrying with backoff. */
  private async ensureConnected(): Promise<void> {
    let lastErr: unknown;
    for (let i = 0; i < SEND_CONNECT_TRIES; i++) {
      if (this.isOpen()) return;
      try {
        await this.connect();
        if (this.isOpen()) return;
      } catch (err) {
        lastErr = err;
      }
      if (i < SEND_CONNECT_TRIES - 1) await sleep(backoffMs(i));
    }
    throw lastErr instanceof Error ? lastErr : new Error('WS connect failed');
  }

  async send(text: string, callbacks: StreamCallbacks, model?: string): Promise<string> {
    await this.ensureConnected();

    const id = genTurnId();
    this.pending.set(id, { ...callbacks, accumulated: '' });
    const payload = JSON.stringify({
      type: 'chat',
      id,
      text,
      sessionId: this.sessionId ?? undefined,
      model,
    });

    try {
      this.ws!.send(payload);
    } catch {
      // Socket dropped between the check and the write — reconnect once and retry.
      try {
        await this.ensureConnected();
        this.ws!.send(payload);
      } catch (err) {
        this.pending.delete(id);
        throw err instanceof Error ? err : new Error('WS send failed');
      }
    }
    return id;
  }

  cancel(turnId: string): void {
    if (this.ws?.readyState === WebSocket.OPEN && this.sessionId) {
      try {
        this.ws.send(JSON.stringify({ type: 'cancel', id: turnId, sessionId: this.sessionId }));
      } catch {}
    }
    this.pending.delete(turnId);
  }

  dispose(): void {
    this.dead = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    for (const [id, turn] of this.pending) {
      turn.onError?.('Connection disposed');
      this.pending.delete(id);
    }
    try { this.ws?.close(); } catch {}
    this.ws = null;
    this.connectPromise = null;
    this.sessionId = null;
  }
}

function genTurnId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ── Singleton per server profile ────────────────────────────────────────

const connections = new Map<string, WsChatConnection>();

function getConnection(): WsChatConnection {
  const profile = useServers.getState().active();
  if (!profile) throw new Error('No active server');
  const existing = connections.get(profile.id);
  if (existing) return existing;
  const conn = new WsChatConnection(profile.url, profile.token);
  connections.set(profile.id, conn);
  return conn;
}

export function disposeConnection(serverId: string): void {
  const conn = connections.get(serverId);
  if (conn) {
    conn.dispose();
    connections.delete(serverId);
  }
}

/** Tear down every connection (e.g. on sign-out / app background). */
export function disposeAllConnections(): void {
  for (const [id, conn] of connections) {
    conn.dispose();
    connections.delete(id);
  }
}

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Stream a chat turn. Resolves with the turn id (use it to cancel) once the
 * message is on the wire; reply frames arrive via the callbacks. Rejects only
 * if the connection could not be established after retries.
 */
export async function streamChat(
  text: string,
  callbacks: StreamCallbacks,
  model?: string,
): Promise<string> {
  const conn = getConnection();
  return conn.send(text, callbacks, model);
}

export function cancelTurn(turnId: string): void {
  try {
    getConnection().cancel(turnId);
  } catch {
    /* no active server — nothing to cancel */
  }
}
