#!/usr/bin/env node
/**
 * End-to-end smoke tests for the Hermes integration.
 *
 * Designed to be copied to the Pi and run from the WildClaude repo root:
 *   node scripts/test-hermes.mjs
 *
 * Touches the live SQLite DB. Uses synthetic data tagged with a unique prefix
 * so it can be cleaned up at the end. Does NOT call out to the Claude CLI —
 * features that depend on it (skill synthesis Haiku draft, ACP session/prompt)
 * are exercised at the boundary, not all the way through.
 */

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
process.chdir(REPO_ROOT);

// ── Test harness ─────────────────────────────────────────────────────

const results = [];
let currentSection = '';

function section(name) {
  currentSection = name;
  console.log(`\n━━━ ${name} ━━━`);
}

async function test(name, fn) {
  const label = `[${currentSection}] ${name}`;
  try {
    await fn();
    results.push({ label, ok: true });
    console.log(`  ✓ ${name}`);
  } catch (err) {
    results.push({ label, ok: false, err: err instanceof Error ? err.stack || err.message : String(err) });
    console.log(`  ✗ ${name}\n      ${err instanceof Error ? err.message : String(err)}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function assertEq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ── Imports (from compiled dist/) ────────────────────────────────────

const dist = (p) => path.join(REPO_ROOT, 'dist', p);

const { initDatabase, getDb } = await import(dist('db.js'));
initDatabase();

const sandboxMod = await import(dist('sandbox/index.js'));
const localMod = await import(dist('sandbox/local.js'));
const dockerMod = await import(dist('sandbox/docker.js'));
const registryMod = await import(dist('sandbox/registry.js'));
const execMod = await import(dist('tools/execute-code.js'));
const synthesisMod = await import(dist('skill-synthesis.js'));
const exportMod = await import(dist('trajectory-export.js'));
const importMod = await import(dist('skill-import.js'));
const memoryBlocksMod = await import(dist('memory-blocks.js'));
const traceMod = await import(dist('trace-inspector.js'));
const evalsMod = await import(dist('evals.js'));
const workflowsMod = await import(dist('workflows.js'));
const reflectionMod = await import(dist('reflection.js'));
const digestMod = await import(dist('digest.js'));
const moodsMod = await import(dist('moods.js'));
const litestreamMod = await import(dist('sync/litestream.js'));

// ── Schema ───────────────────────────────────────────────────────────

section('schema');
await test('sandboxes table exists', () => {
  const row = getDb().prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='sandboxes'`).get();
  assert(row, 'sandboxes table not found');
});
await test('tool_sequences table exists', () => {
  const row = getDb().prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='tool_sequences'`).get();
  assert(row, 'tool_sequences table not found');
});
await test('idx_sandboxes_time exists', () => {
  const row = getDb().prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name='idx_sandboxes_time'`).get();
  assert(row, 'idx_sandboxes_time index not found');
});

// ── Sandbox ──────────────────────────────────────────────────────────

section('sandbox');
let scratchSandboxHostCwd = null;

await test('createSandbox(local) returns local backend', async () => {
  const sb = await sandboxMod.createSandbox('local', { label: 'test-local' });
  assertEq(sb.kind, 'local', 'kind');
  assert(sb.id.startsWith('sb-'), 'id prefix');
  await sb.dispose();
  registryMod.completeSandbox(sb.id);
});

await test('createSandbox(local-scratch) creates a fresh dir', async () => {
  const sb = await sandboxMod.createSandbox('local-scratch', { label: 'test-scratch' });
  assertEq(sb.kind, 'local-scratch', 'kind');
  assert(fs.existsSync(sb.hostCwd), `scratch dir missing: ${sb.hostCwd}`);
  scratchSandboxHostCwd = sb.hostCwd;
  await sb.dispose();
  registryMod.completeSandbox(sb.id);
});

