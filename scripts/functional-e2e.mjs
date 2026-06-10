// Functional E2E — exercises real features end to end against a live instance.
// Includes one real chat round-trip (LLM), feature execution, and create→delete
// lifecycles. Run against WB3 (disposable). Keeps LLM calls minimal.
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE;
const TOKEN = process.env.E2E_TOKEN;
const checks = [];
const ok = (name, cond, detail = '') => { checks.push({ name, pass: !!cond, detail }); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`); };

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(BASE);
await page.evaluate((t) => sessionStorage.setItem('wcp_token', t), TOKEN);

const call = (method, path, body) => page.evaluate(async ({ method, path, body, t }) => {
  const res = await fetch(path, { method, headers: { Authorization: 'Bearer ' + t, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}, { method, path, body, t: TOKEN });

console.log('\n── A. READ SWEEP (every module\'s backing endpoint) ──');
const reads = [
  ['/api/models', (d) => Array.isArray(d.models)],
  ['/api/info', (d) => !!d.botName],
  ['/api/health', (d) => 'contextPct' in d],
  ['/api/vitals', (d) => !!d.system],
  ['/api/tokens', (d) => !!d.stats || !!d.recentUsage],
  ['/api/agents', (d) => Array.isArray(d.agents) && d.agents.length > 0],
  ['/api/mission/tasks', (d) => Array.isArray(d.tasks)],
  ['/api/automations', (d) => Array.isArray(d.automations)],
  ['/api/tasks', (d) => Array.isArray(d.tasks)],
  ['/api/skills', (d) => Array.isArray(d.skills)],
  ['/api/mcp', (d) => Array.isArray(d.installed) && Array.isArray(d.available)],
  ['/api/secrets', (d) => Array.isArray(d.secrets)],
  ['/api/personality', (d) => !!d.tone],
  ['/api/personality/presets', (d) => Array.isArray(d.presets)],
  ['/api/profile', (d) => !!d.profile],
  ['/api/verbosity', (d) => !!d],
  ['/api/memories?chatId=auto', (d) => !!d.stats || !!d],
  ['/api/memories/topics?chatId=auto', (d) => Array.isArray(d.topics)],
  ['/api/traces?limit=5', (d) => Array.isArray(d.sessions)],
  ['/api/cost-breakdown?days=7', (d) => !!d],
  ['/api/evals', (d) => Array.isArray(d.evals)],
  ['/api/workflows', (d) => Array.isArray(d.workflows)],
  ['/api/reflections?limit=5', (d) => Array.isArray(d.reflections)],
  ['/api/digest?period=week', (d) => !!d],
  ['/api/budget', (d) => !!d],
  ['/api/tokenjuice', (d) => !!d],
  ['/api/memory-search?q=test', (d) => 'total' in d || 'byScope' in d],
  ['/api/agent-improve', (d) => 'struggling' in d || 'pendingProposals' in d],
  ['/api/finetune/estimate?days=7', (d) => !!d],
  ['/api/audit?limit=5', (d) => Array.isArray(d.entries)],
  ['/api/audit-log?limit=5', (d) => Array.isArray(d.entries)],
  ['/api/hive-mind?limit=5', (d) => Array.isArray(d.entries)],
  ['/api/dashboards', (d) => Array.isArray(d.services)],
  ['/api/sandboxes', (d) => !!d],
  ['/api/files?root=data&path=', (d) => Array.isArray(d.files)],
  ['/api/system/versions', (d) => !!d.current],
  ['/api/skill-marketplace/recommended', (d) => Array.isArray(d.skills)],
];
const cid = (await call('GET', '/api/info')).data?.chatId || 'dashboard';
for (const [path, valid] of reads) {
  const p = path.replace('chatId=auto', 'chatId=' + cid);
  const r = await call('GET', p);
  ok('GET ' + path, r.status === 200 && valid(r.data || {}), r.status !== 200 ? `HTTP ${r.status}` : '');
}

console.log('\n── B. MUTATION LIFECYCLES ──');
// Mission task create → appears → delete
const mc = await call('POST', '/api/mission/tasks', { title: 'E2E probe', prompt: 'noop', priority: 0 });
ok('mission create', mc.status === 201 || mc.status === 200, `HTTP ${mc.status}`);
const mid = mc.data?.task?.id || mc.data?.id;
if (mid) {
  const ml = await call('GET', '/api/mission/tasks');
  ok('mission appears', (ml.data.tasks || []).some((t) => t.id === mid));
  const md = await call('DELETE', `/api/mission/tasks/${mid}`);
  ok('mission delete', md.status === 200);
}
// Automation create → toggle → delete. Pre-clean in case a prior run left one.
await call('DELETE', '/api/automations/e2e-probe-auto');
const ac = await call('POST', '/api/automations', { id: 'e2e-probe-auto', name: 'E2E probe auto', prompt: 'noop', cron: '0 4 * * 0' });
ok('automation create', ac.status === 201 || ac.status === 200, `HTTP ${ac.status}`);
const aid = ac.data?.id;
if (aid) {
  const at = await call('PUT', `/api/automations/${aid}`, { enabled: false });
  ok('automation toggle', at.status === 200);
  const ad = await call('DELETE', `/api/automations/${aid}`);
  ok('automation delete (config removed)', ad.status === 200, `HTTP ${ad.status}`);
  const re = await call('GET', '/api/automations');
  ok('automation truly gone', !(re.data.automations || []).some((a) => a.id === aid));
}

console.log('\n── C. REAL CHAT ROUND-TRIP (LLM pipeline) ──');
const chatResult = await page.evaluate(async ({ t }) => {
  return await new Promise((resolve) => {
    const es = new EventSource('/api/chat/stream?token=' + t);
    const t0 = Date.now();
    const done = (r) => { try { es.close(); } catch {} resolve(r); };
    const timer = setTimeout(() => done({ ok: false, reason: 'timeout 120s', events }), 120000);
    const events = [];
    const onType = (type) => (ev) => {
      events.push(type);
      let d = {}; try { d = ev.data ? JSON.parse(ev.data) : {}; } catch {}
      if (type === 'assistant_message') { clearTimeout(timer); done({ ok: true, ms: Date.now() - t0, text: (d.content || '').slice(0, 80), model: d.model, events }); }
      if (type === 'error') { clearTimeout(timer); done({ ok: false, reason: d.content, events }); }
    };
    for (const ty of ['processing', 'user_message', 'assistant_message', 'progress', 'error']) es.addEventListener(ty, onType(ty));
    es.onopen = async () => {
      await fetch('/api/chat/send', { method: 'POST', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Reply with exactly the word: pong' }) });
    };
  });
}, { t: TOKEN });
ok('chat round-trip (LLM responds)', chatResult.ok, chatResult.ok ? `${chatResult.ms}ms, model=${chatResult.model}, "${chatResult.text}"` : chatResult.reason);
ok('chat SSE event sequence', (chatResult.events || []).includes('assistant_message') || (chatResult.events || []).includes('user_message'), 'events: ' + (chatResult.events || []).join(','));

await browser.close();

const pass = checks.filter((c) => c.pass).length;
console.log(`\n=== FUNCTIONAL RESULT: ${pass}/${checks.length} passed ===`);
const fails = checks.filter((c) => !c.pass);
if (fails.length) { console.log('FAILURES:'); fails.forEach((f) => console.log('  - ' + f.name + (f.detail ? ' :: ' + f.detail : ''))); }
process.exit(fails.length ? 1 : 0);
