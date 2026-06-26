/**
 * Voice module: native record (expo-audio) → upload → STT, and ElevenLabs TTS
 * playback with transport controls. The chat token streaming itself lives in
 * @/api/stream + @/hooks/useChat; this module is the audio in/out around it.
 */

export {
  startRecording,
  stopAndTranscribe,
  stopAndDiscard,
  isRecording,
  type RecordingStatus,
} from './record';

export {
  speak,
  stopPlayback,
  pausePlayback,
  resumePlayback,
  togglePlayback,
  seekTo,
  isSpeaking,
  getPlaybackState,
  subscribePlayback,
  type PlaybackState,
  type PlaybackStatus,
} from './tts';

export { usePlayback } from './usePlayback';
export { PlaybackControls } from './PlaybackControls';
