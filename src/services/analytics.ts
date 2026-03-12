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
  responders: number;
  replies: number;
  positiveReplies: number;
  conversions: number;
  demoBookings: number;
  conversionRate: number;
};

export type LiveSocialPlatformStats = {
  connected: boolean;
  views: number;
  interactions: number;
  engagementRate: number;
  conversions: number;
  postsAnalyzed: number;
};

export type LiveSocialStats = {
  generatedAt: string;
  lookbackHours: number;
  summary: {
    views: number;
    interactions: number;
    engagementRate: number;
    conversions: number;
  };
  web: {
    visitors: number;
    interactions: number;
    redirectClicks: number;
    engagementRate: number;
  };
  platforms: {
    facebook: LiveSocialPlatformStats;
    instagram: LiveSocialPlatformStats;
    threads: LiveSocialPlatformStats;
    x: LiveSocialPlatformStats;
    web: LiveSocialPlatformStats;
  };
};

export type ActivityHeatmapDaily = {
  date: string;
  views: number;
  interactions: number;
  outbound: number;
  conversions: number;
};

const emptyLiveSocialPlatformStats: LiveSocialPlatformStats = {
  connected: false,
  views: 0,
  interactions: 0,
  engagementRate: 0,
  conversions: 0,
  postsAnalyzed: 0,
};

const emptyLiveSocialStats: LiveSocialStats = {
  generatedAt: new Date(0).toISOString(),
  lookbackHours: 72,
  summary: {
    views: 0,
    interactions: 0,
    engagementRate: 0,
    conversions: 0,
  },
  web: {
    visitors: 0,
    interactions: 0,
    redirectClicks: 0,
    engagementRate: 0,
  },
  platforms: {
    facebook: { ...emptyLiveSocialPlatformStats },
    instagram: { ...emptyLiveSocialPlatformStats },
    threads: { ...emptyLiveSocialPlatformStats },
    x: { ...emptyLiveSocialPlatformStats },
    web: { ...emptyLiveSocialPlatformStats },
  },
};

const toFiniteNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizePlatform = (value: any): LiveSocialPlatformStats => ({
  connected: Boolean(value?.connected),
  views: toFiniteNumber(value?.views),
  interactions: toFiniteNumber(value?.interactions),
  engagementRate: toFiniteNumber(value?.engagementRate),
  conversions: toFiniteNumber(value?.conversions),
  postsAnalyzed: toFiniteNumber(value?.postsAnalyzed),
});

const normalizeLiveSocialStats = (value: any): LiveSocialStats => ({
  generatedAt:
    typeof value?.generatedAt === 'string' && value.generatedAt
      ? value.generatedAt
      : new Date().toISOString(),
  lookbackHours: Math.max(toFiniteNumber(value?.lookbackHours, 72), 1),
  summary: {
    views: toFiniteNumber(value?.summary?.views),
    interactions: toFiniteNumber(value?.summary?.interactions),
    engagementRate: toFiniteNumber(value?.summary?.engagementRate),
    conversions: toFiniteNumber(value?.summary?.conversions),
  },
  web: {
    visitors: toFiniteNumber(value?.web?.visitors),
    interactions: toFiniteNumber(value?.web?.interactions),
    redirectClicks: toFiniteNumber(value?.web?.redirectClicks),
    engagementRate: toFiniteNumber(value?.web?.engagementRate),
  },
  platforms: {
    facebook: normalizePlatform(value?.platforms?.facebook),
    instagram: normalizePlatform(value?.platforms?.instagram),
    threads: normalizePlatform(value?.platforms?.threads),
    x: normalizePlatform(value?.platforms?.x),
    web: normalizePlatform(value?.platforms?.web),
  },
});

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
  messagesSent?: number;
  replies?: number;
  conversions?: number;
};

type WebLeadDailyDoc = {
  date?: string;
  leads?: number;
  messages?: number;
};

type WebTrafficDailyDoc = {
  date?: string;
  visitors?: number;
  interactions?: number;
  redirectClicks?: number;
};

