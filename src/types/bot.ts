export type PlatformName = 'whatsapp' | 'facebook' | 'instagram' | 'threads' | 'linkedin' | 'web';

export type BotSummary = {
  totalMessagesToday: number;
  newLeadsToday: number;
  mostCommonCategory: string;
  avgResponseTime: number;
  conversionRate: number;
  avgSentiment: number;
};

export type ChartPoint = {
  label: string;
  value: number;
};

export type BotConversation = {
  conversationId: string;
  user_id: string;
  channel_user_id: string;
  platform: PlatformName;
  intent_category: string;
  response_type: string;
  sentiment_score: number;
  created_at: string;
  meta: {
    name?: string;
    company?: string;
    email?: string;
    interestCategory?: string;
    isLead: boolean;
  };
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: string;
  }>;
};

export type PlatformMetric = {
  platform: PlatformName;
  messages: number;
  leads: number;
  avgResponseTime: number;
  avgSentiment: number;
  conversionRate: number;
};

export type BotAnalytics = {
  summary: BotSummary;
  charts: {
    dailyMessages: ChartPoint[];
    weeklyMessagesByPlatform: Array<{
      platform: PlatformName;
      series: ChartPoint[];
    }>;
    leadsByPlatform: ChartPoint[];
  };
  platformMetrics: PlatformMetric[];
  categoryBreakdown: ChartPoint[];
  activeUsers: number;
  topConversations: BotConversation[];
  learningEfficiency?: number;
  leadInsights?: LeadInsights;
};

export type LeadInsights = {
  intentBreakdown: ChartPoint[];
  sentimentBuckets: ChartPoint[];
  leadTiers: ChartPoint[];
  conversionTrend: ChartPoint[];
  responseMix: ChartPoint[];
  followUp: {
    sent: number;
    pending: number;
    successRate: number;
  };
  outreach: {
    sent: number;
    replies: number;
    replyRate: number;
  };
  roi: {
    bookings: number;
    learningEfficiency: number;
  };
};
