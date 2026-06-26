import { View, Text, Pressable, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useServers } from '@/store/servers';
import { useFeatures } from '@/store/features';
import { FEATURE_GROUP_ORDER, type FeatureDef } from '@/features/manifest';

// Home: server status + a grid of enabled+supported feature modules, grouped.
// Everything here is derived from the manifest — no hardcoded screen list.
export default function Home() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const active = useServers((s) => s.active());
  const info = useServers((s) => s.info);
  const visible = useFeatures((s) => s.visible);

  const caps = info?.caps ?? [];
  const features = visible(caps);
  const byGroup = FEATURE_GROUP_ORDER
    .map((g) => ({ group: g, items: features.filter((f) => f.group === g) }))
    .filter((x) => x.items.length > 0);

  const online = info?.online ?? false;

  return (
    <ScrollView className="flex-1 bg-bg" contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: 40, paddingHorizontal: 16 }}>
      {/* Header / server status */}
      <Pressable onPress={() => router.push('/servers')} className="flex-row items-center justify-between mb-6">
        <View>
          <Text className="text-white text-2xl font-bold">{info ? '🐺 WildClaude' : '🐺 WildClaude'}</Text>
          <Text className="text-muted text-sm">
            {active?.name ?? 'Nessun server'} · {online ? `online · ${info?.role ?? ''}` : 'offline'}
          </Text>
        </View>
        <View className={`w-3 h-3 rounded-full ${online ? 'bg-green-500' : 'bg-red-500'}`} />
      </Pressable>

      {byGroup.map(({ group, items }) => (
        <View key={group} className="mb-6">
          <Text className="text-muted text-xs uppercase tracking-wider mb-2">{group}</Text>
          <View className="flex-row flex-wrap gap-3">
            {items.map((f) => {
              // Phase 1 features with dedicated routes get direct navigation
              const href = f.id === 'talk' || f.id === 'voice' ? '/talk'
                : f.id === 'notifications' ? '/push-setup'
                : `/feature/${f.id}`;
              return <Tile key={f.id} f={f} onPress={() => router.push(href as any)} />;
            })}
          </View>
        </View>
      ))}

      {byGroup.length === 0 && (
        <Text className="text-muted text-center mt-20">
          {online ? 'Nessuna funzione abilitata. Vai in Settings → Features.' : 'Server non raggiungibile.'}
        </Text>
      )}
    </ScrollView>
  );
}

function Tile({ f, onPress }: { f: FeatureDef; onPress: () => void }) {
  return (
    <Pressable onPress={onPress}
      className="bg-surface border border-border rounded-2xl p-4 active:opacity-70"
      style={{ width: '47%' }}>
      <Text className="text-3xl mb-2">{f.icon}</Text>
      <Text className="text-white font-semibold">{f.title}</Text>
    </Pressable>
  );
}
