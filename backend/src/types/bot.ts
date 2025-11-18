export const IntentCategories = ['Lead Inquiry', 'Support', 'Demo Booking', 'General Chat'] as const;
export type IntentCategory = (typeof IntentCategories)[number];

export const InterestCategories = ['AI CRM', 'Chatbot', 'Lead Generation'] as const;
export type InterestCategory = (typeof InterestCategories)[number];

export const ResponseTypes = ['Pricing', 'Onboarding', 'Demo', 'Support', 'General'] as const;
export type ResponseType = (typeof ResponseTypes)[number];

export const Platforms = ['whatsapp', 'facebook', 'instagram', 'threads', 'linkedin', 'web'] as const;
export type Platform = (typeof Platforms)[number];

export type ConversationMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
};

export type LeadProfile = {
  name?: string;
  company?: string;
  email?: string;
  interestCategory?: InterestCategory;
  phone?: string;
  goal?: string;
  budget?: string;
};

export type ConversationRecord = {
  conversationId: string;
  user_id: string;
  channel_user_id: string;
  platform: Platform;
  messages: ConversationMessage[];
  sentiment_score: number;
  intent_category: IntentCategory;
  response_type: ResponseType;
  created_at: string;
  updated_at: string;
  meta: LeadProfile & {
    isLead: boolean;
    leadScore?: number;
    leadTier?: 'hot' | 'warm' | 'cold';
  };
};

export type BotSessionSummary = {
  conversation: ConversationRecord;
  responseTimeMs: number;
  isLead: boolean;
  leadScore: number;
  leadTier: 'hot' | 'warm' | 'cold';
};

export type PlatformStats = {
  messages: number;
  leads: number;
  responseTimeTotalMs: number;
  responseSamples: number;
  sentimentTotal: number;
  sentimentSamples: number;
  conversionCount: number;
};

export type BotStatsDocument = {
  date: string;
  totalMessagesToday: number;
  newLeadsToday: number;
  responseTimeTotalMs: number;
  responseSamples: number;
  intentCounts: Record<IntentCategory, number>;
  responseTypeCounts: Record<ResponseType, number>;
  activeUsers: string[];
  activeUsersByPlatform: Record<Platform, string[]>;
  sentimentTotal: number;
  sentimentSamples: number;
  conversionCount: number;
  platformBreakdown: Record<Platform, PlatformStats>;
  mostCommonCategory: IntentCategory;
  avgResponseTime: number;
  conversionRate: number;
  learningEfficiency?: number;
};

export type BotSummary = {
  totalMessagesToday: number;
  newLeadsToday: number;
  mostCommonCategory: IntentCategory;
  avgResponseTime: number;
  conversionRate: number;
  avgSentiment: number;
};

export type ChartPoint = {
  label: string;
  value: number;
};

export type PlatformMetric = {
  platform: Platform;
  messages: number;
  leads: number;
  avgResponseTime: number;
  avgSentiment: number;
  conversionRate: number;
};

export type BotAnalyticsPayload = {
  summary: BotSummary;
  charts: {
    dailyMessages: ChartPoint[];
    weeklyMessagesByPlatform: Array<{
      platform: Platform;
      series: ChartPoint[];
    }>;
    leadsByPlatform: ChartPoint[];
  };
  platformMetrics: PlatformMetric[];
  categoryBreakdown: ChartPoint[];
  activeUsers: number;
  topConversations: ConversationRecord[];
  learningEfficiency?: number;
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

export type WhatsAppTextMessage = {
  from: string;
  id: string;
  timestamp: string;
  text: { body: string };
  type: 'text';
};

export type WhatsAppWebhookPayload = {
  entry?: Array<{
    id?: string;
    changes?: Array<{
      value?: {
        contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>;
        messages?: WhatsAppTextMessage[];
        metadata?: { phone_number_id?: string };
      };
    }>;
  }>;
};

export type MakeLeadPayload = {
  name?: string;
  email?: string;
  phoneNumber: string;
  company?: string;
  intentCategory: IntentCategory;
  interestCategory?: InterestCategory;
  platform: Platform | 'app';
  source: 'whatsapp' | 'app' | Platform;
  goal?: string;
  budget?: string;
  leadScore?: number;
  leadTier?: 'hot' | 'warm' | 'cold';
};
