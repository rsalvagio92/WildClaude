/**
 * Skill importer compatible with agentskills.io and any host that serves a
 * raw SKILL.md (or a tarball/zip containing one).
 *
 * v1 supports the simplest case: a single SKILL.md URL or `<id>` from
 * agentskills.io. Multi-file skill bundles are out of scope here.
 *
 * Safety:
 *   - SKILL.md content is shown back to the user before it is written
 *     (handled at the Telegram-command layer).
 *   - Python / shell scriptlets embedded as fenced code blocks are stripped
 *     by default. We don't execute them anywhere, but stripping them avoids
 *     prompt-injection vectors where the skill instructs the model to run
 *     untrusted code.
 *   - All imports land under USER_DATA_DIR/skills/. Never PROJECT_ROOT.
 */

import fs from 'fs';
import path from 'path';

import { USER_DATA_DIR } from './paths.js';
import { logger } from './logger.js';

const AGENTSKILLS_BASE = 'https://agentskills.io';

export interface ImportResult {
  ok: boolean;
  name?: string;
  skillPath?: string;
  redactedBlocks?: number;
  warning?: string;
  error?: string;
  rawContent?: string;
}

/**
 * Normalize a user-supplied reference into a fetchable URL.
 *   "foo-bar"                              → https://agentskills.io/skills/foo-bar/SKILL.md
 *   "agentskills.io/skills/foo-bar"        → same, with https:
 *   "https://anywhere.example/path.md"     → unchanged
 */
function resolveUrl(ref: string): string {
  const trimmed = ref.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('agentskills.io/')) return `https://${trimmed.replace(/\/$/, '')}/SKILL.md`;
  if (/^[\w-]+$/.test(trimmed)) return `${AGENTSKILLS_BASE}/skills/${trimmed}/SKILL.md`;
  // bare path on agentskills
  return `${AGENTSKILLS_BASE}/${trimmed.replace(/^\//, '')}`;
}

interface Frontmatter {
  name: string;
  description?: string;
  raw: string;
}

function parseFrontmatter(text: string): Frontmatter | null {
  const m = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!m) return null;
  const fm = m[1]!;
  const nameMatch = fm.match(/^name:\s*([\w-]+)\s*$/m);
  if (!nameMatch) return null;
  const descMatch = fm.match(/^description:\s*(.+)\s*$/m);
  return {
    name: nameMatch[1]!,
    description: descMatch?.[1]?.trim(),
    raw: fm,
  };
}

/**
 * Strip fenced code blocks whose language is python/sh/bash/shell/powershell.
 * Replace with a placeholder so users can see what was removed.
 */
function stripScriptlets(content: string): { content: string; removed: number } {
  const re = /```(python|py|sh|bash|shell|zsh|powershell|ps1)\b[^\n]*\n[\s\S]*?\n```/gi;
  let removed = 0;
  const out = content.replace(re, () => {
    removed++;
    return '```\n[code block removed by WildClaude import for safety]\n```';
  });
  return { content: out, removed };
}

/**
 * Append a `source:` line to the frontmatter so the origin is auditable later.
 */
function annotateFrontmatter(content: string, sourceUrl: string): string {
  return content.replace(
    /^---\s*\n([\s\S]*?)\n---/,
    (_, body) => `---\n${body}\nsource: ${sourceUrl}\nimported_at: ${new Date().toISOString()}\n---`,
  );
}

/**
 * SSRF guard: only https, and never localhost / private / link-local ranges.
 * Without this, /skill_install http://localhost:3141/... could be used to
 * read internal services through the bot.
 */
function validateSkillUrl(url: string): string | null {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return 'Invalid URL'; }
  if (parsed.protocol !== 'https:') return 'Only https:// skill sources are allowed';
  const host = parsed.hostname.toLowerCase();
  const isPrivate =
    host === 'localhost' || host === '0.0.0.0' || host === '::1' ||
    /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /^169\.254\./.test(host) ||
    host.endsWith('.local') || host.endsWith('.internal') || !host.includes('.');
  if (isPrivate) return 'Refusing to fetch from a private/internal host';
  return null;
}

/**
 * Fetch + parse + scrub. Returns the proposed write location and content
 * without actually writing yet — the Telegram command commits after preview.
 */
