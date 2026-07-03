import AsyncStorage from '@react-native-async-storage/async-storage';

type CacheEnvelope<T> = {
  savedAt: string;
  value: T;
};

const getLocalStorage = () => {
  try {
    if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis) {
      return globalThis.localStorage;
    }
  } catch {
    return null;
  }
  return null;
};

const parseCachedEnvelope = <T>(raw: string | null, key: string, maxAgeMs?: number): CacheEnvelope<T> | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CacheEnvelope<T>;
    if (!parsed || typeof parsed !== 'object' || !('value' in parsed)) {
      return null;
    }
    if (maxAgeMs && parsed.savedAt) {
      const savedAt = Date.parse(parsed.savedAt);
      if (Number.isFinite(savedAt) && Date.now() - savedAt > maxAgeMs) {
        const localStorage = getLocalStorage();
        localStorage?.removeItem(key);
        void AsyncStorage.removeItem(key);
        return null;
      }
    }
    return parsed;
  } catch (error) {
    console.warn(`Failed to parse cache for ${key}`, error);
    return null;
  }
};

export const peekCachedValue = <T>(key: string, maxAgeMs?: number): T | null => {
  const localStorage = getLocalStorage();
  if (!localStorage) return null;
  const envelope = parseCachedEnvelope<T>(localStorage.getItem(key), key, maxAgeMs);
  return envelope?.value ?? null;
};

export const readCachedValue = async <T>(key: string, maxAgeMs?: number): Promise<T | null> => {
  try {
    const raw = await AsyncStorage.getItem(key);
    const envelope = parseCachedEnvelope<T>(raw, key, maxAgeMs);
    return envelope?.value ?? null;
  } catch (error) {
    console.warn(`Failed to read cache for ${key}`, error);
    return null;
  }
};

export const writeCachedValue = async <T>(key: string, value: T): Promise<void> => {
  try {
    const envelope: CacheEnvelope<T> = {
      savedAt: new Date().toISOString(),
      value,
    };
    const serialized = JSON.stringify(envelope);
    const localStorage = getLocalStorage();
    localStorage?.setItem(key, serialized);
    await AsyncStorage.setItem(key, serialized);
  } catch (error) {
    console.warn(`Failed to write cache for ${key}`, error);
  }
};

export const clearCachedValue = async (key: string): Promise<void> => {
  try {
    const localStorage = getLocalStorage();
    localStorage?.removeItem(key);
    await AsyncStorage.removeItem(key);
  } catch (error) {
    console.warn(`Failed to clear cache for ${key}`, error);
  }
};
