/**
 * Auto-skill synthesis.
 *
 * Watches tool-use sequences across turns. When the same canonical sequence
 * shows up N times within a rolling window, propose a new skill via Telegram.
 *
 * Pipeline:
 *   recordTurn(toolUses, sessionId)
 *     → canonicalize (drop raw arg VALUES, keep arg SHAPES)
 *     → hash
 *     → upsert into tool_sequences
 *     → if count just hit MIN_REPETITIONS and status === 'pending':
 *         draft a SKILL.md via Haiku
 *         write to USER_DATA_DIR/skills/_proposals/<slug>.md
 *         emit 'proposal' event (bot.ts subscribes)
 *
 * PII discipline:
 *   - We never persist raw argument VALUES. Only tool name + which arg keys
 *     were present + the JS typeof each value (string/number/boolean/object/array).
 *   - Sample session IDs are stored so the bot can show context on demand, but
 *     the canonical signature itself is value-free.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';

import { getDb } from './db.js';
import { logger } from './logger.js';
import { USER_DATA_DIR } from './paths.js';
import {
  SKILL_SYNTHESIS_ENABLED,
  SKILL_SYNTHESIS_MIN_REPETITIONS,
  SKILL_SYNTHESIS_WINDOW_DAYS,
  SKILL_SYNTHESIS_MIN_TOOLS,
} from './config.js';
import { runAgent } from './agent.js';

// ── Types ────────────────────────────────────────────────────────────

export interface ToolUseRecord {
  name: string;
  input?: Record<string, unknown>;
}

interface CanonicalStep {
  tool: string;
  /** Sorted arg key signature, e.g. "file_path:string,offset:number" */
  args: string;
}

interface SequenceRow {
  hash: string;
  signature: string;
  tool_count: number;
  count: number;
  sample_session_ids: string;
  status: 'pending' | 'proposed' | 'accepted' | 'rejected';
  first_seen: number;
  last_seen: number;
  proposed_name: string | null;
  proposal_path: string | null;
}

export interface ProposalEvent {
  hash: string;
  proposedName: string;
  proposalPath: string;
  signature: string;
  count: number;
}

// ── Event bus ────────────────────────────────────────────────────────

class SynthesisEmitter extends EventEmitter {
  emitProposal(p: ProposalEvent): boolean {
    return this.emit('proposal', p);
  }
  onProposal(handler: (p: ProposalEvent) => void): void {
    this.on('proposal', handler);
  }
}

export const synthesisEvents = new SynthesisEmitter();

// ── Canonicalization ─────────────────────────────────────────────────

