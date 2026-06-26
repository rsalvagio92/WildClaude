import { useState } from 'react';
import { View, Text, Pressable, FlatList, ActivityIndicator, RefreshControl, TextInput, Modal, ScrollView, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServers } from '@/store/servers';
import { ServerClient } from '@/api/client';

interface MissionTask {
  id: string;
  title: string;
  prompt: string;
  status: string;
  assigned_agent: string | null;
  priority: number;
  created_at: number;
}

const STATUS_COLOR: Record<string, string> = {
  pending: 'text-yellow-400',
  running: 'text-blue-400',
  completed: 'text-green-400',
  failed: 'text-red-400',
  cancelled: 'text-zinc-500',
};

function TaskCard({ task, onCancel }: { task: MissionTask; onCancel: (id: string) => void }) {
  const date = new Date(task.created_at * 1000).toLocaleDateString('it');
  const statusColor = STATUS_COLOR[task.status] ?? 'text-muted';
  return (
    <View className="bg-surface border border-border rounded-2xl p-4 mb-2">
      <View className="flex-row items-start justify-between mb-1">
        <Text className="text-white font-semibold flex-1 mr-2" numberOfLines={2}>{task.title}</Text>
        <Text className={`text-xs shrink-0 ${statusColor}`}>{task.status}</Text>
      </View>
      <View className="flex-row items-center gap-3 mt-1">
        <Text className="text-muted text-xs">{task.assigned_agent ?? 'non assegnato'}</Text>
        {task.priority > 0 && <Text className="text-accent text-xs">P{task.priority}</Text>}
        <Text className="text-muted text-xs">{date}</Text>
      </View>
      {task.status === 'pending' && (
        <Pressable
          onPress={() => onCancel(task.id)}
          className="mt-2 py-1.5 rounded-lg border border-red-500/30 bg-red-500/10 items-center"
        >
          <Text className="text-red-400 text-xs">Annulla task</Text>
        </Pressable>
      )}
    </View>
  );
}

export default function MissionsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const active = useServers((s) => s.active());
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['missions', active?.id],
    queryFn: () => new ServerClient(active!).get<{ tasks: MissionTask[] }>('/api/mission/tasks'),
    enabled: !!active,
    refetchInterval: 10_000,
  });

  const { mutate: createTask, isPending } = useMutation({
    mutationFn: ({ title, prompt }: { title: string; prompt: string }) =>
      new ServerClient(active!).post('/api/mission/tasks', { title, prompt }),
    onSuccess: () => {
      setTitle(''); setPrompt(''); setComposing(false);
      void qc.invalidateQueries({ queryKey: ['missions'] });
    },
    onError: () => Alert.alert('Errore', 'Impossibile creare il task.'),
  });

  const { mutate: cancelTask } = useMutation({
    mutationFn: (id: string) => new ServerClient(active!).post(`/api/mission/tasks/${id}/cancel`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['missions'] }),
  });

  const onRefresh = async () => { setRefreshing(true); await refetch(); setRefreshing(false); };
  const tasks = data?.tasks ?? [];

  return (
    <View className="flex-1 bg-bg" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center px-4 py-3 border-b border-border">
        <Pressable onPress={() => router.back()} className="mr-3"><Text className="text-muted text-lg">←</Text></Pressable>
        <Text className="text-white font-semibold text-base flex-1">🎯 Missions</Text>
        <Pressable
          onPress={() => setComposing(true)}
          className="bg-accent rounded-full w-8 h-8 items-center justify-center"
        >
          <Text className="text-white text-lg">+</Text>
        </Pressable>
      </View>

      {isLoading && <View className="flex-1 items-center justify-center"><ActivityIndicator color="#888" /></View>}
      {error && <View className="flex-1 items-center justify-center"><Text className="text-red-400">Errore caricamento missions</Text></View>}

      <FlatList
        data={tasks}
        keyExtractor={(t) => t.id}
        renderItem={({ item }) => <TaskCard task={item} onCancel={(id) => cancelTask(id)} />}
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 20 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#888" />}
        ListEmptyComponent={!isLoading ? <Text className="text-muted text-center mt-20">Nessun task in missione.</Text> : null}
      />

      <Modal visible={composing} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setComposing(false)}>
        <View className="flex-1 bg-bg" style={{ paddingTop: insets.top }}>
          <View className="flex-row items-center px-4 py-3 border-b border-border">
            <Pressable onPress={() => setComposing(false)} className="mr-3"><Text className="text-accent">Annulla</Text></Pressable>
            <Text className="text-white font-semibold flex-1">Nuovo task</Text>
          </View>
          <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
            <Text className="text-muted text-xs mb-1">Titolo</Text>
            <TextInput
              className="bg-surface border border-border rounded-xl px-4 py-3 text-white text-sm"
              placeholder="Titolo del task…"
              placeholderTextColor="#666"
              value={title}
              onChangeText={setTitle}
            />
            <Text className="text-muted text-xs mt-2 mb-1">Prompt</Text>
            <TextInput
              className="bg-surface border border-border rounded-xl px-4 py-3 text-white text-sm min-h-[120px]"
              placeholder="Descrizione dettagliata…"
              placeholderTextColor="#666"
              value={prompt}
              onChangeText={setPrompt}
              multiline
              textAlignVertical="top"
            />
            <Pressable
              onPress={() => title.trim() && prompt.trim() && createTask({ title: title.trim(), prompt: prompt.trim() })}
              disabled={!title.trim() || !prompt.trim() || isPending}
              className={`py-3 rounded-xl items-center mt-2 ${title.trim() && prompt.trim() && !isPending ? 'bg-accent' : 'bg-surface border border-border'}`}
            >
              <Text className="text-white font-medium">{isPending ? 'Creando…' : 'Crea task'}</Text>
            </Pressable>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}
