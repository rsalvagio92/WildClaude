import { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useChat } from '@/hooks/useChat';
import { useVoice } from '@/hooks/useVoice';
import { useFeatures } from '@/store/features';
import { useServers } from '@/store/servers';
import { PlaybackControls } from '@/voice/PlaybackControls';
import type { ChatMessage } from '@/hooks/useChat';

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user';
  return (
    <View className={`mb-3 max-w-[85%] ${isUser ? 'self-end' : 'self-start'}`}>
      <View
        className={`rounded-2xl px-4 py-3 ${
          isUser ? 'bg-accent rounded-br-sm' : 'bg-surface border border-border rounded-bl-sm'
        }`}
      >
        {msg.error ? (
          <Text className="text-red-400 text-sm">
            {/* Keep any text that streamed before the failure, then the error. */}
            {msg.text ? `${msg.text}\n\n` : ''}
            ⚠ {msg.error}
          </Text>
        ) : (
          <Text className="text-sm leading-5 text-white">
            {msg.text}
            {msg.streaming && <Text className="text-accent opacity-60"> ▋</Text>}
          </Text>
        )}
      </View>
      {msg.usage && (
        <Text className="text-muted text-xs mt-1 px-1">
          {msg.usage.outputTokens} tok · ${msg.usage.totalCostUsd.toFixed(4)}
        </Text>
      )}
    </View>
  );
}

function MicButton({
  voiceState,
  onPress,
  onRelease,
  hasVoice,
}: {
  voiceState: string;
  onPress: () => void;
  onRelease: () => void;
  hasVoice: boolean;
}) {
  if (!hasVoice) return null;
  const isActive = voiceState === 'recording' || voiceState === 'transcribing';
  const isSpeaking = voiceState === 'speaking';
  return (
    <Pressable
      onPressIn={onPress}
      onPressOut={onRelease}
      accessibilityLabel={isSpeaking ? 'Interrompi e parla' : 'Tieni premuto per parlare'}
      className={`w-11 h-11 rounded-full items-center justify-center mr-2 ${
        isActive ? 'bg-red-500' : isSpeaking ? 'bg-amber-500' : 'bg-surface border border-border'
      }`}
    >
      {voiceState === 'transcribing' ? (
        <ActivityIndicator size="small" color="#fff" />
      ) : (
        <Text className="text-lg">{isActive ? '⏹' : isSpeaking ? '🔊' : '🎤'}</Text>
      )}
    </Pressable>
  );
}

