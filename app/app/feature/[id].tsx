import { View, Text, Pressable, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter, Stack, Redirect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getFeature } from '@/features/manifest';
import FeaturesSettings from '@/screens/FeaturesSettings';

// Generic feature host. Swaps real screens as phases ship.
// Phase 1: 'talk' → /talk, 'push' → /push-setup
export default function FeatureScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const def = getFeature(String(id));

  if (!def) {
    return <Placeholder insetTop={insets.top} title="Sconosciuto" body="Funzione non trovata nel manifest." onBack={() => router.back()} />;
  }

  // Phase 1 screens with dedicated routes
  if (def.id === 'talk') return <Redirect href="/talk" />;
  if (def.id === 'voice') return <Redirect href="/talk" />;
  if (def.id === 'notifications') return <Redirect href="/push-setup" />;

  if (def.id === 'settings') return <FeaturesSettings />;

  return (
    <Placeholder
      insetTop={insets.top}
      title={`${def.icon} ${def.title}`}
      body={`In arrivo nella Phase ${def.phase}. Lo scheletro modulare è pronto: questo screen verrà sostituito con l'implementazione reale.`}
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