await test('sandbox exec returns stdout for a trivial command', async () => {
  const sb = await sandboxMod.createSandbox('local-scratch', { label: 'test-exec' });
  const r = await sb.exec('echo hello-from-sandbox');
  assert(r.exitCode === 0, `non-zero exit: ${r.exitCode}`);
  assert(r.stdout.includes('hello-from-sandbox'), `stdout missing: ${r.stdout}`);
  await sb.dispose();
  registryMod.completeSandbox(sb.id);
});

await test('sandbox exec is fs-isolated to scratch dir', async () => {
  const sb = await sandboxMod.createSandbox('local-scratch', { label: 'test-iso' });
  const r = await sb.exec('pwd && echo isolated > marker.txt && cat marker.txt');
  assert(r.stdout.includes('isolated'), 'marker.txt round-trip failed');
  assert(r.stdout.includes(sb.hostCwd) || r.stdout.includes(path.basename(sb.hostCwd)), `pwd did not include scratch dir: ${r.stdout}`);
  await sb.dispose();
  registryMod.completeSandbox(sb.id);
});

await test('isDockerAvailable() returns boolean (false on bare Pi)', async () => {
  const ok = await dockerMod.isDockerAvailable();
  assert(typeof ok === 'boolean', `expected boolean, got ${typeof ok}`);
  console.log(`      docker available: ${ok}`);
});

await test('docker request falls back to local-scratch when daemon absent', async () => {
  const sb = await sandboxMod.createSandbox('docker', { label: 'test-fallback' });
  assert(['docker', 'local-scratch'].includes(sb.kind), `unexpected kind: ${sb.kind}`);
  await sb.dispose();
  registryMod.completeSandbox(sb.id);
});

await test('registry tracks lifecycle in SQLite', async () => {
  const sb = await sandboxMod.createSandbox('local', { label: 'test-registry' });
  const liveBefore = registryMod.listLiveSandboxes().find((s) => s.id === sb.id);
  assert(liveBefore, 'sandbox not in liveSandboxes after create');
  await sb.dispose();
  registryMod.completeSandbox(sb.id);
  const liveAfter = registryMod.listLiveSandboxes().find((s) => s.id === sb.id);
  assert(!liveAfter, 'sandbox still in liveSandboxes after dispose');
  const dbRow = getDb().prepare(`SELECT * FROM sandboxes WHERE id = ?`).get(sb.id);
  assert(dbRow, 'sandbox not in DB');
  assert(dbRow.completed_at, 'completed_at not set');
});

// ── execute_code ─────────────────────────────────────────────────────

section('execute_code');

await test('runSnippet: trivial return value', async () => {
  const r = await execMod.runSnippet('return 1 + 2;');
  assert(r.ok, `snippet failed: ${r.error}`);
  assertEq(r.value, 3, 'value');
});

await test('runSnippet: wc.log captures stdout', async () => {
  const r = await execMod.runSnippet(`wc.log('hi', 42); return null;`);
  assert(r.ok, `snippet failed: ${r.error}`);
  assert(r.stdout.includes('hi 42'), `stdout missing: ${JSON.stringify(r.stdout)}`);
});

await test('runSnippet: wc.write + wc.read round-trip', async () => {
  const sb = await sandboxMod.createSandbox('local-scratch', { label: 'exec-rw' });
  const r = await execMod.runSnippet(
    `wc.write('round-trip.txt', 'hello-rt'); return wc.read('round-trip.txt');`,
    { sandbox: sb },
  );
  assert(r.ok, `snippet failed: ${r.error}`);
  assertEq(r.value, 'hello-rt', 'value');
  await sb.dispose();
  registryMod.completeSandbox(sb.id);
});

await test('runSnippet: wc.exec runs in sandbox', async () => {
  const sb = await sandboxMod.createSandbox('local-scratch', { label: 'exec-shell' });
  const r = await execMod.runSnippet(
    `const r = await wc.exec('echo via-exec'); return r.stdout.trim();`,
    { sandbox: sb },
  );
  assert(r.ok, `snippet failed: ${r.error}`);
  assertEq(r.value, 'via-exec', 'value');
  await sb.dispose();
  registryMod.completeSandbox(sb.id);
});

