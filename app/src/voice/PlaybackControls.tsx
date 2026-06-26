import { View, Text, Pressable } from 'react-native';
import { pausePlayback, resumePlayback, stopPlayback, seekTo, getPlaybackState, subscribePlayback, type PlaybackState } from './tts';
import { useEffect, useState } from 'react';

export function PlaybackControls() {
  const [state, setState] = useState<PlaybackState>(getPlaybackState());

  useEffect(() => {
    return subscribePlayback(setState);
  }, []);

  if (state.status === 'idle') return null;

  const progressPct = state.durationMs > 0 ? (state.positionMs / state.durationMs) * 100 : 0;
  const fmtTime = (ms: number) => {
    const sec = Math.round(ms / 1000);
    const m = Math.floor(sec / 60);
    const s = (sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  return (
    <View className="bg-surface border border-border rounded-xl p-4 mb-3">
      <View className="flex-row items-center justify-between mb-2">
        <Text className="text-white text-sm font-semibold">Playing</Text>
        <Text className="text-muted text-xs">{fmtTime(state.positionMs)} / {fmtTime(state.durationMs)}</Text>
      </View>

      <View className="h-1 bg-border rounded-full mb-3 overflow-hidden">
        <View className="h-full bg-accent" style={{ width: `${progressPct}%` }} />
      </View>

      <View className="flex-row items-center justify-center gap-2">
        {state.status === 'playing' ? (
          <Pressable onPress={pausePlayback} className="flex-1 bg-accent rounded-lg py-2 items-center">
            <Text className="text-white">⏸ Pause</Text>
          </Pressable>
        ) : (
          <Pressable onPress={resumePlayback} className="flex-1 bg-accent rounded-lg py-2 items-center">
            <Text className="text-white">▶ Resume</Text>
          </Pressable>
        )}

        <Pressable onPress={stopPlayback} className="flex-1 bg-surface border border-border rounded-lg py-2 items-center">
          <Text className="text-muted">⏹ Stop</Text>
        </Pressable>
      </View>
    </View>
  );
}
