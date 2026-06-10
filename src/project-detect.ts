/**
 * Auto-detect project/repo mentions and PROPOSE creating a container.
 *
 * Detect → propose (never silent): a cheap regex pre-filter gates a single Haiku
 * extraction; if it finds a concrete, not-yet-tracked project the user is
 * working on, we offer to create a container (Telegram inline ✅/❌). On accept
 * we create a stub project; details accrue into its KB/Wiki over time.
 *
 * Guards against spam: pre-filter, dedupe vs existing projects + already-proposed
 * names, a confidence floor, and a per-process cooldown.
 */

import { logger } from './logger.js';
import { listProjects, normalizeProject, saveProject } from './projects.js';

// Cheap pre-filter — only when these appear do we spend a Haiku call.
const HINT = /\b(repo|repository|codebase|my (project|app|site|bot|service)|working on|building (a|an|my)|new project|github\.com\/|gitlab\.com\/)\b/i;

interface Pending { name: string; description: string; ts: number }
const pending = new Map<string, Pending>();
const proposedNames = new Set<string>(); // lowercased — don't re-ask in this run
let tokenSeq = 0;
let lastRunAt = 0;
const COOLDOWN_MS = 45_000;
const PENDING_TTL_MS = 30 * 60 * 1000;

export function detectProjectHint(message: string): boolean {
  return message.length >= 12 && HINT.test(message);
}

function gc(): void {
  const now = Date.now();
  for (const [k, v] of pending) if (now - v.ts > PENDING_TTL_MS) pending.delete(k);
}

interface Extraction { isProject: boolean; name?: string; description?: string; confidence?: number }

/**
 * If the message plausibly introduces a new project the user manages, draft a
 * proposal and invoke onPropose(text, token, name). No-op otherwise.
 */
export async function maybeProposeProject(
  message: string,
  onPropose: (text: string, token: string, name: string) => void,
): Promise<void> {
  if (!detectProjectHint(message)) return;
  const now = Date.now();
  if (now - lastRunAt < COOLDOWN_MS) return;
  lastRunAt = now;

  try {
    const existing = new Set(listProjects().map((p) => p.name.toLowerCase()));
    const { runAgent } = await import('./agent.js');
    const { MODELS } = await import('./models.js');
    const prompt = `Decide if this user message introduces a SPECIFIC software project/repo/app the USER is actively working on or managing (not a library, not someone else's, not hypothetical). Output ONLY JSON:
{"isProject": boolean, "name": "short project name", "description": "one line", "confidence": 0.0-1.0}

Message: "${message.slice(0, 500)}"

Set isProject=false unless there's a concrete named thing the user owns/builds. Be conservative.`;
    const result = await runAgent(prompt, undefined, () => {}, undefined, MODELS.haiku);
    let ext: Extraction | null = null;
    const raw = result.text || '';
    try { ext = JSON.parse(raw); } catch {
      const s = raw.indexOf('{');
      if (s >= 0) { try { ext = JSON.parse(raw.slice(s, raw.lastIndexOf('}') + 1)); } catch { /* */ } }
    }
    if (!ext || !ext.isProject || !ext.name) return;
    if ((ext.confidence ?? 0) < 0.6) return;
    const name = String(ext.name).trim().slice(0, 80);
    const key = name.toLowerCase();
    if (!name || existing.has(key) || proposedNames.has(key)) return;

    proposedNames.add(key);
    gc();
    const token = `p${++tokenSeq}`;
    pending.set(token, { name, description: String(ext.description || '').slice(0, 300), ts: now });
    onPropose(
      `🗂 You mentioned <b>${name}</b> — want me to create a project container for it? I'll keep its repos, env, secrets refs, knowledge base and dashboards there.`,
      token,
      name,
    );
  } catch (err) {
    logger.debug({ err }, 'project-detect: extraction failed');
  }
}

export function acceptProjectProposal(token: string): { ok: boolean; project?: ReturnType<typeof saveProject>; error?: string } {
  const p = pending.get(token);
  if (!p) return { ok: false, error: 'expired' };
  pending.delete(token);
  try {
    const project = saveProject(normalizeProject({ name: p.name, description: p.description || undefined }));
    logger.info({ id: project.id }, 'project created from proposal');
    return { ok: true, project };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'create failed' };
  }
}

export function rejectProjectProposal(token: string): void {
  pending.delete(token);
}
