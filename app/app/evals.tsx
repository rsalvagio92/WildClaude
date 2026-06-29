import { View, Text, Pressable, FlatList, ActivityIndicator, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServers } from '@/store/servers';
import { ServerClient } from '@/api/client';
import { useState } from 'react';

interface Eval {
  name: string;
  description: string;
  created_at: number;
}

interface Run {
  name: string;
  passed: number;
  total: number;
  created_at: number;
}

function EvalCard({ eval: e, onRun }: { eval: Eval; onRun: () => void }) {
  return (
    <View className="bg-surface border border-border rounded-xl p-3 mb-2">
      <View className="flex-row justify-between items-start mb-1">
        <Text className="text-white font-semibold text-sm flex-1">{e.name}</Text>
      </View>
      <Text className="text-muted text-xs mb-2">{e.description}</Text>
      <Pressable onPress={onRun} className="bg-accent/20 border border-accent rounded-lg px-2 py-1">
        <Text className="text-accent text-xs font-semibold text-center">Run</Text>
      </Pressable>
    </View>
  );
}

function RunRow({ run }: { run: Run }) {
  const date = new Date(run.created_at * 1000).toLocaleString('it');
  const pct = Math.round((run.passed / run.total) * 100);
  return (
    <View className="bg-bg border border-border rounded-lg p-3 mb-2">
      <View className="flex-row justify-between items-center">
        <Text className="text-white text-sm font-mono">{run.name}</Text>
        <Text className={pct === 100 ? 'text-green-400 font-semibold' : 'text-yellow-400 font-semibold'}>{pct}%</Text>
      </View>
      <Text className="text-muted text-xs mt-1">{run.passed}/{run.total} passed • {date}</Text>
    </View>
  );
}

export default function EvalsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const active = useServers((s) => s.active());
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<'evals' | 'runs'>('evals');

  const { data: evalsData, isLoading: evalsLoading, refetch: refetchEvals } = useQuery({
    queryKey: ['evals', active?.id],
    queryFn: () => new ServerClient(active!).get<{ evals: Eval[] }>('/api/evals?limit=50'),
    enabled: !!active,
  });

  const { data: runsData, isLoading: runsLoading, refetch: refetchRuns } = useQuery({
    queryKey: ['evals-runs', active?.id],
    queryFn: () => new ServerClient(active!).get<{ runs: Run[] }>('/api/evals/runs?limit=20'),
    enabled: !!active,
  });

  const { mutate: runEval } = useMutation({
    mutationFn: (name: string) => new ServerClient(active!).post(`/api/evals/run/${encodeURIComponent(name)}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['evals-runs'] });
    },
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([tab === 'evals' ? refetchEvals() : refetchRuns()]);
    setRefreshing(false);
  };

  const isLoading = tab === 'evals' ? evalsLoading : runsLoading;
  const data = tab === 'evals' ? evalsData?.evals : runsData?.runs;

  return (
    <View className="flex-1 bg-bg" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center px-4 py-3 border-b border-border">
        <Pressable onPress={() => router.back()} className="mr-3">
          <Text className="text-muted text-lg">←</Text>
        </Pressable>
        <Text className="text-white font-semibold text-base">✅ Evals</Text>
      </View>

      <View className="flex-row border-b border-border">
        {(['evals', 'runs'] as const).map((t) => (
          <Pressable
            key={t}
            onPress={() => setTab(t)}
            className={`flex-1 py-3 border-b-2 ${t === tab ? 'border-accent' : 'border-transparent'}`}
          >
            <Text className={t === tab ? 'text-white font-semibold text-center' : 'text-muted text-center'}>{t === 'evals' ? 'Test Cases' : 'Recent Runs'}</Text>
          </Pressable>
        ))}
      </View>

      {isLoading && <View className="flex-1 items-center justify-center"><ActivityIndicator color="#888" /></View>}

      {data && (
        <FlatList
          data={data as any}
          keyExtractor={(item, i) => `${item.name}-${i}`}
          renderItem={({ item }) =>
            tab === 'evals' ? (
              <EvalCard eval={item} onRun={() => runEval(item.name)} />
            ) : (
              <RunRow run={item} />
            )
          }
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 20 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#888" />}
          ListEmptyComponent={<Text className="text-muted text-center mt-20">No data.</Text>}
        />
      )}
    </View>
  );
}
