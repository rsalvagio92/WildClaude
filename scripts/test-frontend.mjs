#!/usr/bin/env node
/**
 * End-to-end frontend test driven by Playwright.
 *
 * Connects to the deployed dashboard at $DASHBOARD_URL (default
 * http://192.168.1.112:3141) with $DASHBOARD_TOKEN. For each of the 17 module
 * pages, clicks the nav item, waits for the active page, checks key DOM
 * elements, captures any console errors, and screenshots.
 *
 * Run:
 *   DASHBOARD_TOKEN=... node scripts/test-frontend.mjs
 *
 * Output:
 *   - results table on stdout
 *   - screenshots under scripts/frontend-screenshots/
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = path.join(__dirname, 'frontend-screenshots');
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

const URL_BASE = process.env.DASHBOARD_URL || 'http://192.168.1.112:3141';
const TOKEN = process.env.DASHBOARD_TOKEN;
if (!TOKEN) {
  console.error('DASHBOARD_TOKEN required');
  process.exit(2);
}

const PAGES = [
  { id: 'command',     label: 'Command Center',      probe: '#page-command' },
  { id: 'memory',      label: 'Memory Palace',       probe: '#page-memory' },
  { id: 'mission',     label: 'Mission Control',     probe: '#page-mission' },
  { id: 'agents',      label: 'Agent Hub',           probe: '#page-agents' },
  { id: 'workflow',    label: 'Automation (legacy)', probe: '#page-workflow' },
  { id: 'plugins',     label: 'Skills & MCP',        probe: '#page-plugins' },
  { id: 'vitals',      label: 'System Vitals',       probe: '#page-vitals' },
  { id: 'journal',     label: 'Daily Journal',       probe: '#page-journal' },
  { id: 'dashboards',  label: 'External Dashboards', probe: '#page-dashboards' },
  { id: 'files',       label: 'File Explorer',       probe: '#page-files' },
  { id: 'activity',    label: 'Live Activity',       probe: '#page-activity' },
  { id: 'traces',      label: 'Trace Inspector',     probe: '#page-traces', critical: ['#cost-breakdown-content', '#traces-list'] },
  { id: 'evals',       label: 'Evals',               probe: '#page-evals', critical: ['#evals-list', '#eval-runs-list'] },
  { id: 'workflows',   label: 'Workflows (DAG)',     probe: '#page-workflows', critical: ['#workflows-list', '#workflow-runs-list'] },
  { id: 'reflection',  label: 'Reflection & Digest', probe: '#page-reflection', critical: ['#reflections-list', '#digest-content'] },
  { id: 'marketplace', label: 'Skill Marketplace',   probe: '#page-marketplace', critical: ['#marketplace-search', '#marketplace-results'] },
  { id: 'settings',    label: 'Settings',            probe: '#page-settings' },
];

const results = [];

function logErr(consoleErrors, networkErrors, hint) {
  const lines = [];
  if (consoleErrors.length) lines.push(`  ${consoleErrors.length} console error(s): ${consoleErrors[0].slice(0, 120)}`);
  if (networkErrors.length) lines.push(`  ${networkErrors.length} failed request(s): ${networkErrors[0].slice(0, 120)}`);
  if (hint) lines.push(`  ${hint}`);
  return lines.join('\n');
}

async function main() {
  console.log(`Connecting to ${URL_BASE}…`);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    ignoreHTTPSErrors: true,
  });

  const consoleErrorsByPage = new Map();
  const networkErrorsByPage = new Map();
  let currentPageKey = '_init';
  consoleErrorsByPage.set(currentPageKey, []);
  networkErrorsByPage.set(currentPageKey, []);

  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrorsByPage.get(currentPageKey)?.push(msg.text());
    }
  });
  page.on('pageerror', (err) => {
    consoleErrorsByPage.get(currentPageKey)?.push('pageerror: ' + (err.message || String(err)));
  });
  page.on('requestfailed', (req) => {
    // Ignore expected aborts (mDNS hiccups etc.)
    const reason = req.failure()?.errorText ?? '';
    if (reason.includes('net::ERR_ABORTED')) return;
    networkErrorsByPage.get(currentPageKey)?.push(`${req.method()} ${req.url()} (${reason})`);
  });
  page.on('response', (resp) => {
    if (resp.status() >= 500) {
      networkErrorsByPage.get(currentPageKey)?.push(`HTTP ${resp.status()} ${resp.url()}`);
    }
  });

  // ── Initial load + auth ─────────────────────────────────────────────
  const loadUrl = `${URL_BASE}/dashboard?token=${encodeURIComponent(TOKEN)}`;
  console.log(`Loading ${loadUrl}`);
  await page.goto(loadUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });

  // Wait for the SPA to mount — token screen should disappear, sidebar render.
  await page.waitForSelector('#sidebar-nav .nav-item', { timeout: 15_000 });
  await page.waitForTimeout(500);

  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '00-initial-load.png'), fullPage: false });

  // Sanity: token screen should be hidden
  const tokenScreenVisible = await page.locator('#token-screen').isVisible().catch(() => false);
  results.push({
    label: 'initial: auth + SPA mount',
    ok: !tokenScreenVisible,
    detail: tokenScreenVisible ? 'token screen still visible — auth failed' : 'auth OK, sidebar mounted',
  });

  // Sanity: sidebar contains all 17 expected items
  const expectedNavCount = PAGES.length;
  const renderedNavCount = await page.locator('#sidebar-nav .nav-item').count();
  results.push({
    label: `sidebar: ${expectedNavCount} nav items rendered`,
    ok: renderedNavCount >= expectedNavCount,
    detail: `rendered ${renderedNavCount} / expected ${expectedNavCount}`,
  });

  // ── Per-page tests ──────────────────────────────────────────────────
  for (const p of PAGES) {
    currentPageKey = p.id;
    consoleErrorsByPage.set(currentPageKey, []);
    networkErrorsByPage.set(currentPageKey, []);

    const consoleErrs = consoleErrorsByPage.get(currentPageKey);
    const networkErrs = networkErrorsByPage.get(currentPageKey);

    let pass = true;
    const reasons = [];

    try {
      const nav = page.locator(`[data-page="${p.id}"]`).first();
      const navExists = (await nav.count()) > 0;
      if (!navExists) {
        results.push({ label: p.label, ok: false, detail: `nav item [data-page="${p.id}"] not found` });
        continue;
      }
      await nav.click();

      // Wait for the active page to mount and become visible
      await page.waitForSelector(`${p.probe}.active`, { timeout: 8_000 });

      // Give the lazy-load handlers a moment to fetch data
      await page.waitForTimeout(1500);

      // Critical elements (for new modules) must exist
      if (p.critical) {
        for (const sel of p.critical) {
          const count = await page.locator(sel).count();
          if (count === 0) {
            pass = false;
            reasons.push(`missing element ${sel}`);
          }
        }
      }

      // Screenshot
      const fname = `${String(PAGES.indexOf(p) + 1).padStart(2, '0')}-${p.id}.png`;
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, fname), fullPage: false });

      // Report console / network errors as soft failures
      if (consoleErrs.length > 0) {
        pass = false;
        reasons.push(`${consoleErrs.length} console error(s)`);
      }
      if (networkErrs.length > 0) {
        pass = false;
        reasons.push(`${networkErrs.length} failed request(s)`);
      }
    } catch (err) {
      pass = false;
      reasons.push('navigation failed: ' + (err instanceof Error ? err.message : String(err)));
    }

    results.push({
      label: p.label,
      ok: pass,
      detail: pass ? 'page loaded, no errors' : reasons.join('; '),
      consoleErrs: consoleErrs.slice(0, 3),
      networkErrs: networkErrs.slice(0, 3),
    });
  }

  // ── Module-specific interaction tests ──────────────────────────────

  // 0) Trace Inspector: timestamps in recent sessions list should be from THIS YEAR.
  // Catches the seconds-vs-milliseconds bug that made everything show "1970".
  currentPageKey = 'traces-dates';
  consoleErrorsByPage.set(currentPageKey, []);
  networkErrorsByPage.set(currentPageKey, []);
  try {
    await page.locator('[data-page="traces"]').first().click();
    await page.waitForSelector('#page-traces.active');
    await page.waitForTimeout(2000);
    const rows = page.locator('#traces-list > div');
    const count = await rows.count();
    if (count > 0) {
      const firstRowText = await rows.first().textContent();
      // The dashboard renders dates as toLocaleString(). We expect the current
      // year somewhere on the row. If it shows 1970, the unit conversion is wrong.
      const currentYear = String(new Date().getFullYear());
      const containsCurrentYear = (firstRowText || '').includes(currentYear);
      const contains1970 = (firstRowText || '').includes('1970');
      results.push({
        label: 'accuracy: trace inspector renders this-year dates (no epoch-zero leak)',
        ok: containsCurrentYear && !contains1970,
        detail: contains1970
          ? 'FOUND 1970 — seconds-vs-ms bug active'
          : containsCurrentYear
            ? `row contains ${currentYear}`
            : `row text does not contain ${currentYear}: ${(firstRowText || '').slice(0, 120)}`,
      });
    } else {
      results.push({
        label: 'accuracy: trace inspector renders this-year dates (no epoch-zero leak)',
        ok: true,
        detail: 'no rows to check — skipped',
      });
    }
  } catch (err) {
    results.push({
      label: 'accuracy: trace inspector renders this-year dates',
      ok: false,
      detail: 'exception: ' + (err instanceof Error ? err.message : String(err)),
    });
  }

  // 1) Trace Inspector: click a session row, expect detail card to open
  currentPageKey = 'traces-interact';
  consoleErrorsByPage.set(currentPageKey, []);
  networkErrorsByPage.set(currentPageKey, []);
  try {
    await page.locator('[data-page="traces"]').first().click();
    await page.waitForSelector('#page-traces.active');
    await page.waitForTimeout(2000);
    const firstSessionRow = page.locator('#traces-list > div').first();
    const hasRow = (await firstSessionRow.count()) > 0;
    if (hasRow) {
      await firstSessionRow.click();
      await page.waitForTimeout(1500);
      const cardVisible = await page.locator('#trace-detail-card').isVisible();
      results.push({
        label: 'interact: click session → trace detail opens',
        ok: cardVisible,
        detail: cardVisible ? 'detail card visible' : 'detail card not shown',
      });
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'X1-trace-detail.png'), fullPage: false });
    } else {
      results.push({
        label: 'interact: click session → trace detail opens',
        ok: true,
        detail: 'no sessions to click (Pi has no traces yet) — skipped',
      });
    }
  } catch (err) {
    results.push({
      label: 'interact: click session → trace detail opens',
      ok: false,
      detail: 'exception: ' + (err instanceof Error ? err.message : String(err)),
    });
  }

  // 2) Reflection: click "Day" digest button
  currentPageKey = 'digest-interact';
  consoleErrorsByPage.set(currentPageKey, []);
  networkErrorsByPage.set(currentPageKey, []);
  try {
    await page.locator('[data-page="reflection"]').first().click();
    await page.waitForSelector('#page-reflection.active');
    await page.waitForTimeout(500);
    // Click the *digest* Day button specifically (not the reflection "Today" button).
    // Selector matches the button whose onclick calls loadDigest('day').
    await page.locator(`button[onclick="loadDigest('day')"]`).click();
    await page.waitForTimeout(2500);
    const digestText = await page.locator('#digest-content').textContent();
    const ok = !!digestText && digestText.includes('Turns:');
    results.push({
      label: 'interact: digest Day button populates content',
      ok,
      detail: ok ? 'digest body contains "Turns:"' : `unexpected: ${(digestText || '').slice(0, 80)}`,
    });
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'X2-digest-day.png'), fullPage: false });
  } catch (err) {
    results.push({
      label: 'interact: digest Day button populates content',
      ok: false,
      detail: 'exception: ' + (err instanceof Error ? err.message : String(err)),
    });
  }

  // 3) Marketplace: typing + clicking Search shows results area
  currentPageKey = 'marketplace-interact';
  consoleErrorsByPage.set(currentPageKey, []);
  networkErrorsByPage.set(currentPageKey, []);
  try {
    await page.locator('[data-page="marketplace"]').first().click();
    await page.waitForSelector('#page-marketplace.active');
    await page.locator('#marketplace-search').fill('git');
    await page.locator('button:has-text("Search")').first().click();
    await page.waitForTimeout(2500);
    const resultsText = await page.locator('#marketplace-results').textContent();
    const ok = !!resultsText && resultsText.trim().length > 0;
    results.push({
      label: 'interact: marketplace search renders results area',
      ok,
      detail: ok ? 'results area populated' : 'results area empty',
    });
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'X3-marketplace-search.png'), fullPage: false });
  } catch (err) {
    results.push({
      label: 'interact: marketplace search renders results area',
      ok: false,
      detail: 'exception: ' + (err instanceof Error ? err.message : String(err)),
    });
  }

  await browser.close();

  // ── Report ─────────────────────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('FRONTEND TEST RESULTS');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  for (const r of results) {
    const mark = r.ok ? '✓' : '✗';
    console.log(`  ${mark} ${r.label}`);
    console.log(`      ${r.detail}`);
    if (r.consoleErrs && r.consoleErrs.length > 0) {
      for (const e of r.consoleErrs.slice(0, 2)) {
        console.log(`        console: ${e.slice(0, 200)}`);
      }
    }
    if (r.networkErrs && r.networkErrs.length > 0) {
      for (const e of r.networkErrs.slice(0, 2)) {
        console.log(`        network: ${e.slice(0, 200)}`);
      }
    }
  }
  const pass = results.filter((r) => r.ok).length;
  const fail = results.length - pass;
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`PASS: ${pass}   FAIL: ${fail}   TOTAL: ${results.length}`);
  console.log(`Screenshots: ${SCREENSHOT_DIR}`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => { console.error('Fatal:', err); process.exit(2); });