export default function TalkScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { messages, status, progress, send, cancel, clear } = useChat();
  const [input, setInput] = useState('');
  const listRef = useRef<FlatList>(null);
  const isVoiceEnabled = useFeatures((s) => s.isEnabled('voice'));
  const caps = useServers((s) => s.info?.caps ?? []);
  const hasVoice = isVoiceEnabled && caps.includes('voice');

  // Tracks the last assistant message we auto-spoke, so a re-render never
  // replays the same reply.
  const spokenIdRef = useRef<string | null>(null);

  const handleSend = useCallback(
    (text?: string) => {
      const t = (text ?? input).trim();
      if (!t) return;
      setInput('');
      void send(t);
    },
    [input, send],
  );

  const {
    voiceState,
    error: voiceError,
    handleMicPress,
    handleMicRelease,
    speakText,
    cancel: cancelVoice,
  } = useVoice(handleSend);

  // Barge-in: the moment a new turn starts (typed OR spoken), silence any reply
  // still playing so the old answer never talks over the new one.
  useEffect(() => {
    if (!hasVoice) return;
    if (status === 'sending' || status === 'streaming') {
      if (voiceState === 'speaking') void cancelVoice();
    }
  }, [status, hasVoice, voiceState, cancelVoice]);

  // Auto-speak each newly finalized assistant reply (once), but never while the
  // user is mid-recording — that would talk over them.
  useEffect(() => {
    if (!hasVoice) return;
    if (voiceState === 'recording' || voiceState === 'transcribing') return;
    const last = messages[messages.length - 1];
    if (
      last?.role === 'assistant' &&
      !last.streaming &&
      last.text &&
      !last.error &&
      spokenIdRef.current !== last.id
    ) {
      spokenIdRef.current = last.id;
      void speakText(last.text);
    }
  }, [messages, hasVoice, voiceState, speakText]);

  // Scroll to bottom on new messages / streamed tokens.
  useEffect(() => {
    if (messages.length > 0) {
      const t = setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
      return () => clearTimeout(t);
    }
  }, [messages]);

  // Stop any playback when leaving the screen.
  useEffect(() => () => { void cancelVoice(); }, [cancelVoice]);

  const handleClear = useCallback(() => {
    void cancelVoice();
    clear();
  }, [cancelVoice, clear]);

  const isBusy = status === 'sending' || status === 'streaming';
  const isSpeaking = voiceState === 'speaking';
  const canSend = !!input.trim() && !isBusy;

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-bg"
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={insets.top}
    >
      {/* Header */}
      <View
        className="flex-row items-center px-4 pb-3 border-b border-border"
        style={{ paddingTop: insets.top + 12 }}
      >
        <Pressable onPress={() => router.back()} className="mr-3" accessibilityLabel="Indietro">
          <Text className="text-muted text-lg">←</Text>
        </Pressable>
        <Text className="text-white font-semibold text-base flex-1">Chat</Text>
        {messages.length > 0 && (
          <Pressable onPress={handleClear} className="px-2 py-1">
            <Text className="text-muted text-sm">Pulisci</Text>
          </Pressable>
        )}
      </View>

      {/* Messages */}
      {messages.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-muted text-center text-sm leading-6">
            Scrivi un messaggio o tieni premuto il microfono per parlare.
          </Text>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          renderItem={({ item }) => <MessageBubble msg={item} />}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 }}
          className="flex-1"
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          keyboardShouldPersistTaps="handled"
        />
      )}

      {/* Progress / status line while the agent works (tool use, sub-agents). */}
      {isBusy && progress ? (
        <View className="px-4 pb-1 flex-row items-center">
          <ActivityIndicator size="small" color="#888" />
          <Text className="text-muted text-xs ml-2 flex-1" numberOfLines={1}>
            {progress}
          </Text>
        </View>
      ) : null}

      {/* Voice error banner */}
      {voiceError ? (
        <View className="mx-4 mb-2 py-2 px-3 rounded-xl bg-red-500/15 border border-red-500/30">
          <Text className="text-red-400 text-xs">🎤 {voiceError}</Text>
        </View>
      ) : null}

      {/* Playback transport controls (play/pause, progress, stop). Stop resolves
          the in-flight speak(), which returns useVoice to idle. Tapping the mic
          while playing barges in to record (handled in useVoice). */}
      {isSpeaking ? <PlaybackControls /> : null}

      {/* Input bar */}
      <View
        className="flex-row items-end px-4 pt-2 border-t border-border"
        style={{ paddingBottom: insets.bottom + 8 }}
      >
        <MicButton
          voiceState={voiceState}
          onPress={handleMicPress}
          onRelease={handleMicRelease}
          hasVoice={hasVoice}
        />
        <TextInput
          className="flex-1 bg-surface border border-border rounded-2xl px-4 py-3 text-white text-sm max-h-32 mr-2"
          placeholder="Scrivi un messaggio…"
          placeholderTextColor="#666"
          value={input}
          onChangeText={setInput}
          multiline
          onSubmitEditing={() => handleSend()}
          returnKeyType="send"
          blurOnSubmit
          editable={!isBusy}
        />
        {isBusy ? (
          <Pressable
            onPress={cancel}
            accessibilityLabel="Interrompi risposta"
            className="w-11 h-11 rounded-full bg-red-500/20 border border-red-500/40 items-center justify-center"
          >
            <Text className="text-red-400 text-lg">⏹</Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={() => handleSend()}
            disabled={!canSend}
            accessibilityLabel="Invia messaggio"
            className={`w-11 h-11 rounded-full items-center justify-center ${
              canSend ? 'bg-accent' : 'bg-surface border border-border'
            }`}
          >
            <Text className="text-white text-lg">↑</Text>
          </Pressable>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}
