/**
 * Push notifications setup screen.
 *
 * Registers (or updates) the device's Expo push token with the active server.
 * Shown on first launch (from _layout.tsx) or from Settings → Notifications.
 *
 * Registration is idempotent server-side (UPSERT on token), so re-running
 * this screen is safe.
 */

import { useState, useEffect } from 'react';
import { View, Text, Pressable, Switch, ScrollView } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useServers } from '@/store/servers';

// Notification categories the server supports
const CATEGORIES = [
  { id: 'chat', label: 'Risposte chat', description: 'Nuovi messaggi da WildClaude' },
  { id: 'agent', label: 'Agenti', description: 'Task completati, errori' },
  { id: 'system', label: 'Sistema', description: 'Avvisi di sistema, manutenzione' },
];

async function getExpoPushToken(): Promise<string | null> {
  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;
  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') return null;

  const token = await Notifications.getExpoPushTokenAsync({
    projectId: process.env.EXPO_PUBLIC_PROJECT_ID,
  });
  return token.data;
}

export default function PushSetupScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const profile = useServers((s) => s.active());
  const [token, setToken] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [categories, setCategories] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'denied' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getExpoPushToken().then((t) => {
      if (!t) setStatus('denied');
      else setToken(t);
    });
  }, []);

  const save = async () => {
    if (!token || !profile) return;
    setStatus('saving');
    setError(null);
    try {
      const res = await fetch(`${profile.url.replace(/\/$/, '')}/api/push/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${profile.token}`,
        },
        body: JSON.stringify({ token, platform: 'expo', deviceName: 'WildClaude App' }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      // Update prefs
      await fetch(`${profile.url.replace(/\/$/, '')}/api/push/prefs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${profile.token}`,
        },
        body: JSON.stringify({ token, enabled, categories }),
      });

      setStatus('saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore');
      setStatus('error');
    }
  };

  if (status === 'denied') {
    return (
      <View className="flex-1 bg-bg items-center justify-center px-8" style={{ paddingTop: insets.top }}>
        <Text className="text-white text-lg font-semibold mb-3">Notifiche non consentite</Text>
        <Text className="text-muted text-sm text-center mb-6">
          Abilita le notifiche nelle impostazioni di sistema per ricevere aggiornamenti da WildClaude.
        </Text>
        <Pressable onPress={() => router.back()} className="bg-surface border border-border rounded-xl px-6 py-3">
          <Text className="text-white">Chiudi</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-bg"
      contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: 40, paddingHorizontal: 16 }}
    >
      <Pressable onPress={() => router.back()} className="mb-4">
        <Text className="text-muted">← Impostazioni</Text>
      </Pressable>
      <Text className="text-white text-2xl font-bold mb-1">Notifiche</Text>
      <Text className="text-muted mb-6">
        Ricevi aggiornamenti da WildClaude anche quando l'app è chiusa.
      </Text>

      {/* Master toggle */}
      <View className="flex-row items-center justify-between bg-surface border border-border rounded-xl px-4 py-3 mb-5">
        <Text className="text-white font-medium">Abilita notifiche</Text>
        <Switch value={enabled} onValueChange={setEnabled} />
      </View>

      {/* Per-category */}
      <Text className="text-muted text-xs uppercase tracking-wider mb-2">Categorie</Text>
      {CATEGORIES.map((cat) => (
        <View key={cat.id} className="flex-row items-center justify-between bg-surface border border-border rounded-xl px-4 py-3 mb-2">
          <View className="flex-1 pr-3">
            <Text className={`font-medium ${enabled ? 'text-white' : 'text-muted'}`}>{cat.label}</Text>
            <Text className="text-muted text-xs mt-0.5">{cat.description}</Text>
          </View>
          <Switch
            value={categories[cat.id] !== false}
            disabled={!enabled}
            onValueChange={(v) => setCategories((prev) => ({ ...prev, [cat.id]: v }))}
          />
        </View>
      ))}

      {error && <Text className="text-red-400 text-sm mt-3 mb-2">{error}</Text>}

      <Pressable
        onPress={save}
        disabled={!token || status === 'saving'}
        className={`rounded-xl py-3 items-center mt-6 ${
          status === 'saved' ? 'bg-green-600' : 'bg-accent active:opacity-80'
        }`}
      >
        <Text className="text-white font-semibold">
          {status === 'saving' ? 'Salvataggio…' : status === 'saved' ? '✓ Salvato' : 'Salva impostazioni'}
        </Text>
      </Pressable>

      {status === 'saved' && (
        <Pressable onPress={() => router.back()} className="items-center py-3 mt-2">
          <Text className="text-muted">Continua</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}
