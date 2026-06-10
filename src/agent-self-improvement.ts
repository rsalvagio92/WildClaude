/**
 * Agent self-improvement — closed-loop refinement of struggling agents.
 *
 * Distinct from src/self-reflection.ts (which tracks user-correction lessons).
 * This module:
 *   1. Finds which agents had high failure rates in the last week
 *   2. Reads their definition file + recent failure errors
 *   3. Asks Opus to propose a small, conservative revision
 *   4. Writes the proposal to ~/.wild-claude-pi/agents/_self-improvement-proposals/
 *   5. User reviews via /agent_improve list and approves with /agent_improve accept
 *
 * Approval is gated — we never silently rewrite agent prompts.
 */

import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';

import { getDb } from './db.js';
import { runAgent } from './agent.js';
import { USER_DATA_DIR, resolveAgentPath } from './paths.js';
import { logger } from './logger.js';
import { MODELS } from './models.js';

const PROPOSAL_DIR = path.join(USER_DATA_DIR, 'agents', '_self-improvement-proposals');

export interface AgentFailureSample {
  agentId: string;
  totalTasks: number;
  failedTasks: number;
  failureRate: number;
  errors: string[];
}

export function findStrugglingAgents(days = 7, minTasks = 3, minFailRate = 0.3): AgentFailureSample[] {
  const sinceMs = Date.now() - days * 24 * 3600 * 1000;
  const rows = getDb().prepare(
    `SELECT assigned_agent AS agentId,
            COUNT(*) AS total,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
       FROM mission_tasks
      WHERE created_at >= ? AND assigned_agent IS NOT NULL
      GROUP BY assigned_agent
      HAVING total >= ? AND (CAST(failed AS REAL) / total) >= ?`,
  ).all(sinceMs, minTasks, minFailRate) as Array<{ agentId: string; total: number; failed: number }>;

  return rows.map((r) => {
    const errs = getDb().prepare(
      `SELECT error FROM mission_tasks WHERE assigned_agent = ? AND status = 'failed' AND created_at >= ? AND error IS NOT NULL LIMIT 5`,
    ).all(r.agentId, sinceMs) as Array<{ error: string }>;
    return {
      agentId: r.agentId,
      totalTasks: r.total,
      failedTasks: r.failed,
      failureRate: r.failed / r.total,
      errors: errs.map((e) => e.error).filter(Boolean),
    };
  });
}

const PROMPT = (s: AgentFailureSample, def: string) =>
`You are tuning an underperforming WildClaude agent. The user trusts you to ` +
`propose small, conservative fixes — not rewrites.

Agent: ${s.agentId}
Recent failure rate: ${(s.failureRate * 100).toFixed(0)}% (${s.failedTasks}/${s.totalTasks})
Sample errors:
${s.errors.slice(0, 5).map((e, i) => `  ${i + 1}. ${e.slice(0, 250)}`).join('\n')}

Current agent definition:
${def.slice(0, 4000)}

Propose a REVISED agent definition in the same Markdown frontmatter format.
Keep:
  - name, model, lane unchanged
  - existing voice / personality
Change ONLY:
  - the Execution Protocol or Constraints sections, where the errors clearly point at a fixable gap
  - add specific guardrails referenced by the errors

Output ONLY the new file content. No commentary.`;

export interface AgentProposal {
  agentId: string;
  proposalPath: string;
  failureRate: number;
  diffPreview: string;
}

function getLane(agentId: string): string {
  for (const lane of ['build', 'review', 'domain', 'coordination', 'life']) {
    if (resolveAgentPath(lane, agentId)) return lane;
  }
  return 'build';
}

export async function generateAgentProposal(sample: AgentFailureSample): Promise<AgentProposal | null> {
  const lane = getLane(sample.agentId);
  const defPath = resolveAgentPath(lane, sample.agentId);
  if (!defPath || !fs.existsSync(defPath)) return null;
  const def = fs.readFileSync(defPath, 'utf8');

  const result = await runAgent(PROMPT(sample, def), undefined, () => {}, undefined, MODELS.opus);
  const newDef = (result.text ?? '').trim();
  if (!newDef.startsWith('---')) return null;

  fs.mkdirSync(PROPOSAL_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const proposalPath = path.join(PROPOSAL_DIR, `${sample.agentId}-${stamp}-${randomBytes(2).toString('hex')}.md`);
  fs.writeFileSync(proposalPath, newDef, 'utf8');

  logger.info({ agentId: sample.agentId, proposalPath }, 'agent-self-improvement: proposal written');
  return {
    agentId: sample.agentId,
    proposalPath,
    failureRate: sample.failureRate,
    diffPreview: newDef.slice(0, 600),
  };
}

export function listPendingProposals(): AgentProposal[] {
  if (!fs.existsSync(PROPOSAL_DIR)) return [];
  return fs.readdirSync(PROPOSAL_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const fullPath = path.join(PROPOSAL_DIR, f);
      const content = fs.readFileSync(fullPath, 'utf8');
      return {
        agentId: f.split('-').slice(0, -7).join('-') || f.replace('.md', ''),
        proposalPath: fullPath,
        failureRate: 0,
        diffPreview: content.slice(0, 600),
      };
    });
}

