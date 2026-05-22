/**
 * Personality moods — context-aware personality modulation.
 *
 * The base personality stays the user's preset. Moods are *modifiers* applied
 * on top: terser during deep-work hours, looser in evenings, more formal
 * during work hours. Moods are derived from time-of-day + signals like an
 * active /focus session.
 *
 * Exposed as an additional snippet appended to the system prompt that
 * personality.ts already injects.
 */

import { getDb } from './db.js';

export type Mood = 'focus' | 'work' | 'evening' | 'weekend' | 'neutral';

export interface MoodContext {
  /** Currently in a /focus session? */
  inFocus?: boolean;
  /** Override the current mood explicitly (e.g. from /mood set). */
  override?: Mood;
}

const MOOD_MODIFIERS: Record<Mood, string> = {
  focus:
    `Mood: deep work. Be terse. No greetings, no apologies, no recapping. ` +
    `Answer the question and stop. Never propose tangents.`,
  work:
    `Mood: work hours. Professional tone. Prefer short paragraphs, code over prose, ` +
    `bullet points for choices. Skip pleasantries.`,
  evening:
    `Mood: evening / off-hours. Slightly looser, more conversational. ` +
    `It's okay to ask a follow-up or share a small observation. Still no fluff.`,
  weekend:
    `Mood: weekend. More relaxed. Personal topics welcome. Take a moment ` +
    `to actually engage with the person, not just the task.`,
  neutral: '',
};

export function detectMood(ctx: MoodContext = {}, now: Date = new Date()): Mood {
  if (ctx.override) return ctx.override;
  if (ctx.inFocus) return 'focus';
  const dow = now.getDay(); // 0=Sun, 6=Sat
  const hour = now.getHours();
  if (dow === 0 || dow === 6) return 'weekend';
  if (hour >= 9 && hour < 18) return 'work';
  if (hour >= 18 && hour < 23) return 'evening';
  // Late night / early morning: neutral
  return 'neutral';
}

/** Append-to-system-prompt snippet for the current mood. */
export function moodSnippet(mood: Mood): string {
  return MOOD_MODIFIERS[mood] || '';
}

export function logMoodChange(mood: Mood, reason = ''): void {
  try {
    getDb().prepare(`INSERT INTO mood_log (mood, reason, at) VALUES (?, ?, ?)`).run(mood, reason, Date.now());
  } catch { /* table missing */ }
}

export function getCurrentMood(ctx: MoodContext = {}): { mood: Mood; snippet: string } {
  const mood = detectMood(ctx);
  return { mood, snippet: moodSnippet(mood) };
}

export function registerMoodCommand(
  bot: import('grammy').Bot,
  isAuthorised: (chatId: number) => boolean,
): void {
  bot.command('mood', async (ctx) => {
    if (!isAuthorised(ctx.chat!.id)) return;
    const arg = (ctx.match ?? '').trim().toLowerCase();
    if (!arg) {
      const cur = detectMood();
      await ctx.reply(`Current mood (derived): ${cur}\n\nModifier:\n${moodSnippet(cur) || '(no modifier)'}\n\nOverride: /mood set <focus|work|evening|weekend|neutral>`);
      return;
    }
    if (arg.startsWith('set ')) {
      const m = arg.slice(4).trim() as Mood;
      if (!['focus', 'work', 'evening', 'weekend', 'neutral'].includes(m)) {
        await ctx.reply('Unknown mood. Use one of: focus, work, evening, weekend, neutral');
        return;
      }
      logMoodChange(m, 'manual override');
      await ctx.reply(`Mood override logged: ${m}`);
      return;
    }
    await ctx.reply('Usage:\n/mood\n/mood set <focus|work|evening|weekend|neutral>');
  });
}
