// Edit round-trip E2E: drive real mutations through the API the way the UI does,
// then re-read to confirm persistence. Run against a disposable local instance.
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE || 'http://127.0.0.1:3199';
const TOKEN = process.env.E2E_TOKEN || 'localtest123';
const checks = [];
const ok = (name, cond, detail = '') => checks.push({ name, pass: !!cond, detail });

const browser = await chromium.launch();
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));

// Run all calls inside the page so the real api.js token/Bearer path is used.
await page.goto(BASE);
await page.evaluate((t) => sessionStorage.setItem('wcp_token', t), TOKEN);

const call = (method, path, body) => page.evaluate(async ({ method, path, body, t }) => {
  const res = await fetch(path, {
    method,
    headers: { Authorization: 'Bearer ' + t, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}, { method, path, body, t: TOKEN });

try {
  // 1. /api/models feeds dropdowns and includes Fable
  const models = await call('GET', '/api/models');
  ok('models endpoint', models.status === 200 && Array.isArray(models.data.models));
  ok('models include fable', (models.data.models || []).some((m) => m.id === 'claude-fable-5'));

  // 2. Personality round-trip (Settings → Personality save)
  const pBefore = await call('GET', '/api/personality');
  ok('personality read', pBefore.status === 200);
  const setHumor = (pBefore.data.humor === 7) ? 4 : 7;
  const pPut = await call('PUT', '/api/personality', { ...pBefore.data, humor: setHumor });
  ok('personality save', pPut.status === 200);
  const pAfter = await call('GET', '/api/personality');
  ok('personality persisted', pAfter.data.humor === setHumor, `expected ${setHumor} got ${pAfter.data.humor}`);

  // 3. Caveman toggle round-trip (topbar button logic)
  const presets = await call('GET', '/api/personality/presets');
  ok('caveman preset exists', (presets.data.presets || []).some((x) => x.id === 'caveman'));
  const caveman = (presets.data.presets || []).find((x) => x.id === 'caveman');
  if (caveman) {
    await call('PUT', '/api/config', { previousPreset: pAfter.data.preset || 'default' });
    await call('PUT', '/api/personality', { ...caveman.config, preset: 'caveman' });
    const onState = await call('GET', '/api/personality');
    ok('caveman on', onState.data.preset === 'caveman');
    // restore
    await call('PUT', '/api/personality', { ...pBefore.data });
  }

  // 4. Secret set/delete round-trip — use a KNOWN secret key so it appears
  //    in the status list (the list is the known-def registry, by design).
  const sList0 = await call('GET', '/api/secrets');
  const knownKey = (sList0.data.secrets || [])[0]?.key || 'GROQ_API_KEY';
  const sPut = await call('POST', `/api/secrets/${knownKey}`, { value: 'secret-val-123' });
  ok('secret set', sPut.status === 200);
  const sList = await call('GET', '/api/secrets');
  ok('secret appears as set', (sList.data.secrets || []).some((x) => x.key === knownKey && x.set === true));
  const sDel = await call('DELETE', `/api/secrets/${knownKey}`);
  ok('secret delete', sDel.status === 200);
  const sList2 = await call('GET', '/api/secrets');
  ok('secret cleared after delete', (sList2.data.secrets || []).some((x) => x.key === knownKey && x.set === false));

  // 5. Registry agent create → model patch → delete (edit round-trip)
  const agentId = 'e2e-test-agent';
  const aCreate = await call('POST', '/api/agents/registry', {
    id: agentId, name: 'E2E Test', description: 'temp', model: 'claude-sonnet-4-6', lane: 'domain',
    systemPrompt: '# E2E\nYou are a test agent.\n',
  });
  ok('agent create', aCreate.status === 201 || aCreate.status === 200, `status ${aCreate.status} ${JSON.stringify(aCreate.data).slice(0,80)}`);
  const aList = await call('GET', '/api/agents');
  const created = (aList.data.agents || []).find((a) => a.id === agentId);
  ok('agent appears in list', !!created);
  if (created) {
    const mPatch = await call('PATCH', `/api/agents/${agentId}/model`, { model: 'claude-haiku-4-5' });
    ok('agent model patch', mPatch.status === 200);
    const aList2 = await call('GET', '/api/agents');
    const after = (aList2.data.agents || []).find((a) => a.id === agentId);
    ok('agent model persisted', after && after.model === 'claude-haiku-4-5', `got ${after?.model}`);
  }
  // cleanup: registry agents are files under USER_DATA_DIR/agents/<lane>/<id>.md
  const aDel = await call('DELETE', `/api/agents/${agentId}/full`);
  ok('agent delete (best-effort)', aDel.status === 200 || aDel.status === 400 || aDel.status === 404, `status ${aDel.status}`);

  // 6. Memory create-via-search context X-ray endpoints respond
  const ms = await call('GET', '/api/memory-search?q=test');
  ok('memory-search endpoint', ms.status === 200);
  const ml = await call('GET', '/api/memories/list?chatId=dashboard&q=test&limit=5');
  ok('memory list endpoint', ml.status === 200);

  // 7. Profile domain round-trip
  const profPut = await call('PUT', '/api/profile/goals', { content: '# goals\nE2E marker\n' });
  ok('profile save', profPut.status === 200);
  const prof = await call('GET', '/api/profile');
  ok('profile persisted', prof.data.profile && /E2E marker/.test(prof.data.profile.goals || ''));

} catch (e) {
  ok('exception', false, e.message);
}

await browser.close();

console.log('\n=== EDIT ROUND-TRIP MATRIX ===');
let pass = 0;
for (const c of checks) {
  if (c.pass) pass++;
  console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? ' :: ' + c.detail : ''}`);
}
if (errs.length) console.log('\npage errors:', errs.slice(0, 5));
console.log(`\n${pass}/${checks.length} edit checks passed`);
process.exit(pass === checks.length ? 0 : 1);
