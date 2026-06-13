/**
 * Project containers.
 *
 * A project bundles everything WildClaude needs to work on a repo/app you
 * manage: description, the repos involved, environment notes, references to
 * the secrets it uses (NAMES ONLY — never values), useful links, a private
 * knowledge base (markdown), and project-scoped dashboards.
 *
 * Two consumers:
 *   1. The dashboard UI — a visual, browsable container.
 *   2. The LLM/agents — `buildProjectReference()` renders a compact context
 *      block (description + env + KB) that is injected into the system prompt
 *      when a chat has an active project, so the assistant works with full
 *      project context as a referral.
 *
 * Storage: USER_DATA_DIR/projects/<id>/
 *   project.json          — metadata
 *   knowledge/<file>.md   — KB documents
 * Versioned in the user-data git repo (same as evolution artifacts).
 */

import fs from 'fs';
import path from 'path';
import type { Hono } from 'hono';

import { USER_DATA_DIR } from './paths.js';
import { logger } from './logger.js';
import { loadUserConfig, saveUserConfig } from './overlay.js';
import { commitUserData } from './user-data-git.js';

// ── Types ──────────────────────────────────────────────────────────────

export interface ProjectRepo { name: string; url?: string; path?: string; branch?: string; }
export interface ProjectLink { label: string; url: string; }

export interface Project {
  id: string;
  name: string;
  icon?: string;
  description?: string;
  status?: 'active' | 'paused' | 'archived';
  repos: ProjectRepo[];
  /** Environment notes — stack, hosts, deploy steps, gotchas. Free-form markdown. */
  envNotes?: string;
  /** Names of secrets this project relies on. NEVER store values here. */
  secretRefs: string[];
  links: ProjectLink[];
  /** Dashboard spec ids scoped to this project (see dashboards-v2). */
  dashboards: string[];
  createdAt: number;
  updatedAt: number;
}

const PROJECTS_DIR = path.join(USER_DATA_DIR, 'projects');

const slugify = (s: string) => (s || 'project').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'project';

function projDir(id: string): string {
  const clean = String(id).replace(/[^a-z0-9_-]/gi, '');
  return path.join(PROJECTS_DIR, clean);
}
function projFile(id: string): string { return path.join(projDir(id), 'project.json'); }
function kbDir(id: string): string { return path.join(projDir(id), 'knowledge'); }

// ── CRUD ──────────────────────────────────────────────────────────────

export function listProjects(): Project[] {
  try {
    if (!fs.existsSync(PROJECTS_DIR)) return [];
    const out: Project[] = [];
    for (const entry of fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const p = getProject(entry.name);
      if (p) out.push(p);
    }
    return out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  } catch { return []; }
}

export function getProject(id: string): Project | null {
  try { return JSON.parse(fs.readFileSync(projFile(id), 'utf8')) as Project; } catch { return null; }
}

export function normalizeProject(raw: Partial<Project>, opts: { id?: string } = {}): Project {
  const now = Date.now();
  const id = opts.id || slugify(raw.id || raw.name || 'project') + '-' + now.toString(36).slice(-4);
  return {
    id,
    name: String(raw.name || 'Untitled project').slice(0, 120),
    icon: String(raw.icon || '📦').slice(0, 8),
    description: raw.description ? String(raw.description).slice(0, 2000) : undefined,
    status: (['active', 'paused', 'archived'].includes(raw.status as string) ? raw.status : 'active') as Project['status'],
    repos: Array.isArray(raw.repos) ? raw.repos.slice(0, 30).map((r) => ({
      name: String(r.name || '').slice(0, 120), url: r.url ? String(r.url).slice(0, 400) : undefined,
      path: r.path ? String(r.path).slice(0, 400) : undefined, branch: r.branch ? String(r.branch).slice(0, 80) : undefined,
    })) : [],
    envNotes: raw.envNotes ? String(raw.envNotes).slice(0, 8000) : undefined,
    secretRefs: Array.isArray(raw.secretRefs) ? raw.secretRefs.map((s) => String(s).toUpperCase().replace(/[^A-Z0-9_]/g, '')).filter(Boolean).slice(0, 50) : [],
    links: Array.isArray(raw.links) ? raw.links.slice(0, 30).map((l) => ({ label: String(l.label || l.url || '').slice(0, 120), url: String(l.url || '').slice(0, 400) })).filter((l) => l.url) : [],
    dashboards: Array.isArray(raw.dashboards) ? raw.dashboards.map((d) => String(d)).slice(0, 50) : [],
    createdAt: raw.createdAt || now,
    updatedAt: now,
  };
}

