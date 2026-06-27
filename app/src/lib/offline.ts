// Polls the active server every 30 s when online, every 10 s when offline,
// and updates the servers store with the freshest info.
import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { useServers } from '@/store/servers';
import { ServerClient } from '@/api/client';

const ONLINE_INTERVAL_MS = 30_000;
const OFFLINE_INTERVAL_MS = 10_000;

export function useServerPoller() {
  const active = useServers((s) => s.active());
  const info = useServers((s) => s.info);
  const setInfo = useServers((s) => s.setInfo);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const probe = async (server: NonNullable<typeof active>) => {
    try {
      const result = await new ServerClient(server).info();
      setInfo(result);
    } catch {
      setInfo({ caps: [], role: 'unknown', online: false });
    }
  };

  useEffect(() => {
    if (!active) return;

    const schedule = () => {
      const delay = info?.online === false ? OFFLINE_INTERVAL_MS : ONLINE_INTERVAL_MS;
      timerRef.current = setTimeout(async () => {
        await probe(active);
        schedule();
      }, delay);
    };

    schedule();

    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') {
        if (timerRef.current) clearTimeout(timerRef.current);
        probe(active).then(schedule);
      }
    });

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      sub.remove();
    };
  }, [active?.id]);
}
