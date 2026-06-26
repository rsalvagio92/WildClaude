import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import net from 'net';
import crypto from 'crypto';

// ── Mocks ────────────────────────────────────────────────────────────
// Mock the agent engine so we exercise the gateway plumbing, not the CLI.
const runAgentMock = vi.fn();
vi.mock('./agent.js', () => ({ runAgent: (...args: unknown[]) => runAgentMock(...args) }));
vi.mock('./config.js', () => ({ DASHBOARD_TOKEN: 'test-token' }));
vi.mock('./logger.js', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));

const TEST_PORT = 39187;

// decodeFrame handles both masked and unmasked frames — reuse it for the
// server→client direction (server sends unmasked).
let decodeFrame: (buf: Buffer) => { payload: string; rest: Buffer } | null;

beforeAll(async () => {
  process.env.WS_CHAT_PORT = String(TEST_PORT);
  ({ decodeFrame } = await import('./acp/ws-server.js'));
  const mod = await import('./ws-chat.js');
  mod.startWsChatServer();
  // Give the listener a tick to bind.
  await new Promise((r) => setTimeout(r, 200));
});

afterAll(() => {
  delete process.env.WS_CHAT_PORT;
});

// Client→server frames MUST be masked per RFC 6455.
function clientFrame(payload: string): Buffer {
  const data = Buffer.from(payload, 'utf8');
  const len = data.length;
  let header: Buffer;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = 0x80 | len;
  } else if (len < 65_536) {
    header = Buffer.alloc(4);
    header[1] = 0x80 | 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  header[0] = 0x81; // FIN + text
  const mask = crypto.randomBytes(4);
  const masked = Buffer.from(data);
  for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i % 4];
  return Buffer.concat([header, mask, masked]);
}

/** Open a WS connection, send `messages`, collect frames until `done`/timeout. */
function chatRoundtrip(messages: object[], token = 'test-token'): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(TEST_PORT, '127.0.0.1');
    const key = crypto.randomBytes(16).toString('base64');
    const frames: any[] = [];
    let handshakeDone = false;
    let buf = Buffer.alloc(0);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`timeout; got frames: ${JSON.stringify(frames)}`));
    }, 4000);

    socket.on('connect', () => {
      socket.write(
        `GET /?token=${token} HTTP/1.1\r\n` +
          'Host: localhost\r\n' +
          'Upgrade: websocket\r\n' +
          'Connection: Upgrade\r\n' +
          `Sec-WebSocket-Key: ${key}\r\n` +
          'Sec-WebSocket-Version: 13\r\n\r\n',
      );
    });

    socket.on('data', (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      if (!handshakeDone) {
        const idx = buf.indexOf('\r\n\r\n');
        if (idx === -1) return;
        const headers = buf.subarray(0, idx).toString();
        if (!headers.includes('101')) {
          clearTimeout(timer);
          socket.destroy();
          reject(new Error(`handshake failed: ${headers.split('\r\n')[0]}`));
          return;
        }
        handshakeDone = true;
        buf = buf.subarray(idx + 4);
        // Send the client messages now that we're upgraded.
        for (const m of messages) socket.write(clientFrame(JSON.stringify(m)));
      }
      while (buf.length >= 2) {
        const frame = decodeFrame(buf);
        if (!frame) break;
        buf = Buffer.from(frame.rest);
        try {
          const obj = JSON.parse(frame.payload);
          frames.push(obj);
          if (obj.type === 'done' || obj.type === 'error') {
            clearTimeout(timer);
            socket.end();
            resolve(frames);
          }
        } catch {
          /* ignore non-JSON */
        }
      }
    });

    socket.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

describe('ws-chat gateway', () => {
  it('rejects connections without a valid token', async () => {
    await expect(chatRoundtrip([{ type: 'chat', text: 'hi' }], 'wrong-token')).rejects.toThrow(/handshake failed|401/);
  });

  it('streams ready → accepted → progress → token deltas → done', async () => {
    runAgentMock.mockImplementationOnce(async (
      _message: string,
      _sessionId: string | undefined,
      _onTyping: () => void,
      onProgress: (ev: { type: string; description: string }) => void,
      _model: string | undefined,
      _abort: AbortController,
      onStreamText: (acc: string) => void,
    ) => {
      onProgress({ type: 'tool_active', description: 'Reading file' });
      onStreamText('Hello');
      onStreamText('Hello world');
      return {
        text: 'Hello world',
        newSessionId: 'claude-session-1',
        usage: { inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 0, totalCostUsd: 0 },
      };
    });

    const frames = await chatRoundtrip([{ type: 'chat', id: 'turn-1', text: 'say hi' }]);

    const ready = frames.find((f) => f.type === 'ready');
    expect(ready).toBeDefined();
    expect(ready.protocol).toBe('wildclaude-chat/1');
    expect(typeof ready.sessionId).toBe('string');

    const accepted = frames.find((f) => f.type === 'accepted');
    expect(accepted).toMatchObject({ id: 'turn-1', sessionId: ready.sessionId });

    expect(frames.find((f) => f.type === 'progress')).toMatchObject({
      kind: 'tool_active',
      description: 'Reading file',
    });

    const tokens = frames.filter((f) => f.type === 'token');
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens.map((t) => t.delta).join('')).toBe('Hello world');
    for (const t of tokens) expect(t.id).toBe('turn-1');

    const done = frames.find((f) => f.type === 'done');
    expect(done).toMatchObject({ id: 'turn-1', text: 'Hello world', aborted: false });
    expect(done.usage).toMatchObject({ inputTokens: 10, outputTokens: 5 });
  });

  it('answers ping with pong', async () => {
    // ping yields no done frame, so resolve on pong manually via a short race.
    runAgentMock.mockImplementationOnce(async () => ({ text: 'x', newSessionId: 's', usage: null }));
    const frames = await chatRoundtrip([{ type: 'ping' }, { type: 'chat', text: 'go' }]);
    expect(frames.find((f) => f.type === 'pong')).toBeDefined();
    expect(frames.find((f) => f.type === 'done')).toBeDefined();
  });

  it('errors on a chat with empty text', async () => {
    const frames = await chatRoundtrip([{ type: 'chat', id: 'e1', text: '   ' }]);
    const err = frames.find((f) => f.type === 'error');
    expect(err).toMatchObject({ id: 'e1' });
    expect(err.message).toMatch(/text is required/);
  });
});
