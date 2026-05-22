/**
 * Sandbox abstraction for safe command execution.
 *
 * Backends:
 *   - local         : current behaviour, no isolation
 *   - local-scratch : creates an isolated scratch dir under USER_DATA_DIR/sandboxes/
 *                     and runs commands with that as cwd. Filesystem-isolated.
 *   - docker        : runs commands inside an ephemeral container. Process-isolated.
 *                     Requires `dockerode` (optional dep) and a running Docker daemon.
 *
 * Selection priority: caller `kind` arg → SANDBOX_DEFAULT env → 'local'.
 * Docker gracefully falls back to local-scratch if the daemon is unreachable
 * or dockerode is missing.
 */

import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';

import { USER_DATA_DIR } from '../paths.js';
import { logger } from '../logger.js';
import { recordSandbox, completeSandbox } from './registry.js';

export type SandboxKind = 'local' | 'local-scratch' | 'docker';

export interface SandboxOptions {
  /** Reason / owner — used for logs and SQLite tracking. */
  label?: string;
  /** Docker image name (only used by docker backend). */
  image?: string;
  /** Network mode for docker backend. */
  network?: 'none' | 'bridge';
  /** Memory limit in MB (docker only). */
  memoryMb?: number;
  /** Timeout for any single exec() call, ms. */
  timeoutMs?: number;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

export interface Sandbox {
  /** Unique id for this sandbox instance. */
  readonly id: string;
  /** Backend kind actually used (may differ from requested if fell back). */
  readonly kind: SandboxKind;
  /** Path on host where files should be read/written for this sandbox. */
  readonly hostCwd: string;
  /** Run a single shell command inside the sandbox. */
  exec(cmd: string, opts?: { timeoutMs?: number }): Promise<ExecResult>;
  /** Dispose / release any resources (stop container, mark complete). */
  dispose(): Promise<void>;
}

/** Pick the default kind from env if caller didn't specify one. */
export function resolveDefaultKind(): SandboxKind {
  const env = (process.env.SANDBOX_DEFAULT || '').toLowerCase();
  if (env === 'docker' || env === 'local-scratch' || env === 'local') return env;
  return 'local';
}

/** Build a scratch directory under USER_DATA_DIR/sandboxes/<id>/ and return both. */
export function makeScratchDir(id: string): string {
  const dir = path.join(USER_DATA_DIR, 'sandboxes', id);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Create a new sandbox of the requested kind.
 * If `kind` is omitted, uses SANDBOX_DEFAULT env or 'local'.
 * If the requested kind cannot be initialised, falls back gracefully and logs a warning.
 */
export async function createSandbox(
  kind?: SandboxKind,
  opts: SandboxOptions = {},
): Promise<Sandbox> {
  const requested = kind ?? resolveDefaultKind();
  const id = `sb-${randomBytes(4).toString('hex')}`;

  if (requested === 'docker') {
    try {
      const { createDockerSandbox } = await import('./docker.js');
      const sb = await createDockerSandbox(id, opts);
      recordSandbox(sb.id, 'docker', opts.label ?? '');
      return sb;
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'Docker sandbox unavailable, falling back to local-scratch',
      );
      // fall through to local-scratch
    }
  }

  if (requested === 'docker' || requested === 'local-scratch') {
    const { createLocalScratchSandbox } = await import('./local.js');
    const sb = createLocalScratchSandbox(id, opts);
    recordSandbox(sb.id, 'local-scratch', opts.label ?? '');
    return sb;
  }

  const { createLocalSandbox } = await import('./local.js');
  const sb = createLocalSandbox(id, opts);
  recordSandbox(sb.id, 'local', opts.label ?? '');
  return sb;
}

/** Convenience wrapper so callers don't have to remember to await disposal. */
export async function withSandbox<T>(
  kind: SandboxKind | undefined,
  opts: SandboxOptions,
  fn: (sb: Sandbox) => Promise<T>,
): Promise<T> {
  const sb = await createSandbox(kind, opts);
  try {
    return await fn(sb);
  } finally {
    await sb.dispose().catch((err) => {
      logger.warn({ err, sandboxId: sb.id }, 'Sandbox dispose failed');
    });
    completeSandbox(sb.id);
  }
}
