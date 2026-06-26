import { useState } from 'react';
import { View, Text, TextInput, Pressable, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useServers } from '@/store/servers';
import { ServerClient } from '@/api/client';
import { parsePairing, toProfile } from '@/lib/pair';

// Pair with a server: scan the QR shown in the web dashboard, or enter manually.
export default function Pair() {
  const router = useRouter();
  const addProfile = useServers((s) => s.addProfile);
  const [permission, requestPermission] = useCameraPermissions();
  const [manual, setManual] = useState(false);
  const [url, setUrl] = useState('https://');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [scanned, setScanned] = useState(false);

  async function commit(profileInput: { url: string; token: string; name?: string; certSha256?: string }) {
    if (busy) return;
    setBusy(true);
    const profile = toProfile(profileInput);
    try {
      // Verify before saving so we don't store a dead/wrong pairing.
      await new ServerClient(profile).info();
      addProfile(profile);
      router.replace('/home');
    } catch (e: any) {
      Alert.alert('Pairing fallito', e?.message || 'Server non raggiungibile o token errato.');
      setScanned(false);
    } finally {
      setBusy(false);
    }
  }

  if (manual) {
    return (
      <View className="flex-1 bg-bg px-6 pt-20 gap-4">
        <Text className="text-white text-2xl font-bold">Pairing manuale</Text>
        <Text className="text-muted">URL del server (con porta)</Text>
        <TextInput value={url} onChangeText={setUrl} autoCapitalize="none" autoCorrect={false}
          placeholder="https://wild-berry.tailnet.ts.net:3141" placeholderTextColor="#555"
          className="bg-surface text-white rounded-xl px-4 py-3 border border-border" />
        <Text className="text-muted">Dashboard token</Text>
        <TextInput value={token} onChangeText={setToken} autoCapitalize="none" autoCorrect={false} secureTextEntry
          placeholder="token…" placeholderTextColor="#555"
          className="bg-surface text-white rounded-xl px-4 py-3 border border-border" />
        <Pressable disabled={busy || !token} onPress={() => commit({ url, token })}
          className="bg-accent rounded-xl py-3 items-center mt-2 active:opacity-80">
          <Text className="text-white font-semibold">{busy ? 'Verifico…' : 'Connetti'}</Text>
        </Pressable>
        <Pressable onPress={() => setManual(false)} className="items-center py-2">
          <Text className="text-muted">← Scansiona QR invece</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-bg">
      {permission?.granted ? (
        <CameraView
          style={{ flex: 1 }}
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={({ data }) => {
            if (scanned) return;
            const payload = parsePairing(data);
            if (!payload) return;
            setScanned(true);
            commit(payload);
          }}
        />
      ) : (
        <View className="flex-1 items-center justify-center px-8 gap-4">
          <Text className="text-white text-2xl font-bold">Connetti un server</Text>
          <Text className="text-muted text-center">
            Apri la dashboard WildClaude → Impostazioni → Pairing e inquadra il QR.
          </Text>
          <Pressable onPress={requestPermission} className="bg-accent rounded-xl px-6 py-3 active:opacity-80">
            <Text className="text-white font-semibold">Abilita fotocamera</Text>
          </Pressable>
        </View>
      )}
      <View className="absolute bottom-10 left-0 right-0 items-center">
        <Pressable onPress={() => setManual(true)} className="bg-surface/80 rounded-full px-5 py-2 border border-border">
          <Text className="text-white">Inserisci URL + token manualmente</Text>
        </Pressable>
      </View>
    </View>
  );
}
