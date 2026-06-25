// Smoke test for a freshly-built dist before swapping it live.
// Imports every compiled module so top-level throws, missing exports, and
// ESM mistakes (e.g. `require is not defined`) surface BEFORE we restart the
// bot. tsc already type-checks; this catches runtime load failures.
//
// Usage: node scripts/healthcheck.mjs <distDir>
// Exit 0 = all modules load clean. Exit 1 = at least one failed.

import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const distDir = resolve(process.argv[2] || 'dist');

// Loading these executes side effects (acquire lock, start servers, polling)
// or parse argv and exit. We only want to verify modules *load*, so skip the
// entrypoints: index.js, *-cli.js, cli-*.js, and *.test.js.
const SKIP = new Set(['index.js']);
const isEntrypoint = (name) =>
  SKIP.has(name) || /-cli\.js$/.test(name) || /^cli-/.test(name) ||
  /\.test\.js$/.test(name) || /-test\.js$/.test(name);

// Run in healthcheck mode so any module guarding on this env stays inert.
process.env.WC_HEALTHCHECK = '1';

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (name.endsWith('.js') && !isEntrypoint(name)) out.push(p);
  }
  return out;
}

const files = walk(distDir);
let failed = 0;

for (const f of files) {
  try {
    await import(pathToFileURL(f).href);
  } catch (err) {
    failed++;
    const rel = f.slice(distDir.length + 1);
    console.error(`FAIL  ${rel}\n      ${err?.message || err}`);
  }
}

if (failed) {
  console.error(`\nHealthcheck FAILED: ${failed}/${files.length} modules did not load.`);
  process.exit(1);
}
console.log(`Healthcheck OK: ${files.length} modules loaded clean.`);
process.exit(0);
