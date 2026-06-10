import { chromium } from 'playwright';
const BASE = process.env.E2E_BASE || 'http://127.0.0.1:3199';
const TOKEN = process.env.E2E_TOKEN || 'localtest123';
const OUT = process.env.SHOT_OUT || 'dashboard-preview';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
await page.addInitScript((t) => { try { sessionStorage.setItem('wcp_token', t); } catch {} }, TOKEN);
await page.goto(BASE);
await page.waitForSelector('#app:not([hidden])', { timeout: 8000 });
const shots = ['command', 'memory', 'agents', 'vitals', 'ecosystem', 'settings'];
for (const id of shots) {
  await page.goto(`${BASE}/#/${id}`, { waitUntil: 'commit' });
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${OUT}-${id}.png` });
  console.log('shot', id);
}
await browser.close();
