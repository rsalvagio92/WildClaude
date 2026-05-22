/**
 * Gemini text embeddings — lightweight semantic search for memory_blocks.
 *
 * Uses Google's text-embedding-004 (768d). Requires GOOGLE_API_KEY.
 * Falls back gracefully when missing — the memory system continues to work
 * with FTS5 keyword search, just without semantic recall.
 *
 * Cost: ~$0.0001 per text up to 2K tokens. Negligible compared to chat.
 */

import { GOOGLE_API_KEY } from './config.js';
import { logger } from './logger.js';

const EMBED_MODEL = 'text-embedding-004';
const EMBED_DIM = 768;

let warned = false;

export function embeddingsAvailable(): boolean {
  return !!(GOOGLE_API_KEY || process.env.GOOGLE_API_KEY);
}

/**
 * Encode a string into a float32 embedding via Gemini.
 * Returns null if the API key is missing or the call fails.
 */
export async function embed(text: string): Promise<Float32Array | null> {
  if (!embeddingsAvailable()) {
    if (!warned) {
      logger.info('Embeddings disabled — GOOGLE_API_KEY not set. Semantic search falls back to keyword matching.');
      warned = true;
    }
    return null;
  }
  const key = GOOGLE_API_KEY || process.env.GOOGLE_API_KEY!;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent?key=${encodeURIComponent(key)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: { parts: [{ text: text.slice(0, 8000) }] },
        }),
      },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      logger.warn({ status: res.status, body: body.slice(0, 200) }, 'embed: API call failed');
      return null;
    }
    const data = await res.json() as { embedding?: { values?: number[] } };
    const vals = data.embedding?.values;
    if (!Array.isArray(vals) || vals.length !== EMBED_DIM) {
      logger.warn({ len: vals?.length }, 'embed: unexpected response shape');
      return null;
    }
    const out = new Float32Array(EMBED_DIM);
    for (let i = 0; i < EMBED_DIM; i++) out[i] = vals[i];
    return out;
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'embed: exception');
    return null;
  }
}

/** Serialize a Float32Array to a Buffer for SQLite BLOB storage. */
export function embeddingToBuffer(e: Float32Array): Buffer {
  return Buffer.from(e.buffer, e.byteOffset, e.byteLength);
}

/** Deserialize a SQLite BLOB back into a Float32Array. */
export function bufferToEmbedding(b: Buffer): Float32Array | null {
  if (b.length !== EMBED_DIM * 4) return null;
  return new Float32Array(b.buffer, b.byteOffset, EMBED_DIM);
}

/** Cosine similarity in [-1, 1]. Returns 0 if vector lengths differ. */
export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}
