import { env } from '@services/env';
import { getIdToken, isFirebaseEnabled, realtimeDb } from '@services/firebase';
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  type Unsubscribe,
} from 'firebase/firestore';
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

export const subscribeAnalytics = (
  userId: string,
  onData: (payload: DashboardAnalytics) => void,
  onError?: (err: unknown) => void
): Unsubscribe | null => {
  if (!isFirebaseEnabled || !realtimeDb) return null;

  const dailyRef = query(
    collection(realtimeDb, 'analytics', userId, 'daily'),
    orderBy('date', 'desc'),
    limit(14)
  );
  const jobsRef = query(
    collection(realtimeDb, 'automations', userId, 'jobs'),
    orderBy('updatedAt', 'desc'),
    limit(15)
  );

  let history: DashboardAnalytics['history'] = [];
  let jobBreakdown: DashboardAnalytics['jobBreakdown'] = { active: 0, queued: 0, failed: 0 };
  let recentJobs: DashboardAnalytics['recentJobs'] = [];

  const emit = () => {
    const latest = history[0];
    if (!latest) return;
    onData({
      leads: latest.leads,
      engagement: latest.engagement,
      conversions: latest.conversions,
      feedbackScore: latest.feedbackScore,
      jobBreakdown,
      recentJobs,
      history: [...history].reverse(), // chronological
    });
  };

  const unsubDaily = onSnapshot(
    dailyRef,
    snap => {
      history = snap.docs.map(doc => {
        const data = doc.data() as any;
        const samples = Number(data.samples ?? 1) || 1;
        return {
          date: (data.date as string) ?? doc.id,
          leads: Math.round(Number(data.leads ?? 0) / samples),
          engagement: Math.round(Number(data.engagement ?? 0) / samples),
          conversions: Math.round(Number(data.conversions ?? 0) / samples),
          feedbackScore: Number(((Number(data.feedbackScore ?? 0) / samples) || 0).toFixed(1)),
        };
      });
      emit();
    },
    err => onError?.(err)
  );

  const unsubJobs = onSnapshot(
    jobsRef,
    snap => {
      jobBreakdown = { active: 0, queued: 0, failed: 0 };
      recentJobs = snap.docs.map(doc => {
        const data = doc.data() as any;
        const status = (data.status as string | undefined)?.toLowerCase() ?? 'queued';
        if (status === 'active') jobBreakdown.active += 1;
        else if (status === 'failed') jobBreakdown.failed += 1;
        else jobBreakdown.queued += 1;
        return {
          jobId: (data.jobId as string) ?? doc.id,
          scenarioId: data.scenarioId as string | undefined,
          status,
          updatedAt: data.updatedAt ? new Date(data.updatedAt.seconds * 1000).toISOString() : undefined,
        };
      });
      emit();
    },
    err => onError?.(err)
  );

  return () => {
    unsubDaily();
    unsubJobs();
  };
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

export const subscribeOutboundStats = (
  onData: (stats: OutboundStats) => void,
  onError?: (err: unknown) => void
): Unsubscribe | null => {
  if (!isFirebaseEnabled || !realtimeDb) return null;
  const summaryRef = doc(realtimeDb, 'analytics', 'outboundSummary');
  return onSnapshot(
    summaryRef,
    snap => {
      const data = (snap.data() ?? {}) as any;
      const prospectsContacted = Number(data.prospectsContacted ?? 0);
      const replies = Number(data.replies ?? 0);
      const conversions = Number(data.conversions ?? 0);
      const positiveReplies = Number(data.positiveReplies ?? replies);
      const demoBookings = Number(data.demoBookings ?? 0);
      const conversionRate = prospectsContacted ? conversions / prospectsContacted : 0;
      onData({
        prospectsContacted,
        replies,
        positiveReplies,
        conversions,
        demoBookings,
        conversionRate: Number(conversionRate.toFixed(2)),
      });
    },
    err => onError?.(err)
  );
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

export const subscribeWebLeadStats = (
  onData: (stats: WebLeadStats) => void,
  onError?: (err: unknown) => void
): Unsubscribe | null => {
  if (!isFirebaseEnabled || !realtimeDb) return null;
  const summaryRef = doc(realtimeDb, 'analytics', 'webLeadsSummary');
  return onSnapshot(
    summaryRef,
    snap => {
      const data = (snap.data() ?? {}) as any;
      const leads = Number(data.leads ?? 0);
      const messages = Number(data.messages ?? 0);
      const conversionRate = messages ? leads / messages : leads ? 1 : 0;
      onData({ leads, messages, conversionRate: Number(conversionRate.toFixed(2)) });
    },
    err => onError?.(err)
  );
};
