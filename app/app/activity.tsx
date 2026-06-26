import { useState } from 'react';
import { View, Text, Pressable, FlatList, ActivityIndicator, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { useServers } from '@/store/servers';
import { ServerClient } from '@/api/client';

interface ActivityEntry {
  id: string;
  timestamp: number;
  agentId: string;
  type: string;
  description: string;
  metadata?: string;
}

function typeColor(type: string): string {
  if (type.includes('error') || type.includes('fail')) return 'text-red-400';
  if (type.includes('complete') || type.includes('success')) return 'text-green-400';
  if (type.includes('start') || type.includes('running')) return 'text-blue-400';
  return 'text-muted';
}

function typeIcon(type: string): string {
  if (type.includes('error') || type.includes('fail')) return '✕';
  if (type.includes('complete') || type.includes('success')) return '✓';
  if (type.includes('start')) return '▶';
  return '·';
}

function ActivityRow({ entry }: { entry: ActivityEntry }) {
  const d = new Date(entry.timestamp * 1000);
  const time = d.toLocaleTimeString('it', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return (
    <View className="flex-row items-start py-2 border-b border-border/40 px-4">
      <Text className={`text-sm font-bold w-5 ${typeColor(entry.type)}`}>{typeIcon(entry.type)}</Text>
      <View className="flex-1 ml-2">
        <View className="flex-row items-center justify-between">
          <Text className="text-white text-sm flex-1 mr-2" numberOfLines={2}>{entry.description}</Text>
          <Text className="text-muted text-xs shrink-0">{time}</Text>
        </View>
        <Text className="text-muted text-xs mt-0.5">{entry.agentId} · {entry.type}</Text>
      </View>
    </View>
  );
}

export default function ActivityScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const active = useServers((s) => s.active());
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['activity', active?.id],
    queryFn: () => new ServerClient(active!).get<{ activities: ActivityEntry[] }>('/api/activity?limit=100'),
    enabled: !!active,
    refetchInterval: 5_000,
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const activities = data?.activities ?? [];

  return (
    <View className="flex-1 bg-bg" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center px-4 py-3 border-b border-border">
        <Pressable onPress={() => router.back()} className="mr-3">
          <Text className="text-muted text-lg">←</Text>
        </Pressable>
        <Text className="text-white font-semibold text-base flex-1">📡 Live Activity</Text>
        <Text className="text-muted text-xs">{activities.length} eventi</Text>
      </View>

      {isLoading && <View className="flex-1 items-center justify-center"><ActivityIndicator color="#888" /></View>}
      {error && <View className="flex-1 items-center justify-center"><Text className="text-red-400">Errore caricamento activity</Text></View>}

      <FlatList
        data={activities}
        keyExtractor={(a) => a.id}
        renderItem={({ item }) => <ActivityRow entry={item} />}
        contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#888" />}
        ListEmptyComponent={
          !isLoading ? <Text className="text-muted text-center mt-20">Nessuna attività registrata.</Text> : null
        }
      />
    </View>
  );
}
