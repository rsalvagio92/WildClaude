/**
 * Life management commands for WildClaude.
 *
 * Registers: /morning /evening /goals /focus /journal /review /remember /reflect
 *
 * Design principles:
 * - Simple read/display commands format and reply directly (no LLM call).
 * - Heavy analysis commands (/review) call runAgent() with a targeted prompt.
 * - Log writes always prepend (newest entry first) in life/me/_kernel/log.md.
 * - All file I/O is synchronous to keep command handlers simple.
 */

import fs from 'fs';
import path from 'path';
import { Bot, Context } from 'grammy';

import { runAgent } from './agent.js';
import { ALLOWED_CHAT_ID } from './config.js';
import { deleteMemory, getRecentMemories, saveStructuredMemory } from './db.js';
import { logger } from './logger.js';
import { lifePath } from './paths.js';

// ── Path helpers ─────────────────────────────────────────────────────────────

const GOALS_KEY = lifePath('goals', '_kernel', 'key.md');
const ME_KEY = lifePath('me', '_kernel', 'key.md');
const LOG_FILE = lifePath('me', '_kernel', 'log.md');

function readFileSafe(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return `(file not found: ${filePath})`;
  }
}

/** Prepend a new entry to log.md (oldest entries sink to the bottom). */
function prependLog(entry: string): void {
  const existing = fs.existsSync(LOG_FILE) ? fs.readFileSync(LOG_FILE, 'utf-8') : '';
  const separator = existing ? '\n\n---\n\n' : '';
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  fs.writeFileSync(LOG_FILE, entry + separator + existing, 'utf-8');
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

// ── Per-chat conversation state for multi-step commands ───────────────────────

type CommandState =
  | { cmd: 'evening'; step: 1 | 2 | 3; answers: string[] }
  | { cmd: 'journal'; question: string }
  | { cmd: 'reflect' };

const pendingState = new Map<string, CommandState>();

// ── Journal questions (rotated by day-of-year mod question count) ─────────────

const JOURNAL_QUESTIONS = [
  'Qual è una cosa che stai evitando che sai di dovere affrontare?',
  'Cosa ha drenato di più la tua energia questa settimana, e cosa la ha ripristinata?',
  'Se potessi rifare una decisione dell\'ultimo mese, quale sarebbe?',
  'Qual è la cosa più onesta che potresti dire di dove sei adesso?',
  'Di che cosa sei grato ma che raramente riconosci?',
  'Come potrebbe essere "abbastanza buono" oggi, e stai chiedendo più di quello che serve?',
  'Che cosa il tuo futuro io ha bisogno che tu cominci (o smetta di) fare questa settimana?',
];

function getTodaysJournalQuestion(): string {
  const dayOfYear = Math.floor(
    (Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86_400_000,
  );
  return JOURNAL_QUESTIONS[dayOfYear % JOURNAL_QUESTIONS.length];
}

// ── Security helper ───────────────────────────────────────────────────────────

function isAuthorised(chatId: number): boolean {
  if (!ALLOWED_CHAT_ID) return true;
  return chatId.toString() === ALLOWED_CHAT_ID;
}

async function guardedReply(ctx: Context, fn: () => Promise<void>): Promise<void> {
  if (!isAuthorised(ctx.chat!.id)) return;
  try {
    await fn();
  } catch (err) {
    logger.error({ err }, 'Life command error');
    await ctx.reply('Something went wrong. Check logs.').catch(() => {});
  }
}

// ── Exported registration function ───────────────────────────────────────────

export function registerLifeCommands(bot: Bot<Context>): void {

  // ── /morning ───────────────────────────────────────────────────────────────
  // Passes through runAgent() so Claude handles the conversation interactively
  bot.command('morning', async (ctx) => {
    await guardedReply(ctx, async () => {
      const goalsContent = readFileSafe(GOALS_KEY);
      const meContent = readFileSafe(ME_KEY);
      const logContent = readFileSafe(LOG_FILE).slice(0, 2000);
      const today = todayISO();

      const prompt =
        `Fai il briefing mattutino per oggi (${today}). Rispondi nella lingua dell'utente.\n\n` +
        `[Profilo utente]\n${meContent.slice(0, 1000)}\n[Fine profilo]\n\n` +
        `[Obiettivi attivi]\n${goalsContent.slice(0, 1500)}\n[Fine obiettivi]\n\n` +
        `[Log recente]\n${logContent}\n[Fine log]\n\n` +
        `Istruzioni:\n` +
        `1. Saluta l'utente per nome\n` +
        `2. Mostra la data di oggi e uno stato rapido degli obiettivi attivi (1 riga ciascuno)\n` +
        `3. Suggerisci i 3 principali obiettivi per oggi basati su obiettivi e elementi in sospeso\n` +
        `4. Chiedi "Come è la tua energia oggi? (1-10)" e ASPETTA la risposta\n` +
        `5. In base al livello di energia, adatta gli obiettivi (poca energia = compiti più facili prima)\n` +
        `6. Termina con un suggerimento di una cosa semplice e motivante da realizzare\n` +
        `Sii conciso — niente muri di testo. Conversazionale, non un rapporto.`;

      const { messageQueue } = await import('./message-queue.js');
      messageQueue.enqueue(ctx.chat!.id.toString(), async () => {
        const { handleMessage } = await import('./bot.js');
        await (handleMessage as Function)(ctx, prompt);
      });
    });
  });

  // ── /evening ───────────────────────────────────────────────────────────────
  // Interactive via runAgent() — Claude asks questions and logs answers
  bot.command('evening', async (ctx) => {
    await guardedReply(ctx, async () => {
      const goalsContent = readFileSafe(GOALS_KEY);
      const logContent = readFileSafe(LOG_FILE).slice(0, 1500);
      const today = todayISO();

      const prompt =
        `Fai la revisione serale per oggi (${today}). Rispondi nella lingua dell'utente.\n\n` +
        `[Obiettivi attivi]\n${goalsContent.slice(0, 1000)}\n[Fine obiettivi]\n\n` +
        `[Log recente]\n${logContent}\n[Fine log]\n\n` +
        `Istruzioni:\n` +
        `1. Chiedi: "Cosa hai realizzato oggi?" — aspetta la risposta\n` +
        `2. Chiedi: "Livello di energia? (1-10)" — aspetta la risposta\n` +
        `3. Chiedi: "Una riflessione o lezione da oggi?" — aspetta la risposta\n` +
        `4. Dopo le 3 risposte, scrivi un entry nel log usando lo strumento Write:\n` +
        `   Formato: "## ${today} — Evening Review\\n\\nRealizzato: [risposta1]\\nEnergia: [risposta2]/10\\nRiflessione: [risposta3]\\n\\n---"\n` +
        `   PREPEND al file (più recente prima)\n` +
        `5. Suggerisci i 3 principali obiettivi per domani basati su obiettivi e elemento in sospeso\n` +
        `6. Saluta buonanotte\n` +
        `Sii conversazionale. Una domanda alla volta. Aspetta ogni risposta.`;

      const { messageQueue } = await import('./message-queue.js');
      messageQueue.enqueue(ctx.chat!.id.toString(), async () => {
        const { handleMessage } = await import('./bot.js');
        await (handleMessage as Function)(ctx, prompt);
      });
    });
  });

  // ── /goals ─────────────────────────────────────────────────────────────────
  bot.command('goals', async (ctx) => {
    await guardedReply(ctx, async () => {
      const args = (ctx.match ?? '').trim();

      if (!args) {
        // List all goals
        const content = readFileSafe(GOALS_KEY);
        await ctx.reply(`Current goals:\n\n${content.slice(0, 3800)}`);
        return;
      }

      const addMatch = args.match(/^add\s+(.+)/i);
      if (addMatch) {
        const description = addMatch[1].trim();
        let content = readFileSafe(GOALS_KEY);

        // Count existing goals to number the new one
        const existingGoals = [...content.matchAll(/^###\s+Goal\s+(\d+):/gm)];
        const nextNum = existingGoals.length + 1;

        const newGoalBlock =
          `\n### Goal ${nextNum}: ${description}\n` +
          `- Why it matters: [FILL IN]\n` +
          `- Target outcome: [FILL IN]\n` +
          `- Target date: [FILL IN]\n` +
          `- Current status: 0%\n` +
          `- Next action: [FILL IN]\n` +
          `- Blocker: none\n`;

        // Insert before "## On Hold" section if it exists, otherwise append
        const onHoldIdx = content.indexOf('## On Hold');
        if (onHoldIdx !== -1) {
          content = content.slice(0, onHoldIdx) + newGoalBlock + '\n' + content.slice(onHoldIdx);
        } else {
          content = content + newGoalBlock;
        }

        // Update the "Last Updated" line
        content = content.replace(
          /^## Last Updated\s*\n.*$/m,
          `## Last Updated\n${todayISO()}`,
        );

        fs.mkdirSync(path.dirname(GOALS_KEY), { recursive: true });
        fs.writeFileSync(GOALS_KEY, content, 'utf-8');
        await ctx.reply(`Goal ${nextNum} added: ${description}`);
        return;
      }

      const doneMatch = args.match(/^done\s+(\d+)/i);
      if (doneMatch) {
        const num = parseInt(doneMatch[1], 10);
        let content = readFileSafe(GOALS_KEY);

        // Find and mark the goal header line with [DONE]
        const goalRegex = new RegExp(`(###\\s+Goal\\s+${num}:\\s*)(.+)`, 'm');
        if (!goalRegex.test(content)) {
          await ctx.reply(`Goal ${num} not found.`);
          return;
        }
        content = content.replace(goalRegex, (_, prefix, title) => {
          if (title.startsWith('[DONE]')) return `${prefix}${title}`;
          return `${prefix}[DONE] ${title}`;
        });

        content = content.replace(
          /^## Last Updated\s*\n.*$/m,
          `## Last Updated\n${todayISO()}`,
        );

        fs.writeFileSync(GOALS_KEY, content, 'utf-8');
        await ctx.reply(`Goal ${num} marked as done.`);
        return;
      }

      await ctx.reply(
        'Usage:\n' +
        '/goals — list all goals\n' +
        '/goals add <description> — add a new goal\n' +
        '/goals done <number> — mark goal complete',
      );
    });
  });

  // ── /focus ─────────────────────────────────────────────────────────────────
  bot.command('focus', async (ctx) => {
    await guardedReply(ctx, async () => {
      const taskArg = (ctx.match ?? '').trim();
      const now = new Date();
      const timeStr = now.toTimeString().slice(0, 5); // HH:MM

      let task: string;
      if (taskArg) {
        task = taskArg;
      } else {
        // Try to pull the first active goal as the suggested task
        const goalsContent = readFileSafe(GOALS_KEY);
        const firstNextAction = goalsContent.match(/^[-*]\s*Next action:\s*(.+)/im);
        if (firstNextAction && !firstNextAction[1].includes('[FILL')) {
          task = firstNextAction[1].trim();
        } else {
          await ctx.reply(
            'What are you focusing on? Send:\n\n/focus <task description>',
          );
          return;
        }
      }

      // Log focus session start to log.md
      const logEntry =
        `## Focus session — ${todayISO()} ${timeStr}\n` +
        `**Task:** ${task}\n` +
        `**Started:** ${timeStr}`;
      prependLog(logEntry);

      await ctx.reply(
        `Focus mode: ${task}\n\n25-min block. Go.\n\n(Started ${timeStr})`,
      );
    });
  });

  // ── /journal ───────────────────────────────────────────────────────────────
  bot.command('journal', async (ctx) => {
    await guardedReply(ctx, async () => {
      const chatId = ctx.chat!.id.toString();
      const question = getTodaysJournalQuestion();
      pendingState.set(chatId, { cmd: 'journal', question });
      await ctx.reply(`Journal prompt:\n\n${question}`);
    });
  });

  // ── /review ────────────────────────────────────────────────────────────────
  bot.command('review', async (ctx) => {
    await guardedReply(ctx, async () => {
      const goalsContent = readFileSafe(GOALS_KEY);
      const logContent = readFileSafe(LOG_FILE);
      const recentLog = logContent.split('\n').slice(0, 200).join('\n');

      const prompt =
        `Fai la revisione settimanale. Rispondi nella lingua dell'utente.\n\n` +
        `Oggi: ${todayISO()}\n\n` +
        `[Obiettivi attivi]\n${goalsContent.slice(0, 2000)}\n[Fine obiettivi]\n\n` +
        `[Log recente (ultimi 7 giorni)]\n${recentLog}\n[Fine log]\n\n` +
        `Istruzioni:\n` +
        `1. Progresso obiettivi — stato rapido per ogni obiettivo attivo (1 riga ciascuno)\n` +
        `2. Vittorie questa settimana — 3-5 punti elenco\n` +
        `3. Lezioni — 2-3 cose da portare avanti\n` +
        `4. Chiedi: "Su cosa vuoi concentrarti la prossima settimana?" — aspetta la risposta\n` +
        `5. In base alla risposta, suggerisci i 3 obiettivi concreti principali\n` +
        `6. Scrivi la revisione settimanale in ${LOG_FILE} usando lo strumento Write (prepend)\n` +
        `Sii diretto e onesto, non da cheerleader. Meno di 400 parole per lo scorecard.`;

      const { messageQueue } = await import('./message-queue.js');
      messageQueue.enqueue(ctx.chat!.id.toString(), async () => {
        const { handleMessage } = await import('./bot.js');
        await (handleMessage as Function)(ctx, prompt);
      });
    });
  });

  // ── /remember <text> ───────────────────────────────────────────────────────
  bot.command('remember', async (ctx) => {
    await guardedReply(ctx, async () => {
      const text = (ctx.match ?? '').trim();
      if (!text) {
        await ctx.reply('Usage: /remember <what to remember>\n\nExample: /remember I prefer morning meetings before 10am');
        return;
      }

      const chatId = ctx.chat!.id.toString();
      const memoryId = saveStructuredMemory(
        chatId,
        text,
        text,             // summary = raw text for manual saves
        [],               // entities — let natural decay handle it
        ['manual'],       // topics
        0.9,              // high importance
        'manual',         // source
      );

      await ctx.reply(`Memory saved (#${memoryId}, importance 0.9).\n\nUse /pin ${memoryId} to make it permanent.`);
    });
  });

  // ── /reflect ───────────────────────────────────────────────────────────────
  bot.command('reflect', async (ctx) => {
    await guardedReply(ctx, async () => {
      const chatId = ctx.chat!.id.toString();

      const recent = getRecentMemories(chatId, 10);

      if (recent.length === 0) {
        await ctx.reply('No memories found yet. Use /remember to save something.');
        return;
      }

      const lines = recent.map((m, i) => {
        const pin = m.pinned ? ' [pinned]' : '';
        return `${i + 1}. #${m.id} [${m.importance.toFixed(1)}]${pin} ${m.summary}`;
      });

      pendingState.set(chatId, { cmd: 'reflect' });

      await ctx.reply(
        `Recent memories:\n\n${lines.join('\n\n')}\n\n` +
        `Reply with the number of a memory to delete it, or anything else to exit.`,
      );
    });
  });

  // ── Multi-step state machine (handles follow-up messages for evening/journal/reflect) ──
  bot.on('message:text', async (ctx, next) => {
    const chatId = ctx.chat!.id.toString();
    const state = pendingState.get(chatId);
    if (!state) return next();

    const text = ctx.message.text.trim();

    // Don't intercept slash commands
    if (text.startsWith('/')) {
      pendingState.delete(chatId);
      return next();
    }

    if (state.cmd === 'evening') {
      state.answers.push(text);

      if (state.step === 1) {
        state.step = 2;
        await ctx.reply('Q2: What was your energy level today? (1–10)');
        return;
      }

      if (state.step === 2) {
        state.step = 3;
        await ctx.reply('Q3: One reflection — what would you do differently?');
        return;
      }

      // Step 3: collect final answer and write log
      const [accomplished, energy, reflection] = state.answers;
      const now = new Date();
      const timeStr = now.toTimeString().slice(0, 5);

      const entry =
        `## Evening check-in — ${todayISO()} ${timeStr}\n` +
        `**Accomplished:** ${accomplished}\n` +
        `**Energy:** ${energy}/10\n` +
        `**Reflection:** ${reflection}`;

      prependLog(entry);
      pendingState.delete(chatId);
      await ctx.reply('Logged. Good night.');
      return;
    }

    if (state.cmd === 'journal') {
      const now = new Date();
      const timeStr = now.toTimeString().slice(0, 5);

      const entry =
        `## Journal — ${todayISO()} ${timeStr}\n` +
        `**Q:** ${state.question}\n` +
        `**A:** ${text}`;

      prependLog(entry);
      pendingState.delete(chatId);
      await ctx.reply('Saved to journal.');
      return;
    }

    if (state.cmd === 'reflect') {
      const num = parseInt(text, 10);
      if (!isNaN(num) && num > 0) {
        // User wants to delete a memory by list position
        const recent = getRecentMemories(chatId, 10);
        const target = recent[num - 1];
        if (target) {
          deleteMemory(target.id);
          pendingState.delete(chatId);
          await ctx.reply(`Memory #${target.id} deleted.`);
        } else {
          await ctx.reply(`No memory at position ${num}. Exiting reflect mode.`);
          pendingState.delete(chatId);
        }
      } else {
        pendingState.delete(chatId);
        await ctx.reply('Exited reflect mode.');
      }
      return;
    }

    return next();
  });

  // ── /learnlesson ───────────────────────────────────────────────────────────
  // Capture a lesson learned immediately after an error or misunderstanding
  // Invokes the learnlesson skill with a structured prompt
  bot.command('learnlesson', async (ctx) => {
    await guardedReply(ctx, async () => {
      // Extract optional lesson description from command args
      const args = ctx.message?.text?.slice('/learnlesson'.length).trim() || '';

      const prompt = args
        ? `[Lesson Input: ${args}]\n\nStep 1: Confirm this lesson description. If it seems complete, proceed to steps 2-4. If not clear, ask me to clarify in one sentence.\n\nStep 2: Reconstruct what went wrong from context if needed. Then categorize as: misunderstanding | code_bug | workflow | communication | memory | context_missing\n\nStep 3: Save to 3 places: (1) memory file in ~/.wild-claude-pi/memories/YYYY-MM/YYYY-MM-DD-lesson-<slug>.md, (2) append to ~/.wild-claude-pi/reflections.jsonl, (3) append to ~/.wild-claude-pi/lessons-learned.md.\n\nStep 4: Confirm with a brief response listing the error and the rule.`
        : `Capture a lesson learned. You have context from our conversation.\n\nStep 1: Look at the recent conversation (last 5-10 exchanges). Identify what went wrong, what should have happened, and why.\n\nStep 2: Categorize: misunderstanding | code_bug | workflow | communication | memory | context_missing\n\nStep 3: Save to 3 places: (1) memory file in ~/.wild-claude-pi/memories/YYYY-MM/YYYY-MM-DD-lesson-<slug>.md with frontmatter (type: lesson_learned, date, category, importance: 0.95, pinned: true), (2) append to ~/.wild-claude-pi/reflections.jsonl (one JSON line), (3) append to ~/.wild-claude-pi/lessons-learned.md.\n\nStep 4: Respond concisely with the error and the rule going forward.`;

      const result = await runAgent(prompt, undefined, () => void ctx.api.sendChatAction(ctx.chat!.id, 'typing'), undefined, 'claude-opus-4-6');

      if (result.text) {
        const parts = result.text.split('\n\n');
        for (const part of parts) {
          const lines = part.split('\n');
          for (const chunk of lines.slice(0, 20)) {
            if (chunk.length > 4096) {
              // Break extra long lines
              const subchunks = chunk.match(/.{1,4090}/g) || [];
              for (const subchunk of subchunks) {
                await ctx.reply(subchunk).catch(() => {});
              }
            } else if (chunk) {
              await ctx.reply(chunk).catch(() => {});
            }
          }
          if (lines.length > 20) {
            await ctx.reply(`... (truncated, rest saved to memory)`).catch(() => {});
            break;
          }
        }
      }
    });
  });
}
