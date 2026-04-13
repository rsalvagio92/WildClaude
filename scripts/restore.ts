/**
 * Restores from a backup file.
 * Usage: npm run restore -- path/to/backup.tar.gz
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';

const USER_DATA_DIR = process.env.WILD_DATA_DIR || path.join(os.homedir(), '.wild-claude-pi');

// Parse backup file argument
const args = process.argv.slice(2);
const backupFile = args[0];

if (!backupFile) {
  // List available backups if no argument given
  const BACKUPS_DIR = path.join(USER_DATA_DIR, 'backups');
  if (fs.existsSync(BACKUPS_DIR)) {
    const backups = fs
      .readdirSync(BACKUPS_DIR)
      .filter(f => f.endsWith('.tar.gz'))
      .sort()
      .reverse();

    if (backups.length === 0) {
      console.error('No backups found in', BACKUPS_DIR);
    } else {
      console.log('Available backups:');
      for (const b of backups) {
        const fullPath = path.join(BACKUPS_DIR, b);
        const bytes = fs.statSync(fullPath).size;
        const mb = (bytes / 1024 / 1024).toFixed(2);
        console.log(`  ${fullPath}  (${mb} MB)`);
      }
      console.log('\nUsage: npm run restore -- <path/to/backup.tar.gz>');
    }
  } else {
    console.error('No backups directory found at', BACKUPS_DIR);
    console.error('Usage: npm run restore -- <path/to/backup.tar.gz>');
  }
  process.exit(1);
}

const resolvedBackup = path.resolve(backupFile);

if (!fs.existsSync(resolvedBackup)) {
  console.error(`Backup file not found: ${resolvedBackup}`);
  process.exit(1);
}

const bytes = fs.statSync(resolvedBackup).size;
const mb = (bytes / 1024 / 1024).toFixed(2);

console.log(`Backup file : ${resolvedBackup} (${mb} MB)`);
console.log(`Restore to  : ${USER_DATA_DIR}`);
console.log('');
console.warn('WARNING: This will overwrite your current data directory!');

// Prompt for confirmation
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('Type "yes" to continue: ', (answer) => {
  rl.close();
  if (answer.trim().toLowerCase() !== 'yes') {
    console.log('Restore cancelled.');
    process.exit(0);
  }

  const parentDir = path.dirname(USER_DATA_DIR);
  const cmd = `tar -xzf "${resolvedBackup}" -C "${parentDir}"`;

  console.log('Restoring ...');
  try {
    execSync(cmd, { stdio: 'inherit' });
    console.log('Restore complete.');
  } catch (err: unknown) {
    const e = err as { message?: string };
    console.error('Restore failed:', e.message);
    process.exit(1);
  }
});