function shapeOfValue(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function canonicalizeStep(t: ToolUseRecord): CanonicalStep {
  const input = t.input ?? {};
  const argSig = Object.keys(input)
    .sort()
    .map((k) => `${k}:${shapeOfValue(input[k])}`)
    .join(',');
  return { tool: t.name, args: argSig };
}

export function canonicalizeSequence(tools: ToolUseRecord[]): {
  hash: string;
  signature: string;
} {
  const steps = tools.map(canonicalizeStep);
  const signature = steps.map((s) => `${s.tool}(${s.args})`).join(' → ');
  const hash = crypto.createHash('sha1').update(signature).digest('hex').slice(0, 16);
  return { hash, signature };
}

// ── Storage ──────────────────────────────────────────────────────────

function loadSeq(hash: string): SequenceRow | null {
  try {
    return (getDb()
      .prepare(`SELECT * FROM tool_sequences WHERE hash = ?`)
      .get(hash) as SequenceRow | undefined) ?? null;
  } catch {
    return null;
  }
}

function upsertSeq(
  hash: string,
  signature: string,
  toolCount: number,
  sessionId: string | undefined,
): SequenceRow | null {
  const now = Date.now();
  try {
    const existing = loadSeq(hash);
    if (!existing) {
      const samples = sessionId ? JSON.stringify([sessionId]) : '[]';
      getDb()
        .prepare(
          `INSERT INTO tool_sequences
             (hash, signature, tool_count, count, sample_session_ids,
              status, first_seen, last_seen, proposed_name, proposal_path)
           VALUES (?, ?, ?, 1, ?, 'pending', ?, ?, NULL, NULL)`,
        )
        .run(hash, signature, toolCount, samples, now, now);
      return loadSeq(hash);
    }

    // Append session id to samples (cap at 5, dedupe)
    let samples: string[] = [];
    try { samples = JSON.parse(existing.sample_session_ids) as string[]; } catch { /* */ }
    if (sessionId && !samples.includes(sessionId)) {
      samples.push(sessionId);
      if (samples.length > 5) samples = samples.slice(-5);
    }

    getDb()
      .prepare(
        `UPDATE tool_sequences
           SET count = count + 1,
               last_seen = ?,
               sample_session_ids = ?
         WHERE hash = ?`,
      )
      .run(now, JSON.stringify(samples), hash);

    return loadSeq(hash);
  } catch (err) {
    logger.warn({ err, hash }, 'upsertSeq failed (table missing?)');
    return null;
  }
}

function markProposed(hash: string, proposedName: string, proposalPath: string): void {
  try {
    getDb()
      .prepare(
        `UPDATE tool_sequences
           SET status = 'proposed', proposed_name = ?, proposal_path = ?
         WHERE hash = ?`,
      )
      .run(proposedName, proposalPath, hash);
  } catch (err) {
    logger.warn({ err, hash }, 'markProposed failed');
  }
}

export function markAccepted(hash: string): void {
  try {
    getDb().prepare(`UPDATE tool_sequences SET status = 'accepted' WHERE hash = ?`).run(hash);
  } catch (err) {
    logger.warn({ err, hash }, 'markAccepted failed');
  }
}

export function markRejected(hash: string): void {
  try {
    getDb().prepare(`UPDATE tool_sequences SET status = 'rejected' WHERE hash = ?`).run(hash);
  } catch (err) {
    logger.warn({ err, hash }, 'markRejected failed');
  }
}

export function getSequence(hash: string): SequenceRow | null {
  return loadSeq(hash);
}

// ── Filters ──────────────────────────────────────────────────────────

/**
 * Decide whether a sequence is worth proposing.
 * Reject:
 *   - too short (< MIN_TOOLS)
 *   - the same tool repeated (e.g. Read → Read → Read — no abstraction value)
 *   - sequences older than the window (count may be stale)
 *   - trivial pairs like just Read+Edit
 */
function isInteresting(seq: SequenceRow): boolean {
  if (seq.tool_count < SKILL_SYNTHESIS_MIN_TOOLS) return false;
  if (seq.status !== 'pending') return false;
  if (seq.count < SKILL_SYNTHESIS_MIN_REPETITIONS) return false;

  const windowMs = SKILL_SYNTHESIS_WINDOW_DAYS * 24 * 3600 * 1000;
  if (Date.now() - seq.first_seen > windowMs) return false;

  // Reject sequences where all steps use the same tool
  const tools = seq.signature.split(' → ').map((s) => s.replace(/\(.*$/, ''));
  const unique = new Set(tools);
  if (unique.size < 2) return false;

  return true;
}

// ── Proposal generation ──────────────────────────────────────────────

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60) || 'skill';
}

const DRAFT_PROMPT = (signature: string, count: number) =>
  `You are drafting a reusable SKILL.md for WildClaude.

A user has performed this canonical tool sequence ${count} times in the last 14 days:

${signature}

Each arrow → represents one tool call. The form is "ToolName(arg1:type,arg2:type)".
This is value-free (no PII) — we only see WHAT tools, with WHICH args, in what ORDER.

Your job: propose a single SKILL.md file that captures this pattern as a reusable workflow.

Output ONLY the file content, starting with frontmatter:

---
name: <short-kebab-slug>
description: <one sentence: when should the model invoke this skill>
---

# <Title Case Name>

## When to use
<1-2 sentences>

## Steps
1. <first step in plain language>
2. <second step>
...

## Notes
<anything non-obvious — assumptions, edge cases>

Constraints:
- Name: kebab-case, ≤ 4 words, descriptive
- Steps: same number as in the observed sequence (${signature.split(' → ').length}), in the same order
- No code blocks unless absolutely necessary
- Total length under 400 words
- Do not invent details — if a step's intent is unclear from the tool sequence alone, write "<infer from context>"`;

interface ParsedProposal {
  name: string;
  content: string;
}

function parseProposal(raw: string): ParsedProposal | null {
  // Find frontmatter
  const fmMatch = raw.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!fmMatch) return null;
  const fm = fmMatch[1]!;
  const nameMatch = fm.match(/^name:\s*([\w-]+)\s*$/m);
  if (!nameMatch) return null;
  return { name: slugify(nameMatch[1]!), content: raw.trim() };
}

async function draftSkill(signature: string, count: number): Promise<ParsedProposal | null> {
  try {
    const result = await runAgent(
      DRAFT_PROMPT(signature, count),
      undefined,
      () => {},
      undefined,
      'claude-haiku-4-5',
    );
    if (!result.text) return null;
    return parseProposal(result.text);
  } catch (err) {
    logger.warn({ err }, 'draftSkill: Haiku call failed');
    return null;
  }
}

const PROPOSAL_DIR = path.join(USER_DATA_DIR, 'skills', '_proposals');

