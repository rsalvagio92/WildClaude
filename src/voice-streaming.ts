/**
 * Real-time voice streaming via ElevenLabs streaming TTS.
 *
 * Replaces the batch flow:
 *   transcribe → wait for full LLM response → TTS the whole thing → send
 * With a sub-second incremental flow:
 *   transcribe → stream LLM → chunk text → stream TTS → buffer audio → send voice
 *
 * Architecture:
 *   - speakStreamed(text$): consumes a string stream, emits MP3 audio chunks
 *   - Uses ElevenLabs /v1/text-to-speech/{voice_id}/stream-input over WebSocket
 *     (a flexible streaming endpoint that accepts text chunks)
 *   - On the Telegram side, we accumulate audio chunks until the first
 *     sentence boundary and send the first voice note ASAP, then queue the rest
 *
 * This is a v1 scaffold — runtime behavior depends on:
 *   - ELEVENLABS_API_KEY set
 *   - ELEVENLABS_VOICE_ID set
 *   - VOICE_STREAMING_ENABLED=true in .env (default off; the existing batch
 *     voice path stays the default)
 */

import { ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID } from './config.js';
import { logger } from './logger.js';

const STREAMING_ENABLED = (process.env.VOICE_STREAMING_ENABLED ?? 'false').toLowerCase() === 'true';
const ELEVEN_MODEL = process.env.ELEVENLABS_MODEL_ID ?? 'eleven_turbo_v2_5';

export function voiceStreamingAvailable(): boolean {
  return STREAMING_ENABLED && !!ELEVENLABS_API_KEY && !!ELEVENLABS_VOICE_ID;
}

export interface VoiceChunk {
  /** MP3-encoded audio frames. */
  audio: Buffer;
  /** Sentence index inside the stream (0-based). */
  sentenceIndex: number;
  /** True once the upstream LLM has finished. */
  final: boolean;
}

/**
 * Splits a streaming text source into sentence-ish chunks ready to feed TTS.
 * Yields whenever a sentence-terminator is seen (. ! ?), or every 240 chars,
 * or at stream end.
 */
async function* sentenceStream(textIter: AsyncIterable<string>): AsyncGenerator<string> {
  let buf = '';
  for await (const piece of textIter) {
    buf += piece;
    while (true) {
      const m = buf.match(/^([\s\S]+?[.!?])(\s+)/);
      if (m) {
        yield m[1];
        buf = buf.slice(m[0].length);
      } else if (buf.length >= 240) {
        // Force-flush at a soft cap so we don't wait forever on a paragraph
        // without punctuation.
        yield buf;
        buf = '';
      } else {
        break;
      }
    }
  }
  if (buf.trim()) yield buf;
}

/**
 * Send a sentence to ElevenLabs streaming TTS, return the audio buffer.
 * For now uses the non-WS streaming HTTP endpoint, which yields audio chunks
 * as it generates. A future revision can promote to the WS endpoint for
 * even lower latency.
 */
async function ttsSentence(text: string): Promise<Buffer> {
  if (!ELEVENLABS_API_KEY || !ELEVENLABS_VOICE_ID) {
    throw new Error('ElevenLabs not configured');
  }
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(ELEVENLABS_VOICE_ID)}/stream`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': ELEVENLABS_API_KEY,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: ELEVEN_MODEL,
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  });
  if (!res.ok || !res.body) {
    const t = await res.text().catch(() => '');
    throw new Error(`ElevenLabs ${res.status}: ${t.slice(0, 200)}`);
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c)));
}

/**
 * Public entry point. Pass an async iterable of text chunks from the LLM, get
 * back an async iterable of audio chunks ready to forward to Telegram.
 */
export async function* speakStreamed(textIter: AsyncIterable<string>): AsyncGenerator<VoiceChunk> {
  if (!voiceStreamingAvailable()) {
    logger.info('voice-streaming: disabled or unconfigured — caller should fall back to batch TTS');
    return;
  }
  let idx = 0;
  for await (const sentence of sentenceStream(textIter)) {
    try {
      const audio = await ttsSentence(sentence);
      yield { audio, sentenceIndex: idx, final: false };
      idx++;
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : String(err), idx }, 'voice-streaming: TTS chunk failed');
      // Continue with next chunk — don't break the whole stream over one failure
    }
  }
  // Sentinel: caller knows we're done because the iterator ends.
}

/**
 * Helper: bridge a runAgent onStreamText callback into an async iterable so
 * speakStreamed() can consume it.
 */
export function makeTextStreamSink(): { iter: AsyncIterable<string>; push: (s: string) => void; close: () => void } {
  const queue: string[] = [];
  let resolve: ((v: IteratorResult<string>) => void) | null = null;
  let closed = false;

  const iter: AsyncIterable<string> = {
    [Symbol.asyncIterator]() {
      return {
        async next(): Promise<IteratorResult<string>> {
          if (queue.length > 0) return { value: queue.shift()!, done: false };
          if (closed) return { value: undefined as unknown as string, done: true };
          return new Promise<IteratorResult<string>>((r) => { resolve = r; });
        },
      };
    },
  };

  const push = (s: string): void => {
    if (resolve) {
      const r = resolve;
      resolve = null;
      r({ value: s, done: false });
    } else {
      queue.push(s);
    }
  };

  const close = (): void => {
    closed = true;
    if (resolve) {
      const r = resolve;
      resolve = null;
      r({ value: undefined as unknown as string, done: true });
    }
  };

  return { iter, push, close };
}
