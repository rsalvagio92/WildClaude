import { useState } from 'react';
import { View, Text, Pressable, FlatList, ActivityIndicator, RefreshControl, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServers } from '@/store/servers';
import { ServerClient } from '@/api/client';

interface Machine {
  machineId: string;
  primaryUrl?: string;
  status: 'online' | 'offline' | 'unknown';
  version?: string;
  lastSeen?: number; // ms timestamp
  telemetry?: { cpuPercent?: number; ramUsed?: number; ramTotal?: number; uptime?: number };
}

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <View className="bg-bg rounded-lg px-2 py-1 mr-2">
      <Text className="text-muted text-xs">{label}</Text>
      <Text className="text-white text-sm font-medium">{value}</Text>
    </View>
  );
}

function MachineCard({ machine, onCommand }: { machine: Machine; onCommand: (id: string, type: string) => void }) {
  const isOnline = machine.status === 'online';
  const t = machine.telemetry;
  const memPct = t?.ramUsed && t.ramTotal ? Math.round((t.ramUsed / t.ramTotal) * 100) : null;
  const role = machine.primaryUrl ? 'secondaria' : 'primaria';

  return (
    <View className="bg-surface border border-border rounded-2xl p-4 mb-3">
      <View className="flex-row items-center justify-between mb-3">
        <View className="flex-row items-center">
          <View className={`w-2.5 h-2.5 rounded-full mr-2 ${isOnline ? 'bg-green-500' : 'bg-red-400'}`} />
          <Text className="text-white font-semibold text-base">{machine.machineId}</Text>
        </View>
        <Text className="text-muted text-xs">{role}</Text>
      </View>

      {t && (
        <View className="flex-row flex-wrap mb-3">
          {t.cpuPercent != null && <StatChip label="CPU" value={`${Math.round(t.cpuPercent)}%`} />}
          {memPct != null && <StatChip label="RAM" value={`${memPct}%`} />}
          {t.uptime != null && <StatChip label="Up" value={`${Math.round(t.uptime / 3600)}h`} />}
        </View>
      )}

      {isOnline && (
        <View className="flex-row gap-2">
          {(['restart', 'upgrade'] as const).map((cmd) => (
            <Pressable
              key={cmd}
              onPress={() => onCommand(machine.machineId, cmd)}
              className="flex-1 bg-bg border border-border rounded-xl py-2 items-center active:opacity-60"
            >
              <Text className="text-muted text-sm capitalize">{cmd}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {!isOnline && machine.lastSeen && (
        <Text className="text-muted text-xs mt-1">
          Ultimo contatto: {new Date(machine.lastSeen).toLocaleString('it')}
        </Text>
      )}
    </View>
  );
}

export default function FleetScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const active = useServers((s) => s.active());
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['machines', active?.id],
    queryFn: () => new ServerClient(active!).get<{ machines: Machine[] }>('/api/machines'),
    enabled: !!active,
    refetchInterval: 15_000,
  });

  const { mutate: sendCommand } = useMutation({
    mutationFn: ({ machineId, type }: { machineId: string; type: string }) =>
      new ServerClient(active!).post(`/api/machines/${machineId}/command`, { type }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['machines'] }); },
  });

  const handleCommand = (machineId: string, type: string) => {
    Alert.alert(
      `${type.charAt(0).toUpperCase() + type.slice(1)} macchina`,
      `Confermi ${type} su questa macchina?`,
      [
        { text: 'Annulla', style: 'cancel' },
        { text: 'Conferma', style: 'destructive', onPress: () => sendCommand({ machineId, type }) },
      ],
    );
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const machines = data?.machines ?? [];

  return (
    <View className="flex-1 bg-bg" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center px-4 py-3 border-b border-border">
        <Pressable onPress={() => router.back()} className="mr-3">
          <Text className="text-muted text-lg">←</Text>
        </Pressable>
        <Text className="text-white font-semibold text-base flex-1">🖥️ Fleet</Text>
        <Text className="text-muted text-sm">{machines.filter(m => m.status === 'online').length}/{machines.length} online</Text>
      </View>

      {isLoading && (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#888" />
        </View>
      )}

      {error && (
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-red-400 text-center">Errore caricamento fleet</Text>
        </View>
      )}

      {!isLoading && !error && (
        <FlatList
          data={machines}
          keyExtractor={(m) => m.machineId}
          renderItem={({ item }) => <MachineCard machine={item} onCommand={handleCommand} />}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 20 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#888" />}
          ListEmptyComponent={<Text className="text-muted text-center mt-20">Nessuna macchina nel fleet.</Text>}
        />
      )}
    </View>
  );
}
