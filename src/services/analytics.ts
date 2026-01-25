import { env } from '@services/env';
import { getIdToken, isFirebaseEnabled, realtimeDb } from '@services/firebase';
import {
  collection,
  doc,
  getDocs,
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

const sanitizeScopeId = (value?: string) => {
  if (!value) return '';
  return value.trim().replace(/[\\/]/g, '_');
};

export const resolveAnalyticsScopeId = (userId?: string, orgId?: string) => {
  const candidate = sanitizeScopeId(orgId ?? userId);
  const envOrg = sanitizeScopeId(env.analyticsOrgId);
  const envUser = sanitizeScopeId(env.analyticsUserId);
  return candidate || envOrg || envUser || undefined;
};

const resolveScopeKey = (scopeId?: string) => sanitizeScopeId(scopeId) || 'global';

const appendScope = (path: string, scopeId?: string) => {
  const scoped = sanitizeScopeId(scopeId);
  if (!scoped) return path;
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}scopeId=${encodeURIComponent(scoped)}`;
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
  onError?: (err: unknown) => void,
  scopeId?: string
): Unsubscribe | null => {
  if (!isFirebaseEnabled || !realtimeDb) return null;

  const dailyOwner = scopeId ?? userId;
  const dailyRef = query(
    collection(realtimeDb, 'analytics', dailyOwner, 'daily'),
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

type InboundDailyDoc = {
  date?: string;
  leads?: number;
  messages?: number;
  sentimentTotal?: number;
  sentimentSamples?: number;
};

type OutboundDailyDoc = {
  date?: string;
  conversions?: number;
};

type WebLeadDailyDoc = {
  date?: string;
  leads?: number;
  messages?: number;
};

const toScore = (avgSentiment: number) => {
  const clamped = Math.max(-1, Math.min(1, avgSentiment));
  return Number(((clamped + 1) * 2.5).toFixed(1));
};

const buildOrgDashboard = (
  inbound: InboundDailyDoc[],
  outbound: OutboundDailyDoc[],
  webLeads: WebLeadDailyDoc[]
): DashboardAnalytics => {
  const byDate = new Map<string, { inbound?: InboundDailyDoc; outbound?: OutboundDailyDoc; web?: WebLeadDailyDoc }>();
  const push = (entry: { date?: string }, key: 'inbound' | 'outbound' | 'web') => {
    const date = entry.date ?? '';
    if (!date) return;
    const existing = byDate.get(date) ?? {};
    byDate.set(date, { ...existing, [key]: entry });
  };
  inbound.forEach(entry => push(entry, 'inbound'));
  outbound.forEach(entry => push(entry, 'outbound'));
  webLeads.forEach(entry => push(entry, 'web'));

  const dates = Array.from(byDate.keys()).sort();
  const history = dates.slice(-14).map(date => {
    const entry = byDate.get(date) ?? {};
    const inboundLeads = Number(entry.inbound?.leads ?? 0);
    const inboundMessages = Number(entry.inbound?.messages ?? 0);
    const webLeadsCount = Number(entry.web?.leads ?? 0);
    const webMessages = Number(entry.web?.messages ?? 0);
    const totalLeads = inboundLeads + webLeadsCount;
    const totalMessages = inboundMessages + webMessages;
    const engagement = totalMessages ? (totalLeads / totalMessages) * 100 : 0;
    const sentimentSamples = Number(entry.inbound?.sentimentSamples ?? 0);
    const sentimentTotal = Number(entry.inbound?.sentimentTotal ?? 0);
    const avgSentiment = sentimentSamples ? sentimentTotal / sentimentSamples : 0;
    return {
      date,
      leads: totalLeads,
      engagement: Number(engagement.toFixed(1)),
      conversions: Number(entry.outbound?.conversions ?? 0),
      feedbackScore: toScore(avgSentiment),
    };
  });

  const latest = history[history.length - 1];
  return {
    leads: latest?.leads ?? 0,
    engagement: latest?.engagement ?? 0,
    conversions: latest?.conversions ?? 0,
    feedbackScore: latest?.feedbackScore ?? 0,
    jobBreakdown: { active: 0, queued: 0, failed: 0 },
    recentJobs: [],
    history,
  };
};

export const fetchOrgDashboardAnalytics = async (
  scopeId: string | undefined
): Promise<DashboardAnalytics | null> => {
  if (!isFirebaseEnabled || !realtimeDb || !scopeId) return null;
  const inboundRef = query(
    collection(realtimeDb, 'analytics', scopeId, 'inboundDaily'),
    orderBy('date', 'desc'),
    limit(14)
  );
  const outboundRef = query(
    collection(realtimeDb, 'analytics', scopeId, 'outboundDaily'),
    orderBy('date', 'desc'),
    limit(14)
  );
  const webRef = query(
    collection(realtimeDb, 'analytics', scopeId, 'webLeadsDaily'),
    orderBy('date', 'desc'),
    limit(14)
  );

  const [inboundSnap, outboundSnap, webSnap] = await Promise.all([
    getDocs(inboundRef),
    getDocs(outboundRef),
    getDocs(webRef),
  ]);

  const inbound = inboundSnap.docs.map(doc => ({ date: doc.id, ...(doc.data() as InboundDailyDoc) }));
  const outbound = outboundSnap.docs.map(doc => ({ date: doc.id, ...(doc.data() as OutboundDailyDoc) }));
  const webLeads = webSnap.docs.map(doc => ({ date: doc.id, ...(doc.data() as WebLeadDailyDoc) }));
  return buildOrgDashboard(inbound, outbound, webLeads);
};

export const subscribeOrgDashboardAnalytics = (
  scopeId: string | undefined,
  onData: (payload: DashboardAnalytics) => void,
  onError?: (err: unknown) => void
): Unsubscribe | null => {
  if (!isFirebaseEnabled || !realtimeDb || !scopeId) return null;
  const inboundRef = query(
    collection(realtimeDb, 'analytics', scopeId, 'inboundDaily'),
    orderBy('date', 'desc'),
    limit(14)
  );
  const outboundRef = query(
    collection(realtimeDb, 'analytics', scopeId, 'outboundDaily'),
    orderBy('date', 'desc'),
    limit(14)
  );
  const webRef = query(
    collection(realtimeDb, 'analytics', scopeId, 'webLeadsDaily'),
    orderBy('date', 'desc'),
    limit(14)
  );

  let inbound: InboundDailyDoc[] = [];
  let outbound: OutboundDailyDoc[] = [];
  let webLeads: WebLeadDailyDoc[] = [];

  const emit = () => {
    onData(buildOrgDashboard(inbound, outbound, webLeads));
  };

  const unsubInbound = onSnapshot(
    inboundRef,
    snap => {
      inbound = snap.docs.map(doc => ({ date: doc.id, ...(doc.data() as InboundDailyDoc) }));
      emit();
    },
    err => onError?.(err)
  );
  const unsubOutbound = onSnapshot(
    outboundRef,
    snap => {
      outbound = snap.docs.map(doc => ({ date: doc.id, ...(doc.data() as OutboundDailyDoc) }));
      emit();
    },
    err => onError?.(err)
  );
  const unsubWeb = onSnapshot(
    webRef,
    snap => {
      webLeads = snap.docs.map(doc => ({ date: doc.id, ...(doc.data() as WebLeadDailyDoc) }));
      emit();
    },
    err => onError?.(err)
  );

  return () => {
    unsubInbound();
    unsubOutbound();
    unsubWeb();
  };
};

export const fetchOutboundStats = async (userId?: string, scopeId?: string): Promise<OutboundStats | null> => {
  const endpoint = buildApiUrl(appendScope('/api/stats/outbound', scopeId));
  if (!endpoint) return null;
  try {
    const headers = await buildAuthHeader(userId ?? '');
    const response = await fetch(endpoint, { headers });
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
  scopeId: string | undefined,
  onData: (stats: OutboundStats) => void,
  onError?: (err: unknown) => void
): Unsubscribe | null => {
  if (!isFirebaseEnabled || !realtimeDb) return null;
  const summaryRef = doc(realtimeDb, 'analytics', resolveScopeKey(scopeId), 'summaries', 'outbound');
  return onSnapshot(
    summaryRef,
    snap => {
      const data = (snap.data() ?? {}) as any;
      const prospectsContacted = Number(
        data.prospectsContacted ?? data.messagesSent ?? data.prospectsFound ?? 0
      );
      const replies = Number(data.replies ?? 0);
      const conversions = Number(data.conversions ?? 0);
      const positiveReplies = Number(data.positiveReplies ?? replies);
      const demoBookings = Number(data.demosBooked ?? data.demoBookings ?? 0);
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

const simpleFetch = async <T>(path: string, userId?: string, scopeId?: string): Promise<T | null> => {
  const endpoint = buildApiUrl(appendScope(path, scopeId));
  if (!endpoint) return null;
  try {
    const headers = await buildAuthHeader(userId ?? '');
    const response = await fetch(endpoint, { headers });
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

export const fetchInboundStats = (userId?: string, scopeId?: string) =>
  simpleFetch<InboundStats>('/api/stats/inbound', userId, scopeId);
export const fetchEngagementStats = (userId?: string, scopeId?: string) =>
  simpleFetch<EngagementStats>('/api/stats/engagement', userId, scopeId);
export const fetchFollowupStats = (userId?: string, scopeId?: string) =>
  simpleFetch<FollowupStats>('/api/stats/followups', userId, scopeId);
export const fetchWebLeadStats = (userId?: string, scopeId?: string) =>
  simpleFetch<WebLeadStats>('/api/stats/webLeads', userId, scopeId);

export const subscribeWebLeadStats = (
  scopeId: string | undefined,
  onData: (stats: WebLeadStats) => void,
  onError?: (err: unknown) => void
): Unsubscribe | null => {
  if (!isFirebaseEnabled || !realtimeDb) return null;
  const summaryRef = doc(realtimeDb, 'analytics', resolveScopeKey(scopeId), 'summaries', 'webLeads');
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
