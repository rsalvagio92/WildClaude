import { useState } from 'react';
import { View, Text, Pressable, FlatList, ActivityIndicator, RefreshControl, Modal, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { useServers } from '@/store/servers';
import { ServerClient } from '@/api/client';

interface Dashboard {
  id: string;
  title: string;
  description?: string;
  widgets: Widget[];
  updatedAt?: number;
}

interface Widget {
  id: string;
  type: string;
  title: string;
  source: string;
  value?: string | number;
  data?: unknown;
}

interface WidgetData {
  value?: string | number | null;
  rows?: Record<string, unknown>[];
  items?: string[];
  html?: string;
  text?: string;
}

function WidgetCard({ widget, dashId, client }: { widget: Widget; dashId: string; client: ServerClient }) {
  const { data, isLoading } = useQuery({
    queryKey: ['widget', dashId, widget.id],
    queryFn: () => client.get<WidgetData>(`/api/dash/${dashId}/widget/${widget.id}`),
    refetchInterval: 30_000,
  });

  const renderContent = () => {
    if (isLoading) return <ActivityIndicator size="small" color="#888" />;
    if (!data) return <Text className="text-muted text-sm">—</Text>;

    if (data.value != null) {
      return <Text className="text-white text-2xl font-bold">{String(data.value)}</Text>;
    }
    if (data.items && data.items.length > 0) {
      return (
        <View>
          {data.items.slice(0, 5).map((item, i) => (
            <Text key={i} className="text-white text-sm mb-1" numberOfLines={1}>· {item}</Text>
          ))}
        </View>
      );
    }
    if (data.rows && data.rows.length > 0) {
      const keys = Object.keys(data.rows[0] || {}).slice(0, 3);
      return (
        <View>
          {data.rows.slice(0, 4).map((row, i) => (
            <Text key={i} className="text-muted text-xs mb-0.5">
              {keys.map(k => `${k}: ${row[k]}`).join(' · ')}
            </Text>
          ))}
        </View>
      );
    }
    if (data.text) return <Text className="text-white text-sm" numberOfLines={4}>{data.text}</Text>;
    return <Text className="text-muted text-sm">Nessun dato</Text>;
  };

  return (
    <View className="bg-bg border border-border/50 rounded-xl p-3 mb-2">
      <Text className="text-muted text-xs uppercase tracking-wider mb-2">{widget.title}</Text>
      {renderContent()}
    </View>
  );
}

function DashboardDetail({ dash, onClose }: { dash: Dashboard; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const active = useServers((s) => s.active());
  if (!active) return null;
  const client = new ServerClient(active);

  return (
    <View className="flex-1 bg-bg" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center px-4 py-3 border-b border-border">
        <Pressable onPress={onClose} className="mr-3"><Text className="text-accent">← Indietro</Text></Pressable>
        <Text className="text-white font-semibold flex-1" numberOfLines={1}>{dash.title}</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 20 }}>
        {dash.description ? (
          <Text className="text-muted text-sm mb-4">{dash.description}</Text>
        ) : null}
        {dash.widgets.map((w) => (
          <WidgetCard key={w.id} widget={w} dashId={dash.id} client={client} />
        ))}
        {dash.widgets.length === 0 && (
          <Text className="text-muted text-center mt-10">Nessun widget in questa dashboard.</Text>
        )}
      </ScrollView>
    </View>
  );
}

function DashCard({ dash, onPress }: { dash: Dashboard; onPress: () => void }) {
  const date = dash.updatedAt ? new Date(dash.updatedAt).toLocaleDateString('it') : '';
  return (
    <Pressable onPress={onPress} className="bg-surface border border-border rounded-2xl p-4 mb-3 active:opacity-70">
      <Text className="text-white font-semibold text-base mb-1">{dash.title}</Text>
      {dash.description ? <Text className="text-muted text-sm" numberOfLines={2}>{dash.description}</Text> : null}
      <View className="flex-row items-center justify-between mt-2">
        <Text className="text-muted text-xs">{dash.widgets?.length ?? 0} widget</Text>
        {date ? <Text className="text-muted text-xs">{date}</Text> : null}
      </View>
    </Pressable>
  );
}

export default function DashboardsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const active = useServers((s) => s.active());
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<Dashboard | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboards', active?.id],
    queryFn: () => new ServerClient(active!).get<{ dashboards: Dashboard[] }>('/api/dash'),
    enabled: !!active,
  });

  const onRefresh = async () => { setRefreshing(true); await refetch(); setRefreshing(false); };

  const dashboards = data?.dashboards ?? [];

  return (
    <View className="flex-1 bg-bg" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center px-4 py-3 border-b border-border">
        <Pressable onPress={() => router.back()} className="mr-3"><Text className="text-muted text-lg">←</Text></Pressable>
        <Text className="text-white font-semibold text-base flex-1">📊 Dashboards</Text>
        <Text className="text-muted text-xs">{dashboards.length}</Text>
      </View>

      {isLoading && <View className="flex-1 items-center justify-center"><ActivityIndicator color="#888" /></View>}
      {error && <View className="flex-1 items-center justify-center"><Text className="text-red-400">Errore caricamento dashboards</Text></View>}

      <FlatList
        data={dashboards}
        keyExtractor={(d) => d.id}
        renderItem={({ item }) => <DashCard dash={item} onPress={() => setSelected(item)} />}
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 20 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#888" />}
        ListEmptyComponent={!isLoading ? (
          <View className="items-center mt-20 px-8">
            <Text className="text-muted text-center">Nessuna dashboard.</Text>
            <Text className="text-muted text-center text-xs mt-2">Crea una dashboard dalla web UI con /dashboard_create.</Text>
          </View>
        ) : null}
      />

      <Modal visible={!!selected} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setSelected(null)}>
        {selected && <DashboardDetail dash={selected} onClose={() => setSelected(null)} />}
      </Modal>
    </View>
  );
}
