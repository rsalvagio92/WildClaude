// Playwright E2E smoke for the new dashboard. Boots is external (caller starts
// the server); this script logs in, visits every module, asserts it renders
// without an error box / console error, and reports a per-module matrix.
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE || 'http://localhost:3199';
const TOKEN = process.env.E2E_TOKEN || 'localtest123';

const MODULES = [
  'command', 'memory', 'journal', 'reflection', 'agents', 'mission',
  'automation', 'workflows', 'evals', 'ecosystem', 'marketplace',
  'dashboards', 'vitals', 'traces', 'activity', 'audit', 'hermes',
  'files', 'settings',
];

const results = [];

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();

const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));

// ── Login ──
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('#login:not([hidden]), #app:not([hidden])', { timeout: 8000 });
const needsLogin = await page.isVisible('#login:not([hidden])');
if (needsLogin) {
  await page.fill('#login-token', TOKEN);
  await page.click('#login-form button[type=submit]');
}
await page.waitForSelector('#app:not([hidden])', { timeout: 10000 });
console.log('LOGIN OK');

// ── Visit each module ──
for (const id of MODULES) {
  const before = consoleErrors.length;
  let status = 'ok', detail = '';
  try {
    await page.goto(`${BASE}/#/${id}`, { waitUntil: 'commit' });
    // wait for view to settle: either content or an error box
    await page.waitForFunction(() => {
      const v = document.getElementById('view');
      if (!v) return false;
      if (v.querySelector('.spinner')) return false; // still loading
      return v.children.length > 0;
    }, { timeout: 12000 }).catch(() => {});
    await page.waitForTimeout(700);

    const hasErrBox = await page.locator('#view .errbox').count();
    const navActive = await page.locator(`.nav-item.active[data-id="${id}"]`).count();
    const title = await page.locator('#page-title').textContent();
    const newConsole = consoleErrors.slice(before);

    if (hasErrBox > 0) {
      const txt = await page.locator('#view .errbox').first().textContent();
      status = 'errbox';
      detail = (txt || '').slice(0, 120);
    } else if (newConsole.length) {
      status = 'console';
      detail = newConsole[0].slice(0, 120);
    } else if (!navActive) {
      status = 'noactive';
      detail = 'nav item not active';
    }
    results.push({ id, status, detail, title: (title || '').trim() });
  } catch (e) {
    results.push({ id, status: 'throw', detail: (e.message || '').slice(0, 120) });
  }
}

await browser.close();

// ── Report ──
console.log('\n=== MODULE MATRIX ===');
let pass = 0;
for (const r of results) {
  const mark = r.status === 'ok' ? 'PASS' : 'FAIL';
  if (r.status === 'ok') pass++;
  console.log(`${mark.padEnd(5)} ${r.id.padEnd(12)} ${r.status}${r.detail ? ' :: ' + r.detail : ''}`);
}
console.log(`\n${pass}/${results.length} modules clean`);
process.exit(pass === results.length ? 0 : 1);
