import { View, Text, Pressable, FlatList, ActivityIndicator, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { useServers } from '@/store/servers';
import { ServerClient } from '@/api/client';
import { useState } from 'react';

interface Trace {
  session_id: string;
  chat_id: string;
  agent_id: string;
  created_at: number;
  input_cost: number;
  output_cost: number;
  totalCost: number;
}

interface TraceResponse {
  traces: Trace[];
}

function TraceRow({ trace }: { trace: Trace }) {
  const date = new Date(trace.created_at * 1000).toLocaleString('it');
  return (
    <View className="bg-surface border border-border rounded-xl p-3 mb-2">
      <View className="flex-row justify-between mb-1">
        <Text className="text-white font-semibold text-sm flex-1" numberOfLines={1}>{trace.session_id.slice(0, 12)}</Text>
        <Text className="text-accent font-mono text-sm">${trace.totalCost}</Text>
      </View>
      <View className="flex-row gap-2 mb-1">
        {trace.agent_id && <Text className="text-muted text-xs bg-bg px-2 py-1 rounded">🤖 {trace.agent_id}</Text>}
        <Text className="text-muted text-xs bg-bg px-2 py-1 rounded">💬 {trace.chat_id.slice(0, 8)}</Text>
      </View>
      <Text className="text-muted text-xs">{date}</Text>
    </View>
  );
}

export default function TracesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const active = useServers((s) => s.active());
  const [refreshing, setRefreshing] = useState(false);
  const [days, setDays] = useState(7);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['traces', active?.id, days],
    queryFn: () => new ServerClient(active!).get<TraceResponse>(`/api/traces?limit=50`),
    enabled: !!active,
  });

  const { data: costData } = useQuery({
    queryKey: ['cost-breakdown', days],
    queryFn: () => new ServerClient(active!).get<{ totalCost: number; breakdown: any[] }>(`/api/cost-breakdown?days=${days}`),
    enabled: !!active,
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
        <Text className="text-white font-semibold text-base flex-1">🔍 Trace Inspector</Text>
      </View>

      {isLoading && <View className="flex-1 items-center justify-center"><ActivityIndicator color="#888" /></View>}
      {error && <View className="flex-1 items-center justify-center"><Text className="text-red-400">Errore caricamento traces</Text></View>}

      {data && (
        <FlatList
          data={data.traces}
          keyExtractor={(t, i) => `${t.session_id}-${i}`}
          renderItem={({ item }) => <TraceRow trace={item} />}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 20 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#888" />}
          ListHeaderComponent={
            costData ? (
              <View className="bg-surface border border-accent/30 rounded-xl p-4 mb-4">
                <Text className="text-muted text-xs uppercase mb-2">Cost Summary ({days}d)</Text>
                <Text className="text-white text-2xl font-bold">${costData.totalCost}</Text>
                <View className="flex-row gap-2 mt-3">
                  {[7, 30].map((d) => (
                    <Pressable
                      key={d}
                      onPress={() => setDays(d)}
                      className={`px-3 py-2 rounded-lg ${days === d ? 'bg-accent' : 'bg-bg border border-border'}`}
                    >
                      <Text className={days === d ? 'text-white text-xs font-semibold' : 'text-muted text-xs'}>{d}d</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null
          }
          ListEmptyComponent={!isLoading ? <Text className="text-muted text-center mt-20">No traces yet.</Text> : null}
        />
      )}
    </View>
  );
}
