/**
 * WebSocket chat gateway — the mobile/web streaming front door.
 *
 * This is a thin, client-friendly layer over the same agent engine the ACP
 * transports drive (`runAgent`). Where the ACP WS server (./acp/ws-server.ts)
 * speaks raw JSON-RPC 2.0 for IDEs, this gateway speaks a small, purpose-built
 * chat protocol the WildClaude app (and the dashboard web UI) can consume
 * directly: send text, receive `token` deltas as they're generated, `progress`
 * frames for tool/sub-agent activity, and a final `done` frame.
 *
 * It REUSES the ACP machinery rather than reinventing it:
 *   - the WebSocket framing (encodeFrame/decodeFrame/WS_MAGIC) from acp/ws-server
 *   - the agent engine (runAgent) that every WildClaude surface runs through
 *   - the per-connection session model (a Claude session id for context
 *     continuity, one in-flight turn per session, abortable mid-stream)
 *
 * It is ADDITIVE: it binds its own port (WS_CHAT_PORT, default 3142) and adds
 * no breaking changes to /api/info — the dashboard advertises this gateway via
 * a new `wsChat` field that older clients simply ignore.
 *
 * ── Wire protocol (JSON text frames) ─────────────────────────────────
 *
 * Auth: query string `?token=...` matched against DASHBOARD_TOKEN, same as the
 * ACP WS transport. Single shared token (personal LAN/VPN deployment).
 *
 * Client → server:
 *   { type: 'chat',   id?, text, sessionId?, model? }  start a turn
 *   { type: 'cancel', sessionId }                      abort the in-flight turn
 *   { type: 'ping' }                                   heartbeat
 *
 * Server → client:
 *   { type: 'ready',    sessionId, protocol }                 on connect
 *   { type: 'accepted', id?, sessionId }                      turn started
 *   { type: 'token',    id?, sessionId, delta }               incremental text
 *   { type: 'progress', id?, sessionId, kind, description }   tool/sub-agent
 *   { type: 'done',     id?, sessionId, text, usage, aborted }turn finished
 *   { type: 'error',    id?, sessionId?, message }            failure
 *   { type: 'pong' }                                          heartbeat reply
 *
 * The optional `id` is a client-supplied turn correlation id, echoed on every
 * frame for that turn so a client can match a stream to its request (and so the
 * same session streaming to two clients stays unambiguous).
 *
 * Token frames carry DELTAS. runAgent's stream callback hands us the full
 * accumulated text each tick; we diff against what we've already sent so the
 * client only receives the new characters and can append blindly.
 */

import http from 'http';
import crypto from 'crypto';
import { randomUUID } from 'crypto';
import type { Socket } from 'net';

import { DASHBOARD_TOKEN } from './config.js';
import { logger } from './logger.js';
import { runAgent } from './agent.js';
import { encodeFrame, decodeFrame, WS_MAGIC } from './acp/ws-server.js';

const PROTOCOL = 'wildclaude-chat/1';

/** Resolved chat gateway port. 0 (or WS_CHAT_PORT=0) disables the gateway. */
export const WS_CHAT_PORT = parseInt(process.env.WS_CHAT_PORT ?? '3142', 10);

/** Discovery info surfaced (additively) on /api/info for clients. */
export function wsChatInfo(): {
  enabled: boolean;
  port: number;
  path: string;
  protocol: string;
} {
  return {
    enabled: WS_CHAT_PORT > 0,
    port: WS_CHAT_PORT,
    path: '/',
    protocol: PROTOCOL,
  };
}

// ── Per-connection session state ─────────────────────────────────────

interface ChatSession {
  /** Stable id the client uses to address this conversation. */
  sessionId: string;
  /** Last Claude session id, for context continuity across turns. */
  claudeSessionId?: string;
  /** AbortController for the in-flight turn, if any. */
  abort?: AbortController;
}

interface ChatRequest {
  type?: string;
  id?: string | number | null;
  text?: string;
  sessionId?: string;
  model?: string;
}

// ── Per-connection handler ───────────────────────────────────────────

