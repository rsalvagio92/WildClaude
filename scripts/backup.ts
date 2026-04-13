/**
 * Backs up ~/.wild-claude-pi/ to a timestamped tar.gz
 * Usage: npm run backup
 * Output: ~/.wild-claude-pi/backups/wildclaude-backup-YYYY-MM-DD.tar.gz
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const USER_DATA_DIR = process.env.WILD_DATA_DIR || path.join(os.homedir(), '.wild-claude-pi');
const BACKUPS_DIR = path.join(USER_DATA_DIR, 'backups');
const MAX_BACKUPS = 5;

// Ensure backups directory exists
fs.mkdirSync(BACKUPS_DIR, { recursive: true });

// Build timestamped filename
const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
const outputFile = path.join(BACKUPS_DIR, `wildclaude-backup-${date}.tar.gz`);

// Run tar
const parentDir = path.dirname(USER_DATA_DIR);
const dirName = path.basename(USER_DATA_DIR);
const cmd = `tar -czf "${outputFile}" -C "${parentDir}" "${dirName}" --exclude="${dirName}/backups"`;

console.log(`Backing up ${USER_DATA_DIR} ...`);
try {
  execSync(cmd, { stdio: 'pipe' });
} catch (err: unknown) {
  const e = err as { stderr?: Buffer; message?: string };
  // tar exits non-zero on "file changed as we read it" warnings — ignore
  const stderr = e.stderr?.toString() ?? '';
  if (!outputFile || !fs.existsSync(outputFile)) {
    console.error('Backup failed:', e.message, stderr);
    process.exit(1);
  }
}

const bytes = fs.statSync(outputFile).size;
const mb = (bytes / 1024 / 1024).toFixed(2);
console.log(`Backup saved: ${outputFile} (${mb} MB)`);

// Prune old backups — keep only MAX_BACKUPS most recent
const allBackups = fs
  .readdirSync(BACKUPS_DIR)
  .filter(f => f.startsWith('wildclaude-backup-') && f.endsWith('.tar.gz'))
  .sort(); // lexicographic = chronological for YYYY-MM-DD

if (allBackups.length > MAX_BACKUPS) {
  const toDelete = allBackups.slice(0, allBackups.length - MAX_BACKUPS);
  for (const f of toDelete) {
    const fullPath = path.join(BACKUPS_DIR, f);
    fs.unlinkSync(fullPath);
    console.log(`Pruned old backup: ${f}`);
  }
}

console.log(`Done. (${Math.min(allBackups.length, MAX_BACKUPS)} backup(s) kept)`);
