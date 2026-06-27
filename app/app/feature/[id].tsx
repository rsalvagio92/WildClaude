import { View, Text, Pressable, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter, Stack, Redirect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getFeature } from '@/features/manifest';
import FeaturesSettings from '@/screens/FeaturesSettings';

// Feature router — maps manifest IDs to their dedicated screens.
export default function FeatureScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const def = getFeature(String(id));

  if (!def) {
    return <Placeholder insetTop={insets.top} title="Sconosciuto" body="Funzione non trovata nel manifest." onBack={() => router.back()} />;
  }

  // Phase 1
  if (def.id === 'talk' || def.id === 'voice') return <Redirect href="/talk" />;
  if (def.id === 'notifications') return <Redirect href="/push-setup" />;

  // Phase 2 — Fleet & Monitoring
  if (def.id === 'fleet') return <Redirect href="/fleet" />;
  if (def.id === 'vitals') return <Redirect href="/vitals" />;
  if (def.id === 'activity') return <Redirect href="/activity" />;
  if (def.id === 'audit') return <Redirect href="/audit" />;

  // Phase 3 — Knowledge & Agents
  if (def.id === 'memory') return <Redirect href="/memory" />;
  if (def.id === 'wiki') return <Redirect href="/wiki" />;
  if (def.id === 'journal') return <Redirect href="/journal" />;
  if (def.id === 'agents') return <Redirect href="/agents" />;
  if (def.id === 'missions') return <Redirect href="/missions" />;
  if (def.id === 'automation') return <Redirect href="/automation" />;

  // Phase 4 — Dashboards & Ecosystem
  if (def.id === 'dashboards') return <Redirect href="/dashboards" />;
  if (def.id === 'skills') return <Redirect href="/skills" />;
  if (def.id === 'projects') return <Redirect href="/projects" />;

  // System
  if (def.id === 'settings') return <FeaturesSettings />;

  return (
    <Placeholder
      insetTop={insets.top}
      title={`${def.icon} ${def.title}`}
      body="Schermata non ancora disponibile."
      onBack={() => router.back()}
    />
  );
}

function Placeholder({ insetTop, title, body, onBack }: { insetTop: number; title: string; body: string; onBack: () => void }) {
  return (
    <ScrollView className="flex-1 bg-bg" contentContainerStyle={{ paddingTop: insetTop + 12, paddingHorizontal: 16 }}>
      <Stack.Screen options={{ headerShown: false }} />
      <Pressable onPress={onBack} className="mb-6"><Text className="text-muted">← Home</Text></Pressable>
      <Text className="text-white text-2xl font-bold mb-3">{title}</Text>
      <Text className="text-muted leading-6">{body}</Text>
    </ScrollView>
  );
}
