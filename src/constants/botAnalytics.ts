import type { BotAnalytics } from '@models/bot';

const today = new Date();
const buildDate = (offset: number) => {
  const d = new Date(today);
  d.setDate(d.getDate() - offset);
  return d.toISOString().slice(5, 10);
};

const platforms = ['whatsapp', 'facebook', 'instagram', 'threads', 'linkedin', 'web'] as const;

export const sampleBotAnalytics: BotAnalytics = {
  summary: {
    totalMessagesToday: 72,
    newLeadsToday: 14,
    mostCommonCategory: 'Lead Inquiry',
    avgResponseTime: 38,
    conversionRate: 0.22,
    avgSentiment: 4.4
  },
  charts: {
    dailyMessages: Array.from({ length: 7 }).map((_, index) => ({
      label: buildDate(6 - index),
      value: 40 + index * 4
    })),
    weeklyMessagesByPlatform: platforms.map((platform, idx) => ({
      platform,
      series: Array.from({ length: 7 }).map((_, index) => ({
        label: buildDate(6 - index),
        value: 10 + idx * 3 + index
      }))
    })),
    leadsByPlatform: platforms.map((platform, idx) => ({
      label: platform,
      value: 2 + idx * 2
    }))
  },
  platformMetrics: platforms.map((platform, idx) => ({
    platform,
    messages: 15 + idx * 5,
    leads: 2 + idx,
    avgResponseTime: 35 + idx * 2,
    avgSentiment: 4.1 + idx * 0.1,
    conversionRate: 0.15 + idx * 0.03
  })),
  categoryBreakdown: [
    { label: 'Lead Inquiry', value: 32 },
    { label: 'Demo Booking', value: 18 },
    { label: 'Support', value: 12 },
    { label: 'General Chat', value: 8 }
  ],
  activeUsers: 58,
  topConversations: [],
  learningEfficiency: 0.68,
  leadInsights: {
    intentBreakdown: [
      { label: 'Lead Inquiry', value: 28 },
      { label: 'Demo Booking', value: 12 },
      { label: 'Support', value: 6 },
      { label: 'General Chat', value: 4 }
    ],
    sentimentBuckets: [
      { label: 'Positive', value: 42 },
      { label: 'Neutral', value: 10 },
      { label: 'Negative', value: 4 }
    ],
    leadTiers: [
      { label: 'hot', value: 12 },
      { label: 'warm', value: 18 },
      { label: 'cold', value: 6 }
    ],
    conversionTrend: Array.from({ length: 7 }).map((_, index) => ({
      label: buildDate(6 - index),
      value: 5 + index
    })),
    responseMix: [
      { label: 'Pricing', value: 18 },
      { label: 'Demo', value: 14 },
      { label: 'Support', value: 8 },
      { label: 'General', value: 6 }
    ],
    followUp: {
      sent: 24,
      pending: 6,
      successRate: 0.8
    },
    outreach: {
      sent: 18,
      replies: 5,
      replyRate: 0.28
    },
    roi: {
      bookings: 9,
      learningEfficiency: 0.68
    }
  }
};
