import { useState } from 'react';
import { View, Text, Pressable, FlatList, ActivityIndicator, RefreshControl, TextInput, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServers } from '@/store/servers';
import { ServerClient } from '@/api/client';

interface Memory {
  id: number;
  content: string;
  topic: string;
  importance: number;
  salience: number;
  pinned: boolean;
  created_at: number;
}

function MemoryCard({ mem, onPin, onDelete }: {
  mem: Memory;
  onPin: (id: number, pinned: boolean) => void;
  onDelete: (id: number) => void;
}) {
  const date = new Date(mem.created_at * 1000).toLocaleDateString('it');
  return (
    <View className="bg-surface border border-border rounded-2xl p-3 mb-2">
      <View className="flex-row items-start justify-between mb-2">
        <View className="flex-row items-center gap-1">
          {mem.pinned && <Text className="text-yellow-400 text-xs">📌</Text>}
          <Text className="text-accent text-xs">{mem.topic}</Text>
          <Text className="text-muted text-xs">· imp {mem.importance.toFixed(1)}</Text>
        </View>
        <Text className="text-muted text-xs">{date}</Text>
      </View>
      <Text className="text-white text-sm leading-5" numberOfLines={4}>{mem.content}</Text>
      <View className="flex-row gap-2 mt-2">
        <Pressable
          onPress={() => onPin(mem.id, mem.pinned)}
          className="flex-1 bg-bg border border-border rounded-lg py-1.5 items-center active:opacity-60"
        >
          <Text className="text-muted text-xs">{mem.pinned ? 'Unpin' : 'Pin'}</Text>
        </Pressable>
        <Pressable
          onPress={() => onDelete(mem.id)}
          className="flex-1 bg-bg border border-red-500/30 rounded-lg py-1.5 items-center active:opacity-60"
        >
          <Text className="text-red-400 text-xs">Elimina</Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function MemoryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const active = useServers((s) => s.active());
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['memories', active?.id, search],
    queryFn: () => new ServerClient(active!).get<{ memories: Memory[]; total: number }>(
      `/api/memories/list?limit=50${search ? `&q=${encodeURIComponent(search)}` : ''}`
    ),
    enabled: !!active,
  });

  const { mutate: pin } = useMutation({
    mutationFn: ({ id, pinned }: { id: number; pinned: boolean }) =>
      new ServerClient(active!).post(`/api/memories/${id}/${pinned ? 'unpin' : 'pin'}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['memories'] }),
  });

  const { mutate: del } = useMutation({
    mutationFn: (id: number) => new ServerClient(active!).del(`/api/memories/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['memories'] }),
  });

  const handleDelete = (id: number) => {
    Alert.alert('Elimina memoria', 'Sicuro?', [
      { text: 'Annulla', style: 'cancel' },
      { text: 'Elimina', style: 'destructive', onPress: () => del(id) },
    ]);
  };

  const onRefresh = async () => { setRefreshing(true); await refetch(); setRefreshing(false); };

  const memories = data?.memories ?? [];

  return (
    <View className="flex-1 bg-bg" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center px-4 py-3 border-b border-border">
        <Pressable onPress={() => router.back()} className="mr-3"><Text className="text-muted text-lg">←</Text></Pressable>
        <Text className="text-white font-semibold text-base flex-1">🧠 Memory</Text>
        <Text className="text-muted text-xs">{data?.total ?? 0} ricordi</Text>
      </View>

      <View className="px-4 py-2 border-b border-border">
        <View className="flex-row items-center bg-surface border border-border rounded-xl px-3 py-2">
          <Text className="text-muted mr-2">🔍</Text>
          <TextInput
            className="flex-1 text-white text-sm"
            placeholder="Cerca nei ricordi…"
            placeholderTextColor="#666"
            value={q}
            onChangeText={setQ}
            onSubmitEditing={() => setSearch(q)}
            returnKeyType="search"
          />
          {q ? (
            <Pressable onPress={() => { setQ(''); setSearch(''); }}>
              <Text className="text-muted">✕</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {isLoading && <View className="flex-1 items-center justify-center"><ActivityIndicator color="#888" /></View>}
      {error && <View className="flex-1 items-center justify-center"><Text className="text-red-400">Errore caricamento</Text></View>}

      <FlatList
        data={memories}
        keyExtractor={(m) => String(m.id)}
        renderItem={({ item }) => (
          <MemoryCard
            mem={item}
            onPin={(id, pinned) => pin({ id, pinned })}
            onDelete={handleDelete}
          />
        )}
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 20 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#888" />}
        ListEmptyComponent={!isLoading ? <Text className="text-muted text-center mt-20">Nessun ricordo.</Text> : null}
      />
    </View>
  );
}
