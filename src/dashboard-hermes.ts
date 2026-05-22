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
} from './evals.js';
import {
  listWorkflowFiles,
  loadWorkflow,
  runWorkflow,
  listRecentRuns as listWorkflowRuns,
  getRun as getWorkflowRun,
} from './workflows.js';
import {
  listReflections,
  generateReflection,
  acknowledgeReflection,
} from './reflection.js';
import { computeDigest, persistDigest } from './digest.js';
import { listLiveSandboxes, listRecentSandboxes } from './sandbox/registry.js';
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