await test('runSnippet: path traversal blocked', async () => {
  const sb = await sandboxMod.createSandbox('local-scratch', { label: 'exec-traversal' });
  const r = await execMod.runSnippet(
    `return wc.read('../../../etc/passwd');`,
    { sandbox: sb },
  );
  assert(!r.ok, 'traversal should have failed');
  assert(r.error && r.error.includes('escapes workspace'), `unexpected error: ${r.error}`);
  await sb.dispose();
  registryMod.completeSandbox(sb.id);
});

await test('runSnippet: wc.exec without sandbox throws', async () => {
  const r = await execMod.runSnippet(`await wc.exec('echo no-sandbox'); return 'oops';`);
  assert(!r.ok, 'should have thrown');
  assert(r.error && r.error.includes('no sandbox'), `unexpected: ${r.error}`);
});

await test('runSnippet: bare require/process are unavailable', async () => {
  const r = await execMod.runSnippet(`return typeof process + ':' + typeof require;`);
  assert(r.ok, `snippet failed: ${r.error}`);
  assertEq(r.value, 'undefined:undefined', 'process/require should not leak');
});

// ── execute_code MCP server ──────────────────────────────────────────

section('execute_code MCP');

await test('MCP server: initialize + tools/list + tools/call', async () => {
  const proc = spawn('node', ['dist/tools/execute-code-mcp.js'], { cwd: REPO_ROOT });
  let buf = '';
  const responses = [];
  proc.stdout.on('data', (d) => {
    buf += d.toString();
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try { responses.push(JSON.parse(line)); } catch { /* */ }
    }
  });
  const send = (msg) => proc.stdin.write(JSON.stringify(msg) + '\n');
  send({ jsonrpc: '2.0', id: 1, method: 'initialize' });
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'run', arguments: { snippet: 'return 7 * 7;' } } });
  await new Promise((r) => setTimeout(r, 4000));
  proc.kill();

  const init = responses.find((r) => r.id === 1);
  const list = responses.find((r) => r.id === 2);
  const call = responses.find((r) => r.id === 3);
  assert(init?.result?.serverInfo?.name === 'wildclaude-execute-code', 'bad initialize');
  assert(Array.isArray(list?.result?.tools) && list.result.tools[0]?.name === 'run', 'bad tools/list');
  assert(call?.result?.content?.[0]?.text?.includes('49'), `bad tools/call: ${JSON.stringify(call)}`);
});

// ── Skill synthesis ──────────────────────────────────────────────────

section('skill-synthesis');

const SYNTH_TEST_PREFIX = 'TEST-SYNTH-' + Date.now();

await test('canonicalizeSequence is stable + value-free', () => {
  const tools = [
    { name: 'Read', input: { file_path: '/tmp/a.txt' } },
    { name: 'Edit', input: { file_path: '/tmp/a.txt', old_string: 'x', new_string: 'y' } },
    { name: 'Bash', input: { command: 'ls' } },
  ];
  const { hash, signature } = synthesisMod.canonicalizeSequence(tools);
  assert(/^[a-f0-9]{16}$/.test(hash), `bad hash: ${hash}`);
  assert(signature.includes('Read(file_path:string)'), `signature missing Read: ${signature}`);
  assert(!signature.includes('/tmp/a.txt'), 'signature leaked raw value');
  // Determinism
  const again = synthesisMod.canonicalizeSequence(tools);
  assertEq(again.hash, hash, 'hash not deterministic');
});

await test('canonicalize is order-sensitive', () => {
  const a = synthesisMod.canonicalizeSequence([
    { name: 'Read', input: { file_path: '/a' } },
    { name: 'Write', input: { file_path: '/a', content: 'x' } },
  ]);
  const b = synthesisMod.canonicalizeSequence([
    { name: 'Write', input: { file_path: '/a', content: 'x' } },
    { name: 'Read', input: { file_path: '/a' } },
  ]);
  assert(a.hash !== b.hash, 'order should affect hash');
});

