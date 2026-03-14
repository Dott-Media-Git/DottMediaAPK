import AsyncStorage from '@react-native-async-storage/async-storage';

type CacheEnvelope<T> = {
  savedAt: string;
  value: T;
};

export const readCachedValue = async <T>(key: string, maxAgeMs?: number): Promise<T | null> => {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEnvelope<T>;
    if (!parsed || typeof parsed !== 'object' || !('value' in parsed)) {
      return null;
    }
    if (maxAgeMs && parsed.savedAt) {
      const savedAt = Date.parse(parsed.savedAt);
      if (Number.isFinite(savedAt) && Date.now() - savedAt > maxAgeMs) {
        await AsyncStorage.removeItem(key);
        return null;
      }
    }
    return parsed.value;
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
    await AsyncStorage.setItem(key, JSON.stringify(envelope));
  } catch (error) {
    console.warn(`Failed to write cache for ${key}`, error);
  }
};

export const clearCachedValue = async (key: string): Promise<void> => {
  try {
    await AsyncStorage.removeItem(key);
  } catch (error) {
    console.warn(`Failed to clear cache for ${key}`, error);
  }
};