export async function fetchSkill(ref: string): Promise<ImportResult> {
  const url = resolveUrl(ref);
  const urlError = validateSkillUrl(url);
  if (urlError) return { ok: false, error: urlError };
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { 'User-Agent': 'WildClaude-Importer/0.1', Accept: 'text/markdown, text/plain;q=0.9, */*;q=0.5' },
    });
  } catch (err) {
    return { ok: false, error: `Fetch failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!response.ok) {
    return { ok: false, error: `HTTP ${response.status} ${response.statusText} for ${url}` };
  }
  const raw = await response.text();
  if (raw.length > 64 * 1024) {
    return { ok: false, error: `Skill too large (${(raw.length / 1024).toFixed(1)}KB). Cap is 64KB.` };
  }
  const fm = parseFrontmatter(raw);
  if (!fm) {
    return { ok: false, error: 'No valid frontmatter (need `name:` field)' };
  }

  const stripped = stripScriptlets(raw);
  const annotated = annotateFrontmatter(stripped.content, url);
  const skillName = fm.name;
  const skillPath = path.join(USER_DATA_DIR, 'skills', skillName, 'SKILL.md');

  return {
    ok: true,
    name: skillName,
    skillPath,
    redactedBlocks: stripped.removed,
    rawContent: annotated,
    warning: stripped.removed > 0
      ? `${stripped.removed} executable code block(s) were stripped.`
      : undefined,
  };
}

/** Commit a fetched skill to disk. Overwrites if it already exists. */
export function writeSkill(skillPath: string, content: string): void {
  fs.mkdirSync(path.dirname(skillPath), { recursive: true });
  fs.writeFileSync(skillPath, content, 'utf8');
  logger.info({ skillPath, bytes: content.length }, 'Skill imported');
}

// ── Telegram surface ─────────────────────────────────────────────────

interface PendingImport { ref: string; result: ImportResult; ts: number }
const pendingImports = new Map<number /* chatId */, PendingImport>();
const PENDING_TTL_MS = 5 * 60 * 1000;

export function registerSkillImportCommands(
  bot: import('grammy').Bot,
  isAuthorised: (chatId: number) => boolean,
): void {
  bot.command('skill_install', async (ctx) => {
    if (!isAuthorised(ctx.chat!.id)) return;
    const ref = (ctx.match ?? '').trim();
    if (!ref) {
      await ctx.reply(
        'Usage: /skill_install <name-or-url>\n' +
        'Examples:\n' +
        '  /skill_install my-skill\n' +
        '  /skill_install https://example.com/path/SKILL.md',
      );
      return;
    }

    await ctx.reply(`Fetching skill from ${ref}…`);
    const result = await fetchSkill(ref);
    if (!result.ok) {
      await ctx.reply(`Import failed: ${result.error}`);
      return;
    }

    pendingImports.set(ctx.chat!.id, { ref, result, ts: Date.now() });

    const preview = (result.rawContent ?? '').slice(0, 1500);
    const more = (result.rawContent ?? '').length > 1500 ? '\n…(truncated)' : '';
    const warning = result.warning ? `\n⚠️ ${result.warning}` : '';
    await ctx.reply(
      `<b>Preview: ${result.name}</b>${warning}\n` +
      `Target: <code>${result.skillPath}</code>\n\n` +
      `<pre>${escapeHtml(preview)}${more}</pre>\n\n` +
      `Confirm: <code>/skill_confirm</code>\n` +
      `Cancel:  <code>/skill_cancel</code>`,
      { parse_mode: 'HTML' },
    );
  });

  bot.command('skill_confirm', async (ctx) => {
    if (!isAuthorised(ctx.chat!.id)) return;
    const pending = pendingImports.get(ctx.chat!.id);
    if (!pending || Date.now() - pending.ts > PENDING_TTL_MS) {
      await ctx.reply('No pending skill import (or it expired). Run /skill_install <name-or-url> first.');
      return;
    }
    pendingImports.delete(ctx.chat!.id);
    try {
      writeSkill(pending.result.skillPath!, pending.result.rawContent!);
      await ctx.reply(`✓ Installed <b>${pending.result.name}</b>\nFile: <code>${pending.result.skillPath}</code>`, { parse_mode: 'HTML' });
    } catch (err) {
      await ctx.reply(`Write failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  bot.command('skill_cancel', async (ctx) => {
    if (!isAuthorised(ctx.chat!.id)) return;
    pendingImports.delete(ctx.chat!.id);
    await ctx.reply('Skill import cancelled.');
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
