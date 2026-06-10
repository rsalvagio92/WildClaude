/**
 * Evals framework — declarative "when X, expect Y" test cases.
 *
 * An eval is a YAML or JSON file under USER_DATA_DIR/evals/ describing one
 * or more cases:
 *
 *   name: morning-routine
 *   cases:
 *     - prompt: "what's on my schedule today?"
 *       expect:
 *         contains: ["focus", "blocked"]
 *         tools: ["Read", "Bash"]
 *     - prompt: "summarize last week"
 *       expect:
 *         contains_any: ["week", "summary"]
 *
 * Runner invokes runAgent() for each case, grades the result, persists the
 * run into `eval_runs`. Surfaces via /evals run + dashboard module.
 */

import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import yaml from 'js-yaml';

import { USER_DATA_DIR } from './paths.js';
import { getDb } from './db.js';
import { runAgent } from './agent.js';
import { logger } from './logger.js';

// ── Types ────────────────────────────────────────────────────────────

export interface EvalCase {
  prompt: string;
  expect: {
    contains?: string[];
    contains_any?: string[];
    not_contains?: string[];
    tools?: string[];
    min_length?: number;
    max_length?: number;
  };
}

export interface EvalDefinition {
  name: string;
  description?: string;
  model?: string;
  cases: EvalCase[];
}

export interface EvalCaseResult {
  prompt: string;
  passed: boolean;
  reasons: string[];
  response: string | null;
  toolsObserved: string[];
}

export interface EvalRun {
  id: string;
  evalId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  score: number;
  passed: number;
  total: number;
  details: EvalCaseResult[];
  startedAt: number;
  completedAt: number | null;
}

const EVALS_DIR = path.join(USER_DATA_DIR, 'evals');

// ── Discovery & parsing ──────────────────────────────────────────────

export function listEvalFiles(): string[] {
  if (!fs.existsSync(EVALS_DIR)) return [];
  return fs
    .readdirSync(EVALS_DIR)
    .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml') || f.endsWith('.json'))
    .map((f) => path.join(EVALS_DIR, f));
}

export function validateEvalObject(parsed: unknown, label = 'eval'): EvalDefinition {
  if (!parsed || typeof parsed !== 'object') throw new Error(`${label} did not parse to an object`);
  const def = parsed as Partial<EvalDefinition>;
  if (typeof def.name !== 'string') throw new Error(`${label} missing 'name'`);
  if (!Array.isArray(def.cases) || def.cases.length === 0) throw new Error(`${label} has no cases`);
  for (const [i, c] of def.cases.entries()) {
    if (!c || typeof (c as EvalCase).prompt !== 'string') throw new Error(`${label}: case ${i + 1} missing 'prompt'`);
  }
  return def as EvalDefinition;
}

export function loadEval(filePath: string): EvalDefinition {
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = filePath.endsWith('.json') ? (JSON.parse(raw) as unknown) : (yaml.load(raw) as unknown);
  return validateEvalObject(parsed, `Eval ${filePath}`);
}

// ── Authoring (create / edit / delete / generate) ────────────────────

const slugifyName = (s: string) => (s || 'eval').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'eval';

export function getEvalRaw(name: string): { file: string; content: string } | null {
  const file = listEvalFiles().find((f) => path.basename(f).replace(/\.[^.]+$/, '') === name || path.basename(f) === name);
  if (!file) return null;
  return { file: path.basename(file), content: fs.readFileSync(file, 'utf8') };
}

