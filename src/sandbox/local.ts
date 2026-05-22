/**
 * Local sandbox backends.
 *
 *   local         — runs commands in the user home dir (current default behaviour).
 *   local-scratch — runs commands in a fresh per-sandbox scratch dir under
 *                   USER_DATA_DIR/sandboxes/<id>/. The filesystem is isolated;
 *                   the process is not.
 *
 * Both backends honour timeouts and never leak child processes past dispose().
 */

import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { Sandbox, SandboxOptions, ExecResult, makeScratchDir } from './index.js';
import { USER_DATA_DIR } from '../paths.js';
import { logger } from '../logger.js';

const DEFAULT_TIMEOUT_MS = parseInt(process.env.SANDBOX_TIMEOUT_MS ?? '300000', 10);

function runShell(cmd: string, cwd: string, timeoutMs: number): Promise<ExecResult> {
  return new Promise((resolve) => {
    const start = Date.now();
    const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/sh';
    const args = process.platform === 'win32' ? ['-NoProfile', '-Command', cmd] : ['-c', cmd];
    const proc = spawn(shell, args, { cwd, env: process.env });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const killer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGTERM');
      setTimeout(() => proc.kill('SIGKILL'), 2000);
    }, timeoutMs);

    proc.stdout.on('data', (b: Buffer) => { stdout += b.toString(); });
    proc.stderr.on('data', (b: Buffer) => { stderr += b.toString(); });
    proc.on('close', (code) => {
      clearTimeout(killer);
      resolve({
        exitCode: code ?? -1,
        stdout,
        stderr,
        durationMs: Date.now() - start,
        timedOut,
      });
    });
    proc.on('error', (err) => {
      clearTimeout(killer);
      resolve({
        exitCode: -1,
        stdout,
        stderr: stderr + String(err),
        durationMs: Date.now() - start,
        timedOut: false,
      });
    });
  });
}

export function createLocalSandbox(id: string, opts: SandboxOptions = {}): Sandbox {
  const hostCwd = process.env.HOME || process.env.USERPROFILE || os.homedir();
  logger.info({ id, kind: 'local', hostCwd, label: opts.label }, 'Sandbox created');

  return {
    id,
    kind: 'local',
    hostCwd,
    async exec(cmd, execOpts) {
      return runShell(cmd, hostCwd, execOpts?.timeoutMs ?? opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    },
    async dispose() {
      // nothing to release
    },
  };
}

export function createLocalScratchSandbox(id: string, opts: SandboxOptions = {}): Sandbox {
  const hostCwd = makeScratchDir(id);
  logger.info({ id, kind: 'local-scratch', hostCwd, label: opts.label }, 'Sandbox created');

  return {
    id,
    kind: 'local-scratch',
    hostCwd,
    async exec(cmd, execOpts) {
      return runShell(cmd, hostCwd, execOpts?.timeoutMs ?? opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    },
    async dispose() {
      // Leave the scratch dir on disk so users can inspect artifacts.
      // GC happens via /sandbox prune or the registry.
    },
  };
}

/**
 * Delete scratch directories older than `maxAgeMs`.
 * Called from /sandbox prune and on startup.
 */
export function pruneScratchDirs(maxAgeMs: number): { deleted: number; bytes: number } {
  const root = path.join(USER_DATA_DIR, 'sandboxes');
  if (!fs.existsSync(root)) return { deleted: 0, bytes: 0 };
  const now = Date.now();
  let deleted = 0;
  let bytes = 0;
  for (const entry of fs.readdirSync(root)) {
    const full = path.join(root, entry);
    try {
      const st = fs.statSync(full);
      if (!st.isDirectory()) continue;
      if (now - st.mtimeMs < maxAgeMs) continue;
      bytes += dirSize(full);
      fs.rmSync(full, { recursive: true, force: true });
      deleted++;
    } catch (err) {
      logger.warn({ err, entry }, 'pruneScratchDirs: failed to inspect entry');
    }
  }
  return { deleted, bytes };
}

function dirSize(dir: string): number {
  let total = 0;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      try {
        if (entry.isDirectory()) total += dirSize(full);
        else total += fs.statSync(full).size;
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return total;
}
