import '../global.css';
import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useServers } from '@/store/servers';
import { ServerClient } from '@/api/client';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 10_000 } },
});

export default function RootLayout() {
  const active = useServers((s) => s.active());
  const setInfo = useServers((s) => s.setInfo);

  // Probe the active server for capabilities whenever it changes.
  useEffect(() => {
    if (!active) {
      setInfo(null);
      return;
    }
    let cancelled = false;
    new ServerClient(active)
      .info()
      .then((info) => { if (!cancelled) setInfo(info); })
      .catch(() => { if (!cancelled) setInfo({ caps: [], role: 'unknown', online: false }); });
    return () => { cancelled = true; };
  }, [active?.id]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <StatusBar style="light" />
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#0b0b12' } }} />
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
