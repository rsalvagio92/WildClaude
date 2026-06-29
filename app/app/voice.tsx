import { View, Text, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useState, useEffect } from 'react';
import { useVoice } from '@/hooks/useVoice';
import { useServers } from '@/store/servers';

function StatBox({ label, value }: { label: string; value: string | number }) {
  return (
    <View className="bg-surface border border-border rounded-lg px-3 py-2 flex-1">
      <Text className="text-muted text-xs mb-1">{label}</Text>
      <Text className="text-white font-semibold text-sm">{value}</Text>
    </View>
  );
}

export default function VoiceScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const caps = useServers((s) => s.info?.caps ?? []);
  const hasVoice = caps.includes('voice');
  const [transcript, setTranscript] = useState('');
  const [isListening, setIsListening] = useState(false);

  const {
    voiceState,
    error: voiceError,
    handleMicPress,
    handleMicRelease,
    speakText,
    cancel: cancelVoice,
  } = useVoice(() => {
    // On voice finish, this callback fires (mimics send in useChat)
  });

  useEffect(() => {
    // Track transcript from voiceState (real implementation would extract from hook)
    // For now, placeholder
  }, [voiceState]);

  if (!hasVoice) {
    return (
      <View className="flex-1 bg-bg" style={{ paddingTop: insets.top }}>
        <View className="flex-row items-center px-4 py-3 border-b border-border">
          <Pressable onPress={() => router.back()} className="mr-3">
            <Text className="text-muted text-lg">←</Text>
          </Pressable>
          <Text className="text-white font-semibold text-base">🎙️ Voice</Text>
        </View>
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-muted text-center">Voice capability not available on this server.</Text>
        </View>
      </View>
    );
  }

  const isActive = voiceState === 'recording' || voiceState === 'transcribing';
  const isSpeaking = voiceState === 'speaking';

  return (
    <View className="flex-1 bg-bg" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center px-4 py-3 border-b border-border">
        <Pressable onPress={() => router.back()} className="mr-3">
          <Text className="text-muted text-lg">←</Text>
        </Pressable>
        <Text className="text-white font-semibold text-base flex-1">🎙️ Voice</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 20 }}>
        {/* Mic Control */}
        <View className="items-center mb-6">
          <Pressable
            onPressIn={handleMicPress}
            onPressOut={handleMicRelease}
            className={`w-32 h-32 rounded-full items-center justify-center mb-4 ${
              isActive ? 'bg-red-500/20 border-2 border-red-500' : isSpeaking ? 'bg-amber-500/20 border-2 border-amber-500' : 'bg-accent/20 border-2 border-accent'
            }`}
          >
            {voiceState === 'transcribing' ? (
              <ActivityIndicator size="large" color="#fff" />
            ) : (
              <Text className="text-6xl">{isActive ? '⏹' : isSpeaking ? '🔊' : '🎤'}</Text>
            )}
          </Pressable>
          <Text className={`text-center font-semibold ${isActive ? 'text-red-400' : isSpeaking ? 'text-amber-400' : 'text-accent'}`}>
            {voiceState === 'recording' ? 'Recording...' : voiceState === 'transcribing' ? 'Transcribing...' : voiceState === 'speaking' ? 'Speaking...' : 'Hold to speak'}
          </Text>
        </View>

        {/* Status */}
        {voiceError && (
          <View className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 mb-4">
            <Text className="text-red-400 text-sm">{voiceError}</Text>
          </View>
        )}

        {/* Stats */}
        <View className="flex-row gap-2 mb-6">
          <StatBox label="State" value={voiceState || 'idle'} />
          <StatBox label="Mode" value="Voice I/O" />
        </View>

        {/* Transcript */}
        {transcript && (
          <View className="bg-surface border border-border rounded-lg p-4 mb-4">
            <Text className="text-muted text-xs mb-2 uppercase">Last transcription</Text>
            <Text className="text-white text-sm leading-5">{transcript}</Text>
          </View>
        )}

        {/* Commands */}
        <View className="bg-surface border border-border rounded-lg p-4">
          <Text className="text-muted text-xs mb-3 uppercase">Voice Commands</Text>
          <View className="gap-2">
            <Pressable
              onPress={() => speakText('Voice input is now active. You can speak naturally and I will respond.')}
              className="bg-bg border border-border rounded-lg px-3 py-2 active:opacity-60"
            >
              <Text className="text-white text-sm">Test TTS</Text>
            </Pressable>
            {isSpeaking && (
              <Pressable
                onPress={() => void cancelVoice()}
                className="bg-red-500/20 border border-red-500 rounded-lg px-3 py-2 active:opacity-60"
              >
                <Text className="text-red-400 text-sm">Stop playback</Text>
              </Pressable>
            )}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
