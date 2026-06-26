/**
 * Voice HTTP routes — speech-to-text for the mobile app.
 *
 * Extracted into a registrar (like registerProjectRoutes / registerHermesRoutes)
 * so the route is unit-testable against a bare Hono app via app.fetch().
 *
 * POST /api/voice/stt — accepts an audio blob and returns { text }.
 * Transcription goes through voice.transcribeAudio(), which prefers Groq Whisper
 * (STT_PROVIDER=auto, the default) and falls back to local whisper-cpp.
 */

import type { Hono } from 'hono';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { logger } from './logger.js';

/** Groq's per-file Whisper size limit. */
const STT_MAX_BYTES = 25 * 1024 * 1024;

/** Map common audio content-types to the file extension Whisper expects. */
const STT_CT_EXT: Record<string, string> = {
  'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'm4a',
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3',
  'audio/ogg': 'ogg', 'audio/opus': 'ogg', 'audio/webm': 'webm',
  'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav',
  'audio/flac': 'flac',
};

/** Resolve the file extension to save the upload under (Whisper keys off it). */
export function resolveSttExt(contentType: string, filename?: string): string {
  const nameExt = filename && filename.includes('.') ? filename.split('.').pop()! : '';
  const ct = (contentType || '').split(';')[0].trim().toLowerCase();
  return (nameExt || STT_CT_EXT[ct] || 'm4a').toLowerCase();
}

export function registerVoiceRoutes(app: Hono): void {
  // POST /api/voice/stt — transcribe an audio blob and return the text.
  //
  // Accepts the audio either as:
  //   - multipart/form-data with field `audio` (preferred) or `file`, or
  //   - a raw binary body (Content-Type: audio/*; extension inferred from it).
  app.post('/api/voice/stt', async (c) => {
    try {
      const { transcribeAudio, voiceCapabilities, UPLOADS_DIR } = await import('./voice.js');
      if (!voiceCapabilities().stt) {
        return c.json(
          { error: 'speech-to-text not configured (set GROQ_API_KEY or WHISPER_MODEL_PATH)' },
          503,
        );
      }

      // Resolve the audio bytes + a filename extension from whichever form the
      // client used.
      let bytes: Buffer;
      let ext: string;
      const contentType = c.req.header('Content-Type') ?? '';

      if (contentType.includes('multipart/form-data')) {
        const formData = await c.req.formData();
        const audio = formData.get('audio') ?? formData.get('file');
        if (!audio || typeof audio === 'string') return c.json({ error: 'audio file required' }, 400);
        const file = audio as File;
        ext = resolveSttExt(file.type, file.name);
        bytes = Buffer.from(await file.arrayBuffer());
      } else {
        const raw = await c.req.arrayBuffer();
        if (!raw || raw.byteLength === 0) return c.json({ error: 'audio body required' }, 400);
        ext = resolveSttExt(contentType);
        bytes = Buffer.from(raw);
      }

      if (bytes.length === 0) return c.json({ error: 'empty audio' }, 400);
      if (bytes.length > STT_MAX_BYTES) {
        return c.json({ error: `audio too large (max ${Math.floor(STT_MAX_BYTES / 1024 / 1024)}MB)` }, 413);
      }

      // Write to the uploads tmp dir, transcribe, then always clean up.
      const tmpDir = path.join(UPLOADS_DIR, 'tmp');
      fs.mkdirSync(tmpDir, { recursive: true });
      const tmpFile = path.join(tmpDir, `stt-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`);
      fs.writeFileSync(tmpFile, bytes);

      let text = '';
      try {
        text = (await transcribeAudio(tmpFile)).trim();
      } finally {
        fs.unlink(tmpFile, () => {});
      }

      return c.json({ text });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ err: msg }, 'Voice STT endpoint failed');
      return c.json({ error: msg }, 500);
    }
  });
}
