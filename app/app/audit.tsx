import { useState } from 'react';
import { View, Text, Pressable, FlatList, ActivityIndicator, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { useServers } from '@/store/servers';
import { ServerClient } from '@/api/client';

interface AuditEntry {
  id: number;
  timestamp: number;
  agentId: string;
  action: string;
  allowed: boolean;
  details?: string;
}

function AuditRow({ entry }: { entry: AuditEntry }) {
  const d = new Date(entry.timestamp * 1000);
  const date = d.toLocaleDateString('it', { day: '2-digit', month: '2-digit' });
  const time = d.toLocaleTimeString('it', { hour: '2-digit', minute: '2-digit' });
  return (
    <View className="flex-row items-start py-3 border-b border-border/40 px-4">
      <View className={`w-2 h-2 rounded-full mt-1.5 mr-3 shrink-0 ${entry.allowed ? 'bg-green-500' : 'bg-red-500'}`} />
      <View className="flex-1">
        <View className="flex-row items-center justify-between">
          <Text className="text-white text-sm font-medium flex-1 mr-2" numberOfLines={1}>{entry.action}</Text>
          <Text className="text-muted text-xs">{date} {time}</Text>
        </View>
        <Text className="text-muted text-xs mt-0.5">
          {entry.agentId} · {entry.allowed ? 'consentito' : 'bloccato'}
        </Text>
        {entry.details ? (
          <Text className="text-muted text-xs mt-0.5" numberOfLines={2}>{entry.details}</Text>
        ) : null}
      </View>
    </View>
  );
}

export default function AuditScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const active = useServers((s) => s.active());
  const [refreshing, setRefreshing] = useState(false);
  const [showBlocked, setShowBlocked] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['audit', active?.id, showBlocked],
    queryFn: () =>
      showBlocked
        ? new ServerClient(active!).get<{ entries: AuditEntry[] }>('/api/audit/blocked')
        : new ServerClient(active!).get<{ entries: AuditEntry[]; total: number }>('/api/audit?limit=100'),
    enabled: !!active,
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const entries = data?.entries ?? [];

  return (
    <View className="flex-1 bg-bg" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center px-4 py-3 border-b border-border">
        <Pressable onPress={() => router.back()} className="mr-3">
          <Text className="text-muted text-lg">←</Text>
        </Pressable>
        <Text className="text-white font-semibold text-base flex-1">🛡️ Audit Log</Text>
        <Pressable
          onPress={() => setShowBlocked(!showBlocked)}
          className={`px-3 py-1 rounded-full border ${showBlocked ? 'border-red-500 bg-red-500/10' : 'border-border'}`}
        >
          <Text className={`text-xs ${showBlocked ? 'text-red-400' : 'text-muted'}`}>Bloccati</Text>
        </Pressable>
      </View>

      {isLoading && <View className="flex-1 items-center justify-center"><ActivityIndicator color="#888" /></View>}
      {error && <View className="flex-1 items-center justify-center"><Text className="text-red-400">Errore caricamento audit</Text></View>}

      <FlatList
        data={entries}
        keyExtractor={(e) => String(e.id)}
        renderItem={({ item }) => <AuditRow entry={item} />}
        contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#888" />}
        ListEmptyComponent={
          !isLoading ? <Text className="text-muted text-center mt-20">Nessuna voce nel log.</Text> : null
        }
      />
    </View>
  );
}
