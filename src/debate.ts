/**
 * Multi-agent debate mode — N-round conversation between two agents.
 *
 * Useful for decision-making: e.g. critic + coach debate before you commit to
 * a goal change. Each round, both agents see the full transcript so far and
 * respond. The orchestrator can summarize the position at the end.
 */

import { runAgent } from './agent.js';
import { logger } from './logger.js';

export interface DebateOptions {
  agentA: string;
  agentB: string;
  topic: string;
  rounds?: number;
  summarize?: boolean;
  model?: string;
}

/** Cap rounds × agents to avoid runaway cost. */
const MAX_ROUNDS = parseInt(process.env.DEBATE_MAX_ROUNDS ?? '4', 10);
/** Max debates per hour per chat. */
const MAX_DEBATES_PER_HOUR = parseInt(process.env.DEBATE_MAX_PER_HOUR ?? '3', 10);
const debateTimestamps: number[] = [];
function checkDebateRate(): void {
  const now = Date.now();
  while (debateTimestamps.length > 0 && now - debateTimestamps[0] > 3_600_000) debateTimestamps.shift();
  if (debateTimestamps.length >= MAX_DEBATES_PER_HOUR) {
    throw new Error(`Rate limit: max ${MAX_DEBATES_PER_HOUR} debates/hour`);
  }
  debateTimestamps.push(now);
}

export interface DebateMessage {
  agent: string;
  round: number;
  text: string;
}

export interface DebateResult {
  topic: string;
  messages: DebateMessage[];
  summary?: string | null;
}

const PROMPT = (agent: string, topic: string, transcript: string, round: number, total: number) => `
You are the "${agent}" agent. You are in round ${round}/${total} of a structured debate.

Topic: ${topic}

Transcript so far:
${transcript || '(none — you go first)'}

Respond in your authentic voice as "${agent}". Engage directly with the most recent counter-argument if one exists. Keep your response under 150 words. Do not roleplay or address the other agent by name — write as yourself.
`.trim();

export async function runDebate(
  opts: DebateOptions,
  onMessage?: (msg: DebateMessage) => void,
): Promise<DebateResult> {
  checkDebateRate();
  const rounds = Math.min(opts.rounds ?? 3, MAX_ROUNDS);
  const messages: DebateMessage[] = [];

  for (let r = 1; r <= rounds; r++) {
    for (const agent of [opts.agentA, opts.agentB]) {
      const transcript = messages.map((m) => `[${m.agent} r${m.round}] ${m.text}`).join('\n\n');
      const prompt = PROMPT(agent, opts.topic, transcript, r, rounds);
      const result = await runAgent(prompt, undefined, () => {}, undefined, opts.model);
      const text = (result.text ?? '').trim() || '(no response)';
      const msg = { agent, round: r, text };
      messages.push(msg);
      onMessage?.(msg);
    }
  }

  let summary: string | null = null;
  if (opts.summarize !== false) {
    const transcript = messages.map((m) => `[${m.agent} r${m.round}] ${m.text}`).join('\n\n');
    const sumPrompt =
      `Below is a structured debate between "${opts.agentA}" and "${opts.agentB}" on:\n` +
      `"${opts.topic}"\n\n${transcript}\n\n` +
      `In 3 bullet points, summarize the strongest argument from each side and a synthesis. Be concise.`;
    try {
      const r = await runAgent(sumPrompt, undefined, () => {}, undefined, 'claude-haiku-4-5');
      summary = r.text ?? null;
    } catch (err) {
      logger.warn({ err }, 'debate: summary generation failed');
    }
  }

  return { topic: opts.topic, messages, summary };
}

export function registerDebateCommand(
  bot: import('grammy').Bot,
  isAuthorised: (chatId: number) => boolean,
): void {
  bot.command('debate', async (ctx) => {
    if (!isAuthorised(ctx.chat!.id)) return;
    const args = (ctx.match ?? '').trim();
    // Format: /debate <agentA> <agentB> <topic...> [--rounds N]
    const parts = args.split(/\s+/);
    if (parts.length < 3) {
      await ctx.reply('Usage: /debate <agentA> <agentB> <topic> [--rounds N]\nExample: /debate critic coach should I quit my job and travel');
      return;
    }
    const agentA = parts[0]!;
    const agentB = parts[1]!;
    let rounds = 3;
    const rest: string[] = [];
    for (let i = 2; i < parts.length; i++) {
      if (parts[i] === '--rounds' && parts[i + 1]) {
        const n = parseInt(parts[++i]!, 10);
        if (Number.isFinite(n)) rounds = Math.max(1, Math.min(8, n));
      } else {
        rest.push(parts[i]!);
      }
    }
    const topic = rest.join(' ').trim();
    if (!topic) { await ctx.reply('Provide a topic.'); return; }

    await ctx.reply(`Starting debate: ${agentA} vs ${agentB}, ${rounds} round(s).\nTopic: ${topic}`);
    try {
      const result = await runDebate(
        { agentA, agentB, topic, rounds },
        (msg) => {
          ctx.api.sendMessage(ctx.chat!.id, `<b>${msg.agent}</b> [r${msg.round}]\n${msg.text}`, { parse_mode: 'HTML' }).catch(() => {});
        },
      );
      if (result.summary) {
        await ctx.reply(`<b>Synthesis</b>\n${result.summary}`, { parse_mode: 'HTML' });
      }
    } catch (err) {
      await ctx.reply(`Debate failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
}
