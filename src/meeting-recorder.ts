/**
 * Meeting recorder — accumulate audio chunks, transcribe, and generate structured notes.
 * Usage:
 *   /meeting start [title]  — Begin recording session
 *   /meeting add <audio>    — Transcribe + append audio chunk
 *   /meeting stop           — End session, generate summary
 */

import { logger } from './logger.js';
import { runAgent } from './agent.js';
import { MODELS } from './models.js';
import { saveStructuredMemory } from './db.js';

export interface MeetingSession {
  id: string;
  title: string;
  startedAt: number;
  chunks: MeetingChunk[];
}

export interface MeetingChunk {
  seq: number;
  transcript: string;
  duration: number; // seconds
}

const sessions = new Map<string, MeetingSession>();

export function startMeeting(chatId: string, title?: string): MeetingSession {
  const id = `meeting_${Date.now()}`;
  const session: MeetingSession = {
    id,
    title: title || 'Untitled Meeting',
    startedAt: Date.now(),
    chunks: [],
  };
  sessions.set(chatId, session);
  logger.info({ chatId, sessionId: id }, 'Meeting started');
  return session;
}

export function getMeeting(chatId: string): MeetingSession | undefined {
  return sessions.get(chatId);
}

export async function addMeetingChunk(
  chatId: string,
  transcript: string,
  durationSecs: number,
): Promise<MeetingChunk | null> {
  const session = sessions.get(chatId);
  if (!session) {
    logger.warn({ chatId }, 'No active meeting session');
    return null;
  }

  const chunk: MeetingChunk = {
    seq: session.chunks.length + 1,
    transcript,
    duration: durationSecs,
  };
  session.chunks.push(chunk);
  logger.info({ chatId, seq: chunk.seq }, 'Meeting chunk added');
  return chunk;
}

/** End meeting, generate summary, save to memories. */
export async function finalizeMeeting(chatId: string): Promise<{
  summary: string;
  actionItems: string[];
  decisions: string[];
} | null> {
  const session = sessions.get(chatId);
  if (!session) {
    logger.warn({ chatId }, 'No active meeting session');
    return null;
  }

  if (session.chunks.length === 0) {
    logger.warn({ chatId }, 'Empty meeting session');
    sessions.delete(chatId);
    return null;
  }

  const fullTranscript = session.chunks.map(c => c.transcript).join('\n\n---\n\n');
  const duration = session.chunks.reduce((sum, c) => sum + c.duration, 0);

  // Generate structured summary
  const prompt = `Analizza questa trascrizione di riunione e produci output strutturato.

TRASCRIZIONE:
${fullTranscript}

---

Ritorna JSON object:
{
  "summary": "riassunto della riunione in 2-3 frasi",
  "actionItems": [
    "azione 1 - responsabile (se noto)",
    "azione 2 - deadline (se noto)"
  ],
  "decisions": [
    "decisione 1",
    "decisione 2"
  ],
  "topics": ["topic1", "topic2"]
}

Sii conciso e specifico.`;

  try {
    const result = await runAgent(prompt, undefined, () => undefined, undefined, MODELS.haiku);
    const raw = result.text?.trim() ?? '{}';
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found');

    const parsed = JSON.parse(jsonMatch[0]) as {
      summary: string;
      actionItems: string[];
      decisions: string[];
      topics?: string[];
    };

    // Save to memory
    const markdown = `# ${session.title}

**Data:** ${new Date(session.startedAt).toLocaleString('it-IT')}
**Durata:** ${Math.round(duration / 60)} minuti

## Riassunto
${parsed.summary}

## Azioni
${parsed.actionItems.map(a => `- ${a}`).join('\n') || '(nessuna)'}

## Decisioni
${parsed.decisions.map(d => `- ${d}`).join('\n') || '(nessuna)'}

## Trascrizione completa
${fullTranscript}`;

    await saveStructuredMemory(
      chatId.toString(),
      markdown,
      parsed.summary,
      [],
      ['meeting', ...(parsed.topics || [])],
      0.75,
      'meeting'
    );

    logger.info({ chatId, sessionId: session.id }, 'Meeting finalized');
    sessions.delete(chatId);

    return {
      summary: parsed.summary,
      actionItems: parsed.actionItems,
      decisions: parsed.decisions,
    };
  } catch (err) {
    logger.error({ err, chatId }, 'Failed to finalize meeting');
    sessions.delete(chatId);
    return null;
  }
}
