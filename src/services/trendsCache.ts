import { readCachedValue, writeCachedValue } from '@services/localCache';
import type { TrendCandidate, TrendSourceInput } from '@services/trends';

export type TrendsCacheSnapshot = {
  scope: 'global' | 'football';
  candidates: TrendCandidate[];
  sources: TrendSourceInput[];
  connectedSources?: string[];
};

const TRENDS_CACHE_TTL_MS = 1000 * 60 * 60 * 2;

export const buildTrendingCacheKey = (userId?: string) => `dott.trendingNews.v1:${userId ?? 'guest'}`;

export const readTrendingCache = async (cacheKey: string) =>
  readCachedValue<TrendsCacheSnapshot>(cacheKey, TRENDS_CACHE_TTL_MS);

export const writeTrendingCache = async (cacheKey: string, snapshot: TrendsCacheSnapshot) =>
  writeCachedValue(cacheKey, snapshot);
