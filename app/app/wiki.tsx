import { useState } from 'react';
import { View, Text, Pressable, FlatList, ActivityIndicator, RefreshControl, Modal, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { useServers } from '@/store/servers';
import { ServerClient } from '@/api/client';

interface WikiArticle {
  id: string;
  topic: string;
  body: string;
  owner: string;
  updated_at: number;
}

function ArticleCard({ article, onPress }: { article: WikiArticle; onPress: () => void }) {
  const isDraft = article.owner === 'wiki-draft';
  const date = new Date(article.updated_at * 1000).toLocaleDateString('it');
  return (
    <Pressable
      onPress={onPress}
      className="bg-surface border border-border rounded-2xl p-4 mb-2 active:opacity-70"
    >
      <View className="flex-row items-center justify-between mb-1">
        <Text className="text-white font-semibold flex-1 mr-2" numberOfLines={1}>{article.topic}</Text>
        {isDraft && (
          <View className="bg-yellow-500/20 border border-yellow-500/40 rounded-full px-2 py-0.5">
            <Text className="text-yellow-400 text-xs">bozza</Text>
          </View>
        )}
      </View>
      <Text className="text-muted text-sm leading-5" numberOfLines={2}>{article.body}</Text>
      <Text className="text-muted text-xs mt-2">{date}</Text>
    </Pressable>
  );
}

export default function WikiScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const active = useServers((s) => s.active());
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<WikiArticle | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['wiki', active?.id],
    queryFn: () => new ServerClient(active!).get<WikiArticle[]>('/api/wiki'),
    enabled: !!active,
  });

  const onRefresh = async () => { setRefreshing(true); await refetch(); setRefreshing(false); };

  const articles = Array.isArray(data) ? data : [];

  return (
    <View className="flex-1 bg-bg" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center px-4 py-3 border-b border-border">
        <Pressable onPress={() => router.back()} className="mr-3"><Text className="text-muted text-lg">←</Text></Pressable>
        <Text className="text-white font-semibold text-base flex-1">📚 Wiki</Text>
        <Text className="text-muted text-xs">{articles.length} articoli</Text>
      </View>

      {isLoading && <View className="flex-1 items-center justify-center"><ActivityIndicator color="#888" /></View>}
      {error && <View className="flex-1 items-center justify-center"><Text className="text-red-400">Errore caricamento wiki</Text></View>}

      <FlatList
        data={articles}
        keyExtractor={(a) => a.id}
        renderItem={({ item }) => <ArticleCard article={item} onPress={() => setSelected(item)} />}
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 20 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#888" />}
        ListEmptyComponent={!isLoading ? <Text className="text-muted text-center mt-20">Nessun articolo nel wiki.</Text> : null}
      />

      <Modal visible={!!selected} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSelected(null)}>
        {selected && (
          <View className="flex-1 bg-bg" style={{ paddingTop: insets.top }}>
            <View className="flex-row items-center px-4 py-3 border-b border-border">
              <Pressable onPress={() => setSelected(null)} className="mr-3"><Text className="text-accent">Chiudi</Text></Pressable>
              <Text className="text-white font-semibold flex-1" numberOfLines={1}>{selected.topic}</Text>
            </View>
            <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 20 }}>
              <Text className="text-white text-sm leading-6">{selected.body}</Text>
            </ScrollView>
          </View>
        )}
      </Modal>
    </View>
  );
}
