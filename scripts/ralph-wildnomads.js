#!/usr/bin/env node

/**
 * ralph-wildnomads.js — Autonomous loop for WildNomads Phase 2
 *
 * Invokes Ralph to implement the remaining Phase 2 tasks (mobile UI):
 * - Booking checkout flow
 * - Portfolio upload UI
 * - Inquiries management
 * - Saved jobs feature
 *
 * Usage: node scripts/ralph-wildnomads.js
 */

import { startRalph } from '../dist/ralph.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const WILDNOMADS_DIR = path.resolve(path.dirname(PROJECT_ROOT), 'wildnomads');

const goal = `Complete WildNomads Phase 2 remaining features:
- Professional/Jobs mobile end-to-end (booking checkout, portfolio upload, inquiries mgmt, saved jobs)
- Reuse all existing Next.js API routes
- Focus on mobile (Expo) screens in /mobile
- Target: Phase 2 95% → 100%`;

const config = {
  goal,
  maxIterations: 20,
  maxCallsPerHour: 30,
  projectDir: WILDNOMADS_DIR,
  sandboxKind: 'local', // real checkout, not sandbox isolation (we commit after each iteration)
};

// onUpdate callback: log to console instead of Telegram
function onUpdate(status) {
  console.log(`\n[Ralph] Iteration ${status.iteration}/${status.maxIterations}`);
  console.log(`  Tasks: ${status.completedTasks}/${status.totalTasks}`);
  console.log(`  Running: ${status.running}`);
  if (status.lastOutput) console.log(`  Output: ${status.lastOutput.slice(0, 200)}`);
}

console.log('🚀 Starting Ralph loop for WildNomads Phase 2...');
console.log(`   Target: ${WILDNOMADS_DIR}`);
console.log(`   Branch: dev-ralph`);
console.log(`   Config: ${JSON.stringify(config, null, 2)}\n`);

startRalph(config, onUpdate)
  .then(() => {
    console.log('\n✅ Ralph loop completed.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ Ralph loop failed:', err);
    process.exit(1);
  });