export function acceptAgentProposal(proposalPath: string, agentId: string): { ok: boolean; reason?: string } {
  if (!fs.existsSync(proposalPath)) return { ok: false, reason: 'proposal not found' };
  const livePath = resolveAgentPath(getLane(agentId), agentId);
  if (!livePath) return { ok: false, reason: 'live agent not found' };
  const backup = livePath + '.bak.' + Date.now();
  fs.copyFileSync(livePath, backup);
  fs.copyFileSync(proposalPath, livePath);
  fs.unlinkSync(proposalPath);
  return { ok: true };
}

export function discardAgentProposal(proposalPath: string): boolean {
  if (!fs.existsSync(proposalPath)) return false;
  fs.unlinkSync(proposalPath);
  return true;
}

export async function runSelfImprovementCycle(send?: (text: string) => Promise<void>): Promise<AgentProposal[]> {
  const struggling = findStrugglingAgents();
  if (struggling.length === 0) {
    logger.info('agent-self-improvement: no struggling agents');
    return [];
  }
  const proposals: AgentProposal[] = [];
  for (const sample of struggling.slice(0, 3)) {
    const p = await generateAgentProposal(sample);
    if (p) proposals.push(p);
  }
  if (send && proposals.length > 0) {
    const lines = ['🪞 <b>Agent self-improvement proposals</b>', ''];
    for (const p of proposals) {
      lines.push(`<b>${escapeHtml(p.agentId)}</b> — failure rate ${(p.failureRate * 100).toFixed(0)}%`);
      lines.push(`<code>${escapeHtml(path.basename(p.proposalPath))}</code>`);
    }
    lines.push('');
    lines.push('Review: <code>/agent_improve list</code>');
    await send(lines.join('\n'));
  }
  return proposals;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function registerAgentImproveCommand(
  bot: import('grammy').Bot,
  isAuthorised: (chatId: number) => boolean,
): void {
  bot.command('agent_improve', async (ctx) => {
    if (!isAuthorised(ctx.chat!.id)) return;
    const [sub, ...rest] = ((ctx.match ?? '').trim()).split(/\s+/);

    if (sub === 'run') {
      await ctx.reply('Running self-improvement cycle…');
      try {
        const proposals = await runSelfImprovementCycle();
        await ctx.reply(`Generated ${proposals.length} proposal(s).`);
      } catch (err) {
        await ctx.reply(`Failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }

    if (sub === 'list' || !sub) {
      const list = listPendingProposals();
      if (list.length === 0) { await ctx.reply('No pending agent improvement proposals.'); return; }
      const lines = ['<b>Pending agent proposals</b>'];
      for (const p of list) {
        lines.push('');
        lines.push(`<b>${escapeHtml(p.agentId)}</b>`);
        lines.push(`<code>${escapeHtml(path.basename(p.proposalPath))}</code>`);
        lines.push(`<pre>${escapeHtml(p.diffPreview.slice(0, 300))}</pre>`);
        lines.push(`Accept: <code>/agent_improve accept ${escapeHtml(path.basename(p.proposalPath))} ${escapeHtml(p.agentId)}</code>`);
        lines.push(`Drop:   <code>/agent_improve drop ${escapeHtml(path.basename(p.proposalPath))}</code>`);
      }
      await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' });
      return;
    }

    if (sub === 'accept') {
      const fname = rest[0]; const agentId = rest[1];
      if (!fname || !agentId) { await ctx.reply('Usage: /agent_improve accept <filename> <agent-id>'); return; }
      const r = acceptAgentProposal(path.join(PROPOSAL_DIR, fname), agentId);
      await ctx.reply(r.ok ? '✓ Accepted (backup saved)' : `Failed: ${r.reason}`);
      return;
    }

    if (sub === 'drop') {
      const fname = rest[0];
      if (!fname) { await ctx.reply('Usage: /agent_improve drop <filename>'); return; }
      discardAgentProposal(path.join(PROPOSAL_DIR, fname));
      await ctx.reply('Dropped.');
      return;
    }

    await ctx.reply('Usage:\n/agent_improve list\n/agent_improve run\n/agent_improve accept <file> <agent>\n/agent_improve drop <file>');
  });
}
