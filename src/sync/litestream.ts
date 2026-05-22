/**
 * Cross-device sync — Litestream scaffold.
 *
 * Litestream (https://litestream.io) streams SQLite WAL changes to S3-compatible
 * object storage. WildClaude doesn't bundle the binary; users install it and
 * point it at the WildClaude DB.
 *
 * This module:
 *   - generates the litestream.yml config for the user's environment
 *   - exposes /sync status (reads litestream's state file, if present)
 *   - provides a `wildclaude sync init` walkthrough hook (future)
 *
 * For real multi-device replication you'll typically pair Litestream restore
 * on the second device with a careful handover (only ONE writer at a time).
 */

import fs from 'fs';
import path from 'path';

import { USER_DATA_DIR } from '../paths.js';

export interface LitestreamConfig {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}

const CONFIG_PATH = path.join(USER_DATA_DIR, 'litestream.yml');

/** Build a Litestream YAML config for replicating wild-claude.db. */
export function buildConfig(cfg: LitestreamConfig): string {
  const dbPath = path.join(USER_DATA_DIR, 'store', 'wild-claude.db');
  const lines: string[] = [];
  lines.push('# WildClaude Litestream config — generated. Edit manually if you change the path.');
  lines.push('dbs:');
  lines.push(`  - path: ${dbPath}`);
  lines.push('    replicas:');
  lines.push(`      - type: s3`);
  lines.push(`        bucket: ${cfg.bucket}`);
  lines.push(`        region: ${cfg.region}`);
  if (cfg.endpoint) lines.push(`        endpoint: ${cfg.endpoint}`);
  if (cfg.accessKeyId) lines.push(`        access-key-id: ${cfg.accessKeyId}`);
  if (cfg.secretAccessKey) lines.push(`        secret-access-key: ${cfg.secretAccessKey}`);
  return lines.join('\n') + '\n';
}

export function writeConfig(cfg: LitestreamConfig): string {
  const yaml = buildConfig(cfg);
  fs.writeFileSync(CONFIG_PATH, yaml, 'utf8');
  return CONFIG_PATH;
}

export function configExists(): boolean {
  return fs.existsSync(CONFIG_PATH);
}

export function syncStatusHint(): string {
  if (!configExists()) {
    return 'Litestream is not configured. Run /sync init to set up S3-backed replication.';
  }
  return [
    `Config: ${CONFIG_PATH}`,
    `Start replication:  litestream replicate -config ${CONFIG_PATH}`,
    `Restore on a new device:  litestream restore -config ${CONFIG_PATH} ${path.join(USER_DATA_DIR, 'store', 'wild-claude.db')}`,
    '',
    'Only ONE device should run replicate at a time. To migrate, stop replicate on the source, restore on the destination, then start replicate there.',
  ].join('\n');
}

export function registerSyncCommand(
  bot: import('grammy').Bot,
  isAuthorised: (chatId: number) => boolean,
): void {
  bot.command('sync', async (ctx) => {
    if (!isAuthorised(ctx.chat!.id)) return;
    const arg = (ctx.match ?? '').trim().toLowerCase();
    if (!arg || arg === 'status') {
      await ctx.reply(syncStatusHint());
      return;
    }
    if (arg.startsWith('init')) {
      await ctx.reply(
        'To enable cross-device sync via Litestream:\n' +
        '1) Install: https://litestream.io/install\n' +
        '2) Create an S3-compatible bucket (R2, B2, MinIO all work)\n' +
        '3) Run: /sync configure <bucket> <region> [endpoint]\n' +
        '4) Set secrets: /set_secret S3_ACCESS_KEY  and  /set_secret S3_SECRET_KEY\n' +
        '5) Run: litestream replicate -config ~/.wild-claude-pi/litestream.yml',
      );
      return;
    }
    if (arg.startsWith('configure ')) {
      const parts = arg.slice('configure '.length).split(/\s+/);
      const [bucket, region, endpoint] = parts;
      if (!bucket || !region) {
        await ctx.reply('Usage: /sync configure <bucket> <region> [endpoint]');
        return;
      }
      const written = writeConfig({ bucket, region, endpoint });
      await ctx.reply(`Wrote ${written}. Next: ${syncStatusHint().split('\n').slice(1, 4).join('\n')}`);
      return;
    }
    await ctx.reply('Usage:\n/sync status\n/sync init\n/sync configure <bucket> <region> [endpoint]');
  });
}