await test('recordTurn upserts into tool_sequences', async () => {
  // Use a unique tool name so we don't collide with real activity
  const tools = [
    { name: SYNTH_TEST_PREFIX + 'A', input: { x: 1 } },
    { name: SYNTH_TEST_PREFIX + 'B', input: { y: 'z' } },
    { name: SYNTH_TEST_PREFIX + 'C', input: { ok: true } },
  ];
  await synthesisMod.recordTurn(tools, 'session-1');
  const { hash } = synthesisMod.canonicalizeSequence(tools);
  const row = synthesisMod.getSequence(hash);
  assert(row, 'row not inserted');
  assertEq(row.count, 1, 'count');
  assertEq(row.tool_count, 3, 'tool_count');
});

await test('recordTurn increments count + caps samples', async () => {
  const tools = [
    { name: SYNTH_TEST_PREFIX + 'A', input: { x: 1 } },
    { name: SYNTH_TEST_PREFIX + 'B', input: { y: 'z' } },
    { name: SYNTH_TEST_PREFIX + 'C', input: { ok: true } },
  ];
  // Run 3 more times with different session IDs
  for (let i = 0; i < 3; i++) {
    await synthesisMod.recordTurn(tools, `session-${i + 2}`);
  }
  const { hash } = synthesisMod.canonicalizeSequence(tools);
  const row = synthesisMod.getSequence(hash);
  assertEq(row.count, 4, 'count after 4 turns');
  const samples = JSON.parse(row.sample_session_ids);
  assert(samples.length <= 5, `samples should be capped at 5, got ${samples.length}`);
});

await test('discardProposal marks rejected', async () => {
  const tools = [
    { name: SYNTH_TEST_PREFIX + 'A', input: { x: 1 } },
    { name: SYNTH_TEST_PREFIX + 'B', input: { y: 'z' } },
    { name: SYNTH_TEST_PREFIX + 'C', input: { ok: true } },
  ];
  const { hash } = synthesisMod.canonicalizeSequence(tools);
  synthesisMod.discardProposal(hash);
  const row = synthesisMod.getSequence(hash);
  assertEq(row.status, 'rejected', 'status');
});

// Cleanup synthesis test rows
try {
  getDb().prepare(`DELETE FROM tool_sequences WHERE signature LIKE ?`).run('%' + SYNTH_TEST_PREFIX + '%');
} catch { /* */ }

// ── Trajectory export ────────────────────────────────────────────────

section('trajectory-export');

await test('scrubContent masks emails', () => {
  const r = exportMod.scrubContent('Contact me at gighy@wildnomads.com please');
  assert(r.content.includes('[EMAIL]'), `email not scrubbed: ${r.content}`);
  assert(!r.content.includes('gighy@wildnomads.com'), 'raw email leaked');
  assert(r.redactions > 0, 'redaction count');
});

await test('scrubContent masks IPv4 but not localhost', () => {
  const r = exportMod.scrubContent('host 8.8.8.8 vs 127.0.0.1 vs 192.168.1.5');
  assert(r.content.includes('[IP]'), `ip not scrubbed: ${r.content}`);
  assert(r.content.includes('127.0.0.1'), 'localhost should NOT be scrubbed');
});

await test('scrubContent masks API key prefixes', () => {
  const r = exportMod.scrubContent('export GITHUB_TOKEN=ghp_abcdefghij123456');
  assert(!r.content.includes('ghp_abcdefghij123456'), `api key leaked: ${r.content}`);
});