export function saveProject(p: Project): Project {
  fs.mkdirSync(projDir(p.id), { recursive: true });
  fs.mkdirSync(kbDir(p.id), { recursive: true });
  const normalized = { ...p, updatedAt: Date.now() };
  fs.writeFileSync(projFile(p.id), JSON.stringify(normalized, null, 2));
  commitUserData(`project: save ${p.id}`);
  return normalized;
}

export function deleteProject(id: string): boolean {
  try { fs.rmSync(projDir(id), { recursive: true, force: true }); commitUserData(`project: delete ${id}`); return true; } catch { return false; }
}

// ── Knowledge base ─────────────────────────────────────────────────────

const cleanKbName = (f: string) => path.basename(String(f)).replace(/[^a-z0-9._-]/gi, '-').replace(/\.+/g, '.').slice(0, 80) || 'note.md';

export function listKnowledge(id: string): Array<{ file: string; bytes: number; updatedAt: number }> {
  try {
    const dir = kbDir(id);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => {
      const st = fs.statSync(path.join(dir, f));
      return { file: f, bytes: st.size, updatedAt: st.mtimeMs };
    }).sort((a, b) => b.updatedAt - a.updatedAt);
  } catch { return []; }
}

export function readKnowledge(id: string, file: string): string | null {
  try { return fs.readFileSync(path.join(kbDir(id), cleanKbName(file)), 'utf8'); } catch { return null; }
}

export function writeKnowledge(id: string, file: string, content: string): string {
  fs.mkdirSync(kbDir(id), { recursive: true });
  let name = cleanKbName(file);
  if (!name.endsWith('.md')) name += '.md';
  fs.writeFileSync(path.join(kbDir(id), name), content, 'utf8');
  commitUserData(`project: kb ${id}/${name}`);
  return name;
}

export function deleteKnowledge(id: string, file: string): boolean {
  try { fs.unlinkSync(path.join(kbDir(id), cleanKbName(file))); commitUserData(`project: kb rm ${id}/${file}`); return true; } catch { return false; }
}

// ── Agent reference injection ──────────────────────────────────────────

/**
 * Render a compact markdown context block for the LLM. Includes description,
 * repos, env notes, secret AVAILABILITY (names + present/missing, never
 * values), and the KB (truncated per-file to keep the prompt bounded).
 */
export function buildProjectReference(id: string, opts: { maxKbChars?: number } = {}): string | null {
  const p = getProject(id);
  if (!p) return null;
  const maxKb = opts.maxKbChars ?? 6000;
  const lines: string[] = [];
  lines.push(`# Active project: ${p.name}`);
  if (p.description) lines.push(p.description);
  if (p.repos.length) {
    lines.push('\n## Repositories');
    for (const r of p.repos) lines.push(`- ${r.name}${r.url ? ` (${r.url})` : ''}${r.path ? ` — local: ${r.path}` : ''}${r.branch ? ` [${r.branch}]` : ''}`);
  }
  if (p.envNotes) { lines.push('\n## Environment'); lines.push(p.envNotes); }
  if (p.secretRefs.length) {
    // Report availability without ever printing the secret value.
    lines.push('\n## Secrets this project uses (availability only)');
    try {
      // Lazy require to avoid a static cycle; presence check only.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { getSecret } = require('./secrets.js');
      for (const k of p.secretRefs) lines.push(`- ${k}: ${getSecret(k) ? 'configured' : 'MISSING'}`);
    } catch {
      for (const k of p.secretRefs) lines.push(`- ${k}`);
    }
  }
  const kb = listKnowledge(id);
  if (kb.length) {
    lines.push('\n## Knowledge base');
    let budget = maxKb;
    for (const doc of kb) {
      if (budget <= 0) { lines.push(`- (${kb.length} docs total; remaining omitted for length)`); break; }
      const content = readKnowledge(id, doc.file) || '';
      const slice = content.slice(0, Math.min(content.length, budget));
      budget -= slice.length;
      lines.push(`\n### ${doc.file}\n${slice}${content.length > slice.length ? '\n…(truncated)' : ''}`);
    }
  }
  return lines.join('\n');
}

