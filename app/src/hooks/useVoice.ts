import { useState, useCallback } from 'react';
import { startRecording, stopAndTranscribe, stopAndDiscard, isRecording } from '@/voice/record';
import { speak, stopPlayback, isSpeaking, subscribePlayback, getPlaybackState } from '@/voice/tts';

export type VoiceState = 'idle' | 'recording' | 'transcribing' | 'speaking' | 'error';

export function useVoice(onTranscribed: (text: string) => void) {
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [error, setError] = useState<string | null>(null);

  const handleMicPress = useCallback(async () => {
    setError(null);

    if (isSpeaking()) {
      await stopPlayback();
      setVoiceState('recording');
      try {
        await startRecording();
      } catch (err) {
        setVoiceState('error');
        setError(err instanceof Error ? err.message : 'Mic error');
      }
      return;
    }

    if (isRecording()) {
      setVoiceState('transcribing');
      try {
        const text = await stopAndTranscribe();
        setVoiceState('idle');
        if (text.trim()) onTranscribed(text);
      } catch (err) {
        setVoiceState('error');
        setError(err instanceof Error ? err.message : 'Transcription error');
      }
      return;
    }

    setVoiceState('recording');
    try {
      await startRecording();
    } catch (err) {
      setVoiceState('error');
      setError(err instanceof Error ? err.message : 'Mic error');
    }
  }, [onTranscribed]);

  const handleMicRelease = useCallback(async () => {
    if (!isRecording()) return;
    setVoiceState('transcribing');
    try {
      const text = await stopAndTranscribe();
      setVoiceState('idle');
      if (text.trim()) onTranscribed(text);
    } catch (err) {
      setVoiceState('error');
      setError(err instanceof Error ? err.message : 'Transcription error');
    }
  }, [onTranscribed]);

  const speakText = useCallback(async (text: string) => {
    if (!text.trim()) return;
    setVoiceState('speaking');
    try {
      await speak(text);
      const final = getPlaybackState();
      setVoiceState(final.status === 'idle' ? 'idle' : 'speaking');
    } catch {
      setVoiceState('error');
      setError('Playback failed');
    }
  }, []);

  const cancel = useCallback(async () => {
    if (isRecording()) await stopAndDiscard();
    if (isSpeaking()) await stopPlayback();
    setVoiceState('idle');
    setError(null);
  }, []);

  return { voiceState, error, handleMicPress, handleMicRelease, speakText, cancel };
}
