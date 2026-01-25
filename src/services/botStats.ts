import { env } from '@services/env';
import type { BotAnalytics, LeadInsights, PlatformName } from '@models/bot';
import { emptyBotAnalytics } from '@constants/botAnalytics';
import { getIdToken, isFirebaseEnabled, realtimeDb } from '@services/firebase';
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  type Unsubscribe,
} from 'firebase/firestore';

const buildApiUrl = (path: string) => {
  const base = env.apiUrl?.replace(/\/$/, '');
  if (!base) return '';
  return `${base}${path.startsWith('/') ? '' : '/'}${path}`;
};

const sanitizeScopeId = (value?: string) => {
  if (!value) return '';
  return value.trim().replace(/[\\/]/g, '_');
};

const appendScope = (path: string, scopeId?: string) => {
  const scoped = sanitizeScopeId(scopeId);
  if (!scoped) return path;
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}scopeId=${encodeURIComponent(scoped)}`;
};

const buildAuthHeader = async (userId?: string) => {
  const headers: Record<string, string> = {};
  const token = await getIdToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  } else if (userId) {
    headers.Authorization = `Bearer mock-${userId}`;
  }
  return headers;
};

const scopedCollectionId = (base: string, scopeId?: string) => {
  const scoped = sanitizeScopeId(scopeId);
  return scoped ? `${base}_${scoped}` : base;
};

const mergeAnalytics = (analytics: BotAnalytics | null, leadInsights: LeadInsights | null): BotAnalytics => {
  const base = analytics ?? emptyBotAnalytics;
  return {
    ...emptyBotAnalytics,
    ...base,
    charts: {
      dailyMessages: base.charts?.dailyMessages?.length ? base.charts.dailyMessages : emptyBotAnalytics.charts.dailyMessages,
      weeklyMessagesByPlatform: base.charts?.weeklyMessagesByPlatform?.length
        ? base.charts.weeklyMessagesByPlatform
        : emptyBotAnalytics.charts.weeklyMessagesByPlatform,
      leadsByPlatform: base.charts?.leadsByPlatform?.length ? base.charts.leadsByPlatform : emptyBotAnalytics.charts.leadsByPlatform
    },
    platformMetrics: base.platformMetrics?.length ? base.platformMetrics : emptyBotAnalytics.platformMetrics,
    categoryBreakdown: base.categoryBreakdown?.length ? base.categoryBreakdown : emptyBotAnalytics.categoryBreakdown,
    activeUsers: base.activeUsers ?? emptyBotAnalytics.activeUsers,
    topConversations: base.topConversations?.length ? base.topConversations : emptyBotAnalytics.topConversations,
    learningEfficiency: base.learningEfficiency ?? emptyBotAnalytics.learningEfficiency,
    leadInsights: leadInsights ?? base.leadInsights ?? emptyBotAnalytics.leadInsights
  };
};

export const fetchBotAnalytics = async (userId?: string, scopeId?: string): Promise<BotAnalytics> => {
  const endpoint = buildApiUrl(appendScope('/stats', scopeId));
  if (!endpoint) {
    return emptyBotAnalytics;
  }
  try {
    const headers = await buildAuthHeader(userId);
    const [analyticsResp, leadResp] = await Promise.all([
      fetch(endpoint, { headers }),
      fetch(buildApiUrl(appendScope('/stats/leads', scopeId)), { headers })
    ]);
    if (!analyticsResp.ok) {
      console.warn('Failed to fetch bot analytics', analyticsResp.status);
      return emptyBotAnalytics;
    }
    const analyticsPayload = (await analyticsResp.json()) as BotAnalytics;
    let leadInsights: LeadInsights | null = null;
    if (leadResp.ok) {
      leadInsights = (await leadResp.json()) as LeadInsights;
    }
    return mergeAnalytics(analyticsPayload, leadInsights);
  } catch (error) {
    console.warn('Bot analytics network error', error);
    return emptyBotAnalytics;
  }
};

type Platform = PlatformName;

const ensurePlatforms = (platforms: Platform[]) => {
  const unique = new Set(platforms);
  const defaults: Platform[] = ['whatsapp', 'facebook', 'instagram', 'threads', 'linkedin', 'web'];
  defaults.forEach(p => unique.add(p as Platform));
  return Array.from(unique);
};

export const subscribeBotAnalytics = (
  scopeId: string | undefined,
  onData: (payload: BotAnalytics) => void,
  onError?: (err: unknown) => void
): Unsubscribe | null => {
  if (!isFirebaseEnabled || !realtimeDb) return null;
  const statsRef = query(
    collection(realtimeDb, scopedCollectionId('stats', scopeId)),
    orderBy('date', 'desc'),
    limit(7)
  );

  return onSnapshot(
    statsRef,
    snap => {
      const docs = snap.docs.map(doc => ({ id: doc.id, ...(doc.data() as any) }));
      if (docs.length === 0) {
        onData(emptyBotAnalytics);
        return;
      }
      const latest = docs[0];
      const summary = {
        totalMessagesToday: latest.totalMessagesToday ?? 0,
        newLeadsToday: latest.newLeadsToday ?? 0,
        avgResponseTime: latest.responseSamples ? Math.round((latest.responseTimeTotalMs ?? 0) / latest.responseSamples) : 0,
        conversionRate: latest.conversationCount ? (latest.conversionCount ?? 0) / latest.conversationCount : 0,
        avgSentiment: latest.sentimentSamples ? (latest.sentimentTotal ?? 0) / latest.sentimentSamples : 0,
        mostCommonCategory: latest.mostCommonCategory ?? 'general',
      };

      const dailyMessages = docs
        .slice()
        .reverse()
        .map(d => ({ label: d.date?.slice(5) ?? d.id.slice(5), value: Number(d.totalMessagesToday ?? 0) }));

      const platforms = ensurePlatforms(Object.keys(latest.platformBreakdown ?? {}) as Platform[]);
      const weeklyMessagesByPlatform = platforms.map(platform => ({
        platform,
        series: docs
          .slice()
          .reverse()
          .map(d => ({
            label: d.date?.slice(5) ?? d.id.slice(5),
            value: d.platformBreakdown?.[platform]?.messages ?? 0,
          })),
      }));

      const leadsByPlatform = platforms.map(platform => ({
        label: platform,
        value: Number(latest.platformBreakdown?.[platform]?.leads ?? 0),
      }));

      const categoryBreakdown = Object.entries(latest.intentCounts ?? {}).map(([label, value]) => ({
        label,
        value: Number(value ?? 0),
      }));

      const platformMetrics = platforms.map(platform => {
        const stats = latest.platformBreakdown?.[platform] ?? {};
        const responseSamples = stats.responseSamples ?? 1;
        const sentimentSamples = stats.sentimentSamples ?? 1;
        return {
          platform,
          messages: stats.messages ?? 0,
          leads: stats.leads ?? 0,
          avgResponseTime: Math.round((stats.responseTimeTotalMs ?? 0) / responseSamples),
          avgSentiment: Number(((stats.sentimentTotal ?? 0) / sentimentSamples || 0).toFixed(1)),
          conversionRate: stats.messages ? (stats.conversionCount ?? 0) / stats.messages : 0,
        };
      });

      const conversionTrend = docs
        .slice()
        .reverse()
        .map(d => ({ label: d.date?.slice(5) ?? d.id.slice(5), value: Number(d.newLeadsToday ?? 0) }));

      const payload: BotAnalytics = {
        summary: {
          totalMessagesToday: summary.totalMessagesToday,
          newLeadsToday: summary.newLeadsToday,
          avgResponseTime: summary.avgResponseTime,
          conversionRate: Number(summary.conversionRate.toFixed(2)),
          avgSentiment: Number(summary.avgSentiment.toFixed(2)),
          mostCommonCategory: summary.mostCommonCategory,
        },
        charts: {
          dailyMessages,
          weeklyMessagesByPlatform,
          leadsByPlatform,
        },
        platformMetrics,
        categoryBreakdown,
        activeUsers: latest.activeUsers?.length ?? 0,
        topConversations: [],
        learningEfficiency: latest.learningEfficiency ?? summary.avgSentiment,
        leadInsights: {
          intentBreakdown: categoryBreakdown,
          sentimentBuckets: [],
          leadTiers: [],
          conversionTrend,
          responseMix: [],
          followUp: { sent: 0, pending: 0, successRate: 0 },
          outreach: { sent: 0, replies: 0, replyRate: 0 },
          roi: { bookings: 0, learningEfficiency: latest.learningEfficiency ?? summary.avgSentiment },
        },
      };

      onData(payload);
    },
    err => onError?.(err)
  );
};
