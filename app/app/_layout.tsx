import '../global.css';
import { useEffect, useRef } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { useServers } from '@/store/servers';
import { ServerClient } from '@/api/client';
import { ErrorBoundary } from '@/lib/ErrorBoundary';
import { OfflineBanner } from '@/lib/OfflineBanner';
import { useServerPoller } from '@/lib/offline';
import { useDeepLinks } from '@/lib/deeplinks';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 15_000,
      gcTime: 5 * 60_000,       // keep cache 5 min so offline reads work
      networkMode: 'offlineFirst', // return cached data immediately, revalidate in bg
    },
  },
});

function AppCore() {
  const active = useServers((s) => s.active());
  const setInfo = useServers((s) => s.setInfo);
  const registeredServerId = useRef<string | null>(null);

  // Phase 5: deep link pairing + server poller
  useDeepLinks();
  useServerPoller();

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

  // Register push token with the active server on first connect (best-effort).
  useEffect(() => {
    if (!active || registeredServerId.current === active.id) return;
    registeredServerId.current = active.id;

    void (async () => {
      try {
        const { status } = await Notifications.getPermissionsAsync();
        if (status !== 'granted') return;
        const tokenData = await Notifications.getExpoPushTokenAsync({
          projectId: process.env.EXPO_PUBLIC_PROJECT_ID,
        });
        await fetch(`${active.url.replace(/\/$/, '')}/api/push/register`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${active.token}`,
          },
          body: JSON.stringify({
            token: tokenData.data,
            platform: 'expo',
            deviceName: 'WildClaude App',
          }),
        });
      } catch {
        // Non-fatal — user can set it up later from Settings → Notifiche
      }
    })();
  }, [active?.id]);

  return (
    <>
      <StatusBar style="light" />
      <OfflineBanner />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#0b0b12' } }} />
    </>
  );
}

export default function RootLayout() {
  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <QueryClientProvider client={queryClient}>
            <AppCore />
          </QueryClientProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}
