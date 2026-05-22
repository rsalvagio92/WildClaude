/**
 * Telegram /sandbox commands.
 *
 *   /sandbox            — show live sandboxes + recent history
 *   /sandbox prune      — delete scratch dirs older than SANDBOX_PRUNE_AGE_MS
 *   /sandbox docker     — show whether docker is available right now
 *   /sandbox test       — quick smoke test: create + exec + dispose
 */

import type { Bot, Context } from 'grammy';

import { createSandbox } from './index.js';
import { listLiveSandboxes, listRecentSandboxes } from './registry.js';
import { pruneScratchDirs } from './local.js';
import { isDockerAvailable } from './docker.js';
import { SANDBOX_PRUNE_AGE_MS, SANDBOX_DEFAULT } from '../config.js';
import { logger } from '../logger.js';

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

function formatAge(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h${m % 60}m`;
}

export function registerSandboxCommands(
  bot: Bot<Context>,
  isAuthorised: (chatId: number) => boolean,
): void {
  bot.command('sandbox', async (ctx) => {
    if (!isAuthorised(ctx.chat!.id)) return;
    const arg = (ctx.match ?? '').trim().toLowerCase();

    if (arg === 'prune') {
      const { deleted, bytes } = pruneScratchDirs(SANDBOX_PRUNE_AGE_MS);
      await ctx.reply(`Pruned ${deleted} sandbox(es), freed ${formatBytes(bytes)}.`);
      return;
    }

    if (arg === 'docker') {
      const ok = await isDockerAvailable();
      await ctx.reply(ok ? 'Docker daemon: available ✓' : 'Docker daemon: unavailable (will fall back to local-scratch)');
      return;
    }

    if (arg === 'test') {
      await ctx.reply('Running sandbox smoke test…');
      try {
        const sb = await createSandbox(undefined, { label: 'smoke-test' });
        const r = await sb.exec(process.platform === 'win32' ? 'echo hello from $env:USERPROFILE' : 'echo hello from $HOME');
        await sb.dispose();
        await ctx.reply(
          `Smoke test OK\n` +
          `Kind: ${sb.kind}\n` +
          `Workspace: ${sb.hostCwd}\n` +
          `Exit: ${r.exitCode} in ${r.durationMs}ms\n` +
          `Stdout: ${r.stdout.trim().slice(0, 200)}`,
        );
      } catch (err) {
        await ctx.reply(`Smoke test failed: ${err instanceof Error ? err.message : String(err)}`);
        logger.warn({ err }, 'Sandbox smoke test failed');
      }
      return;
    }

    // Default: status
    const live = listLiveSandboxes();
    const recent = listRecentSandboxes(10);
    const now = Date.now();

    const lines: string[] = [];
    lines.push(`<b>Sandbox</b>  default: <code>${SANDBOX_DEFAULT}</code>`);
    lines.push('');
    if (live.length === 0) {
      lines.push('No active sandboxes.');
    } else {
      lines.push(`<b>Active (${live.length}):</b>`);
      for (const s of live) {
        lines.push(`  • ${s.id}  ${s.kind}  ${formatAge(now - s.startedAt)}  ${s.label.slice(0, 40)}`);
      }
    }
    lines.push('');
    if (recent.length > 0) {
      lines.push(`<b>Recent:</b>`);
      for (const s of recent.slice(0, 5)) {
        const status = s.completedAt ? `done in ${formatAge(s.completedAt - s.startedAt)}` : `running ${formatAge(now - s.startedAt)}`;
        lines.push(`  • ${s.id}  ${s.kind}  ${status}`);
      }
    }
    lines.push('');
    lines.push('Subcommands: <code>/sandbox prune</code> · <code>/sandbox docker</code> · <code>/sandbox test</code>');
    await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' });
  });
}
