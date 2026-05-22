/**
 * execute_code — programmatic tool for running short JS snippets that can
 * call other WildClaude tools through an injected `wc` global.
 *
 * Why it exists: collapses multi-step plans (read file, edit, write, run
 * tests) into a single LLM inference call. Major token-cost reduction on
 * Ralph loops.
 *
 * Isolation: uses Node's built-in `vm` module + a stripped-down context.
 * For real isolation, pair with a docker sandbox (see ../sandbox/).
 * The `vm` boundary alone is NOT safe against determined attackers, but
 * combined with a non-internet-facing docker sandbox it is sufficient.
 *
 * Surface exposed to snippets via `wc`:
 *   wc.read(path)           → string
 *   wc.write(path, content) → void
 *   wc.exists(path)         → boolean
 *   wc.exec(cmd)            → Promise<{ stdout, stderr, exitCode }>
 *   wc.log(...args)         → console.log
 *   wc.workspace            → string (cwd of execution)
 */

import fs from 'fs';
import path from 'path';
import vm from 'vm';

import { Sandbox } from '../sandbox/index.js';
import { logger } from '../logger.js';

export interface ExecuteCodeOptions {
  /** Sandbox to run shell commands through. If absent, wc.exec throws. */
  sandbox?: Sandbox;
  /** Working directory for fs operations. Defaults to sandbox.hostCwd or cwd(). */
  workspace?: string;
  /** Per-snippet timeout in ms. */
  timeoutMs?: number;
  /**
   * Maximum cumulative output size in bytes before we truncate.
   * Protects against snippets that try to flood the context.
   */
  maxOutputBytes?: number;
}

export interface ExecuteCodeResult {
  ok: boolean;
  value: unknown;
  stdout: string;
  stderr: string;
  error?: string;
  durationMs: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT = 65_536;

/**
 * Build a frozen, restricted `wc` object that the snippet receives.
 * Path traversal is constrained to the workspace root.
 */
function buildWcContext(
  workspace: string,
  sandbox: Sandbox | undefined,
  capture: { stdout: string; stderr: string; limit: number },
): Record<string, unknown> {
  const resolveSafe = (p: string): string => {
    const abs = path.resolve(workspace, p);
    const root = path.resolve(workspace);
    if (!abs.startsWith(root + path.sep) && abs !== root) {
      throw new Error(`Path escapes workspace: ${p}`);
    }
    return abs;
  };

  const appendCaptured = (target: 'stdout' | 'stderr', s: string) => {
    if (capture[target].length + s.length > capture.limit) {
      capture[target] += s.slice(0, capture.limit - capture[target].length);
      capture[target] += '\n…[truncated]';
    } else {
      capture[target] += s;
    }
  };

  return {
    workspace,
    read(p: string): string {
      return fs.readFileSync(resolveSafe(p), 'utf8');
    },
    write(p: string, content: string): void {
      const full = resolveSafe(p);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, 'utf8');
    },
    exists(p: string): boolean {
      return fs.existsSync(resolveSafe(p));
    },
    async exec(cmd: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
      if (!sandbox) {
        throw new Error('wc.exec is unavailable: no sandbox provided to execute_code');
      }
      const r = await sandbox.exec(cmd);
      return { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode };
    },
    log(...args: unknown[]): void {
      appendCaptured('stdout', args.map((a) => stringify(a)).join(' ') + '\n');
    },
    error(...args: unknown[]): void {
      appendCaptured('stderr', args.map((a) => stringify(a)).join(' ') + '\n');
    },
  };
}

function stringify(x: unknown): string {
  if (typeof x === 'string') return x;
  try { return JSON.stringify(x); } catch { return String(x); }
}

/**
 * Run a JS snippet. The snippet may be sync or async; it is wrapped in an
 * async IIFE and awaited.
 */
export async function runSnippet(
  snippet: string,
  opts: ExecuteCodeOptions = {},
): Promise<ExecuteCodeResult> {
  const start = Date.now();
  const workspace = opts.workspace ?? opts.sandbox?.hostCwd ?? process.cwd();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutput = opts.maxOutputBytes ?? DEFAULT_MAX_OUTPUT;

  const capture = { stdout: '', stderr: '', limit: maxOutput };
  const wc = buildWcContext(workspace, opts.sandbox, capture);

  // Build a minimal context. Crucially: no `require`, no `process`, no `globalThis`.
  // Snippets that need files/processes must go through `wc`.
  const sandboxCtx = vm.createContext({
    wc,
    console: { log: wc.log, error: wc.error, warn: wc.error },
    setTimeout, clearTimeout,
    Promise, JSON, Math, Date, RegExp,
    Array, Object, String, Number, Boolean,
  });

  const wrapped = `(async () => {\n${snippet}\n})()`;
  let result: ExecuteCodeResult;

  try {
    const script = new vm.Script(wrapped, { filename: 'execute_code.js' });
    const promise = script.runInContext(sandboxCtx, { timeout: timeoutMs }) as Promise<unknown>;
    const value = await promise;
    result = {
      ok: true,
      value,
      stdout: capture.stdout,
      stderr: capture.stderr,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    result = {
      ok: false,
      value: null,
      stdout: capture.stdout,
      stderr: capture.stderr,
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      durationMs: Date.now() - start,
    };
    logger.warn({ err: result.error, durationMs: result.durationMs }, 'execute_code: snippet failed');
  }

  return result;
}
