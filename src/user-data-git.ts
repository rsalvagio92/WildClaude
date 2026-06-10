/**
 * Best-effort versioning of USER_DATA_DIR artifacts (dashboards, projects, KBs,
 * evolution output) in the user-data git repo. The repo is initialised lazily by
 * evolution.ts; here we only commit if it already exists. Never throws.
 */

import fs from 'fs';
import path from 'path';
import { execSync, spawnSync } from 'child_process';

import { USER_DATA_DIR } from './paths.js';
import { logger } from './logger.js';

export function commitUserData(message: string): void {
  try {
    if (!fs.existsSync(path.join(USER_DATA_DIR, '.git'))) return; // evolution inits the repo
    execSync('git add -A', { cwd: USER_DATA_DIR, stdio: 'pipe' });
    const dirty = execSync('git status --porcelain', { cwd: USER_DATA_DIR, stdio: 'pipe' }).toString().trim();
    if (!dirty) return;
    const r = spawnSync('git', ['commit', '-m', message], { cwd: USER_DATA_DIR, stdio: 'pipe' });
    if (r.status !== 0) logger.debug({ message }, 'user-data commit skipped');
  } catch { /* non-fatal */ }
}
