/**
 * Native voice recording via expo-audio.
 *
 * Records to a temporary m4a file, uploads it to /api/voice/stt for Groq
 * Whisper transcription, and cleans the file up afterwards. Imperative (not the
 * expo-audio hooks) so it can be driven from useVoice without a component tree.
 */

import { AudioModule, RecordingPresets, setAudioModeAsync } from 'expo-audio';
import type { AudioRecorder } from 'expo-audio';
// SDK 54: the classic file API (uploadAsync / FileSystemUploadType / deleteAsync)
// moved behind the /legacy entry; the new File/Directory API doesn't cover uploads.
import * as FileSystem from 'expo-file-system/legacy';
import { useServers } from '@/store/servers';

export type RecordingStatus = 'idle' | 'recording' | 'uploading' | 'error';

let recorder: AudioRecorder | null = null;

export async function startRecording(): Promise<void> {
  if (recorder) await stopAndDiscard();

  const perm = await AudioModule.requestRecordingPermissionsAsync();
  if (!perm.granted) throw new Error('Permesso microfono negato');

  await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });

  const rec = new AudioModule.AudioRecorder(RecordingPresets.HIGH_QUALITY);
  await rec.prepareToRecordAsync();
  rec.record();
  recorder = rec;
}

export async function stopAndTranscribe(): Promise<string> {
  if (!recorder) throw new Error('No active recording');
  const rec = recorder;
  recorder = null;

  await rec.stop();
  await setAudioModeAsync({ allowsRecording: false });

  const uri = rec.uri;
  if (!uri) throw new Error('No recording URI');

  const profile = useServers.getState().active();
  if (!profile) throw new Error('No active server');

  try {
    const response = await FileSystem.uploadAsync(
      `${profile.url.replace(/\/$/, '')}/api/voice/stt`,
      uri,
      {
        httpMethod: 'POST',
        uploadType: FileSystem.FileSystemUploadType.MULTIPART,
        fieldName: 'audio',
        mimeType: 'audio/m4a',
        headers: { Authorization: `Bearer ${profile.token}` },
      },
    );

    if (response.status !== 200) {
      throw new Error(`STT error ${response.status}`);
    }
    const json = JSON.parse(response.body) as { text?: string; error?: string };
    if (json.error) throw new Error(json.error);
    return json.text ?? '';
  } finally {
    await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
  }
}

export async function stopAndDiscard(): Promise<void> {
  if (!recorder) return;
  const rec = recorder;
  recorder = null;
  try {
    await rec.stop();
  } catch {
    /* already stopped */
  }
  await setAudioModeAsync({ allowsRecording: false }).catch(() => {});
  const uri = rec.uri;
  if (uri) await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
}

export function isRecording(): boolean {
  return recorder !== null;
}