await test('exportTrajectories writes a JSONL file', async () => {
  const outputPath = path.join('/tmp', `hermes-export-${Date.now()}.jsonl`);
  const r = await exportMod.exportTrajectories({ outputPath, limit: 10 });
  assert(fs.existsSync(r.outputPath), 'file not created');
  console.log(`      rows: ${r.rowsExported}, skipped: ${r.rowsSkipped}, bytes: ${r.bytesWritten}`);
  if (r.rowsExported > 0) {
    const first = fs.readFileSync(r.outputPath, 'utf8').split('\n')[0];
    const parsed = JSON.parse(first);
    assert('chat_id' in parsed && 'role' in parsed && 'content' in parsed, 'malformed JSONL');
    // Default mode: chat_id should be hashed (12 hex chars)
    assert(/^[a-f0-9]{12}$/.test(parsed.chat_id), `chat_id not hashed: ${parsed.chat_id}`);
  }
  fs.unlinkSync(r.outputPath);
});

// ── Skill import ─────────────────────────────────────────────────────

section('skill-import');

await test('fetchSkill handles invalid URL gracefully', async () => {
  const r = await importMod.fetchSkill('https://nonexistent.example.invalid/SKILL.md');
  assert(!r.ok, 'should have failed');
  assert(r.error, 'should have error message');
});

await test('fetchSkill rejects non-markdown frontmatter', async () => {
  // Spin up a tiny local HTTP server to serve a malformed response
  const http = await import('http');
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/markdown' });
    res.end('No frontmatter here');
  });
  const port = await new Promise((resolve) => server.listen(0, () => resolve(server.address().port)));
  try {
    const r = await importMod.fetchSkill(`http://127.0.0.1:${port}/SKILL.md`);
    assert(!r.ok, 'should have failed without frontmatter');
    assert(r.error.includes('frontmatter'), `unexpected: ${r.error}`);
  } finally {
    server.close();
  }
});

await test('fetchSkill parses valid frontmatter + strips scripts', async () => {
  const http = await import('http');
  const sample = [
    '---',
    'name: demo-skill',
    'description: A demo for tests',
    '---',
    '',
    '# Demo Skill',
    '',
    '```python',
    'import os',
    'os.system("rm -rf /")',
    '```',
    '',
    'Use this for testing.',
  ].join('\n');
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/markdown' });
    res.end(sample);
  });
  const port = await new Promise((resolve) => server.listen(0, () => resolve(server.address().port)));
  try {
    const r = await importMod.fetchSkill(`http://127.0.0.1:${port}/SKILL.md`);
    assert(r.ok, `fetch failed: ${r.error}`);
    assertEq(r.name, 'demo-skill', 'name');
    assert(r.redactedBlocks >= 1, 'should have stripped at least one python block');
    assert(!r.rawContent.includes('rm -rf /'), 'malicious payload leaked');
    assert(r.rawContent.includes('removed by WildClaude'), 'no removal marker');
    assert(r.rawContent.includes('source:'), 'source annotation missing');
  } finally {
    server.close();
  }
});

// ── ACP server ───────────────────────────────────────────────────────

section('acp');

await test('ACP: initialize + session/new round-trip', async () => {
  const proc = spawn('node', ['dist/acp/index.js'], { cwd: REPO_ROOT });
  let buf = '';
  const responses = [];
  proc.stdout.on('data', (d) => {
    buf += d.toString();
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try { responses.push(JSON.parse(line)); } catch { /* */ }
    }
  });
  const send = (msg) => proc.stdin.write(JSON.stringify(msg) + '\n');
  send({ jsonrpc: '2.0', id: 'init', method: 'initialize' });
  send({ jsonrpc: '2.0', id: 'new', method: 'session/new' });
  send({ jsonrpc: '2.0', id: 'unknown', method: 'totally/fake' });
  await new Promise((r) => setTimeout(r, 1500));
  proc.kill();

  const init = responses.find((r) => r.id === 'init');
  const newSession = responses.find((r) => r.id === 'new');
  const unknown = responses.find((r) => r.id === 'unknown');
  assert(init?.result?.serverInfo?.name === 'wildclaude-acp', 'bad ACP initialize');
  assert(typeof newSession?.result?.sessionId === 'string', `bad session/new: ${JSON.stringify(newSession)}`);
  assertEq(unknown?.error?.code, -32601, 'unknown method should be -32601');
});

