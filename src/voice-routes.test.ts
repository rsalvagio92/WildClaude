import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';

vi.mock('./logger.js', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));

const transcribeAudioMock = vi.fn();
const voiceCapabilitiesMock = vi.fn();
vi.mock('./voice.js', () => ({
  transcribeAudio: (...a: unknown[]) => transcribeAudioMock(...a),
  voiceCapabilities: () => voiceCapabilitiesMock(),
  UPLOADS_DIR: '/tmp/wc-stt-test-uploads',
}));

import { registerVoiceRoutes, resolveSttExt } from './voice-routes.js';

function makeApp() {
  const app = new Hono();
  registerVoiceRoutes(app);
  return app;
}

beforeEach(() => {
  transcribeAudioMock.mockReset();
  voiceCapabilitiesMock.mockReset();
  voiceCapabilitiesMock.mockReturnValue({ stt: true, tts: true });
});

describe('resolveSttExt', () => {
  it('prefers the filename extension', () => {
    expect(resolveSttExt('audio/mpeg', 'note.m4a')).toBe('m4a');
  });
  it('falls back to content-type mapping', () => {
    expect(resolveSttExt('audio/ogg; codecs=opus')).toBe('ogg');
    expect(resolveSttExt('audio/wav')).toBe('wav');
    expect(resolveSttExt('audio/mp4')).toBe('m4a');
  });
  it('defaults to m4a for unknown types', () => {
    expect(resolveSttExt('application/octet-stream')).toBe('m4a');
    expect(resolveSttExt('')).toBe('m4a');
  });
});

describe('POST /api/voice/stt', () => {
  it('transcribes a multipart upload (field: audio)', async () => {
    transcribeAudioMock.mockResolvedValue('  hello world  ');
    const app = makeApp();

    const fd = new FormData();
    fd.set('audio', new File([Buffer.from('fake-audio-bytes')], 'clip.m4a', { type: 'audio/mp4' }));
    const res = await app.request('/api/voice/stt', { method: 'POST', body: fd });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: 'hello world' }); // trimmed
    expect(transcribeAudioMock).toHaveBeenCalledTimes(1);
    const tmpPath = transcribeAudioMock.mock.calls[0][0] as string;
    expect(tmpPath).toMatch(/\.m4a$/);
  });

  it('accepts the alternate `file` field', async () => {
    transcribeAudioMock.mockResolvedValue('hi');
    const app = makeApp();
    const fd = new FormData();
    fd.set('file', new File([Buffer.from('x')], 'a.ogg', { type: 'audio/ogg' }));
    const res = await app.request('/api/voice/stt', { method: 'POST', body: fd });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: 'hi' });
  });

  it('transcribes a raw binary body and infers extension from content-type', async () => {
    transcribeAudioMock.mockResolvedValue('raw body text');
    const app = makeApp();
    const res = await app.request('/api/voice/stt', {
      method: 'POST',
      headers: { 'Content-Type': 'audio/wav' },
      body: Buffer.from('RIFFfake'),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: 'raw body text' });
    expect(transcribeAudioMock.mock.calls[0][0] as string).toMatch(/\.wav$/);
  });

  it('returns 503 when STT is not configured', async () => {
    voiceCapabilitiesMock.mockReturnValue({ stt: false, tts: false });
    const app = makeApp();
    const fd = new FormData();
    fd.set('audio', new File([Buffer.from('x')], 'a.m4a', { type: 'audio/mp4' }));
    const res = await app.request('/api/voice/stt', { method: 'POST', body: fd });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/not configured/);
    expect(transcribeAudioMock).not.toHaveBeenCalled();
  });

  it('returns 400 when multipart has no audio field', async () => {
    const app = makeApp();
    const fd = new FormData();
    fd.set('notaudio', 'x');
    const res = await app.request('/api/voice/stt', { method: 'POST', body: fd });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/audio file required/);
  });

  it('returns 400 when raw body is empty', async () => {
    const app = makeApp();
    const res = await app.request('/api/voice/stt', {
      method: 'POST',
      headers: { 'Content-Type': 'audio/wav' },
      body: Buffer.alloc(0),
    });
    expect(res.status).toBe(400);
  });

  it('returns 500 when transcription throws', async () => {
    transcribeAudioMock.mockRejectedValue(new Error('groq exploded'));
    const app = makeApp();
    const fd = new FormData();
    fd.set('audio', new File([Buffer.from('x')], 'a.m4a', { type: 'audio/mp4' }));
    const res = await app.request('/api/voice/stt', { method: 'POST', body: fd });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/groq exploded/);
  });
});
