import { env } from '@services/env';
import { getIdToken } from '@services/firebase';
import type { CRMAnalytics } from '@models/crm';

export type DashboardAnalytics = CRMAnalytics & {
  jobBreakdown: {
    active: number;
    queued: number;
    failed: number;
  };
  recentJobs: Array<{
    jobId: string;
    scenarioId?: string | null;
    status: string;
    updatedAt?: string;
  }>;
  history: Array<{
    date: string;
    leads: number;
    engagement: number;
    conversions: number;
    feedbackScore: number;
  }>;  
};

export type OutboundStats = {
  prospectsContacted: number;
  replies: number;
  positiveReplies: number;
  conversions: number;
  demoBookings: number;
  conversionRate: number;
};

const buildApiUrl = (path: string) => {
  const base = env.apiUrl?.replace(/\/$/, '') ?? '';
  if (!base) return '';
  return `${base}${path.startsWith('/') ? '' : '/'}${path}`;
};

const buildAuthHeader = async (userId: string) => {
  const headers: Record<string, string> = {};
  const token = await getIdToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  } else if (userId) {
    headers.Authorization = `Bearer mock-${userId}`;
  }
  return headers;
};

export const fetchAnalytics = async (userId: string): Promise<DashboardAnalytics | null> => {
  const endpoint = buildApiUrl('/api/analytics');
  if (!endpoint) {
    return null;
  }

  const headers = await buildAuthHeader(userId);
  if (!headers.Authorization) {
    console.warn('Missing auth token for analytics request');
    return null;
  }

  const response = await fetch(endpoint, {
    headers
  });

  if (!response.ok) {
    console.warn('Failed to fetch analytics', response.status);
    return null;
  }

  const payload = await response.json();
  if (!payload.analytics) return null;
  const analytics: DashboardAnalytics = {
    ...payload.analytics,
    recentJobs: (payload.analytics.recentJobs ?? []).map((job: DashboardAnalytics['recentJobs'][number]) => ({
      ...job,
      updatedAt: job.updatedAt ?? undefined
    })),
    history: payload.analytics.history ?? []
  };
  return analytics;
};

export const fetchOutboundStats = async (): Promise<OutboundStats | null> => {
  const endpoint = buildApiUrl('/api/stats/outbound');
  if (!endpoint) return null;
  try {
    const response = await fetch(endpoint);
    if (!response.ok) {
      console.warn('Failed to fetch outbound stats', response.status);
      return null;
    }
    const payload = await response.json();
    return payload.stats ?? null;
  } catch (error) {
    console.warn('Outbound stats request failed', error);
    return null;
  }
};

export type InboundStats = {
  messages: number;
  leads: number;
  avgSentiment: number;
  conversionRate: number;
};

export type EngagementStats = {
  comments: number;
  replies: number;
  conversions: number;
  conversionRate: number;
};

export type FollowupStats = {
  sent: number;
  replies: number;
  conversions: number;
  replyRate: number;
  conversionRate: number;
};

export type WebLeadStats = {
  leads: number;
  messages: number;
  conversionRate: number;
};

const simpleFetch = async <T>(path: string): Promise<T | null> => {
  const endpoint = buildApiUrl(path);
  if (!endpoint) return null;
  try {
    const response = await fetch(endpoint);
    if (!response.ok) {
      console.warn(`Failed to fetch ${path}`, response.status);
      return null;
    }
    const payload = await response.json();
    return payload.stats ?? null;
  } catch (error) {
    console.warn(`Analytics fetch error for ${path}`, error);
    return null;
  }
};

export const fetchInboundStats = () => simpleFetch<InboundStats>('/api/stats/inbound');
export const fetchEngagementStats = () => simpleFetch<EngagementStats>('/api/stats/engagement');
export const fetchFollowupStats = () => simpleFetch<FollowupStats>('/api/stats/followups');
export const fetchWebLeadStats = () => simpleFetch<WebLeadStats>('/api/stats/webLeads');
