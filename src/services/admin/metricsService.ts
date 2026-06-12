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

export type AdminLiveSocialAccount = {
  label: string;
  userId: string;
  scopeId?: string;
  email?: string | null;
  status: 'ok' | 'error';
  error?: string;
  stats: {
    generatedAt: string;
    lookbackHours: number;
    summary: {
      views: number;
      interactions: number;
      engagementRate: number;
      conversions: number;
    };
    platforms: {
      facebook: { connected: boolean; views: number; interactions: number; engagementRate: number };
      instagram: { connected: boolean; views: number; interactions: number; engagementRate: number };
      threads: { connected: boolean; views: number; interactions: number; engagementRate: number };
      x: { connected: boolean; views: number; interactions: number; engagementRate: number };
      web: { connected: boolean; views: number; interactions: number; engagementRate: number };
    };
  } | null;
};

export type AdminLiveSocialResponse = {
  generatedAt: string;
  lookbackHours: number;
  rows: AdminLiveSocialAccount[];
};

export const fetchAdminLiveSocial = async (lookbackHours = 720): Promise<AdminLiveSocialResponse> => {
  const payload = await adminFetch(`/admin/live-social?lookbackHours=${encodeURIComponent(String(lookbackHours))}`);
  return payload as AdminLiveSocialResponse;
};
