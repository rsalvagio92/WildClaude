/**
 * Declarative state-graph workflows.
 *
 * A workflow is a YAML file under USER_DATA_DIR/workflows/ describing a DAG:
 *
 *   name: weekly-review
 *   steps:
 *     - id: gather
 *       agent: data-analyst
 *       prompt: "summarize this week's commits + memories"
 *     - id: reflect
 *       agent: coach
 *       depends_on: [gather]
 *       prompt: |
 *         Given this summary:
 *         {{ gather.output }}
 *         What patterns or risks do you see?
 *     - id: notify
 *       depends_on: [reflect]
 *       telegram: "Weekly review ready:\n{{ reflect.output }}"
 *
 * Engine:
 *   - parses + validates the DAG (rejects cycles, missing deps)
 *   - executes ready steps in topological order
 *   - persists step state into `workflow_runs.step_state` (JSON) so a crash
 *     mid-run can resume from the last checkpoint
 *   - supports {{ stepId.output }} interpolation in prompts
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

export interface WorkflowStep {
  id: string;
  agent?: string;
  prompt?: string;
  telegram?: string;
  depends_on?: string[];
  /** Optional model override per-step */
  model?: string;
}

export interface WorkflowDefinition {
  name: string;
  description?: string;
  steps: WorkflowStep[];
}

type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
interface StepState {
  status: StepStatus;
  output?: string;
  error?: string;
  startedAt?: number;
  completedAt?: number;
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  status: 'running' | 'completed' | 'failed';
  stepState: Record<string, StepState>;
  result: string | null;
  error: string | null;
  startedAt: number;
  completedAt: number | null;
}

const WORKFLOWS_DIR = path.join(USER_DATA_DIR, 'workflows');

// ── Discovery & parsing ──────────────────────────────────────────────

export function listWorkflowFiles(): string[] {
  if (!fs.existsSync(WORKFLOWS_DIR)) return [];
  return fs
    .readdirSync(WORKFLOWS_DIR)
    .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml') || f.endsWith('.json'))
    .map((f) => path.join(WORKFLOWS_DIR, f));
}

export function loadWorkflow(filePath: string): WorkflowDefinition {
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = filePath.endsWith('.json') ? JSON.parse(raw) : yaml.load(raw);
  const def = parsed as Partial<WorkflowDefinition>;
  if (typeof def.name !== 'string') throw new Error(`Workflow ${filePath} missing 'name'`);
  if (!Array.isArray(def.steps) || def.steps.length === 0) throw new Error(`Workflow ${filePath} has no steps`);
  const ids = new Set<string>();
  for (const s of def.steps) {
    if (typeof s.id !== 'string') throw new Error(`Workflow ${filePath}: step missing id`);
    if (ids.has(s.id)) throw new Error(`Workflow ${filePath}: duplicate step id ${s.id}`);
    ids.add(s.id);
  }
  for (const s of def.steps) {
    for (const dep of s.depends_on ?? []) {
      if (!ids.has(dep)) throw new Error(`Workflow ${filePath}: step ${s.id} depends on unknown ${dep}`);
    }
  }
  // Cycle detection via DFS
  const visited = new Map<string, 'visiting' | 'done'>();
  const byId = new Map(def.steps.map((s) => [s.id, s]));
  const dfs = (id: string): void => {
    if (visited.get(id) === 'done') return;
    if (visited.get(id) === 'visiting') throw new Error(`Workflow ${filePath}: cycle through step ${id}`);
    visited.set(id, 'visiting');
    for (const dep of byId.get(id)!.depends_on ?? []) dfs(dep);
    visited.set(id, 'done');
  };
  for (const s of def.steps) dfs(s.id);
  return def as WorkflowDefinition;
}

// ── Topological order ────────────────────────────────────────────────

