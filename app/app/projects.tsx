import { View, Text, Pressable, FlatList, ActivityIndicator, RefreshControl, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServers } from '@/store/servers';
import { ServerClient } from '@/api/client';

interface Project {
  id: string;
  name: string;
  description?: string;
  repos?: string[];
  links?: string[];
  isActive?: boolean;
}

function ProjectCard({
  project,
  onActivate,
}: {
  project: Project;
  onActivate: (id: string) => void;
}) {
  return (
    <View
      className={`bg-surface border rounded-2xl p-4 mb-2 ${
        project.isActive ? 'border-accent' : 'border-border'
      }`}
    >
      <View className="flex-row items-start justify-between">
        <View className="flex-1 mr-3">
          <View className="flex-row items-center gap-2 mb-0.5">
            {project.isActive && (
              <View className="w-2 h-2 rounded-full bg-accent" />
            )}
            <Text className="text-white font-semibold">{project.name}</Text>
          </View>
          {project.description ? (
            <Text className="text-muted text-xs mt-0.5" numberOfLines={2}>
              {project.description}
            </Text>
          ) : null}
          {project.repos && project.repos.length > 0 ? (
            <Text className="text-zinc-600 text-xs mt-1">
              {project.repos.length} repo
            </Text>
          ) : null}
        </View>
        {!project.isActive && (
          <Pressable
            onPress={() => onActivate(project.id)}
            className="px-3 py-1.5 rounded-lg border border-accent/40 bg-accent/10"
          >
            <Text className="text-accent text-xs">Attiva</Text>
          </Pressable>
        )}
        {project.isActive && (
          <View className="px-3 py-1.5 rounded-lg bg-accent/20">
            <Text className="text-accent text-xs font-medium">Attivo</Text>
          </View>
        )}
      </View>
    </View>
  );
}

export default function Projects() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const active = useServers((s) => s.active());
  const qc = useQueryClient();

  const client = active ? new ServerClient(active) : null;

  const projectsQ = useQuery({
    queryKey: ['projects', active?.id],
    queryFn: () => client!.get<{ projects: Project[] }>('/api/projects'),
    enabled: !!client,
    staleTime: 30_000,
  });

  // Active project for this chat — use a fixed chatId placeholder for the app context.
  const activeQ = useQuery({
    queryKey: ['projects-active', active?.id],
    queryFn: () =>
      client!
        .get<{ projectId: string | null }>('/api/projects/active/app')
        .catch(() => ({ projectId: null })),
    enabled: !!client,
    staleTime: 15_000,
  });

  const setActive = useMutation({
    mutationFn: (projectId: string) =>
      client!.post('/api/projects/active/app', { projectId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects-active', active?.id] });
      qc.invalidateQueries({ queryKey: ['projects', active?.id] });
    },
    onError: (e: Error) => Alert.alert('Errore', e.message),
  });

  const projects = projectsQ.data?.projects ?? [];
  const activeProjectId = activeQ.data?.projectId;

  const enriched = projects.map((p) => ({ ...p, isActive: p.id === activeProjectId }));

  return (
    <View className="flex-1 bg-bg" style={{ paddingTop: insets.top }}>
      <View className="px-4 pt-4 pb-2">
        <Pressable onPress={() => router.back()} className="mb-3">
          <Text className="text-muted">← Home</Text>
        </Pressable>
        <Text className="text-white text-2xl font-bold">📂 Progetti</Text>
        <Text className="text-muted text-sm mt-1 mb-4">
          Seleziona il progetto attivo per questa sessione.
        </Text>
      </View>

      {projectsQ.isLoading ? (
        <ActivityIndicator className="mt-8" color="#a78bfa" />
      ) : (
        <FlatList
          data={enriched}
          keyExtractor={(p) => p.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
          refreshControl={
            <RefreshControl
              refreshing={projectsQ.isFetching}
              onRefresh={() => {
                qc.invalidateQueries({ queryKey: ['projects', active?.id] });
                qc.invalidateQueries({ queryKey: ['projects-active', active?.id] });
              }}
              tintColor="#a78bfa"
            />
          }
          ListHeaderComponent={
            activeProjectId ? (
              <Pressable
                onPress={() => setActive.mutate('')}
                className="bg-surface border border-border rounded-2xl p-4 mb-4 flex-row items-center justify-between"
              >
                <Text className="text-muted text-sm">Nessun progetto attivo</Text>
                <Text className="text-red-400 text-xs">Deseleziona</Text>
              </Pressable>
            ) : null
          }
          ListEmptyComponent={
            <Text className="text-muted text-center mt-8">
              Nessun progetto configurato. Creane uno via dashboard o Telegram.
            </Text>
          }
          renderItem={({ item }) => (
            <ProjectCard
              project={item}
              onActivate={(id) => setActive.mutate(id)}
            />
          )}
        />
      )}
    </View>
  );
}
