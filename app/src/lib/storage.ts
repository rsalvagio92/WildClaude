// Thin MMKV wrapper with JSON helpers. One store for the whole app.
import { MMKV } from 'react-native-mmkv';

export const storage = new MMKV({ id: 'wildclaude' });

export function getJSON<T>(key: string, fallback: T): T {
  const raw = storage.getString(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function setJSON(key: string, value: unknown): void {
  storage.set(key, JSON.stringify(value));
}

export function remove(key: string): void {
  storage.delete(key);
}
