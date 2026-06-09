import { adminFetch } from './base';

export type AdminMetrics = {
  summary: {
    totalClients: number;
    activeSessions: number;
    newSignupsThisWeek: number;
    connectedClients: number;
  };
  signupsByDay: Array<{ date: string; count: number }>;
  connectedPlatforms: Record<string, number>;
  topActiveAccounts: Array<{ userId: string; email?: string; name?: string; posts: number }>;
  autopostSuccessRate: Record<
    string,
    { posted: number; failed: number; attempted: number; rate: number }
  >;
  weeklyPostVolume: Array<{ date: string; count: number }>;
  aiResponsesSent: number;
  companyKpis: {
    totalAiMessages: number;
    imageGenerations: number;
    crmCampaigns: number;
    leadConversions: number;
  };
  liveFeed: Array<{ id: string; type: 'login' | 'post' | 'reply'; label: string; timestamp: string }>;
  updatedAt: string;
};

export const fetchAdminMetrics = async (): Promise<AdminMetrics> => {
  const payload = await adminFetch('/admin/metrics');
  return payload.metrics as AdminMetrics;
};
