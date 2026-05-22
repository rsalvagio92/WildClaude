/**
 * WebSocket ACP transport — same handlers as the stdio server, different wire.
 *
 * Why hand-rolled WS instead of `ws`? Keep the dep list lean. WebSocket framing
 * for text frames is ~80 lines; the spec we need (RFC 6455) is small. We only
 * support text frames (JSON-RPC), no binary, no extensions, no compression.
 *
 * Auth: query string `?token=...` matched against DASHBOARD_TOKEN. Single
 * shared token because this runs on your personal LAN/VPN.
 *
 * Enabled by setting ACP_WS_PORT=3142 (default off).
 */

import http from 'http';
import crypto from 'crypto';
import { randomUUID } from 'crypto';

import { DASHBOARD_TOKEN } from '../config.js';
import { logger } from '../logger.js';
import { runAgent } from '../agent.js';

const PORT = parseInt(process.env.ACP_WS_PORT ?? '0', 10);
const WS_MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

interface Session {
  sessionId: string;
  claudeSessionId?: string;
  abort?: AbortController;
}
const sessions = new Map<string, Session>();

// ── Minimal WS framing ──────────────────────────────────────────────

function encodeFrame(payload: string): Buffer {
  const data = Buffer.from(payload, 'utf8');
  const len = data.length;
  let header: Buffer;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = len;
  } else if (len < 65_536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  header[0] = 0x81; // FIN + text frame
  return Buffer.concat([header, data]);
}

function decodeFrame(buf: Buffer): { payload: string; rest: Buffer } | null {
  if (buf.length < 2) return null;
  const b1 = buf[1];
  const masked = (b1 & 0x80) === 0x80;
  let len = b1 & 0x7f;
  let offset = 2;
  if (len === 126) {
    if (buf.length < 4) return null;
    len = buf.readUInt16BE(2);
    offset = 4;
  } else if (len === 127) {
    if (buf.length < 10) return null;
    len = Number(buf.readBigUInt64BE(2));
    offset = 10;
  }
  let mask: Buffer | null = null;
  if (masked) {
    if (buf.length < offset + 4) return null;
    mask = buf.subarray(offset, offset + 4);
    offset += 4;
  }
  if (buf.length < offset + len) return null;
  const data = Buffer.from(buf.subarray(offset, offset + len));
  if (mask) {
    for (let i = 0; i < data.length; i++) data[i] ^= mask[i % 4];
  }
  return { payload: data.toString('utf8'), rest: buf.subarray(offset + len) };
}

// ── RPC ──────────────────────────────────────────────────────────────

interface RpcRequest { jsonrpc: '2.0'; id?: number | string | null; method: string; params?: Record<string, unknown> }

async function dispatch(req: RpcRequest, send: (s: string) => void): Promise<void> {
  const id = req.id ?? null;
  const reply = (result: unknown) => send(JSON.stringify({ jsonrpc: '2.0', id, result }));
  const err = (code: number, message: string) => send(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }));
  const notify = (method: string, params: Record<string, unknown>) => send(JSON.stringify({ jsonrpc: '2.0', method, params }));

  try {
    if (req.method === 'initialize') {
      reply({
        protocolVersion: '0.1',
        serverInfo: { name: 'wildclaude-acp-ws', version: '0.1.0' },
        capabilities: { session: { prompt: true, cancel: true }, streaming: true },
      });
      return;
    }
    if (req.method === 'session/new') {
      const sid = randomUUID();
      sessions.set(sid, { sessionId: sid });
      reply({ sessionId: sid });
      return;
    }
    if (req.method === 'session/prompt') {
      const sid = req.params?.['sessionId'] as string;
      const prompt = req.params?.['prompt'] as string;
      const model = req.params?.['model'] as string | undefined;
      if (!sid || !prompt) return err(-32602, 'sessionId and prompt required');
      const s = sessions.get(sid) ?? { sessionId: sid };
      sessions.set(sid, s);
      if (s.abort) s.abort.abort();
      const abort = new AbortController();
      s.abort = abort;
      const result = await runAgent(
        prompt,
        s.claudeSessionId,
        () => {},
        (ev) => notify('session/progress', { sessionId: sid, kind: ev.type, description: ev.description }),
        model,
        abort,
        (text) => notify('session/text', { sessionId: sid, text }),
      );
      if (result.newSessionId) s.claudeSessionId = result.newSessionId;
      s.abort = undefined;
      reply({ text: result.text ?? '', sessionId: sid, aborted: !!result.aborted });
      return;
    }
    if (req.method === 'session/cancel') {
      const sid = req.params?.['sessionId'] as string;
      const s = sessions.get(sid);
      if (s?.abort) { s.abort.abort(); reply({ cancelled: true }); }
      else reply({ cancelled: false });
      return;
    }
    err(-32601, `Method not found: ${req.method}`);
  } catch (e) {
    err(-32603, e instanceof Error ? e.message : String(e));
  }
}

// ── Server ───────────────────────────────────────────────────────────

export function startAcpWebSocketServer(): void {
  if (!PORT) {
    logger.info('ACP WebSocket transport disabled. Set ACP_WS_PORT to enable.');
    return;
  }

  const server = http.createServer((req, res) => {
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
    if (!key) { socket.destroy(); return; }
    const accept = crypto.createHash('sha1').update(key + WS_MAGIC).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );

    const send = (s: string) => socket.write(encodeFrame(s));

    let buf: Buffer = Buffer.alloc(0);
    socket.on('data', async (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      while (true) {
        const frame = decodeFrame(buf);
        if (!frame) break;
        buf = Buffer.from(frame.rest);
        try {
          const req = JSON.parse(frame.payload) as RpcRequest;
          dispatch(req, send).catch((err) => {
            logger.warn({ err }, 'acp-ws: dispatch error');
          });
        } catch {
          send(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }));
        }
      }
    });
    socket.on('error', () => socket.destroy());
  });

  server.listen(PORT, () => {
    logger.info({ port: PORT }, 'ACP WebSocket server listening');
  });
}