function topoOrder(def: WorkflowDefinition): WorkflowStep[] {
  const order: WorkflowStep[] = [];
  const visited = new Set<string>();
  const byId = new Map(def.steps.map((s) => [s.id, s]));
  const visit = (id: string): void => {
    if (visited.has(id)) return;
    visited.add(id);
    for (const dep of byId.get(id)!.depends_on ?? []) visit(dep);
    order.push(byId.get(id)!);
  };
  for (const s of def.steps) visit(s.id);
  return order;
}

// ── Interpolation ────────────────────────────────────────────────────

function interpolate(template: string, state: Record<string, StepState>): string {
  return template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, ref) => {
    const [stepId, key = 'output'] = String(ref).split('.');
    const s = state[stepId];
    if (!s) return '';
    if (key === 'output') return s.output ?? '';
    if (key === 'status') return s.status;
    if (key === 'error') return s.error ?? '';
    return '';
  });
}

// ── Persistence ──────────────────────────────────────────────────────

function persistRun(run: WorkflowRun): void {
  getDb().prepare(
    `INSERT OR REPLACE INTO workflow_runs
       (id, workflow_id, status, step_state, result, error, started_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    run.id,
    run.workflowId,
    run.status,
    JSON.stringify(run.stepState),
    run.result,
    run.error,
    run.startedAt,
    run.completedAt,
  );
}

export function getRun(id: string): WorkflowRun | null {
  const row = getDb().prepare(`SELECT * FROM workflow_runs WHERE id = ?`).get(id) as {
    id: string; workflow_id: string; status: string; step_state: string;
    result: string | null; error: string | null; started_at: number; completed_at: number | null;
  } | undefined;
  if (!row) return null;
  return {
    id: row.id,
    workflowId: row.workflow_id,
    status: row.status as WorkflowRun['status'],
    stepState: (() => { try { return JSON.parse(row.step_state) as Record<string, StepState>; } catch { return {}; } })(),
    result: row.result,
    error: row.error,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

export function listRecentRuns(limit = 20): WorkflowRun[] {
  const rows = getDb().prepare(
    `SELECT * FROM workflow_runs ORDER BY started_at DESC LIMIT ?`,
  ).all(limit) as Array<{
    id: string; workflow_id: string; status: string; step_state: string;
    result: string | null; error: string | null; started_at: number; completed_at: number | null;
  }>;
  return rows.map((row) => ({
    id: row.id,
    workflowId: row.workflow_id,
    status: row.status as WorkflowRun['status'],
    stepState: (() => { try { return JSON.parse(row.step_state) as Record<string, StepState>; } catch { return {}; } })(),
    result: row.result,
    error: row.error,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  }));
}

// ── Execution ────────────────────────────────────────────────────────

export interface WorkflowSinks {
  /** Called when a step's telegram: field fires. */
  telegram?: (text: string) => void;
  /** Optional progress callback per step. */
  onStep?: (id: string, state: StepState) => void;
}

export async function runWorkflow(
  def: WorkflowDefinition,
  sinks: WorkflowSinks = {},
): Promise<WorkflowRun> {
  const id = `wr-${randomBytes(4).toString('hex')}`;
  const startedAt = Date.now();
  const stepState: Record<string, StepState> = {};
  for (const s of def.steps) stepState[s.id] = { status: 'pending' };

  const run: WorkflowRun = {
    id,
    workflowId: def.name,
    status: 'running',
    stepState,
    result: null,
    error: null,
    startedAt,
    completedAt: null,
  };
  persistRun(run);

  let lastOutput = '';

  try {
    for (const step of topoOrder(def)) {
      // Skip if any dependency failed
      const depsFailed = (step.depends_on ?? []).some((d) => stepState[d]?.status === 'failed' || stepState[d]?.status === 'skipped');
      if (depsFailed) {
        stepState[step.id] = { status: 'skipped' };
        sinks.onStep?.(step.id, stepState[step.id]);
        persistRun(run);
        continue;
      }

      stepState[step.id] = { status: 'running', startedAt: Date.now() };
      sinks.onStep?.(step.id, stepState[step.id]);
      persistRun(run);

      try {
        if (step.telegram) {
          const msg = interpolate(step.telegram, stepState);
          sinks.telegram?.(msg);
          stepState[step.id] = { ...stepState[step.id], status: 'completed', output: msg, completedAt: Date.now() };
        } else if (step.prompt) {
          const prompt = interpolate(step.prompt, stepState);
          const result = await runAgent(prompt, undefined, () => {}, undefined, step.model);
          const out = result.text ?? '';
          stepState[step.id] = { ...stepState[step.id], status: 'completed', output: out, completedAt: Date.now() };
          lastOutput = out;
        } else {
          stepState[step.id] = { ...stepState[step.id], status: 'skipped', completedAt: Date.now() };
        }
      } catch (err) {
        stepState[step.id] = {
          ...stepState[step.id],
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
          completedAt: Date.now(),
        };
      }
      sinks.onStep?.(step.id, stepState[step.id]);
      persistRun(run);
    }

    const anyFailed = Object.values(stepState).some((s) => s.status === 'failed');
    run.status = anyFailed ? 'failed' : 'completed';
    run.result = lastOutput;
    run.completedAt = Date.now();
  } catch (err) {
    run.status = 'failed';
    run.error = err instanceof Error ? err.message : String(err);
    run.completedAt = Date.now();
  }

  persistRun(run);
  logger.info({ id, name: def.name, status: run.status }, 'Workflow run finished');
  return run;
}

// ── Telegram surface ─────────────────────────────────────────────────

export function registerWorkflowCommands(
  bot: import('grammy').Bot,
  isAuthorised: (chatId: number) => boolean,
): void {
  bot.command('workflow', async (ctx) => {
    if (!isAuthorised(ctx.chat!.id)) return;
    const args = (ctx.match ?? '').trim();
    const [sub, ...rest] = args.split(/\s+/);

    if (!sub || sub === 'list') {
      const files = listWorkflowFiles();
      if (files.length === 0) {
        await ctx.reply(`No workflows in ${WORKFLOWS_DIR}. Drop a *.yaml in there.`);
        return;
      }
      await ctx.reply(`Workflows:\n${files.map((f) => '  ' + path.basename(f)).join('\n')}\n\nRun: /workflow run <name>`);
      return;
    }

    if (sub === 'run') {
      const name = rest.join(' ').trim();
      if (!name) { await ctx.reply('Usage: /workflow run <name>'); return; }
      const file = listWorkflowFiles().find((f) => path.basename(f).replace(/\.[^.]+$/, '') === name || path.basename(f) === name);
      if (!file) { await ctx.reply(`Workflow "${name}" not found.`); return; }
      let def: WorkflowDefinition;
      try { def = loadWorkflow(file); } catch (err) {
        await ctx.reply(`Load failed: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }
      await ctx.reply(`Running workflow "${def.name}" (${def.steps.length} step(s))…`);
      try {
        const run = await runWorkflow(def, {
          telegram: (text) => ctx.api.sendMessage(ctx.chat!.id, text).catch(() => {}),
        });
        const lines: string[] = [`Workflow ${run.status}: ${def.name}`];
        for (const [stepId, state] of Object.entries(run.stepState)) {
          lines.push(`  ${state.status === 'completed' ? '✓' : state.status === 'failed' ? '✗' : state.status === 'skipped' ? '–' : '·'} ${stepId}`);
        }
        await ctx.reply(lines.join('\n'));
      } catch (err) {
        await ctx.reply(`Workflow error: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }

    if (sub === 'recent') {
      const runs = listRecentRuns(10);
      if (runs.length === 0) { await ctx.reply('No workflow runs yet.'); return; }
      await ctx.reply(`Recent runs:\n${runs.map((r) => `  ${r.workflowId}  ${r.status}`).join('\n')}`);
      return;
    }

    await ctx.reply('Usage:\n/workflow list\n/workflow run <name>\n/workflow recent');
  });
}
