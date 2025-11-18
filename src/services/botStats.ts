import { env } from '@services/env';
import type { BotAnalytics, LeadInsights } from '@models/bot';
import { sampleBotAnalytics } from '@constants/botAnalytics';

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
