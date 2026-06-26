import { View, Text, Pressable, ScrollView, ActivityIndicator, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { useServers } from '@/store/servers';
import { ServerClient } from '@/api/client';
import { useState } from 'react';

interface VitalsResponse {
  process: {
    heapUsedMB: number; heapTotalMB: number; rssMB: number;
    uptimeMin: number; nodeVersion: string; pid: number;
  };
  system: {
    hostname: string; totalMemMB: number; freeMemMB: number; usedMemPct: number;
    loadAvg1m: string; loadAvg5m: string; loadAvg15m: string;
    sysUptimeHours: number; cpuCount: number; platform: string; arch: string;
    temperature: string | null;
    disk: { total: string; used: string; free: string; usedPct: string } | null;
    network: { interface: string; ip: string }[];
    cpuCores: { core: number; speedMHz: number; usagePct: number }[];
  };
}

function Bar({ pct, color = 'bg-accent' }: { pct: number; color?: string }) {
  return (
    <View className="h-2 bg-bg rounded-full overflow-hidden mt-1">
      <View className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(100, pct)}%` }} />
    </View>
  );
}

function StatRow({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <View className="flex-row justify-between items-center py-2 border-b border-border/40">
      <Text className="text-muted text-sm">{label}</Text>
      <View className="items-end">
        <Text className="text-white text-sm font-medium">{value}</Text>
        {sub && <Text className="text-muted text-xs">{sub}</Text>}
      </View>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="bg-surface border border-border rounded-2xl px-4 py-3 mb-3">
      <Text className="text-muted text-xs uppercase tracking-wider mb-2">{title}</Text>
      {children}
    </View>
  );
}

export default function VitalsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const active = useServers((s) => s.active());
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['vitals', active?.id],
    queryFn: () => new ServerClient(active!).get<VitalsResponse>('/api/vitals'),
    enabled: !!active,
    refetchInterval: 10_000,
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
        <Text className="text-white font-semibold text-base">📈 System Vitals</Text>
      </View>

      {isLoading && <View className="flex-1 items-center justify-center"><ActivityIndicator color="#888" /></View>}
      {error && <View className="flex-1 items-center justify-center"><Text className="text-red-400">Errore caricamento vitals</Text></View>}

      {data && (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 20 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#888" />}
        >
          <Section title="Sistema">
            <StatRow label="Hostname" value={data.system.hostname} />
            <StatRow label="Platform" value={`${data.system.platform} ${data.system.arch}`} />
            <StatRow label="Uptime sistema" value={`${data.system.sysUptimeHours}h`} />
            {data.system.temperature && <StatRow label="Temperatura" value={data.system.temperature} />}
          </Section>

          <Section title="Memoria">
            <StatRow
              label="RAM usata"
              value={`${data.system.usedMemPct}%`}
              sub={`${Math.round((data.system.totalMemMB - data.system.freeMemMB))} / ${data.system.totalMemMB} MB`}
            />
            <Bar pct={data.system.usedMemPct} color={data.system.usedMemPct > 85 ? 'bg-red-500' : 'bg-accent'} />
          </Section>

          <Section title="CPU — Load avg">
            <StatRow label="1 min" value={data.system.loadAvg1m} sub={`${data.system.cpuCount} core`} />
            <StatRow label="5 min" value={data.system.loadAvg5m} />
            <StatRow label="15 min" value={data.system.loadAvg15m} />
          </Section>

          {data.system.disk && (
            <Section title="Disco">
              <StatRow label="Usato" value={data.system.disk.usedPct} sub={`${data.system.disk.used} / ${data.system.disk.total}`} />
            </Section>
          )}

          <Section title="Processo Node">
            <StatRow label="Heap usato" value={`${data.process.heapUsedMB} MB`} sub={`/ ${data.process.heapTotalMB} MB`} />
            <Bar pct={Math.round((data.process.heapUsedMB / data.process.heapTotalMB) * 100)} />
            <StatRow label="RSS" value={`${data.process.rssMB} MB`} />
            <StatRow label="Uptime processo" value={`${data.process.uptimeMin} min`} />
            <StatRow label="Node" value={data.process.nodeVersion} />
            <StatRow label="PID" value={String(data.process.pid)} />
          </Section>

          {data.system.network.length > 0 && (
            <Section title="Rete">
              {data.system.network.map((n, i) => (
                <StatRow key={i} label={n.interface} value={n.ip} />
              ))}
            </Section>
          )}
        </ScrollView>
      )}
    </View>
  );
}
