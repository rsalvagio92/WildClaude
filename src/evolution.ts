/**
 * Self-evolution module for WildClaude.
 *
 * Enables creating skills, agents, and plugins via conversation.
 * All mutations are git-tracked with descriptive commit messages.
 */

import fs from 'fs';
import path from 'path';
import { execSync, spawnSync } from 'child_process';
import { Bot, Context } from 'grammy';

import { PROJECT_ROOT } from './config.js';
import { logger } from './logger.js';
import { USER_DATA_DIR, evolutionLogPath } from './paths.js';

// ── Evolution log ────────────────────────────────────────────────────

interface EvolutionEntry {
  timestamp: string;
  type: 'skill' | 'agent' | 'plugin' | 'mcp' | 'workflow';
  action: 'create' | 'update' | 'delete';
  name: string;
  description: string;
}

const EVOLUTION_LOG = evolutionLogPath();

function loadEvolutionLog(): EvolutionEntry[] {
  try {
    if (fs.existsSync(EVOLUTION_LOG)) {
      return JSON.parse(fs.readFileSync(EVOLUTION_LOG, 'utf-8'));
    }
  } catch { /* corrupt log */ }
  return [];
}

function appendEvolutionLog(entry: EvolutionEntry): void {
  const log = loadEvolutionLog();
  log.push(entry);
  fs.writeFileSync(EVOLUTION_LOG, JSON.stringify(log, null, 2));
}

// ── Skill creation ──────────────────────────────────────────────────

export function createSkill(name: string, description: string, instructions: string): string {
  const skillDir = path.join(USER_DATA_DIR, 'skills', name);
  fs.mkdirSync(skillDir, { recursive: true });

  const content = `---
name: ${name}
description: ${description}
---

${instructions}
`;

  const skillPath = path.join(skillDir, 'SKILL.md');
  fs.writeFileSync(skillPath, content);

  appendEvolutionLog({
    timestamp: new Date().toISOString(),
    type: 'skill',
    action: 'create',
    name,
    description,
  });

  gitCommit(`feat(skill): create ${name} — ${description}`);
  logger.info({ name }, 'Skill created');
  return skillPath;
}

// ── Agent creation ──────────────────────────────────────────────────

export function createAgent(
  id: string,
  name: string,
  description: string,
  model: string,
  lane: string,
  systemPrompt: string,
): string {
  const agentDir = path.join(USER_DATA_DIR, 'agents', lane);
  fs.mkdirSync(agentDir, { recursive: true });

  const content = `---
name: ${id}
description: ${description}
model: ${model}
lane: ${lane}
---

${systemPrompt}
`;

  const agentPath = path.join(agentDir, `${id}.md`);
  fs.writeFileSync(agentPath, content);

  // Update registry
  const registryPath = path.join(PROJECT_ROOT, 'agents', 'registry.yaml');
  if (fs.existsSync(registryPath)) {
    const registryContent = fs.readFileSync(registryPath, 'utf-8');
    const newEntry = `
  - id: ${id}
    name: ${name}
    description: >
      ${description}
    model: ${model}
    lane: ${lane}
`;
    fs.writeFileSync(registryPath, registryContent + newEntry);
  }

  appendEvolutionLog({
    timestamp: new Date().toISOString(),
    type: 'agent',
    action: 'create',
    name: id,
    description,
  });

  gitCommit(`feat(agent): create ${id} in ${lane} lane — ${description}`);
  logger.info({ id, lane }, 'Agent created');
  return agentPath;
}

// ── Workflow creation ───────────────────────────────────────────────

export function createWorkflow(name: string, prompt: string, cron: string): void {
  appendEvolutionLog({
    timestamp: new Date().toISOString(),
    type: 'workflow',
    action: 'create',
    name,
    description: `Schedule: ${cron} — ${prompt.slice(0, 100)}`,
  });

  logger.info({ name, cron }, 'Workflow created');
}

// ── Git tracking ────────────────────────────────────────────────────

function gitCommit(message: string): void {
  try {
    execSync('git add -A', { cwd: PROJECT_ROOT, stdio: 'pipe' });
    const result = spawnSync('git', ['commit', '-m', message, '--allow-empty'], {
      cwd: PROJECT_ROOT,
      stdio: 'pipe',
    });
    if (result.status !== 0) {
      throw new Error(result.stderr?.toString() || 'git commit failed');
    }
    logger.info({ message }, 'Evolution committed to git');
  } catch (err) {
    logger.warn({ err }, 'Git commit failed (non-fatal)');
  }
}

