/**
 * Native TTS playback via expo-audio, with transport controls.
 *
 * Flow: POST text to /api/voice/tts (server synthesizes ElevenLabs MP3) → write
 * the audio to the cache → play it through an expo-audio AudioPlayer.
 *
 * Controls: play/pause/resume/stop/seek plus a subscribable PlaybackState
 * (status + position/duration) so the UI can render a scrubber and buttons.
 *
 * Single-stream invariant: a monotonic `playToken` guarantees only the latest
 * speak() owns the player. Any new speak() or stopPlayback() bumps the token,
 * which invalidates an in-flight request mid-flight (so a stale reply never
 * starts playing) and resolves the previous speak()'s promise — this is what
 * makes barge-in instant.
 */

import { createAudioPlayer, setAudioModeAsync, type AudioPlayer, type AudioStatus } from 'expo-audio';
// SDK 54: cacheDirectory / EncodingType / writeAsStringAsync live in /legacy now.
import * as FileSystem from 'expo-file-system/legacy';
import { useServers } from '@/store/servers';

export type PlaybackStatus = 'idle' | 'loading' | 'playing' | 'paused';

export interface PlaybackState {
  status: PlaybackStatus;
  positionMs: number;
  durationMs: number;
}

// ── Shared playback state ────────────────────────────────────────────────

let playToken = 0;
let activePlayer: AudioPlayer | null = null;
let activeUri: string | null = null;
let statusSub: { remove: () => void } | null = null;
let pendingResolve: (() => void) | null = null;

let state: PlaybackState = { status: 'idle', positionMs: 0, durationMs: 0 };
const listeners = new Set<(s: PlaybackState) => void>();

function emit(patch: Partial<PlaybackState>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l(state);
}

export function getPlaybackState(): PlaybackState {
  return state;
}

/** Subscribe to playback state changes. Fires immediately with current state. */
export function subscribePlayback(cb: (s: PlaybackState) => void): () => void {
  listeners.add(cb);
  cb(state);
  return () => { listeners.delete(cb); };
}

function settle(): void {
  const r = pendingResolve;
  pendingResolve = null;
  if (r) r();
}

function teardown(): void {
  if (statusSub) { try { statusSub.remove(); } catch {} statusSub = null; }
  if (activePlayer) { try { activePlayer.remove(); } catch {} activePlayer = null; }
  if (activeUri) {
    const u = activeUri;
    activeUri = null;
    FileSystem.deleteAsync(u, { idempotent: true }).catch(() => {});
  }
}

// ── Base64 (chunked to avoid call-stack blowups on large MP3s) ────────────

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return btoa(binary);
}

// ── Speak ─────────────────────────────────────────────────────────────────

/**
 * Synthesize `text` and play it. Resolves when playback finishes OR is
 * superseded/stopped. Rejects only on a network/HTTP failure.
 */
export async function speak(text: string): Promise<void> {
  if (!text.trim()) return;

  // Stop whatever is playing first, THEN claim a fresh token (claiming before
  // stopPlayback would immediately invalidate our own token — the old bug).
  await stopPlayback();
  const myToken = ++playToken;
  const isStale = () => myToken !== playToken;

  emit({ status: 'loading', positionMs: 0, durationMs: 0 });

  const profile = useServers.getState().active();
  if (!profile) {
    if (!isStale()) emit({ status: 'idle' });
    return;
  }

  let res: Response;
  try {
    res = await fetch(`${profile.url.replace(/\/$/, '')}/api/voice/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${profile.token}` },
      body: JSON.stringify({ text }),
    });
  } catch (err) {
    if (!isStale()) emit({ status: 'idle' });
    throw err instanceof Error ? err : new Error('TTS network error');
  }
  if (!res.ok) {
    if (!isStale()) emit({ status: 'idle' });
    throw new Error(`TTS HTTP ${res.status}`);
  }
  if (isStale()) return;

  const buffer = await res.arrayBuffer();
  if (isStale()) return;

  const uri = `${FileSystem.cacheDirectory}wc-tts-${myToken}.mp3`;
  await FileSystem.writeAsStringAsync(uri, arrayBufferToBase64(buffer), {
    encoding: FileSystem.EncodingType.Base64,
  });
  if (isStale()) {
    FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
    return;
  }

  await setAudioModeAsync({ playsInSilentMode: true });
  const player = createAudioPlayer({ uri }, { updateInterval: 250 });
  if (isStale()) {
    try { player.remove(); } catch {}
    FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
    return;
  }

  activePlayer = player;
  activeUri = uri;

  await new Promise<void>((resolve) => {
    pendingResolve = resolve;
    statusSub = player.addListener('playbackStatusUpdate', (st: AudioStatus) => {
      if (isStale()) return; // stopPlayback() will settle us
      if (!st.isLoaded) return;

      let status: PlaybackStatus;
      if (st.didJustFinish) status = 'idle';
      else if (st.playing) status = 'playing';
      else if (state.status === 'paused') status = 'paused';
      else status = 'loading';

      emit({
        status,
        positionMs: Math.round((st.currentTime ?? 0) * 1000),
        durationMs: Math.round((st.duration ?? 0) * 1000),
      });

      if (st.didJustFinish) settle();
    });

    player.play();
    emit({ status: 'playing' });
  });

  // Natural-finish path: if we're still the current stream, clean up.
  if (!isStale()) {
    teardown();
    emit({ status: 'idle', positionMs: 0, durationMs: 0 });
  }
}

// ── Transport controls ─────────────────────────────────────────────────────

export function pausePlayback(): void {
  if (activePlayer && state.status === 'playing') {
    try { activePlayer.pause(); } catch {}
    emit({ status: 'paused' });
  }
}

export function resumePlayback(): void {
  if (activePlayer && state.status === 'paused') {
    try { activePlayer.play(); } catch {}
    emit({ status: 'playing' });
  }
}

/** Toggle play/pause. No-op if nothing is loaded. */
export function togglePlayback(): void {
  if (state.status === 'playing') pausePlayback();
  else if (state.status === 'paused') resumePlayback();
}

export async function seekTo(positionMs: number): Promise<void> {
  if (!activePlayer) return;
  const seconds = Math.max(0, positionMs / 1000);
  try { await activePlayer.seekTo(seconds); } catch {}
  emit({ positionMs: Math.round(seconds * 1000) });
}

/** Stop playback, invalidate any in-flight synthesis, and release resources. */
export async function stopPlayback(): Promise<void> {
  playToken++; // invalidate in-flight speak()
  teardown();
  emit({ status: 'idle', positionMs: 0, durationMs: 0 });
  settle(); // unblock any awaiting speak()
}

export function isSpeaking(): boolean {
  // True while audio is loaded (playing OR paused) — used for barge-in.
  return activePlayer !== null;
}
