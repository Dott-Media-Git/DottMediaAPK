import type {
  ActivityHeatmapDaily,
  DashboardAnalytics,
  LiveSocialStats,
  OutboundStats,
} from '@services/analytics';
import { peekCachedValue, readCachedValue, writeCachedValue } from '@services/localCache';

export type DashboardCacheSnapshot = {
  analytics: DashboardAnalytics;
  outboundStats: OutboundStats;
  liveSocialStats: LiveSocialStats;
  todayLiveSocialStats: LiveSocialStats;
  activityHeatmapRows: ActivityHeatmapDaily[];
  activityHeatmapRestRows: ActivityHeatmapDaily[];
  rollingPerformanceRows: ActivityHeatmapDaily[];
  dailyLiveSocialRows?: ActivityHeatmapDaily[];
};

const DASHBOARD_CACHE_TTL_MS = 1000 * 60 * 60 * 6;

export const buildDashboardCacheKey = (userId?: string, scopeId?: string) =>
  `dott.dashboard.snapshot.v4:${scopeId ?? userId ?? 'guest'}`;

export const readDashboardCache = async (cacheKey: string) =>
  readCachedValue<DashboardCacheSnapshot>(cacheKey, DASHBOARD_CACHE_TTL_MS);

export const peekDashboardCache = (cacheKey: string) =>
  peekCachedValue<DashboardCacheSnapshot>(cacheKey, DASHBOARD_CACHE_TTL_MS);

const dashboardCacheWrites = new Map<string, Promise<void>>();

const snapshotGeneratedAt = (snapshot?: DashboardCacheSnapshot | null) => {
  const parsed = Date.parse(String(snapshot?.liveSocialStats?.generatedAt ?? ''));
  return Number.isFinite(parsed) ? parsed : 0;
};

export const writeDashboardCache = async (cacheKey: string, snapshot: DashboardCacheSnapshot) => {
  const previous = dashboardCacheWrites.get(cacheKey) ?? Promise.resolve();
  const pending = previous
    .catch(() => undefined)
    .then(async () => {
      const existing = peekDashboardCache(cacheKey) ?? (await readDashboardCache(cacheKey));
      if (snapshotGeneratedAt(existing) > snapshotGeneratedAt(snapshot)) {
        return;
      }
      await writeCachedValue(cacheKey, snapshot);
    })
    .finally(() => {
      if (dashboardCacheWrites.get(cacheKey) === pending) {
        dashboardCacheWrites.delete(cacheKey);
      }
    });
  dashboardCacheWrites.set(cacheKey, pending);
  await pending;
};
