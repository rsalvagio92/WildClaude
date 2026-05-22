/**
 * Tiny JSON-RPC 2.0 stdio server helper for building MCP tools.
 *
 * Each tool file defines its name + tools list + handlers, then calls
 * `serveStdio(...)` from its CLI entry point. The protocol minimum
 * (initialize, tools/list, tools/call) is implemented here.
 */

import readline from 'readline';

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<{ text: string; isError?: boolean }>;
}

export interface ServerInfo {
  name: string;
  version: string;
  tools: McpTool[];
}

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
  error?: { code: number; message: string };
}

function send(msg: JsonRpcResponse): void {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

export function serveStdio(server: ServerInfo): void {
  const rl = readline.createInterface({ input: process.stdin });

  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let req: JsonRpcRequest;
    try { req = JSON.parse(trimmed); }
    catch (err) {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: `Parse error: ${err instanceof Error ? err.message : String(err)}` } });
      return;
    }
    const id = req.id ?? null;

    if (req.method === 'initialize') {
      send({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: server.name, version: server.version },
        },
      });
      return;
    }
    if (req.method === 'notifications/initialized') return;

    if (req.method === 'tools/list') {
      send({
        jsonrpc: '2.0',
        id,
        result: {
          tools: server.tools.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
        },
      });
      return;
    }

    if (req.method === 'tools/call') {
      const params = req.params as { name?: string; arguments?: Record<string, unknown> } | undefined;
      const tool = server.tools.find((t) => t.name === params?.name);
      if (!tool) {
        send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown tool: ${params?.name}` } });
        return;
      }
      try {
        const r = await tool.handler(params!.arguments ?? {});
        send({
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: r.text }],
            isError: !!r.isError,
          },
        });
      } catch (err) {
        send({
          jsonrpc: '2.0',
          id,
          error: { code: -32603, message: err instanceof Error ? err.message : String(err) },
        });
      }
      return;
    }

    send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${req.method}` } });
  });

  rl.on('close', () => process.exit(0));
  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));
}
