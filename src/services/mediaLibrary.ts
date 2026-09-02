import AsyncStorage from '@react-native-async-storage/async-storage';
import type { UploadedMediaFile } from '@services/social';

export type MediaLibraryAsset = UploadedMediaFile & {
  id: string;
  createdAt: string;
};

const storageKey = (userId: string) => `dott.mediaLibrary.v1:${userId}`;

export const loadMediaLibrary = async (userId: string): Promise<MediaLibraryAsset[]> => {
  const raw = await AsyncStorage.getItem(storageKey(userId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const saveMediaLibrary = async (userId: string, assets: MediaLibraryAsset[]) => {
  await AsyncStorage.setItem(storageKey(userId), JSON.stringify(assets));
};

export const addMediaLibraryFiles = async (userId: string, files: UploadedMediaFile[]) => {
  const current = await loadMediaLibrary(userId);
  const now = new Date().toISOString();
  const incoming = files.map((file, index) => ({
    ...file,
    id: `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: now,
  }));
  const seen = new Set<string>();
  const next = [...incoming, ...current].filter(asset => {
    if (!asset.url || seen.has(asset.url)) return false;
    seen.add(asset.url);
    return true;
  });
  await saveMediaLibrary(userId, next);
  return next;
};
