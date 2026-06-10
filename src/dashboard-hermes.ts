/**
 * Dashboard API routes for the Hermes-tier features:
 *   /api/traces, /api/traces/:sessionId, /api/cost-breakdown
 *   /api/memory-blocks, /api/memory-blocks/:id (PATCH/DELETE)
 *   /api/whatdoyouknow?q=
 *   /api/evals, /api/evals/run/:name, /api/evals/runs
 *   /api/workflows, /api/workflows/run/:name, /api/workflows/runs
 *   /api/reflections, /api/reflections/generate, /api/reflections/:id/ack
 *   /api/digest?period=day|week|month
 *   /api/skill-marketplace (proxies agentskills.io search)
 *   /api/sandboxes (list active + recent)
 *
 * Auth: all routes go through the existing dashboard token middleware (registered
 * by dashboard.ts before this function runs).
 */

import type { Hono } from 'hono';

import {
  listRecentSessions,
  getSessionTrace,
  getCostBreakdown,
} from './trace-inspector.js';
import {
  listAll as listAllBlocks,
  listByScope,
  updateBlock,
  deleteBlock,
  createBlock,
  introspect,
  Scope,
} from './memory-blocks.js';
import {
  listEvalFiles,
  loadEval,
  runEval,
  listRecentRuns as listEvalRuns,
  getEvalRaw,
  validateEvalContent,
  saveEval,
  deleteEvalFile,
  generateEval,
} from './evals.js';
import {
  listWorkflowFiles,
  loadWorkflow,
  runWorkflow,
  listRecentRuns as listWorkflowRuns,
  getRun as getWorkflowRun,
  getWorkflowRaw,
  validateWorkflowContent,
  saveWorkflow,
  deleteWorkflowFile,
  generateWorkflow,
} from './workflows.js';
import {
  listReflections,
  generateReflection,
  acknowledgeReflection,
} from './reflection.js';
import { computeDigest, persistDigest } from './digest.js';
import { listLiveSandboxes, listRecentSandboxes } from './sandbox/registry.js';
import { RECOMMENDED_SKILLS } from './recommended-skills.js';
import { getStats as getJuiceStats } from './token-juice.js';
import { getBudgetStatus } from './cost-budget.js';
import { getAuditLog } from './db.js';
import { selectTrajectories, estimateCost, convertToJsonl } from './finetune.js';
import { listPendingProposals as listAgentImprovementProposals, findStrugglingAgents, runSelfImprovementCycle, acceptAgentProposal, discardAgentProposal } from './agent-self-improvement.js';
import { introspectSemantic } from './memory-blocks.js';
import path from 'path';