function writeProposalFile(name: string, content: string): string {
  fs.mkdirSync(PROPOSAL_DIR, { recursive: true });
  const filePath = path.join(PROPOSAL_DIR, `${name}.md`);
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

/**
 * Promote an accepted proposal: move file from _proposals/ to skills/<name>/SKILL.md.
 * Idempotent — if the destination already exists, no-op.
 */
export function promoteProposal(hash: string): { ok: boolean; skillPath?: string; reason?: string } {
  const row = loadSeq(hash);
  if (!row || !row.proposed_name || !row.proposal_path) {
    return { ok: false, reason: 'No proposal recorded' };
  }
  if (!fs.existsSync(row.proposal_path)) {
    return { ok: false, reason: 'Proposal file is missing' };
  }
  const destDir = path.join(USER_DATA_DIR, 'skills', row.proposed_name);
  const destFile = path.join(destDir, 'SKILL.md');
  if (fs.existsSync(destFile)) {
    markAccepted(hash);
    return { ok: true, skillPath: destFile, reason: 'Already exists' };
  }
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(row.proposal_path, destFile);
  fs.unlinkSync(row.proposal_path);
  markAccepted(hash);
  return { ok: true, skillPath: destFile };
}

/**
 * Discard a proposal: delete the file, mark rejected.
 */
export function discardProposal(hash: string): void {
  const row = loadSeq(hash);
  if (row?.proposal_path && fs.existsSync(row.proposal_path)) {
    try { fs.unlinkSync(row.proposal_path); } catch { /* */ }
  }
  markRejected(hash);
}

// ── Public entry point ───────────────────────────────────────────────

// ── Telegram surface ─────────────────────────────────────────────────

/**
 * Subscribe to proposal events and forward them to the given chat as plain
 * messages with /skill_accept and /skill_reject commands. Matches the
 * codebase's existing high-importance-memory notification style — no inline
 * keyboards.
 */
export function attachProposalNotifier(
  send: (text: string) => void,
): void {
  synthesisEvents.onProposal((p) => {
    const lines = [
      `🪄 <b>Skill proposal</b>`,
      `Saw this sequence ${p.count}× recently:`,
      `<code>${escapeHtml(p.signature)}</code>`,
      ``,
      `Drafted: <b>${p.proposedName}</b>`,
      `File: <code>${escapeHtml(p.proposalPath)}</code>`,
      ``,
      `Approve:  <code>/skill_accept ${p.hash}</code>`,
      `Discard:  <code>/skill_reject ${p.hash}</code>`,
    ];
    try {
      send(lines.join('\n'));
    } catch (err) {
      logger.warn({ err, hash: p.hash }, 'attachProposalNotifier: send failed');
    }
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Register /skill_accept and /skill_reject commands on the bot.
 */
export function registerSkillSynthesisCommands(
  bot: import('grammy').Bot,
  isAuthorised: (chatId: number) => boolean,
): void {
  bot.command('skill_accept', async (ctx) => {
    if (!isAuthorised(ctx.chat!.id)) return;
    const hash = (ctx.match ?? '').trim();
    if (!hash) {
      await ctx.reply('Usage: /skill_accept <hash>');
      return;
    }
    const r = promoteProposal(hash);
    if (r.ok) {
      await ctx.reply(`Skill accepted${r.reason ? ` (${r.reason})` : ''}.\nFile: ${r.skillPath}`);
    } else {
      await ctx.reply(`Could not accept: ${r.reason ?? 'unknown'}`);
    }
  });

  bot.command('skill_reject', async (ctx) => {
    if (!isAuthorised(ctx.chat!.id)) return;
    const hash = (ctx.match ?? '').trim();
    if (!hash) {
      await ctx.reply('Usage: /skill_reject <hash>');
      return;
    }
    discardProposal(hash);
    await ctx.reply('Proposal discarded.');
  });
}

/**
 * Called from agent.ts after each turn completes.
 * Records the tool sequence and emits a proposal event when the threshold is hit.
 */
export async function recordTurn(
  tools: ToolUseRecord[],
  sessionId?: string,
): Promise<void> {
  if (!SKILL_SYNTHESIS_ENABLED) return;
  if (tools.length < SKILL_SYNTHESIS_MIN_TOOLS) return;

  const { hash, signature } = canonicalizeSequence(tools);
  const row = upsertSeq(hash, signature, tools.length, sessionId);
  if (!row) return;

  if (!isInteresting(row)) return;

  // We only propose ONCE per sequence. isInteresting() already gates status === 'pending'.
  const draft = await draftSkill(signature, row.count);
  if (!draft) {
    logger.info({ hash, count: row.count }, 'skill-synthesis: draft generation failed, will retry next time');
    return;
  }

  const proposalPath = writeProposalFile(draft.name, draft.content);
  markProposed(hash, draft.name, proposalPath);

  logger.info(
    { hash, name: draft.name, count: row.count, path: proposalPath },
    'skill-synthesis: proposal drafted',
  );

  synthesisEvents.emitProposal({
    hash,
    proposedName: draft.name,
    proposalPath,
    signature,
    count: row.count,
  });
}
