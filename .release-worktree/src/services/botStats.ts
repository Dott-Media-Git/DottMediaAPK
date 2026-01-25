import { env } from '@services/env';
import type { BotAnalytics, LeadInsights, PlatformName } from '@models/bot';
import { sampleBotAnalytics } from '@constants/botAnalytics';
import { isFirebaseEnabled, realtimeDb } from '@services/firebase';
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

const mergeAnalytics = (analytics: BotAnalytics | null, leadInsights: LeadInsights | null): BotAnalytics => {
  const base = analytics ?? sampleBotAnalytics;
  return {
    ...sampleBotAnalytics,
    ...base,
    charts: {
      dailyMessages: base.charts?.dailyMessages ?? sampleBotAnalytics.charts.dailyMessages,
      weeklyMessagesByPlatform: base.charts?.weeklyMessagesByPlatform ?? sampleBotAnalytics.charts.weeklyMessagesByPlatform,
      leadsByPlatform: base.charts?.leadsByPlatform ?? sampleBotAnalytics.charts.leadsByPlatform
    },
    platformMetrics: base.platformMetrics?.length ? base.platformMetrics : sampleBotAnalytics.platformMetrics,
    categoryBreakdown: base.categoryBreakdown?.length ? base.categoryBreakdown : sampleBotAnalytics.categoryBreakdown,
    activeUsers: base.activeUsers ?? sampleBotAnalytics.activeUsers,
    topConversations: base.topConversations?.length ? base.topConversations : sampleBotAnalytics.topConversations,
    learningEfficiency: base.learningEfficiency ?? sampleBotAnalytics.learningEfficiency,
    leadInsights: leadInsights ?? sampleBotAnalytics.leadInsights
  };
};

export const fetchBotAnalytics = async (): Promise<BotAnalytics> => {
  const endpoint = buildApiUrl('/stats');
  if (!endpoint) {
    return sampleBotAnalytics;
  }
  try {
    const [analyticsResp, leadResp] = await Promise.all([
      fetch(endpoint),
      fetch(buildApiUrl('/stats/leads'))
    ]);
    if (!analyticsResp.ok) {
      console.warn('Failed to fetch bot analytics', analyticsResp.status);
      return sampleBotAnalytics;
    }
    const analyticsPayload = (await analyticsResp.json()) as BotAnalytics;
    let leadInsights: LeadInsights | null = null;
    if (leadResp.ok) {
      leadInsights = (await leadResp.json()) as LeadInsights;
    }
    return mergeAnalytics(analyticsPayload, leadInsights);
  } catch (error) {
    console.warn('Bot analytics network error', error);
    return sampleBotAnalytics;
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
  onData: (payload: BotAnalytics) => void,
  onError?: (err: unknown) => void
): Unsubscribe | null => {
  if (!isFirebaseEnabled || !realtimeDb) return null;
  const statsRef = query(collection(realtimeDb, 'stats'), orderBy('date', 'desc'), limit(7));

  return onSnapshot(
    statsRef,
    snap => {
      const docs = snap.docs.map(doc => ({ id: doc.id, ...(doc.data() as any) }));
      if (docs.length === 0) return;
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