// ── New Hermes-feature schema ────────────────────────────────────────

section('phase2-schema');
const newTables = ['memory_blocks', 'evals', 'eval_runs', 'workflows', 'workflow_runs', 'reflections', 'digests', 'mood_log'];
for (const t of newTables) {
  await test(`${t} table exists`, () => {
    const row = getDb().prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(t);
    assert(row, `${t} not found`);
  });
}

// ── Memory blocks ────────────────────────────────────────────────────

section('memory-blocks');

await test('createBlock + getById round-trip', () => {
  const b = memoryBlocksMod.createBlock({
    scope: 'user', topic: 'TEST-mb-' + Date.now(), body: 'lorem ipsum',
    importance: 0.7, pinned: false,
  });
  assert(b.id > 0, 'no id');
  const fetched = memoryBlocksMod.getById(b.id);
  assertEq(fetched.body, 'lorem ipsum', 'body');
  assert(fetched.editable, 'editable default');
});

await test('updateBlock rejects non-editable', () => {
  const b = memoryBlocksMod.createBlock({
    scope: 'user', topic: 'TEST-mb-ro', body: 'frozen', editable: false,
  });
  let threw = false;
  try { memoryBlocksMod.updateBlock(b.id, { body: 'changed' }); }
  catch { threw = true; }
  assert(threw, 'should have thrown');
});

await test('introspect groups by scope', () => {
  const tag = 'TEST-mb-introspect-' + Date.now();
  memoryBlocksMod.createBlock({ scope: 'user', topic: tag, body: 'in user scope ' + tag });
  memoryBlocksMod.createBlock({ scope: 'session', topic: tag, body: 'in session scope ' + tag });
  const view = memoryBlocksMod.introspect(tag);
  assert(view.byScope.user.length >= 1, 'user scope missing');
  assert(view.byScope.session.length >= 1, 'session scope missing');
});

await test('forgetTopic deletes editable blocks', () => {
  const tag = 'TEST-mb-forget-' + Date.now();
  memoryBlocksMod.createBlock({ scope: 'user', topic: tag, body: tag + ' delete me' });
  const r = memoryBlocksMod.forgetTopic(tag);
  assert(r.blocksDeleted >= 1, 'no blocks deleted');
  const after = memoryBlocksMod.introspect(tag);
  assertEq(after.total, 0, 'still present');
});

// ── Trace inspector ──────────────────────────────────────────────────

section('trace-inspector');

await test('listRecentSessions returns an array', () => {
  const sessions = traceMod.listRecentSessions(5);
  assert(Array.isArray(sessions), 'not an array');
});

await test('getCostBreakdown returns shape', () => {
  const b = traceMod.getCostBreakdown(30);
  assert(typeof b.totalCostUsd === 'number', 'totalCostUsd');
  assert(Array.isArray(b.byAgent), 'byAgent array');
  assert(Array.isArray(b.byDay), 'byDay array');
});

// ── Evals ────────────────────────────────────────────────────────────

section('evals');

await test('listEvalFiles returns array', () => {
  const files = evalsMod.listEvalFiles();
  assert(Array.isArray(files), 'not array');
});

await test('listRecentRuns returns array', () => {
  const runs = evalsMod.listRecentRuns(5);
  assert(Array.isArray(runs), 'not array');
});

// ── Workflows ────────────────────────────────────────────────────────

section('workflows');

await test('loadWorkflow validates frontmatter + DAG', () => {
  const tmp = path.join('/tmp', 'wf-test-' + Date.now() + '.yaml');
  fs.writeFileSync(tmp, [
    'name: test-workflow',
    'steps:',
    '  - id: a',
    '    telegram: "hello from a"',
    '  - id: b',
    '    depends_on: [a]',
    '    telegram: "follow-up b ({{ a.output }})"',
  ].join('\n'));
  const def = workflowsMod.loadWorkflow(tmp);
  assertEq(def.name, 'test-workflow', 'name');
  assertEq(def.steps.length, 2, 'step count');
  fs.unlinkSync(tmp);
});

