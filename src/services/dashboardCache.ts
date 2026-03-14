import type {
  ActivityHeatmapDaily,
  DashboardAnalytics,
  LiveSocialStats,
  OutboundStats,
} from '@services/analytics';
import { readCachedValue, writeCachedValue } from '@services/localCache';

export type DashboardCacheSnapshot = {
  analytics: DashboardAnalytics;
  outboundStats: OutboundStats;
  liveSocialStats: LiveSocialStats;
  todayLiveSocialStats: LiveSocialStats;
  activityHeatmapRows: ActivityHeatmapDaily[];
  activityHeatmapRestRows: ActivityHeatmapDaily[];
};

const DASHBOARD_CACHE_TTL_MS = 1000 * 60 * 60 * 6;

export const buildDashboardCacheKey = (userId?: string, scopeId?: string) =>
  `dott.dashboard.snapshot.v1:${scopeId ?? userId ?? 'guest'}`;

export const readDashboardCache = async (cacheKey: string) =>
  readCachedValue<DashboardCacheSnapshot>(cacheKey, DASHBOARD_CACHE_TTL_MS);

export const writeDashboardCache = async (cacheKey: string, snapshot: DashboardCacheSnapshot) =>
  writeCachedValue(cacheKey, snapshot);
