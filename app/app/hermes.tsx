import { View, Text, Pressable, ScrollView, ActivityIndicator, TextInput, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { useServers } from '@/store/servers';
import { ServerClient } from '@/api/client';
import { useState } from 'react';

interface BudgetResponse {
  spent: number;
  monthlyBudgetUsd: number;
  percentUsed: number;
}

function ProgressBar({ pct, color = 'bg-accent' }: { pct: number; color?: string }) {
  return (
    <View className="h-3 bg-bg rounded-full overflow-hidden mt-2 mb-2">
      <View className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(100, pct)}%` }} />
    </View>
  );
}

export default function HermesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const active = useServers((s) => s.active());
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['budget', active?.id],
    queryFn: () => new ServerClient(active!).get<BudgetResponse>('/api/budget'),
    enabled: !!active,
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
        <Text className="text-white font-semibold text-base">⚗️ Hermes Lab</Text>
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#888" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 20 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#888" />}
        >
          {data && (
            <>
              {/* Budget Card */}
              <View className="bg-surface border border-border rounded-2xl p-4 mb-4">
                <Text className="text-muted text-xs uppercase tracking-wider mb-3">Monthly Budget</Text>
                <View className="flex-row justify-between items-end mb-1">
                  <Text className="text-white text-3xl font-bold">${data.spent}</Text>
                  <Text className="text-muted text-sm">/ ${data.monthlyBudgetUsd}</Text>
                </View>
                <ProgressBar
                  pct={data.percentUsed}
                  color={data.percentUsed > 80 ? 'bg-red-500' : data.percentUsed > 60 ? 'bg-yellow-500' : 'bg-green-500'}
                />
                <Text className="text-muted text-xs mt-2">{data.percentUsed}% used</Text>
              </View>

              {/* Memory Search */}
              <View className="bg-surface border border-border rounded-2xl p-4 mb-4">
                <Text className="text-muted text-xs uppercase tracking-wider mb-2">Memory Search</Text>
                <TextInput
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  placeholder="Search memories..."
                  placeholderTextColor="#666"
                  className="bg-bg text-white rounded-lg px-3 py-2 mb-2 border border-border"
                />
                <Pressable className="bg-accent/20 border border-accent rounded-lg py-2">
                  <Text className="text-accent text-xs font-semibold text-center">Search</Text>
                </Pressable>
              </View>

              {/* Fine-tune Info */}
              <View className="bg-surface border border-border rounded-2xl p-4">
                <Text className="text-muted text-xs uppercase tracking-wider mb-3">Fine-tune Pipeline</Text>
                <Text className="text-muted text-sm leading-5 mb-3">
                  Select top conversation trajectories to fine-tune a model variant optimized for your task distribution.
                </Text>
                <Pressable className="bg-accent/20 border border-accent rounded-lg py-2">
                  <Text className="text-accent text-xs font-semibold text-center">Estimate Cost</Text>
                </Pressable>
              </View>
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}
