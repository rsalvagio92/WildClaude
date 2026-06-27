import { useState } from 'react';
import { View, Text, Pressable, FlatList, ActivityIndicator, RefreshControl, Alert, TextInput } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServers } from '@/store/servers';
import { ServerClient } from '@/api/client';

interface Skill {
  name: string;
  description?: string;
  source?: string;
}

interface McpServer {
  id: string;
  name: string;
  description?: string;
  category?: string;
  installed?: boolean;
}

type Tab = 'skills' | 'mcp';

function SkillCard({ skill, onDelete }: { skill: Skill; onDelete: (name: string) => void }) {
  return (
    <View className="bg-surface border border-border rounded-2xl p-4 mb-2">
      <View className="flex-row items-start justify-between">
        <View className="flex-1 mr-3">
          <Text className="text-white font-semibold">{skill.name}</Text>
          {skill.description ? (
            <Text className="text-muted text-xs mt-0.5" numberOfLines={2}>{skill.description}</Text>
          ) : null}
          {skill.source ? (
            <Text className="text-zinc-600 text-xs mt-0.5">via {skill.source}</Text>
          ) : null}
        </View>
        <Pressable
          onPress={() => onDelete(skill.name)}
          className="px-3 py-1.5 rounded-lg border border-red-500/40 bg-red-500/10"
        >
          <Text className="text-red-400 text-xs">Rimuovi</Text>
        </Pressable>
      </View>
    </View>
  );
}

function McpCard({ server, onToggle }: { server: McpServer; onToggle: (id: string, install: boolean) => void }) {
  return (
    <View className="bg-surface border border-border rounded-2xl p-4 mb-2">
      <View className="flex-row items-start justify-between">
        <View className="flex-1 mr-3">
          <Text className="text-white font-semibold">{server.name}</Text>
          {server.description ? (
            <Text className="text-muted text-xs mt-0.5" numberOfLines={2}>{server.description}</Text>
          ) : null}
          {server.category ? (
            <Text className="text-zinc-600 text-xs mt-0.5">{server.category}</Text>
          ) : null}
        </View>
        <Pressable
          onPress={() => onToggle(server.id, !server.installed)}
          className={`px-3 py-1.5 rounded-lg border ${
            server.installed
              ? 'border-red-500/40 bg-red-500/10'
              : 'border-green-500/40 bg-green-500/10'
          }`}
        >
          <Text className={`text-xs ${server.installed ? 'text-red-400' : 'text-green-400'}`}>
            {server.installed ? 'Rimuovi' : 'Installa'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function Skills() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const active = useServers((s) => s.active());
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('skills');
  const [search, setSearch] = useState('');

  const client = active ? new ServerClient(active) : null;

  const skillsQ = useQuery({
    queryKey: ['skills', active?.id],
    queryFn: () => client!.get<{ skills: Skill[] }>('/api/skills'),
    enabled: !!client,
    staleTime: 30_000,
  });

  const mcpQ = useQuery({
    queryKey: ['mcp', active?.id],
    queryFn: () => client!.get<{ servers: McpServer[] }>('/api/mcp'),
    enabled: !!client && tab === 'mcp',
    staleTime: 30_000,
  });

  const deleteSkill = useMutation({
    mutationFn: (name: string) => client!.del(`/api/skills/${name}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['skills', active?.id] }),
    onError: (e: Error) => Alert.alert('Errore', e.message),
  });

  const toggleMcp = useMutation({
    mutationFn: ({ id, install }: { id: string; install: boolean }) =>
      install
        ? client!.post(`/api/mcp/${id}/install`)
        : client!.del(`/api/mcp/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mcp', active?.id] }),
    onError: (e: Error) => Alert.alert('Errore', e.message),
  });

  const skills = skillsQ.data?.skills ?? [];
  const mcpServers = mcpQ.data?.servers ?? [];

  const filtered =
    tab === 'skills'
      ? skills.filter((s) => s.name.toLowerCase().includes(search.toLowerCase()))
      : mcpServers.filter((s) =>
          s.name.toLowerCase().includes(search.toLowerCase()) ||
          (s.category ?? '').toLowerCase().includes(search.toLowerCase()),
        );

  return (
    <View className="flex-1 bg-bg" style={{ paddingTop: insets.top }}>
      <View className="px-4 pt-4 pb-2">
        <Pressable onPress={() => router.back()} className="mb-3">
          <Text className="text-muted">← Home</Text>
        </Pressable>
        <Text className="text-white text-2xl font-bold mb-4">Skills & MCP</Text>

        {/* Tabs */}
        <View className="flex-row bg-surface border border-border rounded-xl p-1 mb-3">
          {(['skills', 'mcp'] as Tab[]).map((t) => (
            <Pressable
              key={t}
              onPress={() => { setTab(t); setSearch(''); }}
              className={`flex-1 py-2 rounded-lg ${tab === t ? 'bg-accent' : ''}`}
            >
              <Text className={`text-center text-sm font-medium ${tab === t ? 'text-white' : 'text-muted'}`}>
                {t === 'skills' ? '🧩 Skills' : '🔌 MCP Server'}
              </Text>
            </Pressable>
          ))}
        </View>

        <TextInput
          className="bg-surface border border-border rounded-xl px-4 py-2.5 text-white text-sm"
          placeholder="Cerca..."
          placeholderTextColor="#71717a"
          value={search}
          onChangeText={setSearch}
        />
      </View>

      {tab === 'skills' ? (
        skillsQ.isLoading ? (
          <ActivityIndicator className="mt-8" color="#a78bfa" />
        ) : (
          <FlatList
            data={filtered as Skill[]}
            keyExtractor={(s) => s.name}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
            refreshControl={
              <RefreshControl
                refreshing={skillsQ.isFetching}
                onRefresh={() => qc.invalidateQueries({ queryKey: ['skills', active?.id] })}
                tintColor="#a78bfa"
              />
            }
            ListEmptyComponent={
              <Text className="text-muted text-center mt-8">
                {skills.length === 0 ? 'Nessuna skill installata.' : 'Nessun risultato.'}
              </Text>
            }
            renderItem={({ item }) => (
              <SkillCard
                skill={item}
                onDelete={(name) =>
                  Alert.alert('Rimuovi skill', `Eliminare "${name}"?`, [
                    { text: 'Annulla', style: 'cancel' },
                    { text: 'Rimuovi', style: 'destructive', onPress: () => deleteSkill.mutate(name) },
                  ])
                }
              />
            )}
          />
        )
      ) : mcpQ.isLoading ? (
        <ActivityIndicator className="mt-8" color="#a78bfa" />
      ) : (
        <FlatList
          data={filtered as McpServer[]}
          keyExtractor={(s) => s.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
          refreshControl={
            <RefreshControl
              refreshing={mcpQ.isFetching}
              onRefresh={() => qc.invalidateQueries({ queryKey: ['mcp', active?.id] })}
              tintColor="#a78bfa"
            />
          }
          ListEmptyComponent={
            <Text className="text-muted text-center mt-8">Nessun server MCP trovato.</Text>
          }
          renderItem={({ item }) => (
            <McpCard
              server={item}
              onToggle={(id, install) => toggleMcp.mutate({ id, install })}
            />
          )}
        />
      )}
    </View>
  );
}
