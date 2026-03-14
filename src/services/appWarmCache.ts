import {
  fetchActivityHeatmap,
  fetchAnalytics,
  fetchLiveSocialStats,
  fetchOrgDashboardAnalytics,
  fetchOutboundStats,
  resolveAnalyticsScopeId,
  type DashboardAnalytics,
  type LiveSocialStats,
  type OutboundStats,
} from '@services/analytics';
import { buildDashboardCacheKey, writeDashboardCache } from '@services/dashboardCache';
import { writeCachedValue } from '@services/localCache';
import { fetchSocialHistory, type SocialHistory } from '@services/social';
import { buildTrendingCacheKey, writeTrendingCache } from '@services/trendsCache';
import { fetchTrendingNews, fetchTrendSources } from '@services/trends';

type WarmPrimaryScreenCachesInput = {
  userId?: string;
  orgId?: string;
  seedAnalytics?: Partial<DashboardAnalytics>;
};

const warmInFlight = new Map<string, Promise<void>>();

const createEmptyAnalytics = (seed?: Partial<DashboardAnalytics>): DashboardAnalytics => ({
  leads: seed?.leads ?? 0,
  engagement: seed?.engagement ?? 0,
  conversions: seed?.conversions ?? 0,
  feedbackScore: seed?.feedbackScore ?? 0,
  jobBreakdown: seed?.jobBreakdown ?? {
    active: 0,
    queued: 0,
    failed: 0,
  },
  recentJobs: seed?.recentJobs ?? [],
  history: seed?.history ?? [],
});

const emptyOutboundStats: OutboundStats = {
  prospectsContacted: 0,
  responders: 0,
  replies: 0,
  positiveReplies: 0,
  conversions: 0,
  demoBookings: 0,
  conversionRate: 0,
};

const emptyLiveSocialStats: LiveSocialStats = {
  generatedAt: new Date(0).toISOString(),
  lookbackHours: 72,
  summary: {
    views: 0,
    interactions: 0,
    engagementRate: 0,
    conversions: 0,
  },
  web: {
    visitors: 0,
    interactions: 0,
    redirectClicks: 0,
    engagementRate: 0,
  },
  platforms: {
    facebook: { connected: false, views: 0, interactions: 0, engagementRate: 0, conversions: 0, postsAnalyzed: 0 },
    instagram: { connected: false, views: 0, interactions: 0, engagementRate: 0, conversions: 0, postsAnalyzed: 0 },
    threads: { connected: false, views: 0, interactions: 0, engagementRate: 0, conversions: 0, postsAnalyzed: 0 },
    x: { connected: false, views: 0, interactions: 0, engagementRate: 0, conversions: 0, postsAnalyzed: 0 },
    web: { connected: false, views: 0, interactions: 0, engagementRate: 0, conversions: 0, postsAnalyzed: 0 },
  },
};

const getHoursSinceMidnight = () => {
  const now = new Date();
  return Math.max(1, now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600);
};

export const warmPrimaryScreenCaches = async ({
  userId,
  orgId,
  seedAnalytics,
}: WarmPrimaryScreenCachesInput) => {
  if (!userId) return;

  const scopeId = resolveAnalyticsScopeId(userId, orgId);
  const warmKey = `${userId}:${scopeId ?? 'default'}`;
  const existing = warmInFlight.get(warmKey);
  if (existing) {
    await existing;
    return;
  }

  const warmTask = (async () => {
    const [
      analyticsResult,
      outboundResult,
      rollingStatsResult,
      todayStatsResult,
      heatmapResult,
      historyResult,
      trendsResult,
      sourcesResult,
    ] = await Promise.allSettled([
      orgId ? fetchOrgDashboardAnalytics(scopeId, userId) : fetchAnalytics(userId),
      fetchOutboundStats(userId, scopeId),
      fetchLiveSocialStats(userId, scopeId, 72),
      fetchLiveSocialStats(userId, scopeId, getHoursSinceMidnight()),
      fetchActivityHeatmap(userId, scopeId, 7),
      fetchSocialHistory(),
      fetchTrendingNews(userId),
      fetchTrendSources(userId),
    ]);

    const analytics =
      analyticsResult.status === 'fulfilled' && analyticsResult.value
        ? analyticsResult.value
        : createEmptyAnalytics(seedAnalytics);
    const outboundStats =
      outboundResult.status === 'fulfilled' && outboundResult.value ? outboundResult.value : emptyOutboundStats;
    const liveSocialStats =
      rollingStatsResult.status === 'fulfilled' && rollingStatsResult.value
        ? rollingStatsResult.value
        : emptyLiveSocialStats;
    const todayLiveSocialStats =
      todayStatsResult.status === 'fulfilled' && todayStatsResult.value
        ? todayStatsResult.value
        : emptyLiveSocialStats;
    const activityHeatmapRows =
      heatmapResult.status === 'fulfilled' && Array.isArray(heatmapResult.value) ? heatmapResult.value : [];

    void writeDashboardCache(buildDashboardCacheKey(userId, scopeId), {
      analytics,
      outboundStats,
      liveSocialStats,
      todayLiveSocialStats,
      activityHeatmapRows,
      activityHeatmapRestRows: activityHeatmapRows,
    });

    if (historyResult.status === 'fulfilled') {
      const history = historyResult.value as SocialHistory;
      void writeCachedValue(`dott.postingHistory.v1:${userId}`, history);
    }

    const candidates =
      trendsResult.status === 'fulfilled' ? trendsResult.value.candidates ?? [] : [];
    const scope =
      trendsResult.status === 'fulfilled' ? trendsResult.value.scope ?? 'global' : 'global';
    const sources =
      sourcesResult.status === 'fulfilled' ? sourcesResult.value.sources ?? [] : [];

    void writeTrendingCache(buildTrendingCacheKey(userId), {
      scope,
      candidates,
      sources,
    });
  })().catch(error => {
    console.warn('Failed to warm primary screen caches', error);
  }).finally(() => {
    warmInFlight.delete(warmKey);
  });

  warmInFlight.set(warmKey, warmTask);
  await warmTask;
};
