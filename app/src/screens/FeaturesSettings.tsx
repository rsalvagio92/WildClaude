import { View, Text, Switch, ScrollView, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FEATURES, FEATURE_GROUP_ORDER, serverSupports } from '@/features/manifest';
import { useFeatures } from '@/store/features';
import { useServers } from '@/store/servers';

// Settings → Features: flip any feature on/off. Disabled or server-unsupported
// features are not mounted, fetched, or navigable. This is the modular core
// surfaced to the user.
export default function FeaturesSettings() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const overrides = useFeatures((s) => s.overrides);
  const isEnabled = useFeatures((s) => s.isEnabled);
  const setEnabled = useFeatures((s) => s.setEnabled);
  const reset = useFeatures((s) => s.reset);
  const caps = useServers((s) => s.info?.caps ?? []);

  return (
    <ScrollView className="flex-1 bg-bg" contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: 40, paddingHorizontal: 16 }}>
      <Pressable onPress={() => router.back()} className="mb-4"><Text className="text-muted">← Home</Text></Pressable>
      <Text className="text-white text-2xl font-bold mb-1">Funzioni</Text>
      <Text className="text-muted mb-6">Abilita o disabilita ogni modulo. Quelli non supportati dal server attivo sono in grigio.</Text>

      {FEATURE_GROUP_ORDER.map((group) => {
        const items = FEATURES.filter((f) => f.group === group);
        if (!items.length) return null;
        return (
          <View key={group} className="mb-5">
            <Text className="text-muted text-xs uppercase tracking-wider mb-2">{group}</Text>
            {items.map((f) => {
              const supported = serverSupports(f, caps);
              const locked = f.id === 'settings';
              return (
                <View key={f.id} className="flex-row items-center justify-between bg-surface border border-border rounded-xl px-4 py-3 mb-2">
                  <View className="flex-1 pr-3">
                    <Text className={`font-medium ${supported ? 'text-white' : 'text-muted'}`}>{f.icon} {f.title}</Text>
                    {!supported && <Text className="text-muted text-xs mt-0.5">richiede: {f.requiresServerCap.join(', ')}</Text>}
                  </View>
                  <Switch
                    value={isEnabled(f.id) && supported}
                    disabled={!supported || locked}
                    onValueChange={(v) => setEnabled(f.id, v)}
                  />
                </View>
              );
            })}
          </View>
        );
      })}

      <Pressable onPress={reset} className="items-center py-3 mt-2">
        <Text className="text-muted">Ripristina default</Text>
      </Pressable>
    </ScrollView>
  );
}
