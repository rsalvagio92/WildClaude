#!/usr/bin/env node
/**
 * MCP stdio server exposing the `execute_code` tool.
 *
 * Speaks JSON-RPC 2.0 over stdin/stdout, the standard MCP transport.
 *
 * Register in .mcp.json:
 *   {
 *     "mcpServers": {
 *       "execute_code": {
 *         "command": "node",
 *         "args": ["dist/tools/execute-code-mcp.js"]
 *       }
 *     }
 *   }
 *
 * The Claude CLI will then expose this tool as `mcp__execute_code__run` to the
 * model. The model is told it can run a JS snippet with a `wc` helper to read,
 * write, exec, and log. Cost: one inference call replaces N tool round-trips.
 *
 * Sandbox: the MCP server itself runs in a local-scratch sandbox (or docker if
 * SANDBOX_DEFAULT=docker). This keeps execute_code from touching the host
 * filesystem outside USER_DATA_DIR/sandboxes/.
 */

import readline from 'readline';

import { runSnippet } from './execute-code.js';
import { createSandbox } from '../sandbox/index.js';
import { ensureUserDataDirs } from '../paths.js';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
}

const TOOL_DEFINITION = {
  name: 'run',
  description:
    'Execute a short JavaScript snippet that can call WildClaude tools through ' +
    'the injected `wc` global. Use this to collapse multi-step plans (read file, ' +
    'edit, exec command) into a single tool call. ' +
    'Available: wc.read(p), wc.write(p, content), wc.exists(p), ' +
    'wc.exec(cmd) → {stdout,stderr,exitCode}, wc.log(...), wc.workspace. ' +
    'Snippet is awaited; use top-level await freely.',
  inputSchema: {
    type: 'object',
    properties: {
      snippet: { type: 'string', description: 'The JavaScript snippet to run.' },
      timeoutMs: { type: 'number', description: 'Optional per-snippet timeout (ms). Default 30000.' },
    },
    required: ['snippet'],
  },
};

function reply(res: JsonRpcResponse): void {
  process.stdout.write(JSON.stringify(res) + '\n');
}

async function handleRequest(req: JsonRpcRequest): Promise<JsonRpcResponse | null> {
  if (req.method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'wildclaude-execute-code', version: '0.1.0' },
      },
    };
  }

  if (req.method === 'notifications/initialized') {
    return null; // notification, no response
  }

  if (req.method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: { tools: [TOOL_DEFINITION] },
    };
  }

  if (req.method === 'tools/call') {
    const params = req.params as { name?: string; arguments?: Record<string, unknown> } | undefined;
    if (params?.name !== TOOL_DEFINITION.name) {
      return {
        jsonrpc: '2.0',
        id: req.id,
        error: { code: -32601, message: `Unknown tool: ${params?.name}` },
      };
    }
    const args = (params.arguments ?? {}) as { snippet?: string; timeoutMs?: number };
    if (typeof args.snippet !== 'string' || !args.snippet.trim()) {
      return {
        jsonrpc: '2.0',
        id: req.id,
        error: { code: -32602, message: 'snippet is required (non-empty string)' },
      };
    }

    // Each call gets a fresh sandbox so failures don't pollute the next call.
    const sandbox = await createSandbox(undefined, { label: 'execute_code' });
    try {
      const r = await runSnippet(args.snippet, {
        sandbox,
        timeoutMs: args.timeoutMs,
      });

      const payload = [
        r.ok ? 'OK' : 'ERROR',
        r.error ? `Error: ${r.error}` : '',
        r.stdout ? `--- stdout ---\n${r.stdout}` : '',
        r.stderr ? `--- stderr ---\n${r.stderr}` : '',
        r.value !== undefined && r.value !== null
          ? `--- value ---\n${typeof r.value === 'string' ? r.value : JSON.stringify(r.value, null, 2)}`
          : '',
        `--- meta ---\nduration: ${r.durationMs}ms, sandbox: ${sandbox.kind}`,
      ]
        .filter(Boolean)
        .join('\n');

      return {
        jsonrpc: '2.0',
        id: req.id,
        result: {
          content: [{ type: 'text', text: payload }],
          isError: !r.ok,
        },
      };
    } finally {
      await sandbox.dispose().catch(() => {});
    }
  }

  return {
    jsonrpc: '2.0',
    id: req.id,
    error: { code: -32601, message: `Method not found: ${req.method}` },
  };
}

async function main(): Promise<void> {
  ensureUserDataDirs();
  const rl = readline.createInterface({ input: process.stdin });

  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let req: JsonRpcRequest;
    try {
      req = JSON.parse(trimmed) as JsonRpcRequest;
    } catch (err) {
      reply({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: `Parse error: ${err instanceof Error ? err.message : String(err)}` },
      });
      return;
    }
    try {
      const res = await handleRequest(req);
      if (res !== null) reply(res);
    } catch (err) {
      reply({
        jsonrpc: '2.0',
        id: req.id,
        error: { code: -32603, message: err instanceof Error ? err.message : String(err) },
      });
    }
  });

  rl.on('close', () => process.exit(0));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('execute-code-mcp fatal:', err);
  process.exit(1);
});
