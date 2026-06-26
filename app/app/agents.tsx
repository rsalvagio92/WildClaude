import { useState } from 'react';
import { View, Text, Pressable, FlatList, ActivityIndicator, RefreshControl, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServers } from '@/store/servers';
import { ServerClient } from '@/api/client';

interface Agent {
  id: string;
  name: string;
  description: string;
  model: string;
  lane: string;
  active: boolean;
  taskCount?: number;
  errorCount?: number;
}

const LANE_COLOR: Record<string, string> = {
  build: 'text-blue-400',
  review: 'text-purple-400',
  domain: 'text-green-400',
  coordination: 'text-yellow-400',
  life: 'text-pink-400',
};

function AgentCard({ agent, onToggle }: { agent: Agent; onToggle: (id: string, active: boolean) => void }) {
  const laneColor = LANE_COLOR[agent.lane] ?? 'text-muted';
  return (
    <View className="bg-surface border border-border rounded-2xl p-4 mb-2">
      <View className="flex-row items-start justify-between mb-1">
        <View className="flex-1 mr-3">
          <View className="flex-row items-center gap-2 mb-0.5">
            <Text className="text-white font-semibold">{agent.name}</Text>
            <View className={`w-1.5 h-1.5 rounded-full ${agent.active ? 'bg-green-500' : 'bg-zinc-500'}`} />
          </View>
          <Text className={`text-xs ${laneColor}`}>{agent.lane} · {agent.model}</Text>
        </View>
        <Pressable
          onPress={() => onToggle(agent.id, agent.active)}
          className={`px-3 py-1.5 rounded-lg border ${
            agent.active ? 'border-red-500/40 bg-red-500/10' : 'border-green-500/40 bg-green-500/10'
          }`}
        >
          <Text className={`text-xs ${agent.active ? 'text-red-400' : 'text-green-400'}`}>
            {agent.active ? 'Disattiva' : 'Attiva'}
          </Text>
        </Pressable>
      </View>
      {agent.description ? (
        <Text className="text-muted text-xs leading-4 mt-1" numberOfLines={2}>{agent.description}</Text>
      ) : null}
      {(agent.taskCount != null || agent.errorCount != null) && (
        <View className="flex-row gap-3 mt-2">
          {agent.taskCount != null && <Text className="text-muted text-xs">Task: {agent.taskCount}</Text>}
          {agent.errorCount != null && agent.errorCount > 0 && (
            <Text className="text-red-400 text-xs">Errori: {agent.errorCount}</Text>
          )}
        </View>
      )}
    </View>
  );
}

export default function AgentsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const active = useServers((s) => s.active());
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<'all' | 'active'>('all');

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['agents', active?.id],
    queryFn: () => new ServerClient(active!).get<{ agents: Agent[] }>('/api/agents'),
    enabled: !!active,
  });

  const { mutate: toggle } = useMutation({
    mutationFn: ({ id, active: isActive }: { id: string; active: boolean }) =>
      new ServerClient(active!).post(`/api/agents/${id}/${isActive ? 'deactivate' : 'activate'}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agents'] }),
  });

  const handleToggle = (id: string, isActive: boolean) => {
    Alert.alert(
      isActive ? 'Disattiva agente' : 'Attiva agente',
      `${isActive ? 'Disattivare' : 'Attivare'} ${id}?`,
      [
        { text: 'Annulla', style: 'cancel' },
        { text: 'Conferma', onPress: () => toggle({ id, active: isActive }) },
      ],
    );
  };

  const onRefresh = async () => { setRefreshing(true); await refetch(); setRefreshing(false); };

  const all = data?.agents ?? [];
  const agents = filter === 'active' ? all.filter(a => a.active) : all;

  return (
    <View className="flex-1 bg-bg" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center px-4 py-3 border-b border-border">
        <Pressable onPress={() => router.back()} className="mr-3"><Text className="text-muted text-lg">←</Text></Pressable>
        <Text className="text-white font-semibold text-base flex-1">🤖 Agent Hub</Text>
        <Pressable
          onPress={() => setFilter(filter === 'all' ? 'active' : 'all')}
          className={`px-3 py-1 rounded-full border text-xs ${filter === 'active' ? 'border-accent bg-accent/10' : 'border-border'}`}
        >
          <Text className={filter === 'active' ? 'text-accent' : 'text-muted'}>
            {filter === 'active' ? 'Attivi' : 'Tutti'}
          </Text>
        </Pressable>
      </View>

      {isLoading && <View className="flex-1 items-center justify-center"><ActivityIndicator color="#888" /></View>}
      {error && <View className="flex-1 items-center justify-center"><Text className="text-red-400">Errore caricamento agenti</Text></View>}

      <FlatList
        data={agents}
        keyExtractor={(a) => a.id}
        renderItem={({ item }) => <AgentCard agent={item} onToggle={handleToggle} />}
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 20 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#888" />}
        ListEmptyComponent={!isLoading ? <Text className="text-muted text-center mt-20">Nessun agente.</Text> : null}
      />
    </View>
  );
}
