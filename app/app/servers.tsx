import { View, Text, Pressable, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useServers } from '@/store/servers';

// Fleet switcher: list paired servers, switch active, add, remove.
export default function Servers() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { profiles, activeId, setActive, removeProfile } = useServers();

  return (
    <ScrollView className="flex-1 bg-bg" contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: 40, paddingHorizontal: 16 }}>
      <Pressable onPress={() => router.back()} className="mb-4"><Text className="text-muted">← Home</Text></Pressable>
      <Text className="text-white text-2xl font-bold mb-6">Server</Text>

      {profiles.map((p) => (
        <View key={p.id} className="flex-row items-center justify-between bg-surface border border-border rounded-xl px-4 py-3 mb-2">
          <Pressable className="flex-1" onPress={() => { setActive(p.id); router.replace('/home'); }}>
            <Text className="text-white font-medium">{p.name} {p.id === activeId ? '· attivo' : ''}</Text>
            <Text className="text-muted text-xs">{p.url}</Text>
          </Pressable>
          <Pressable onPress={() => removeProfile(p.id)} className="px-3 py-1">
            <Text className="text-red-400">Rimuovi</Text>
          </Pressable>
        </View>
      ))}

      <Pressable onPress={() => router.push('/pair')} className="bg-accent rounded-xl py-3 items-center mt-4 active:opacity-80">
        <Text className="text-white font-semibold">+ Aggiungi server</Text>
      </Pressable>
    </ScrollView>
  );
}
