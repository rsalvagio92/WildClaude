// Deep link handler for wildclaude:// scheme.
//
// Supported URLs:
//   wildclaude://pair?url=<serverUrl>&token=<token>&name=<name>&cert=<sha256>
//   → same payload the QR pairing flow reads; adds a server profile automatically.
import { useEffect } from 'react';
import * as Linking from 'expo-linking';
import { useServers } from '@/store/servers';
import { parsePairing, toProfile } from '@/lib/pair';

export function useDeepLinks() {
  const addProfile = useServers((s) => s.addProfile);
  const setActive = useServers((s) => s.setActive);

  const handle = (url: string | null) => {
    if (!url) return;
    if (!url.startsWith('wildclaude://pair')) return;
    const payload = parsePairing(url);
    if (!payload) return;
    const profile = toProfile(payload);
    addProfile(profile);
    setActive(profile.id);
  };

  useEffect(() => {
    Linking.getInitialURL().then(handle);
    const sub = Linking.addEventListener('url', ({ url }) => handle(url));
    return () => sub.remove();
  }, []);
}