// ── Telegram commands ───────────────────────────────────────────────

export function registerEvolutionCommands(bot: Bot<Context>): void {

  // /create-skill <name> <description>
  // Then Claude generates the skill content
  bot.command('create_skill', async (ctx) => {
    const args = ctx.match?.trim();
    if (!args) {
      await ctx.reply(
        'Usage: /create_skill <name> <description>\n\n' +
        'Example: /create_skill meal-plan Weekly meal planning with shopping list',
      );
      return;
    }

    const spaceIdx = args.indexOf(' ');
    if (spaceIdx === -1) {
      await ctx.reply('Please provide both a name and description.');
      return;
    }

    const name = args.slice(0, spaceIdx).toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const description = args.slice(spaceIdx + 1).trim();

    // Create a basic skill template
    const instructions = `# ${name}

## When to Use
${description}

## Instructions
1. Understand the user's request in the context of "${description}"
2. Execute the task step by step
3. Provide a clear, actionable result

## Output Format
- Lead with the result, not the reasoning
- Keep it concise and practical
`;

    const skillPath = createSkill(name, description, instructions);
    await ctx.reply(
      `Skill created: ${name}\n` +
      `Path: ${skillPath}\n\n` +
      `Edit the SKILL.md to refine the instructions. ` +
      `The skill will auto-activate when its description matches your messages.`,
    );
  });

  // /create-agent <id> <lane> <description>
  bot.command('create_agent', async (ctx) => {
    const args = ctx.match?.trim();
    if (!args) {
      await ctx.reply(
        'Usage: /create_agent <id> <lane> <description>\n\n' +
        'Lanes: build, review, domain, coordination, life\n' +
        'Example: /create_agent devops build CI/CD pipeline management and deployment automation',
      );
      return;
    }

    const parts = args.split(' ');
    if (parts.length < 3) {
      await ctx.reply('Please provide: <id> <lane> <description>');
      return;
    }

    const id = parts[0]!.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const lane = parts[1]!.toLowerCase();
    const description = parts.slice(2).join(' ');

    const validLanes = ['build', 'review', 'domain', 'coordination', 'life'];
    if (!validLanes.includes(lane)) {
      await ctx.reply(`Invalid lane: ${lane}\nValid: ${validLanes.join(', ')}`);
      return;
    }

    // Default model by lane
    const modelMap: Record<string, string> = {
      build: 'claude-sonnet-4-6',
      review: 'claude-opus-4-6',
      domain: 'claude-sonnet-4-6',
      coordination: 'claude-opus-4-6',
      life: 'claude-sonnet-4-6',
    };

    const systemPrompt = `# Role
You are a ${id} agent specializing in: ${description}

# Success Criteria
- Complete the requested task accurately
- Provide actionable, specific output
- Stay within your domain of expertise

# Constraints
- Do not modify files outside your scope
- Ask for clarification if the request is ambiguous
- Report blockers immediately

# Execution Protocol
1. Understand the request fully before acting
2. Read relevant existing code/context
3. Execute the task
4. Verify the result
5. Report what was done
`;

    const name = id.charAt(0).toUpperCase() + id.slice(1).replace(/-/g, ' ');
    const agentPath = createAgent(id, name, description, modelMap[lane]!, lane, systemPrompt);
    await ctx.reply(
      `Agent created: @${id} (${lane} lane)\n` +
      `Path: ${agentPath}\n\n` +
      `Delegate with: @${id} <your request>\n` +
      `Edit the .md file to refine the system prompt.`,
    );
  });

  // /evolution — Show evolution log
  bot.command('evolution', async (ctx) => {
    const log = loadEvolutionLog();
    if (log.length === 0) {
      await ctx.reply('No evolution events yet. Create skills or agents to start evolving.');
      return;
    }

    const recent = log.slice(-10).reverse();
    const lines = recent.map((e) => {
      const date = new Date(e.timestamp).toLocaleDateString();
      return `${date} [${e.type}] ${e.action}: ${e.name} — ${e.description}`;
    });

    await ctx.reply(
      `Evolution Log (last ${recent.length}):\n\n${lines.join('\n')}`,
    );
  });
}
