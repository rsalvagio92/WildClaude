import { useState } from 'react';
import { View, Text, Pressable, FlatList, ActivityIndicator, RefreshControl, Switch } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServers } from '@/store/servers';
import { ServerClient } from '@/api/client';

interface Automation {
  id: string;
  name: string;
  description: string;
  cron: string;
  enabled: boolean;
  source: 'default' | 'user';
  status: string;
  last_run: number | null;
  last_status: string | null;
  next_run: number | null;
}

function lastRunLabel(ts: number | null): string {
  if (!ts) return 'mai';
  const d = new Date(ts * 1000);
  return d.toLocaleDateString('it', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function AutomationCard({ auto, onToggle }: { auto: Automation; onToggle: (id: string, enabled: boolean) => void }) {
  const statusColor = auto.last_status === 'success' ? 'text-green-400'
    : auto.last_status === 'error' ? 'text-red-400'
    : 'text-muted';
  return (
    <View className="bg-surface border border-border rounded-2xl p-4 mb-2">
      <View className="flex-row items-center justify-between mb-1">
        <View className="flex-1 mr-3">
          <Text className="text-white font-semibold" numberOfLines={1}>{auto.name}</Text>
          <Text className="text-muted text-xs mt-0.5">{auto.cron}</Text>
        </View>
        <Switch
          value={auto.enabled}
          onValueChange={(v) => onToggle(auto.id, v)}
          trackColor={{ false: '#333', true: '#6366f1' }}
          thumbColor="#fff"
        />
      </View>
      {auto.description ? (
        <Text className="text-muted text-xs leading-4 mb-2" numberOfLines={2}>{auto.description}</Text>
      ) : null}
      <View className="flex-row gap-3">
        <Text className="text-muted text-xs">Ultima: <Text className={statusColor}>{lastRunLabel(auto.last_run)}</Text></Text>
        {auto.source === 'user' && (
          <View className="bg-accent/10 border border-accent/20 rounded-full px-2 py-0.5">
            <Text className="text-accent text-xs">custom</Text>
          </View>
        )}
      </View>
    </View>
  );
}

export default function AutomationScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const active = useServers((s) => s.active());
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['automations', active?.id],
    queryFn: () => new ServerClient(active!).get<{ automations: Automation[] }>('/api/automations'),
    enabled: !!active,
  });

  const { mutate: toggle } = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      new ServerClient(active!).put(`/api/automations/${id}`, { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['automations'] }),
  });

  const onRefresh = async () => { setRefreshing(true); await refetch(); setRefreshing(false); };

  const automations = data?.automations ?? [];

  return (
    <View className="flex-1 bg-bg" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center px-4 py-3 border-b border-border">
        <Pressable onPress={() => router.back()} className="mr-3"><Text className="text-muted text-lg">←</Text></Pressable>
        <Text className="text-white font-semibold text-base flex-1">⏰ Automation</Text>
        <Text className="text-muted text-xs">{automations.filter(a => a.enabled).length}/{automations.length} attive</Text>
      </View>

      {isLoading && <View className="flex-1 items-center justify-center"><ActivityIndicator color="#888" /></View>}
      {error && <View className="flex-1 items-center justify-center"><Text className="text-red-400">Errore caricamento automations</Text></View>}

      <FlatList
        data={automations}
        keyExtractor={(a) => a.id}
        renderItem={({ item }) => (
          <AutomationCard
            auto={item}
            onToggle={(id, enabled) => toggle({ id, enabled })}
          />
        )}
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 20 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#888" />}
        ListEmptyComponent={!isLoading ? <Text className="text-muted text-center mt-20">Nessuna automazione configurata.</Text> : null}
      />
    </View>
  );
}