type EngagementDailyDoc = {
  date?: string;
  comments?: number;
  replies?: number;
  conversions?: number;
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

const dashboardActivityScore = (payload: DashboardAnalytics) =>
  payload.history.reduce(
    (acc, row) => acc + Number(row.leads ?? 0) + Number(row.engagement ?? 0) + Number(row.conversions ?? 0),
    0,
  );

const loadOrgDashboardScope = async (scopeKey: string) => {
  const inboundRef = query(
    collection(realtimeDb!, 'analytics', scopeKey, 'inboundDaily'),
    orderBy('date', 'desc'),
    limit(14)
  );
  const outboundRef = query(
    collection(realtimeDb!, 'analytics', scopeKey, 'outboundDaily'),
    orderBy('date', 'desc'),
    limit(14)
  );
  const webRef = query(
    collection(realtimeDb!, 'analytics', scopeKey, 'webLeadsDaily'),
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

export const fetchOrgDashboardAnalytics = async (
  scopeId: string | undefined,
  fallbackScopeId?: string
): Promise<DashboardAnalytics | null> => {
  if (!isFirebaseEnabled || !realtimeDb || !scopeId) return null;
  const primaryScopeKey = resolveScopeKey(scopeId);
  const fallbackScopeKey = fallbackScopeId ? resolveScopeKey(fallbackScopeId) : '';
  const primary = await loadOrgDashboardScope(primaryScopeKey);
  if (!fallbackScopeKey || fallbackScopeKey === primaryScopeKey) return primary;
  const fallback = await loadOrgDashboardScope(fallbackScopeKey);
  return dashboardActivityScore(fallback) > dashboardActivityScore(primary) ? fallback : primary;
};

export const subscribeOrgDashboardAnalytics = (
  scopeId: string | undefined,
  onData: (payload: DashboardAnalytics) => void,
  onError?: (err: unknown) => void,
  fallbackScopeId?: string
): Unsubscribe | null => {
  if (!isFirebaseEnabled || !realtimeDb || !scopeId) return null;
  const primaryScopeKey = resolveScopeKey(scopeId);
  const fallbackScopeKey = fallbackScopeId ? resolveScopeKey(fallbackScopeId) : '';
  const inboundRef = query(
    collection(realtimeDb, 'analytics', primaryScopeKey, 'inboundDaily'),
    orderBy('date', 'desc'),
    limit(14)
  );
  const outboundRef = query(
    collection(realtimeDb, 'analytics', primaryScopeKey, 'outboundDaily'),
    orderBy('date', 'desc'),
    limit(14)
  );
  const webRef = query(
    collection(realtimeDb, 'analytics', primaryScopeKey, 'webLeadsDaily'),
    orderBy('date', 'desc'),
    limit(14)
  );

  let inbound: InboundDailyDoc[] = [];
  let outbound: OutboundDailyDoc[] = [];
  let webLeads: WebLeadDailyDoc[] = [];
  let fallbackInbound: InboundDailyDoc[] = [];
  let fallbackOutbound: OutboundDailyDoc[] = [];
  let fallbackWebLeads: WebLeadDailyDoc[] = [];

  const emit = () => {
    const primary = buildOrgDashboard(inbound, outbound, webLeads);
    const fallback = buildOrgDashboard(fallbackInbound, fallbackOutbound, fallbackWebLeads);
    const preferred =
      dashboardActivityScore(fallback) > dashboardActivityScore(primary) ? fallback : primary;
    onData(preferred);
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
  if (!fallbackScopeKey || fallbackScopeKey === primaryScopeKey) {
    return () => {
      unsubInbound();
      unsubOutbound();
      unsubWeb();
    };
  }

  const fallbackInboundRef = query(
    collection(realtimeDb, 'analytics', fallbackScopeKey, 'inboundDaily'),
    orderBy('date', 'desc'),
    limit(14)
  );
  const fallbackOutboundRef = query(
    collection(realtimeDb, 'analytics', fallbackScopeKey, 'outboundDaily'),
    orderBy('date', 'desc'),
    limit(14)
  );
  const fallbackWebRef = query(
    collection(realtimeDb, 'analytics', fallbackScopeKey, 'webLeadsDaily'),
    orderBy('date', 'desc'),
    limit(14)
  );

  const unsubFallbackInbound = onSnapshot(
    fallbackInboundRef,
    snap => {
      fallbackInbound = snap.docs.map(doc => ({ date: doc.id, ...(doc.data() as InboundDailyDoc) }));
      emit();
    },
    err => onError?.(err)
  );
  const unsubFallbackOutbound = onSnapshot(
    fallbackOutboundRef,
    snap => {
      fallbackOutbound = snap.docs.map(doc => ({ date: doc.id, ...(doc.data() as OutboundDailyDoc) }));
      emit();
    },
    err => onError?.(err)
  );
  const unsubFallbackWeb = onSnapshot(
    fallbackWebRef,
    snap => {
      fallbackWebLeads = snap.docs.map(doc => ({ date: doc.id, ...(doc.data() as WebLeadDailyDoc) }));
      emit();
    },
    err => onError?.(err)
  );

  return () => {
    unsubInbound();
    unsubOutbound();
    unsubWeb();
    unsubFallbackInbound();
    unsubFallbackOutbound();
    unsubFallbackWeb();
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

const parseOutboundSummary = (data: any): OutboundStats => {
  const prospectsContacted = Number(
    data?.prospectsContacted ?? data?.messagesSent ?? data?.prospectsFound ?? 0
  );
  const responders = Number(data?.responders ?? data?.replies ?? 0);
  const replies = Number(data?.replies ?? 0);
  const conversions = Number(data?.conversions ?? 0);
  const positiveReplies = Number(data?.positiveReplies ?? replies);
  const demoBookings = Number(data?.demosBooked ?? data?.demoBookings ?? 0);
  const conversionRate = prospectsContacted ? conversions / prospectsContacted : 0;
  return {
    prospectsContacted,
    responders,
    replies,
    positiveReplies,
    conversions,
    demoBookings,
    conversionRate: Number(conversionRate.toFixed(2)),
  };
};

const outboundStatsScore = (stats: OutboundStats) =>
  stats.prospectsContacted +
  stats.responders +
  stats.replies +
  stats.positiveReplies +
  stats.conversions +
  stats.demoBookings;

export const subscribeOutboundStats = (
  scopeId: string | undefined,
  onData: (stats: OutboundStats) => void,
  onError?: (err: unknown) => void,
  fallbackScopeId?: string
): Unsubscribe | null => {
  if (!isFirebaseEnabled || !realtimeDb) return null;
  const primaryScopeKey = resolveScopeKey(scopeId);
  const fallbackScopeKey = fallbackScopeId ? resolveScopeKey(fallbackScopeId) : '';
  const summaryRef = doc(realtimeDb, 'analytics', primaryScopeKey, 'summaries', 'outbound');
  let primary = parseOutboundSummary({});
  let fallback = parseOutboundSummary({});
  const emit = () => {
    const preferred =
      outboundStatsScore(fallback) > outboundStatsScore(primary) ? fallback : primary;
    onData(preferred);
  };
  const unsubPrimary = onSnapshot(
    summaryRef,
    snap => {
      primary = parseOutboundSummary(snap.data() ?? {});
      emit();
    },
    err => onError?.(err)
  );
  if (!fallbackScopeKey || fallbackScopeKey === primaryScopeKey) {
    return unsubPrimary;
  }
  const fallbackRef = doc(realtimeDb, 'analytics', fallbackScopeKey, 'summaries', 'outbound');
  const unsubFallback = onSnapshot(
    fallbackRef,
    snap => {
      fallback = parseOutboundSummary(snap.data() ?? {});
      emit();
    },
    err => onError?.(err)
  );
  return () => {
    unsubPrimary();
    unsubFallback();
  };
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

export const fetchLiveSocialStats = (
  userId?: string,
  scopeId?: string,
  lookbackHours?: number
) => {
  const query = Number.isFinite(lookbackHours)
    ? `/api/stats/socialLive?lookbackHours=${encodeURIComponent(String(lookbackHours))}`
    : '/api/stats/socialLive';
  return simpleFetch<LiveSocialStats>(query, userId, scopeId).then(stats =>
    stats ? normalizeLiveSocialStats(stats) : { ...emptyLiveSocialStats },
  );
};

export const fetchActivityHeatmap = (userId?: string, scopeId?: string, days = 14) =>
  simpleFetch<ActivityHeatmapDaily[]>(
    `/api/stats/activityHeatmap?days=${encodeURIComponent(String(days))}`,
    userId,
    scopeId,
  ).then(async stats => {
    const normalizedApiRows = Array.isArray(stats)
      ? stats.map((row: any) => ({
          date: String(row?.date ?? ''),
          views: toFiniteNumber(row?.views),
          interactions: toFiniteNumber(row?.interactions),
          outbound: toFiniteNumber(row?.outbound),
          conversions: toFiniteNumber(row?.conversions),
        }))
      : [];

    if (activityHeatmapScore(normalizedApiRows) > 0 || !isFirebaseEnabled || !realtimeDb) {
      return normalizedApiRows;
    }

    try {
      const scopeKeys = Array.from(new Set([resolveScopeKey(scopeId), resolveScopeKey(userId)].filter(Boolean)));
      const candidateRows = await Promise.all(
        scopeKeys.map(scopeKey => loadActivityHeatmapScope(scopeKey, Math.max(days, 7))),
      );
      const merged = new Map<string, ActivityHeatmapDaily>();
      candidateRows.forEach(rows => {
        rows.forEach(row => mergeActivityHeatmapRow(merged, row.date, row));
      });
      const rows = Array.from(merged.values())
        .sort((a, b) => `${a.date}`.localeCompare(`${b.date}`))
        .slice(-Math.max(days, 7));

      return activityHeatmapScore(rows) > 0 ? rows : normalizedApiRows;
    } catch (error) {
      console.warn('Activity heatmap fetch fallback failed', error);
      return normalizedApiRows;
    }
  });

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

const buildActivityHeatmap = (
  webTraffic: WebTrafficDailyDoc[],
  outbound: OutboundDailyDoc[],
  engagement: EngagementDailyDoc[]
): ActivityHeatmapDaily[] => {
  const byDate = new Map<
    string,
    {
      views: number;
      interactions: number;
      outbound: number;
      conversions: number;
    }
  >();

  const ensureDate = (date?: string) => {
    if (!date) return null;
    const existing = byDate.get(date) ?? { views: 0, interactions: 0, outbound: 0, conversions: 0 };
    byDate.set(date, existing);
    return existing;
  };

  webTraffic.forEach(entry => {
    const row = ensureDate(entry.date);
    if (!row) return;
    row.views += Number(entry.visitors ?? 0);
    row.interactions += Number(entry.interactions ?? 0);
  });

  outbound.forEach(entry => {
    const row = ensureDate(entry.date);
    if (!row) return;
    row.outbound += Number(entry.messagesSent ?? entry.replies ?? 0);
    row.conversions += Number(entry.conversions ?? 0);
  });

  engagement.forEach(entry => {
    const row = ensureDate(entry.date);
    if (!row) return;
    row.interactions += Number(entry.comments ?? 0) + Number(entry.replies ?? 0);
    row.conversions += Number(entry.conversions ?? 0);
  });

  return Array.from(byDate.entries())
    .sort((a, b) => `${a[0]}`.localeCompare(`${b[0]}`))
    .slice(-14)
    .map(([date, values]) => ({
      date,
      views: values.views,
      interactions: values.interactions,
      outbound: values.outbound,
      conversions: values.conversions,
    }));
};

const mergeActivityHeatmapRow = (
  target: Map<string, ActivityHeatmapDaily>,
  date: string,
  incoming: Partial<ActivityHeatmapDaily>,
) => {
  if (!date) return;
  const existing =
    target.get(date) ??
    ({
      date,
      views: 0,
      interactions: 0,
      outbound: 0,
      conversions: 0,
    } as ActivityHeatmapDaily);
  existing.views = Math.max(existing.views, Number(incoming.views ?? 0));
  existing.interactions = Math.max(existing.interactions, Number(incoming.interactions ?? 0));
  existing.outbound = Math.max(existing.outbound, Number(incoming.outbound ?? 0));
  existing.conversions = Math.max(existing.conversions, Number(incoming.conversions ?? 0));
  target.set(date, existing);
};

const loadActivityHeatmapScope = async (scopeKey: string, dayLimit: number) => {
  const [webTrafficSnap, outboundSnap, engagementSnap, dailySnap] = await Promise.all([
    getDocs(
      query(collection(realtimeDb!, 'analytics', scopeKey, 'webTrafficDaily'), orderBy('date', 'desc'), limit(dayLimit)),
    ),
    getDocs(
      query(collection(realtimeDb!, 'analytics', scopeKey, 'outboundDaily'), orderBy('date', 'desc'), limit(dayLimit)),
    ),
    getDocs(
      query(collection(realtimeDb!, 'analytics', scopeKey, 'engagementDaily'), orderBy('date', 'desc'), limit(dayLimit)),
    ),
    getDocs(
      query(collection(realtimeDb!, 'analytics', scopeKey, 'daily'), orderBy('date', 'desc'), limit(dayLimit)),
    ),
  ]);

  const byDate = new Map<string, ActivityHeatmapDaily>();

  webTrafficSnap.docs.forEach(docSnap => {
    const data = docSnap.data() as WebTrafficDailyDoc;
    mergeActivityHeatmapRow(byDate, String(data.date ?? docSnap.id ?? ''), {
      views: Number(data.visitors ?? 0),
      interactions: Number(data.interactions ?? 0),
    });
  });

  outboundSnap.docs.forEach(docSnap => {
    const data = docSnap.data() as OutboundDailyDoc;
    mergeActivityHeatmapRow(byDate, String(data.date ?? docSnap.id ?? ''), {
      outbound: Number(data.messagesSent ?? data.replies ?? 0),
      conversions: Number(data.conversions ?? 0),
    });
  });

  engagementSnap.docs.forEach(docSnap => {
    const data = docSnap.data() as EngagementDailyDoc;
    mergeActivityHeatmapRow(byDate, String(data.date ?? docSnap.id ?? ''), {
      interactions: Number(data.comments ?? 0) + Number(data.replies ?? 0),
      conversions: Number(data.conversions ?? 0),
    });
  });

  dailySnap.docs.forEach(docSnap => {
    const data = docSnap.data() as any;
    const samples = Math.max(Number(data.samples ?? 1) || 1, 1);
    mergeActivityHeatmapRow(byDate, String(data.date ?? docSnap.id ?? ''), {
      views: Math.round(Number(data.leads ?? 0) / samples),
      interactions: Math.round(Number(data.engagement ?? 0) / samples),
      outbound: Math.round(Number(data.conversions ?? 0) / samples),
      conversions: Math.round(Number(data.conversions ?? 0) / samples),
    });
  });

  return Array.from(byDate.values())
    .sort((a, b) => `${a.date}`.localeCompare(`${b.date}`))
    .slice(-dayLimit);
};

const activityHeatmapScore = (rows: ActivityHeatmapDaily[]) =>
  rows.reduce(
    (acc, row) =>
      acc +
      Number(row.views ?? 0) +
      Number(row.interactions ?? 0) +
      Number(row.outbound ?? 0) +
      Number(row.conversions ?? 0),
    0,
  );

export const subscribeLiveActivityHeatmap = (
  scopeId: string | undefined,
  onData: (rows: ActivityHeatmapDaily[]) => void,
  onError?: (err: unknown) => void,
  fallbackScopeId?: string
): Unsubscribe | null => {
  if (!isFirebaseEnabled || !realtimeDb) return null;

  const scopeKey = resolveScopeKey(scopeId);
  const fallbackScopeKey = fallbackScopeId ? resolveScopeKey(fallbackScopeId) : '';
  const webTrafficRef = query(
    collection(realtimeDb, 'analytics', scopeKey, 'webTrafficDaily'),
    orderBy('date', 'desc'),
    limit(14)
  );
  const outboundRef = query(
    collection(realtimeDb, 'analytics', scopeKey, 'outboundDaily'),
    orderBy('date', 'desc'),
    limit(14)
  );
  const engagementRef = query(
    collection(realtimeDb, 'analytics', scopeKey, 'engagementDaily'),
    orderBy('date', 'desc'),
    limit(14)
  );

  let webTraffic: WebTrafficDailyDoc[] = [];
  let outbound: OutboundDailyDoc[] = [];
  let engagement: EngagementDailyDoc[] = [];
  let fallbackWebTraffic: WebTrafficDailyDoc[] = [];
  let fallbackOutbound: OutboundDailyDoc[] = [];
  let fallbackEngagement: EngagementDailyDoc[] = [];

  const emit = () => {
    const primaryRows = buildActivityHeatmap(webTraffic, outbound, engagement);
    const fallbackRows = buildActivityHeatmap(fallbackWebTraffic, fallbackOutbound, fallbackEngagement);
    const preferredRows =
      activityHeatmapScore(fallbackRows) > activityHeatmapScore(primaryRows)
        ? fallbackRows
        : primaryRows;
    onData(preferredRows);
  };

  const unsubWebTraffic = onSnapshot(
    webTrafficRef,
    snap => {
      webTraffic = snap.docs.map(doc => ({ date: doc.id, ...(doc.data() as WebTrafficDailyDoc) }));
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

  const unsubEngagement = onSnapshot(
    engagementRef,
    snap => {
      engagement = snap.docs.map(doc => ({ date: doc.id, ...(doc.data() as EngagementDailyDoc) }));
      emit();
    },
    err => onError?.(err)
  );
  if (!fallbackScopeKey || fallbackScopeKey === scopeKey) {
    return () => {
      unsubWebTraffic();
      unsubOutbound();
      unsubEngagement();
    };
  }

  const fallbackWebTrafficRef = query(
    collection(realtimeDb, 'analytics', fallbackScopeKey, 'webTrafficDaily'),
    orderBy('date', 'desc'),
    limit(14)
  );
  const fallbackOutboundRef = query(
    collection(realtimeDb, 'analytics', fallbackScopeKey, 'outboundDaily'),
    orderBy('date', 'desc'),
    limit(14)
  );
  const fallbackEngagementRef = query(
    collection(realtimeDb, 'analytics', fallbackScopeKey, 'engagementDaily'),
    orderBy('date', 'desc'),
    limit(14)
  );

  const unsubFallbackWebTraffic = onSnapshot(
    fallbackWebTrafficRef,
    snap => {
      fallbackWebTraffic = snap.docs.map(doc => ({ date: doc.id, ...(doc.data() as WebTrafficDailyDoc) }));
      emit();
    },
    err => onError?.(err)
  );
  const unsubFallbackOutbound = onSnapshot(
    fallbackOutboundRef,
    snap => {
      fallbackOutbound = snap.docs.map(doc => ({ date: doc.id, ...(doc.data() as OutboundDailyDoc) }));
      emit();
    },
    err => onError?.(err)
  );
  const unsubFallbackEngagement = onSnapshot(
    fallbackEngagementRef,
    snap => {
      fallbackEngagement = snap.docs.map(doc => ({ date: doc.id, ...(doc.data() as EngagementDailyDoc) }));
      emit();
    },
    err => onError?.(err)
  );

  return () => {
    unsubWebTraffic();
    unsubOutbound();
    unsubEngagement();
    unsubFallbackWebTraffic();
    unsubFallbackOutbound();
    unsubFallbackEngagement();
  };
};
