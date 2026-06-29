import { View, Text, Pressable, FlatList, ActivityIndicator, RefreshControl, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServers } from '@/store/servers';
import { ServerClient } from '@/api/client';
import { useState } from 'react';

interface Workflow {
  name: string;
  description: string;
  created_at: number;
}

interface Run {
  name: string;
  status: string;
  created_at: number;
}

function WorkflowCard({ wf, onRun }: { wf: Workflow; onRun: () => void }) {
  return (
    <View className="bg-surface border border-border rounded-xl p-3 mb-2">
      <View className="flex-row justify-between items-start mb-1">
        <Text className="text-white font-semibold text-sm flex-1">{wf.name}</Text>
      </View>
      <Text className="text-muted text-xs mb-2">{wf.description}</Text>
      <Pressable onPress={onRun} className="bg-accent/20 border border-accent rounded-lg px-2 py-1">
        <Text className="text-accent text-xs font-semibold text-center">Run</Text>
      </Pressable>
    </View>
  );
}

function RunRow({ run }: { run: Run }) {
  const date = new Date(run.created_at * 1000).toLocaleString('it');
  const statusColor = {
    completed: 'text-green-400',
    failed: 'text-red-400',
    pending: 'text-yellow-400',
    running: 'text-blue-400',
  }[run.status as string] || 'text-muted';

  return (
    <View className="bg-bg border border-border rounded-lg p-3 mb-2">
      <View className="flex-row justify-between items-center">
        <Text className="text-white text-sm font-mono">{run.name}</Text>
        <Text className={`${statusColor} text-xs font-semibold capitalize`}>{run.status}</Text>
      </View>
      <Text className="text-muted text-xs mt-1">{date}</Text>
    </View>
  );
}

export default function WorkflowsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const active = useServers((s) => s.active());
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<'workflows' | 'runs'>('workflows');

  const { data: wfData, isLoading: wfLoading, refetch: refetchWf } = useQuery({
    queryKey: ['workflows', active?.id],
    queryFn: () => new ServerClient(active!).get<{ workflows: Workflow[] }>('/api/workflows?limit=50'),
    enabled: !!active,
  });

  const { data: runsData, isLoading: runsLoading, refetch: refetchRuns } = useQuery({
    queryKey: ['workflows-runs', active?.id],
    queryFn: () => new ServerClient(active!).get<{ runs: Run[] }>('/api/workflows/runs?limit=20'),
    enabled: !!active,
  });

  const { mutate: runWorkflow } = useMutation({
    mutationFn: (name: string) => new ServerClient(active!).post(`/api/workflows/run/${encodeURIComponent(name)}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['workflows-runs'] });
      Alert.alert('Workflow started', 'Run in progress');
    },
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([tab === 'workflows' ? refetchWf() : refetchRuns()]);
    setRefreshing(false);
  };

  const isLoading = tab === 'workflows' ? wfLoading : runsLoading;
  const data = tab === 'workflows' ? wfData?.workflows : runsData?.runs;

  return (
    <View className="flex-1 bg-bg" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center px-4 py-3 border-b border-border">
        <Pressable onPress={() => router.back()} className="mr-3">
          <Text className="text-muted text-lg">←</Text>
        </Pressable>
        <Text className="text-white font-semibold text-base">🔀 Workflows</Text>
      </View>

      <View className="flex-row border-b border-border">
        {(['workflows', 'runs'] as const).map((t) => (
          <Pressable
            key={t}
            onPress={() => setTab(t)}
            className={`flex-1 py-3 border-b-2 ${t === tab ? 'border-accent' : 'border-transparent'}`}
          >
            <Text className={t === tab ? 'text-white font-semibold text-center' : 'text-muted text-center'}>{t === 'workflows' ? 'DAGs' : 'Recent Runs'}</Text>
          </Pressable>
        ))}
      </View>

      {isLoading && <View className="flex-1 items-center justify-center"><ActivityIndicator color="#888" /></View>}

      {data && (
        <FlatList
          data={data as any}
          keyExtractor={(item, i) => `${item.name}-${i}`}
          renderItem={({ item }) =>
            tab === 'workflows' ? (
              <WorkflowCard wf={item} onRun={() => runWorkflow(item.name)} />
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