export function validateEvalContent(content: string): { ok: boolean; def?: EvalDefinition; error?: string } {
  try {
    const parsed = yaml.load(content);
    return { ok: true, def: validateEvalObject(parsed, 'eval') };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function saveEval(content: string, name?: string): { ok: boolean; file?: string; error?: string } {
  const v = validateEvalContent(content);
  if (!v.ok || !v.def) return { ok: false, error: v.error };
  fs.mkdirSync(EVALS_DIR, { recursive: true });
  const slug = slugifyName(name || v.def.name);
  const file = path.join(EVALS_DIR, `${slug}.yaml`);
  fs.writeFileSync(file, content, 'utf8');
  return { ok: true, file: path.basename(file) };
}

export function deleteEvalFile(name: string): boolean {
  const file = listEvalFiles().find((f) => path.basename(f).replace(/\.[^.]+$/, '') === name || path.basename(f) === name);
  if (!file) return false;
  try { fs.unlinkSync(file); return true; } catch { return false; }
}

const EVAL_GEN_PROMPT = (request: string) => `Design a WildClaude eval (declarative agent test cases) for this request and output ONLY YAML — no prose, no code fence.

Request: "${request}"

YAML schema:
name: kebab-or-words
description: one line
# model: optional model override
cases:
  - prompt: the message to send the agent
    expect:
      contains: ["substring that must appear"]      # optional
      contains_any: ["either", "or"]                  # optional
      not_contains: ["must not appear"]               # optional
      tools: ["tool_name"]                            # optional — tools that must be used
      min_length: 20                                  # optional
      max_length: 2000                                # optional

Rules: 2-5 realistic cases; every case needs a prompt and at least one expectation; keep assertions robust (avoid brittle exact matches).`;

export async function generateEval(request: string): Promise<{ ok: boolean; content?: string; error?: string }> {
  try {
    const { runAgent } = await import('./agent.js');
    const { MODELS } = await import('./models.js');
    const result = await runAgent(EVAL_GEN_PROMPT(request), undefined, () => {}, undefined, MODELS.sonnet);
    let raw = (result.text || '').trim();
    const fence = raw.match(/```(?:ya?ml)?\s*([\s\S]*?)```/);
    if (fence) raw = fence[1].trim();
    const v = validateEvalContent(raw);
    if (!v.ok) return { ok: false, error: 'Generated eval was invalid: ' + v.error };
    return { ok: true, content: raw };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'generation failed' };
  }
}

// ── Grading ──────────────────────────────────────────────────────────

function grade(c: EvalCase, response: string | null, tools: string[]): { passed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const text = response ?? '';
  const expect = c.expect ?? {};

  if (expect.contains) {
    for (const needle of expect.contains) {
      if (!text.toLowerCase().includes(needle.toLowerCase())) {
        reasons.push(`missing: "${needle}"`);
      }
    }
  }
  if (expect.contains_any && expect.contains_any.length > 0) {
    const any = expect.contains_any.some((n) => text.toLowerCase().includes(n.toLowerCase()));
    if (!any) reasons.push(`none of: ${expect.contains_any.join(', ')}`);
  }
  if (expect.not_contains) {
    for (const needle of expect.not_contains) {
      if (text.toLowerCase().includes(needle.toLowerCase())) {
        reasons.push(`forbidden: "${needle}"`);
      }
    }
  }
  if (expect.tools) {
    for (const t of expect.tools) {
      if (!tools.includes(t)) reasons.push(`tool not used: ${t}`);
    }
  }
  if (expect.min_length !== undefined && text.length < expect.min_length) {
    reasons.push(`response too short (${text.length} < ${expect.min_length})`);
  }
  if (expect.max_length !== undefined && text.length > expect.max_length) {
    reasons.push(`response too long (${text.length} > ${expect.max_length})`);
  }

  return { passed: reasons.length === 0, reasons };
}

// ── Runner ───────────────────────────────────────────────────────────

export async function runEval(def: EvalDefinition, evalId?: string): Promise<EvalRun> {
  const id = `er-${randomBytes(4).toString('hex')}`;
  const startedAt = Date.now();
  const resolvedEvalId = evalId ?? def.name;

  getDb().prepare(
    `INSERT INTO eval_runs (id, eval_id, status, started_at, total)
     VALUES (?, ?, 'running', ?, ?)`,
  ).run(id, resolvedEvalId, startedAt, def.cases.length);

  const details: EvalCaseResult[] = [];
  let passed = 0;

  for (const c of def.cases) {
    const tools: string[] = [];
    let response: string | null = null;
    try {
      const result = await runAgent(
        c.prompt,
        undefined,
        () => {},
        (ev) => {
          if (ev.type === 'tool_active') {
            // ev.description is "ToolName: ..."
            const name = ev.description.split(':')[0]!.split(' ')[0]!;
            if (name) tools.push(name);
          }
        },
        def.model,
      );
      response = result.text;
    } catch (err) {
      details.push({
        prompt: c.prompt,
        passed: false,
        reasons: [`exception: ${err instanceof Error ? err.message : String(err)}`],
        response: null,
        toolsObserved: tools,
      });
      continue;
    }
    const graded = grade(c, response, tools);
    if (graded.passed) passed++;
    details.push({
      prompt: c.prompt,
      passed: graded.passed,
      reasons: graded.reasons,
      response,
      toolsObserved: tools,
    });
  }

  const completedAt = Date.now();
  const score = def.cases.length === 0 ? 0 : passed / def.cases.length;

  getDb().prepare(
    `UPDATE eval_runs
        SET status = ?, score = ?, passed = ?, details = ?, completed_at = ?
      WHERE id = ?`,
  ).run('completed', score, passed, JSON.stringify(details), completedAt, id);

  logger.info({ id, name: def.name, passed, total: def.cases.length, score }, 'Eval run completed');

  return {
    id,
    evalId: resolvedEvalId,
    status: 'completed',
    score,
    passed,
    total: def.cases.length,
    details,
    startedAt,
    completedAt,
  };
}

export function listRecentRuns(limit = 20): EvalRun[] {
  const rows = getDb().prepare(
    `SELECT id, eval_id, status, score, passed, total, details, started_at, completed_at
       FROM eval_runs
      ORDER BY started_at DESC
      LIMIT ?`,
  ).all(limit) as Array<{
    id: string; eval_id: string; status: string; score: number | null;
    passed: number; total: number; details: string;
    started_at: number; completed_at: number | null;
  }>;
  return rows.map((r) => ({
    id: r.id,
    evalId: r.eval_id,
    status: r.status as EvalRun['status'],
    score: r.score ?? 0,
    passed: r.passed,
    total: r.total,
    details: (() => { try { return JSON.parse(r.details) as EvalCaseResult[]; } catch { return []; } })(),
    startedAt: r.started_at,
    completedAt: r.completed_at,
  }));
}

// ── Telegram surface ─────────────────────────────────────────────────

export function registerEvalCommands(
  bot: import('grammy').Bot,
  isAuthorised: (chatId: number) => boolean,
): void {
  bot.command('evals', async (ctx) => {
    if (!isAuthorised(ctx.chat!.id)) return;
    const args = (ctx.match ?? '').trim();
    const [sub, ...rest] = args.split(/\s+/);

    if (!sub || sub === 'list') {
      const files = listEvalFiles();
      if (files.length === 0) {
        await ctx.reply(`No eval files found in ${EVALS_DIR}. Drop a *.yaml in there and try again.`);
        return;
      }
      await ctx.reply(`Evals:\n${files.map((f) => '  ' + path.basename(f)).join('\n')}\n\nRun: /evals run <name>`);
      return;
    }

    if (sub === 'run') {
      const name = rest.join(' ').trim();
      if (!name) {
        await ctx.reply('Usage: /evals run <name>');
        return;
      }
      const file = listEvalFiles().find((f) => path.basename(f).replace(/\.[^.]+$/, '') === name || path.basename(f) === name);
      if (!file) {
        await ctx.reply(`Eval "${name}" not found.`);
        return;
      }
      let def: EvalDefinition;
      try { def = loadEval(file); } catch (err) {
        await ctx.reply(`Failed to load: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }
      await ctx.reply(`Running ${def.cases.length} case(s) for "${def.name}"…`);
      try {
        const run = await runEval(def);
        await ctx.reply(
          `Eval done: ${run.passed}/${run.total} passed (${(run.score * 100).toFixed(0)}%)\n` +
          run.details.slice(0, 5).map((d) => `  ${d.passed ? '✓' : '✗'} ${d.prompt.slice(0, 60)}${d.reasons.length ? '\n     ' + d.reasons.join('; ') : ''}`).join('\n'),
        );
      } catch (err) {
        await ctx.reply(`Eval failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }

    if (sub === 'recent') {
      const runs = listRecentRuns(10);
      if (runs.length === 0) { await ctx.reply('No eval runs yet.'); return; }
      const lines = runs.map((r) => `  ${r.evalId}  ${r.passed}/${r.total}  ${(r.score * 100).toFixed(0)}%`);
      await ctx.reply(`Recent eval runs:\n${lines.join('\n')}`);
      return;
    }

    await ctx.reply('Usage:\n/evals list\n/evals run <name>\n/evals recent');
  });
}
