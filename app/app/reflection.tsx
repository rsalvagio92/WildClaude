import { View, Text, Pressable, FlatList, ActivityIndicator, RefreshControl, Modal } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServers } from '@/store/servers';
import { ServerClient } from '@/api/client';
import { useState } from 'react';

interface Reflection {
  id: string;
  content: string;
  period: string;
  created_at: number;
  acknowledged: boolean;
}

interface ReflectionResponse {
  reflections: Reflection[];
}

function ReflectionCard({ reflection, onAck }: { reflection: Reflection; onAck: () => void }) {
  const date = new Date(reflection.created_at * 1000).toLocaleDateString('it');
  const badge = { daily: '📅', weekly: '📆', monthly: '📊' }[reflection.period] || '🔮';

  return (
    <View className={`rounded-xl p-4 mb-2 border ${reflection.acknowledged ? 'bg-bg border-border/40' : 'bg-surface border-accent/30'}`}>
      <View className="flex-row justify-between mb-2">
        <Text className="text-xs font-mono text-muted">{date}</Text>
        <Text className="text-sm">{badge} {reflection.period}</Text>
      </View>
      <Text className="text-white text-sm leading-5 mb-3">{reflection.content}</Text>
      {!reflection.acknowledged && (
        <Pressable onPress={onAck} className="bg-accent/20 border border-accent rounded-lg px-3 py-2">
          <Text className="text-accent text-xs font-semibold text-center">Acknowledge</Text>
        </Pressable>
      )}
    </View>
  );
}

export default function ReflectionScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const active = useServers((s) => s.active());
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['reflections', active?.id],
    queryFn: () => new ServerClient(active!).get<ReflectionResponse>('/api/reflections?limit=50'),
    enabled: !!active,
  });

  const { mutate: ackReflection } = useMutation({
    mutationFn: (id: string) => new ServerClient(active!).post(`/api/reflections/${id}/ack`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['reflections'] });
    },
  });

  const { mutate: generateReflection } = useMutation({
    mutationFn: (period: string) => new ServerClient(active!).post('/api/reflections/generate', { period }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['reflections'] });
    },
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  return (
    <View className="flex-1 bg-bg" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center px-4 py-3 border-b border-border">
        <Pressable onPress={() => router.back()} className="mr-3">
          <Text className="text-muted text-lg">←</Text>
        </Pressable>
        <Text className="text-white font-semibold text-base flex-1">🔮 Reflection</Text>
      </View>

      {isLoading && <View className="flex-1 items-center justify-center"><ActivityIndicator color="#888" /></View>}
      {error && <View className="flex-1 items-center justify-center"><Text className="text-red-400">Errore caricamento reflections</Text></View>}

      {data && (
        <FlatList
          data={data.reflections}
          keyExtractor={(r) => r.id}
          renderItem={({ item }) => <ReflectionCard reflection={item} onAck={() => ackReflection(item.id)} />}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 20 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#888" />}
          ListHeaderComponent={
            <View className="flex-row gap-2 mb-4">
              {['daily', 'weekly', 'monthly'].map((p) => (
                <Pressable
                  key={p}
                  onPress={() => generateReflection(p)}
                  className="flex-1 bg-accent rounded-lg py-2"
                >
                  <Text className="text-white text-xs font-semibold text-center">Generate {p}</Text>
                </Pressable>
              ))}
            </View>
          }
          ListEmptyComponent={!isLoading ? <Text className="text-muted text-center mt-20">No reflections yet.</Text> : null}
        />
      )}
    </View>
  );
}
