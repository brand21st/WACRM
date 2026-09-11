import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/** Android SecureStore values are capped around 2048 bytes. */
const CHUNK_SIZE = 1800;
const CHUNK_META_PREFIX = 'chunked:';

function webGet(key: string): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(key);
}

function webSet(key: string, value: string): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(key, value);
}

function webRemove(key: string): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(key);
}

async function nativeGet(key: string): Promise<string | null> {
  const raw = await SecureStore.getItemAsync(key);
  if (raw == null) return null;
  if (!raw.startsWith(CHUNK_META_PREFIX)) return raw;

  const count = Number(raw.slice(CHUNK_META_PREFIX.length));
  if (!Number.isFinite(count) || count <= 0) return null;

  const parts: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const part = await SecureStore.getItemAsync(`${key}.${i}`);
    if (part == null) return null;
    parts.push(part);
  }
  return parts.join('');
}

async function nativeRemove(key: string): Promise<void> {
  const raw = await SecureStore.getItemAsync(key);
  if (raw?.startsWith(CHUNK_META_PREFIX)) {
    const count = Number(raw.slice(CHUNK_META_PREFIX.length));
    if (Number.isFinite(count) && count > 0) {
      await Promise.all(
        Array.from({ length: count }, (_, i) => SecureStore.deleteItemAsync(`${key}.${i}`)),
      );
    }
  }
  await SecureStore.deleteItemAsync(key);
}

async function nativeSet(key: string, value: string): Promise<void> {
  await nativeRemove(key);
  if (value.length <= CHUNK_SIZE) {
    await SecureStore.setItemAsync(key, value);
    return;
  }

  const count = Math.ceil(value.length / CHUNK_SIZE);
  await SecureStore.setItemAsync(key, `${CHUNK_META_PREFIX}${count}`);
  await Promise.all(
    Array.from({ length: count }, (_, i) =>
      SecureStore.setItemAsync(`${key}.${i}`, value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE)),
    ),
  );
}

export const secureStoreAdapter = {
  async getItem(key: string): Promise<string | null> {
    if (Platform.OS === 'web') return webGet(key);
    return nativeGet(key);
  },
  async setItem(key: string, value: string): Promise<void> {
    if (Platform.OS === 'web') {
      webSet(key, value);
      return;
    }
    await nativeSet(key, value);
  },
  async removeItem(key: string): Promise<void> {
    if (Platform.OS === 'web') {
      webRemove(key);
      return;
    }
    await nativeRemove(key);
  },
};
