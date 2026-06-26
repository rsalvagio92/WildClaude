import { useState } from 'react';
import { View, Text, Pressable, FlatList, ActivityIndicator, RefreshControl, TextInput, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServers } from '@/store/servers';
import { ServerClient } from '@/api/client';

interface LogEntry {
  id: string;
  content: string;
  timestamp: number;
  tags?: string[];
}

function EntryCard({ entry }: { entry: LogEntry }) {
  const d = new Date(entry.timestamp * 1000);
  const date = d.toLocaleDateString('it', { weekday: 'short', day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString('it', { hour: '2-digit', minute: '2-digit' });
  return (
    <View className="bg-surface border border-border rounded-2xl p-4 mb-3">
      <View className="flex-row items-center justify-between mb-2">
        <Text className="text-muted text-xs">{date}</Text>
        <Text className="text-muted text-xs">{time}</Text>
      </View>
      <Text className="text-white text-sm leading-6">{entry.content}</Text>
      {entry.tags && entry.tags.length > 0 && (
        <View className="flex-row flex-wrap gap-1 mt-2">
          {entry.tags.map((t) => (
            <View key={t} className="bg-accent/10 border border-accent/20 rounded-full px-2 py-0.5">
              <Text className="text-accent text-xs">{t}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

export default function JournalScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const active = useServers((s) => s.active());
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [text, setText] = useState('');
  const [composing, setComposing] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['journal', active?.id],
    queryFn: () => new ServerClient(active!).get<{ entries: LogEntry[] }>('/api/life/log?limit=50'),
    enabled: !!active,
  });

  const { mutate: addEntry, isPending } = useMutation({
    mutationFn: (content: string) =>
      new ServerClient(active!).post('/api/life/log', { content }),
    onSuccess: () => {
      setText('');
      setComposing(false);
      void qc.invalidateQueries({ queryKey: ['journal'] });
    },
    onError: () => Alert.alert('Errore', 'Impossibile salvare la voce.'),
  });

  const onRefresh = async () => { setRefreshing(true); await refetch(); setRefreshing(false); };

  const entries = data?.entries ?? [];

  return (
    <View className="flex-1 bg-bg" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center px-4 py-3 border-b border-border">
        <Pressable onPress={() => router.back()} className="mr-3"><Text className="text-muted text-lg">←</Text></Pressable>
        <Text className="text-white font-semibold text-base flex-1">📓 Journal</Text>
        <Pressable
          onPress={() => setComposing(!composing)}
          className="bg-accent rounded-full w-8 h-8 items-center justify-center"
        >
          <Text className="text-white text-lg">{composing ? '✕' : '+'}</Text>
        </Pressable>
      </View>

      {composing && (
        <View className="px-4 py-3 border-b border-border">
          <TextInput
            className="bg-surface border border-border rounded-xl px-4 py-3 text-white text-sm min-h-[80px]"
            placeholder="Scrivi una voce nel journal…"
            placeholderTextColor="#666"
            value={text}
            onChangeText={setText}
            multiline
            textAlignVertical="top"
          />
          <Pressable
            onPress={() => text.trim() && addEntry(text.trim())}
            disabled={!text.trim() || isPending}
            className={`mt-2 py-2.5 rounded-xl items-center ${text.trim() && !isPending ? 'bg-accent' : 'bg-surface border border-border'}`}
          >
            <Text className="text-white text-sm font-medium">{isPending ? 'Salvo…' : 'Salva voce'}</Text>
          </Pressable>
        </View>
      )}

      {isLoading && <View className="flex-1 items-center justify-center"><ActivityIndicator color="#888" /></View>}
      {error && <View className="flex-1 items-center justify-center"><Text className="text-red-400">Errore caricamento</Text></View>}

      <FlatList
        data={entries}
        keyExtractor={(e) => e.id}
        renderItem={({ item }) => <EntryCard entry={item} />}
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 20 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#888" />}
        ListEmptyComponent={!isLoading ? <Text className="text-muted text-center mt-20">Nessuna voce nel journal.</Text> : null}
      />
    </View>
  );
}
