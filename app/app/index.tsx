import { View, ActivityIndicator } from 'react-native';
import { Redirect } from 'expo-router';
import { useServers } from '@/store/servers';

// Entry gate: wait for AsyncStorage hydration, then route based on paired state.
export default function Index() {
  const hydrated = useServers((s) => s.hydrated);
  const active = useServers((s) => s.active());
  if (!hydrated) {
    return (
      <View style={{ flex: 1, backgroundColor: '#0b0b12', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color="#7c5cfc" />
      </View>
    );
  }
  return <Redirect href={active ? '/home' : '/pair'} />;
}
