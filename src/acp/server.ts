/**
 * Agent Client Protocol (ACP) stdio server for WildClaude.
 *
 * The protocol used by Zed, Cursor, and other IDEs to talk to AI agents.
 * Wire format is JSON-RPC 2.0 over stdin/stdout — same shape as MCP, different
 * method namespace.
 *
 * This is a MINIMAL implementation: the handful of methods that real ACP clients
 * actually call. The ACP spec is still evolving; we implement the stable subset
 * and respond to unknown methods with -32601 so future-version clients fail loud
 * rather than silently misbehaving.
 *
 * Implemented methods:
 *   initialize                — capability handshake
 *   authenticate              — no-op (returns ok) — auth is the calling user
 *   session/new               — open a new agent session, returns sessionId
 *   session/prompt            — run runAgent() against the session, stream text
 *   session/cancel            — abort the in-flight prompt
 *
 * Invocation (from an IDE's ACP config):
 *   {
 *     "command": "node",
 *     "args": ["dist/acp/server.js"]
 *   }
 *
 * Output discipline: only JSON-RPC frames go to stdout. Logs go to stderr.
 */

import readline from 'readline';
import { randomUUID } from 'crypto';

import { runAgent } from '../agent.js';
import { logger } from '../logger.js';
import { ensureUserDataDirs } from '../paths.js';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

// ── Session state ────────────────────────────────────────────────────

interface AcpSession {
  sessionId: string;
  /** Last claude session id for context continuity. */
  claudeSessionId?: string;
  abortController?: AbortController;
}

const sessions = new Map<string, AcpSession>();

// ── Transport ────────────────────────────────────────────────────────

function send(msg: JsonRpcResponse | JsonRpcNotification): void {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function reply(id: number | string | null, result: unknown): void {
  send({ jsonrpc: '2.0', id, result });
}

function replyError(id: number | string | null, code: number, message: string, data?: unknown): void {
  send({ jsonrpc: '2.0', id, error: { code, message, ...(data !== undefined ? { data } : {}) } });
}

function notify(method: string, params?: Record<string, unknown>): void {
  send({ jsonrpc: '2.0', method, params });
}

// ── Method handlers ──────────────────────────────────────────────────

async function handleInitialize(_params: Record<string, unknown> | undefined): Promise<unknown> {
  return {
    protocolVersion: '0.1',
    serverInfo: {
      name: 'wildclaude-acp',
      version: '0.1.0',
    },
    capabilities: {
      session: { prompt: true, cancel: true },
      streaming: true,
    },
  };
}

async function handleAuthenticate(_params: Record<string, unknown> | undefined): Promise<unknown> {
  return { authenticated: true };
}

async function handleSessionNew(_params: Record<string, unknown> | undefined): Promise<unknown> {
  const sessionId = randomUUID();
  sessions.set(sessionId, { sessionId });
  return { sessionId };
}

async function handleSessionPrompt(
  requestId: number | string | null,
  params: Record<string, unknown> | undefined,
): Promise<unknown> {
  const sessionId = params?.['sessionId'] as string | undefined;
  const prompt = params?.['prompt'] as string | undefined;
  const model = params?.['model'] as string | undefined;
  if (!sessionId || !prompt) {
    throw new RpcError(-32602, 'sessionId and prompt are required');
  }
  let session = sessions.get(sessionId);
  if (!session) {
    // ACP clients sometimes call session/prompt with a fresh id — treat as implicit new.
    session = { sessionId };
    sessions.set(sessionId, session);
  }

  // Abort any in-flight prompt for this session
  if (session.abortController) session.abortController.abort();
  const abortController = new AbortController();
  session.abortController = abortController;

  const result = await runAgent(
    prompt,
    session.claudeSessionId,
    () => {}, // no typing indicator in ACP
    (event) => {
      // forward tool/sub-agent events as progress notifications
      notify('session/progress', {
        sessionId,
        requestId,
        kind: event.type,
        description: event.description,
      });
    },
    model,
    abortController,
    (accumulatedText) => {
      // text streaming notifications — the IDE will render these progressively
      notify('session/text', {
        sessionId,
        requestId,
        text: accumulatedText,
      });
    },
  );

  if (result.newSessionId) session.claudeSessionId = result.newSessionId;
  session.abortController = undefined;

  if (result.aborted) {
    return { text: null, aborted: true };
  }

  return {
    text: result.text ?? '',
    sessionId,
    usage: result.usage ? {
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      cacheReadInputTokens: result.usage.cacheReadInputTokens,
      totalCostUsd: result.usage.totalCostUsd,
    } : null,
  };
}

async function handleSessionCancel(params: Record<string, unknown> | undefined): Promise<unknown> {
  const sessionId = params?.['sessionId'] as string | undefined;
  if (!sessionId) throw new RpcError(-32602, 'sessionId required');
  const session = sessions.get(sessionId);
  if (session?.abortController) {
    session.abortController.abort();
    return { cancelled: true };
  }
  return { cancelled: false };
}

class RpcError extends Error {
  code: number;
  data?: unknown;
  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.code = code;
    this.data = data;
  }
}

// ── Dispatcher ───────────────────────────────────────────────────────

async function dispatch(req: JsonRpcRequest): Promise<void> {
  const id = req.id ?? null;
  try {
    switch (req.method) {
      case 'initialize':
        reply(id, await handleInitialize(req.params));
        return;
      case 'initialized':
      case 'notifications/initialized':
        return; // notification, no response
      case 'authenticate':
        reply(id, await handleAuthenticate(req.params));
        return;
      case 'session/new':
        reply(id, await handleSessionNew(req.params));
        return;
      case 'session/prompt':
        reply(id, await handleSessionPrompt(id, req.params));
        return;
      case 'session/cancel':
        reply(id, await handleSessionCancel(req.params));
        return;
      case 'shutdown':
        reply(id, null);
        setTimeout(() => process.exit(0), 50);
        return;
      default:
        replyError(id, -32601, `Method not found: ${req.method}`);
    }
  } catch (err) {
    if (err instanceof RpcError) {
      replyError(id, err.code, err.message, err.data);
    } else {
      const msg = err instanceof Error ? err.message : String(err);
      replyError(id, -32603, msg);
      logger.warn({ err, method: req.method }, 'ACP: handler error');
    }
  }
}

// ── Entry point ──────────────────────────────────────────────────────

export function runStdioServer(): void {
  ensureUserDataDirs();
  const rl = readline.createInterface({ input: process.stdin });

  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let req: JsonRpcRequest;
    try {
      req = JSON.parse(trimmed) as JsonRpcRequest;
    } catch (err) {
      replyError(null, -32700, `Parse error: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    // fire-and-forget; dispatch handles its own replies + errors
    dispatch(req).catch((err) => {
      logger.warn({ err }, 'ACP: dispatch unhandled');
    });
  });

  rl.on('close', () => process.exit(0));

  // Polite shutdown on SIGINT/SIGTERM
  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));
}