// ── Active-project association (per chat, persisted in user config) ─────

export function getActiveProject(chatId: string): string | null {
  try {
    return loadUserConfig().activeProjects?.[chatId] || null;
  } catch { return null; }
}

/**
 * Active project for a chat, with inference fallback.
 * If none is explicitly set (e.g. a fresh session that never ran `/project use`),
 * fall back to the most-recently-updated non-archived project so the assistant
 * always loads project context (KB, plan, status) by default — instead of
 * starting cold every session.
 */
export function getActiveProjectOrInfer(chatId: string): string | null {
  const explicit = getActiveProject(chatId);
  if (explicit) return explicit;
  const candidates = listProjects().filter((p) => p.status !== 'archived');
  return candidates[0]?.id || null;
}

export function setActiveProject(chatId: string, projectId: string | null): void {
  const cfg = loadUserConfig();
  cfg.activeProjects = cfg.activeProjects || {};
  if (projectId) cfg.activeProjects[chatId] = projectId; else delete cfg.activeProjects[chatId];
  saveUserConfig(cfg);
}

// ── API routes ─────────────────────────────────────────────────────────

export function registerProjectRoutes(app: Hono): void {
  app.get('/api/projects', (c) => c.json({ projects: listProjects() }));

  app.post('/api/projects', async (c) => {
    const body = await c.req.json().catch(() => ({})) as Partial<Project>;
    if (!body.name) return c.json({ error: 'name required' }, 400);
    const p = saveProject(normalizeProject(body));
    return c.json({ project: p }, 201);
  });

  app.get('/api/projects/:id', (c) => {
    const p = getProject(c.req.param('id'));
    return p ? c.json({ project: p, knowledge: listKnowledge(p.id) }) : c.json({ error: 'Not found' }, 404);
  });

  app.put('/api/projects/:id', async (c) => {
    const id = c.req.param('id');
    if (!getProject(id)) return c.json({ error: 'Not found' }, 404);
    const body = await c.req.json().catch(() => ({})) as Partial<Project>;
    const p = saveProject(normalizeProject({ ...body, id }, { id }));
    return c.json({ project: p });
  });

  app.delete('/api/projects/:id', (c) =>
    deleteProject(c.req.param('id')) ? c.json({ ok: true }) : c.json({ error: 'Not found' }, 404));

  // Knowledge base
  app.get('/api/projects/:id/knowledge', (c) => c.json({ knowledge: listKnowledge(c.req.param('id')) }));

  app.get('/api/projects/:id/knowledge/:file', (c) => {
    const content = readKnowledge(c.req.param('id'), c.req.param('file'));
    return content == null ? c.json({ error: 'Not found' }, 404) : c.json({ file: c.req.param('file'), content });
  });

  app.put('/api/projects/:id/knowledge/:file', async (c) => {
    if (!getProject(c.req.param('id'))) return c.json({ error: 'No such project' }, 404);
    const body = await c.req.json().catch(() => ({})) as { content?: string };
    const name = writeKnowledge(c.req.param('id'), c.req.param('file'), body.content || '');
    return c.json({ ok: true, file: name }, 201);
  });

  app.delete('/api/projects/:id/knowledge/:file', (c) =>
    deleteKnowledge(c.req.param('id'), c.req.param('file')) ? c.json({ ok: true }) : c.json({ error: 'Not found' }, 404));

  // The LLM-facing reference block (also handy to preview in the UI).
  app.get('/api/projects/:id/reference', (c) => {
    const ref = buildProjectReference(c.req.param('id'));
    return ref == null ? c.json({ error: 'Not found' }, 404) : c.json({ reference: ref });
  });

  // Active project per chat (drives system-prompt injection in the chat path).
  app.get('/api/projects/active/:chatId', (c) => c.json({ projectId: getActiveProject(c.req.param('chatId')) }));
  app.post('/api/projects/active/:chatId', async (c) => {
    const body = await c.req.json().catch(() => ({})) as { projectId?: string | null };
    setActiveProject(c.req.param('chatId'), body.projectId ?? null);
    return c.json({ ok: true });
  });
}
