import { Redirect } from 'expo-router';
import { useServers } from '@/store/servers';

// Entry gate: no paired server → pairing screen; otherwise → home.
export default function Index() {
  const active = useServers((s) => s.active());
  return <Redirect href={active ? '/home' : '/pair'} />;
}