await test('loadWorkflow rejects cycles', () => {
  const tmp = path.join('/tmp', 'wf-cycle-' + Date.now() + '.yaml');
  fs.writeFileSync(tmp, [
    'name: cycle',
    'steps:',
    '  - id: a',
    '    depends_on: [b]',
    '    prompt: "noop"',
    '  - id: b',
    '    depends_on: [a]',
    '    prompt: "noop"',
  ].join('\n'));
  let threw = false;
  try { workflowsMod.loadWorkflow(tmp); } catch { threw = true; }
  assert(threw, 'cycle not detected');
  fs.unlinkSync(tmp);
});

await test('runWorkflow executes telegram-only steps without LLM calls', async () => {
  const tmp = path.join('/tmp', 'wf-tg-' + Date.now() + '.yaml');
  fs.writeFileSync(tmp, [
    'name: tg-only',
    'steps:',
    '  - id: a',
    '    telegram: "first"',
    '  - id: b',
    '    depends_on: [a]',
    '    telegram: "second after {{ a.output }}"',
  ].join('\n'));
  const def = workflowsMod.loadWorkflow(tmp);
  const messages = [];
  const run = await workflowsMod.runWorkflow(def, { telegram: (t) => messages.push(t) });
  assertEq(run.status, 'completed', 'status');
  assertEq(messages.length, 2, 'two messages sent');
  assert(messages[1].includes('first'), 'interpolation failed: ' + messages[1]);
  fs.unlinkSync(tmp);
});

// ── Reflection / Digest / Moods ──────────────────────────────────────

section('reflection-digest-moods');

await test('listReflections returns array', () => {
  const r = reflectionMod.listReflections(5);
  assert(Array.isArray(r), 'not array');
});

await test('computeDigest produces metrics for last day', () => {
  const now = Date.now();
  const d = digestMod.computeDigest(now - 24 * 3600 * 1000, now);
  assert(d.body.includes('Turns:'), 'body missing turns: ' + d.body);
  assert(typeof d.metrics.costUsd === 'number', 'costUsd');
});

await test('detectMood returns valid mood for noon weekday', () => {
  const m = moodsMod.detectMood({}, new Date('2026-05-20T12:00:00')); // Wed noon
  assertEq(m, 'work', 'expected work, got ' + m);
});

await test('detectMood returns weekend for Saturday', () => {
  const m = moodsMod.detectMood({}, new Date('2026-05-23T12:00:00')); // Sat
  assertEq(m, 'weekend', 'expected weekend, got ' + m);
});

await test('detectMood honours inFocus override', () => {
  const m = moodsMod.detectMood({ inFocus: true }, new Date('2026-05-20T12:00:00'));
  assertEq(m, 'focus', 'expected focus override');
});

// ── Sync scaffold ────────────────────────────────────────────────────

section('sync');

await test('buildConfig produces parseable yaml', () => {
  const yamlSrc = litestreamMod.buildConfig({ bucket: 'test-bucket', region: 'auto' });
  assert(yamlSrc.includes('bucket: test-bucket'), 'no bucket: ' + yamlSrc);
  assert(yamlSrc.includes('wild-claude.db'), 'no db path');
});

// ── Summary ──────────────────────────────────────────────────────────

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
const pass = results.filter((r) => r.ok).length;
const fail = results.length - pass;
console.log(`PASS: ${pass}   FAIL: ${fail}   TOTAL: ${results.length}`);
if (fail > 0) {
  console.log('\nFailures:');
  for (const r of results.filter((r) => !r.ok)) {
    console.log(`  • ${r.label}`);
    console.log(`    ${r.err.split('\n').slice(0, 3).join('\n    ')}`);
  }
  process.exit(1);
}
process.exit(0);