function handleConnection(socket: Socket): void {
  const sessions = new Map<string, ChatSession>();
  const send = (obj: unknown) => {
    if (socket.writable) socket.write(encodeFrame(JSON.stringify(obj)));
  };

  // Every connection gets a default session so a client can send `chat`
  // without first allocating one.
  const defaultSessionId = randomUUID();
  sessions.set(defaultSessionId, { sessionId: defaultSessionId });
  send({ type: 'ready', sessionId: defaultSessionId, protocol: PROTOCOL });

  async function runTurn(req: ChatRequest): Promise<void> {
    const turnId = req.id ?? null;
    const text = typeof req.text === 'string' ? req.text : '';
    if (!text.trim()) {
      send({ type: 'error', id: turnId, message: 'text is required' });
      return;
    }

    const sessionId = (typeof req.sessionId === 'string' && req.sessionId) || defaultSessionId;
    let session = sessions.get(sessionId);
    if (!session) {
      session = { sessionId };
      sessions.set(sessionId, session);
    }

    // One in-flight turn per session: abort any previous before starting.
    if (session.abort) session.abort.abort();
    const abort = new AbortController();
    session.abort = abort;

    send({ type: 'accepted', id: turnId, sessionId });

    // Diff accumulated text into deltas so the client can append blindly.
    let sentLen = 0;

    try {
      const result = await runAgent(
        text,
        session.claudeSessionId,
        () => {}, // no typing indicator over WS — token frames are the signal
        (ev) => send({ type: 'progress', id: turnId, sessionId, kind: ev.type, description: ev.description }),
        req.model,
        abort,
        (accumulated) => {
          if (accumulated.length <= sentLen) return;
          const delta = accumulated.slice(sentLen);
          sentLen = accumulated.length;
          send({ type: 'token', id: turnId, sessionId, delta });
        },
      );

      if (result.newSessionId) session.claudeSessionId = result.newSessionId;

      // Flush any tail the stream callback didn't deliver (e.g. when the final
      // text arrives only in the result, not via incremental callbacks).
      const finalText = result.text ?? '';
      if (!result.aborted && finalText.length > sentLen) {
        send({ type: 'token', id: turnId, sessionId, delta: finalText.slice(sentLen) });
      }

      send({
        type: 'done',
        id: turnId,
        sessionId,
        text: finalText,
        aborted: !!result.aborted,
        usage: result.usage
          ? {
              inputTokens: result.usage.inputTokens,
              outputTokens: result.usage.outputTokens,
              cacheReadInputTokens: result.usage.cacheReadInputTokens,
              totalCostUsd: result.usage.totalCostUsd,
            }
          : null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ err: message, sessionId }, 'ws-chat: turn failed');
      send({ type: 'error', id: turnId, sessionId, message });
    } finally {
      // Only clear if still ours — a newer turn may have replaced it.
      if (session.abort === abort) session.abort = undefined;
    }
  }

  function dispatch(raw: string): void {
    let req: ChatRequest;
    try {
      req = JSON.parse(raw) as ChatRequest;
    } catch {
      send({ type: 'error', message: 'invalid JSON' });
      return;
    }

    switch (req.type) {
      case 'chat':
        // Fire-and-forget; runTurn streams its own frames and handles errors.
        void runTurn(req);
        return;
      case 'cancel': {
        const sid = (typeof req.sessionId === 'string' && req.sessionId) || defaultSessionId;
        const s = sessions.get(sid);
        if (s?.abort) {
          s.abort.abort();
          send({ type: 'cancelled', id: req.id ?? null, sessionId: sid });
        } else {
          send({ type: 'cancelled', id: req.id ?? null, sessionId: sid, noop: true });
        }
        return;
      }
      case 'ping':
        send({ type: 'pong' });
        return;
      default:
        send({ type: 'error', id: req.id ?? null, message: `unknown message type: ${req.type ?? '(none)'}` });
    }
  }

  // ── Frame loop ─────────────────────────────────────────────────────
  let buf: Buffer = Buffer.alloc(0);
  socket.on('data', (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 2) {
      // Peek the opcode before decoding so we can honor control frames.
      const opcode = buf[0] & 0x0f;
      if (opcode === 0x8) {
        // Close frame — abort everything and hang up.
        for (const s of sessions.values()) s.abort?.abort();
        socket.end();
        return;
      }
      const frame = decodeFrame(buf);
      if (!frame) break; // need more bytes
      buf = Buffer.from(frame.rest);
      // opcode 0x9 (ping) / 0xA (pong) carry no JSON we act on — skip them.
      if (opcode === 0x1 || opcode === 0x0) {
        dispatch(frame.payload);
      }
    }
  });

  const cleanup = () => {
    for (const s of sessions.values()) s.abort?.abort();
    sessions.clear();
  };
  socket.on('close', cleanup);
  socket.on('error', () => {
    cleanup();
    socket.destroy();
  });
}

// ── Server ───────────────────────────────────────────────────────────

export function startWsChatServer(): void {
  if (!WS_CHAT_PORT) {
    logger.info('WS chat gateway disabled (WS_CHAT_PORT=0).');
    return;
  }
  if (!DASHBOARD_TOKEN) {
    // No token means every upgrade would be rejected — start anyway and warn,
    // so setting the token later (it's read live per connection) just works.
    logger.warn('WS chat gateway: DASHBOARD_TOKEN is unset — connections will be rejected until it is set.');
  }

  const server = http.createServer((_req, res) => {
    res.writeHead(426, { 'Content-Type': 'text/plain' });
    res.end('Upgrade Required\n');
  });

  server.on('upgrade', (req, socket) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const token = url.searchParams.get('token');
    if (!DASHBOARD_TOKEN || token !== DASHBOARD_TOKEN) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    const key = req.headers['sec-websocket-key'];
    if (!key) {
      socket.destroy();
      return;
    }
    const accept = crypto.createHash('sha1').update(key + WS_MAGIC).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    handleConnection(socket as Socket);
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      logger.warn({ port: WS_CHAT_PORT }, 'WS chat gateway: port in use — gateway not started');
    } else {
      logger.warn({ err: err.message }, 'WS chat gateway: server error');
    }
  });

  server.listen(WS_CHAT_PORT, () => {
    logger.info({ port: WS_CHAT_PORT, protocol: PROTOCOL }, 'WS chat gateway listening');
  });
}