export function registerHermesRoutes(app: Hono): void {
  // ── Traces ────────────────────────────────────────────────────────
  app.get('/api/traces', (c) => {
    const limit = parseInt(c.req.query('limit') ?? '25', 10);
    return c.json({ sessions: listRecentSessions(limit) });
  });

  app.get('/api/traces/:sessionId', (c) => {
    const sessionId = c.req.param('sessionId');
    const trace = getSessionTrace(sessionId);
    if (!trace) return c.json({ error: 'not found' }, 404);
    return c.json(trace);
  });

  app.get('/api/cost-breakdown', (c) => {
    const days = parseInt(c.req.query('days') ?? '30', 10);
    return c.json(getCostBreakdown(days));
  });

  // ── Memory blocks ─────────────────────────────────────────────────
  app.get('/api/memory-blocks', (c) => {
    const scope = c.req.query('scope') as Scope | undefined;
    if (scope && (scope === 'user' || scope === 'session' || scope === 'agent')) {
      return c.json({ blocks: listByScope(scope, c.req.query('owner'), 100) });
    }
    return c.json({ blocks: listAllBlocks(200) });
  });

  app.post('/api/memory-blocks', async (c) => {
    const body = await c.req.json() as {
      scope: Scope; owner?: string; topic: string; body: string;
      editable?: boolean; pinned?: boolean; importance?: number;
    };
    if (!body.topic || !body.body || !body.scope) {
      return c.json({ error: 'scope, topic, body required' }, 400);
    }
    const block = createBlock(body);
    return c.json(block, 201);
  });

  app.patch('/api/memory-blocks/:id', async (c) => {
    const id = parseInt(c.req.param('id'), 10);
    const patch = await c.req.json() as Parameters<typeof updateBlock>[1];
    try {
      const block = updateBlock(id, patch);
      if (!block) return c.json({ error: 'not found' }, 404);
      return c.json(block);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  app.delete('/api/memory-blocks/:id', (c) => {
    const id = parseInt(c.req.param('id'), 10);
    try {
      const ok = deleteBlock(id);
      return c.json({ ok });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  app.get('/api/whatdoyouknow', (c) => {
    const q = c.req.query('q') ?? '';
    if (!q.trim()) return c.json({ query: '', total: 0, byScope: { user: [], session: [], agent: [] } });
    return c.json(introspect(q));
  });

  // ── Evals ─────────────────────────────────────────────────────────
  app.get('/api/evals', (c) => {
    const files = listEvalFiles();
    const evals = files.map((f) => {
      try {
        const def = loadEval(f);
        return { file: path.basename(f), name: def.name, description: def.description, caseCount: def.cases.length };
      } catch (err) {
        return { file: path.basename(f), name: '(invalid)', error: err instanceof Error ? err.message : String(err) };
      }
    });
    return c.json({ evals, runs: listEvalRuns(20) });
  });

  app.post('/api/evals/run/:name', async (c) => {
    const name = c.req.param('name');
    const file = listEvalFiles().find((f) => path.basename(f).replace(/\.[^.]+$/, '') === name || path.basename(f) === name);
    if (!file) return c.json({ error: 'not found' }, 404);
    try {
      const def = loadEval(file);
      const run = await runEval(def);
      return c.json(run);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  });

  app.get('/api/evals/runs', (c) => {
    const limit = parseInt(c.req.query('limit') ?? '20', 10);
    return c.json({ runs: listEvalRuns(limit) });
  });

  // Authoring: raw content, create/update, delete, validate, LLM-generate.
  app.get('/api/evals/raw/:name', (c) => {
    const raw = getEvalRaw(c.req.param('name'));
    return raw ? c.json(raw) : c.json({ error: 'not found' }, 404);
  });
  app.post('/api/evals', async (c) => {
    const body = await c.req.json().catch(() => ({})) as { content?: string; name?: string };
    if (!body.content) return c.json({ error: 'content required' }, 400);
    const res = saveEval(body.content, body.name);
    return res.ok ? c.json({ ok: true, file: res.file }, 201) : c.json({ error: res.error }, 422);
  });
  app.post('/api/evals/validate', async (c) => {
    const body = await c.req.json().catch(() => ({})) as { content?: string };
    const v = validateEvalContent(body.content || '');
    return c.json({ ok: v.ok, error: v.error });
  });
  app.post('/api/evals/generate', async (c) => {
    const body = await c.req.json().catch(() => ({})) as { prompt?: string };
    if (!body.prompt) return c.json({ error: 'prompt required' }, 400);
    const res = await generateEval(body.prompt);
    return res.ok ? c.json({ content: res.content }) : c.json({ error: res.error }, 422);
  });
  app.delete('/api/evals/:name', (c) =>
    deleteEvalFile(c.req.param('name')) ? c.json({ ok: true }) : c.json({ error: 'not found' }, 404));

  // ── Workflows ─────────────────────────────────────────────────────
  app.get('/api/workflows', (c) => {
    const files = listWorkflowFiles();
    const workflows = files.map((f) => {
      try {
        const def = loadWorkflow(f);
        return { file: path.basename(f), name: def.name, description: def.description, stepCount: def.steps.length };
      } catch (err) {
        return { file: path.basename(f), name: '(invalid)', error: err instanceof Error ? err.message : String(err) };
      }
    });
    return c.json({ workflows, runs: listWorkflowRuns(20) });
  });

  app.post('/api/workflows/run/:name', async (c) => {
    const name = c.req.param('name');
    const file = listWorkflowFiles().find((f) => path.basename(f).replace(/\.[^.]+$/, '') === name || path.basename(f) === name);
    if (!file) return c.json({ error: 'not found' }, 404);
    try {
      const def = loadWorkflow(file);
      const run = await runWorkflow(def);
      return c.json(run);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  });

  app.get('/api/workflows/runs', (c) => {
    const limit = parseInt(c.req.query('limit') ?? '20', 10);
    return c.json({ runs: listWorkflowRuns(limit) });
  });

  app.get('/api/workflows/runs/:id', (c) => {
    const id = c.req.param('id');
    const run = getWorkflowRun(id);
    if (!run) return c.json({ error: 'not found' }, 404);
    return c.json(run);
  });

  // Authoring: raw content, create/update, delete, validate, LLM-generate.
  app.get('/api/workflows/raw/:name', (c) => {
    const raw = getWorkflowRaw(c.req.param('name'));
    return raw ? c.json(raw) : c.json({ error: 'not found' }, 404);
  });
  app.post('/api/workflows', async (c) => {
    const body = await c.req.json().catch(() => ({})) as { content?: string; name?: string };
    if (!body.content) return c.json({ error: 'content required' }, 400);
    const res = saveWorkflow(body.content, body.name);
    return res.ok ? c.json({ ok: true, file: res.file }, 201) : c.json({ error: res.error }, 422);
  });
  app.post('/api/workflows/validate', async (c) => {
    const body = await c.req.json().catch(() => ({})) as { content?: string };
    const v = validateWorkflowContent(body.content || '');
    return c.json({ ok: v.ok, error: v.error });
  });
  app.post('/api/workflows/generate', async (c) => {
    const body = await c.req.json().catch(() => ({})) as { prompt?: string };
    if (!body.prompt) return c.json({ error: 'prompt required' }, 400);
    const res = await generateWorkflow(body.prompt);
    return res.ok ? c.json({ content: res.content }) : c.json({ error: res.error }, 422);
  });
  app.delete('/api/workflows/:name', (c) =>
    deleteWorkflowFile(c.req.param('name')) ? c.json({ ok: true }) : c.json({ error: 'not found' }, 404));

  // ── Reflection ────────────────────────────────────────────────────
  app.get('/api/reflections', (c) => {
    const limit = parseInt(c.req.query('limit') ?? '10', 10);
    return c.json({ reflections: listReflections(limit) });
  });

  app.post('/api/reflections/generate', async (c) => {
    const body = await c.req.json().catch(() => ({})) as { period?: 'day' | 'week' };
    const period = body.period === 'week' ? 'week' : 'day';
    try {
      const r = await generateReflection(period);
      return c.json({ reflection: r });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  });

  app.post('/api/reflections/:id/ack', (c) => {
    const id = parseInt(c.req.param('id'), 10);
    const ok = acknowledgeReflection(id);
    return c.json({ ok });
  });

  // ── Digest ────────────────────────────────────────────────────────
  app.get('/api/digest', (c) => {
    const period = c.req.query('period') ?? 'day';
    const now = Date.now();
    const days = period === 'week' ? 7 : period === 'month' ? 30 : 1;
    const start = now - days * 24 * 3600 * 1000;
    const d = computeDigest(start, now);
    persistDigest(d);
    return c.json(d);
  });

  // ── Sandboxes ─────────────────────────────────────────────────────
  app.get('/api/sandboxes', (c) => {
    return c.json({
      live: listLiveSandboxes(),
      recent: listRecentSandboxes(30),
    });
  });

  // ── Recommended skills (curated, ships with the app) ───────────────
  app.get('/api/skill-marketplace/recommended', (c) => {
    return c.json({ skills: RECOMMENDED_SKILLS });
  });

  // ── Token Juice stats ──────────────────────────────────────────────
  app.get('/api/tokenjuice', (c) => {
    const s = getJuiceStats();
    const ratio = s.bytesIn === 0 ? 0 : 1 - s.bytesOut / s.bytesIn;
    const dollarsSaved = (s.estTokensSaved / 1_000_000) * 3.00; // Sonnet input rate proxy
    return c.json({ ...s, ratio, dollarsSaved });
  });

  // ── Budget status ──────────────────────────────────────────────────
  app.get('/api/budget', (c) => c.json(getBudgetStatus()));

  // ── Audit log ──────────────────────────────────────────────────────
  app.get('/api/audit-log', (c) => {
    const limit = parseInt(c.req.query('limit') ?? '100', 10);
    const filterBlocked = c.req.query('blocked') === 'true';
    let rows = getAuditLog(limit, 0);
    if (filterBlocked) rows = rows.filter((r) => r.blocked === 1);
    return c.json({ entries: rows });
  });

  // ── Semantic memory search ─────────────────────────────────────────
  app.get('/api/memory-search', async (c) => {
    const q = c.req.query('q') ?? '';
    if (!q.trim()) return c.json({ query: '', total: 0, byScope: { user: [], session: [], agent: [] }, semantic: false });
    return c.json(await introspectSemantic(q));
  });

  // ── Fine-tune estimates ────────────────────────────────────────────
  app.get('/api/finetune/estimate', (c) => {
    const days = parseInt(c.req.query('days') ?? '30', 10);
    const sinceSec = Math.floor((Date.now() - days * 24 * 3600 * 1000) / 1000);
    const pairs = selectTrajectories({ since: sinceSec, limit: 2000 });
    return c.json({ ...estimateCost(pairs), days });
  });

  app.post('/api/finetune/build', async (c) => {
    const body = await c.req.json().catch(() => ({})) as { days?: number };
    const days = body.days ?? 30;
    const sinceSec = Math.floor((Date.now() - days * 24 * 3600 * 1000) / 1000);
    const pairs = selectTrajectories({ since: sinceSec, limit: 5000 });
    const outputPath = convertToJsonl(pairs);
    return c.json({ outputPath, pairs: pairs.length });
  });

  // ── Agent self-improvement ─────────────────────────────────────────
  app.get('/api/agent-improve', (c) => {
    return c.json({
      struggling: findStrugglingAgents(),
      pendingProposals: listAgentImprovementProposals(),
    });
  });

  app.post('/api/agent-improve/run', async (c) => {
    const proposals = await runSelfImprovementCycle();
    return c.json({ proposals });
  });

  app.post('/api/agent-improve/accept', async (c) => {
    const body = await c.req.json() as { proposalPath: string; agentId: string };
    const r = acceptAgentProposal(body.proposalPath, body.agentId);
    return c.json(r);
  });

  app.post('/api/agent-improve/discard', async (c) => {
    const body = await c.req.json() as { proposalPath: string };
    return c.json({ ok: discardAgentProposal(body.proposalPath) });
  });

  // ── Skill marketplace (proxy) ─────────────────────────────────────
  app.get('/api/skill-marketplace', async (c) => {
    const q = c.req.query('q') ?? '';
    try {
      const url = `https://agentskills.io/api/skills?q=${encodeURIComponent(q)}&limit=30`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'WildClaude-Dashboard/0.1', Accept: 'application/json' },
      });
      if (!res.ok) return c.json({ error: `Upstream ${res.status}`, items: [] }, 200);
      const data = await res.json().catch(() => ({ items: [] }));
      return c.json(data);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err), items: [] });
    }
  });
}
