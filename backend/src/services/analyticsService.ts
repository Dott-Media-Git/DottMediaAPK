import admin from 'firebase-admin';
import { firestore } from '../db/firestore';
import { resolveAnalyticsScopeKey, type AnalyticsScope } from './analyticsScope';

export type AnalyticsSummary = {
  leads: number;
  engagement: number;
  conversions: number;
  feedbackScore: number;
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

const RatingWeights: Record<string, number> = {
  active: 1,
  queued: 0.6,
  failed: 0.2,
};

const analyticsRoot = (scope?: AnalyticsScope) =>
  firestore.collection('analytics').doc(resolveAnalyticsScopeKey(scope));

const outboundAnalyticsCollection = (scope?: AnalyticsScope) =>
  analyticsRoot(scope).collection('outboundDaily');
const outboundSummaryDoc = (scope?: AnalyticsScope) =>
  analyticsRoot(scope).collection('summaries').doc('outbound');
const inboundAnalyticsCollection = (scope?: AnalyticsScope) =>
  analyticsRoot(scope).collection('inboundDaily');
const inboundSummaryDoc = (scope?: AnalyticsScope) =>
  analyticsRoot(scope).collection('summaries').doc('inbound');
const engagementAnalyticsCollection = (scope?: AnalyticsScope) =>
  analyticsRoot(scope).collection('engagementDaily');
const engagementSummaryDoc = (scope?: AnalyticsScope) =>
  analyticsRoot(scope).collection('summaries').doc('engagement');
const followupAnalyticsCollection = (scope?: AnalyticsScope) =>
  analyticsRoot(scope).collection('followupsDaily');
const followupSummaryDoc = (scope?: AnalyticsScope) =>
  analyticsRoot(scope).collection('summaries').doc('followups');
const webLeadAnalyticsCollection = (scope?: AnalyticsScope) =>
  analyticsRoot(scope).collection('webLeadsDaily');
const webLeadSummaryDoc = (scope?: AnalyticsScope) =>
  analyticsRoot(scope).collection('summaries').doc('webLeads');
const webTrafficAnalyticsCollection = (scope?: AnalyticsScope) =>
  analyticsRoot(scope).collection('webTrafficDaily');
const webTrafficSummaryDoc = (scope?: AnalyticsScope) =>
  analyticsRoot(scope).collection('summaries').doc('webTraffic');

const hasPositiveMetric = (data: Record<string, unknown>, keys: string[]) =>
  keys.some(key => Number(data[key] ?? 0) > 0);

const buildScopeCandidates = (scope?: AnalyticsScope): AnalyticsScope[] => {
  const candidates: AnalyticsScope[] = [];
  if (scope?.orgId || scope?.scopeId || scope?.userId) {
    candidates.push(scope);
  } else {
    candidates.push({});
  }

  const userId = scope?.userId?.trim();
  if (userId) {
    const userScope: AnalyticsScope = { userId };
    const primaryKey = resolveAnalyticsScopeKey(scope);
    const fallbackKey = resolveAnalyticsScopeKey(userScope);
    if (fallbackKey && fallbackKey !== primaryKey) {
      candidates.push(userScope);
    }
  }

  return candidates;
};

async function readSummaryWithFallback<T extends Record<string, unknown>>(
  summaryDocFactory: (scope?: AnalyticsScope) => SummaryDoc,
  scope: AnalyticsScope | undefined,
  positiveKeys: string[],
): Promise<T> {
  const candidates = buildScopeCandidates(scope);
  let firstSeen: T | null = null;

  for (const candidate of candidates) {
    const snap = await summaryDocFactory(candidate).get();
    if (!snap.exists) continue;
    const data = (snap.data() ?? {}) as T;
    if (!firstSeen) firstSeen = data;
    if (hasPositiveMetric(data, positiveKeys)) {
      return data;
    }
  }

  return (firstSeen ?? {}) as T;
}

export class AnalyticsService {
  async getSummary(userId: string): Promise<AnalyticsSummary> {
    // Mock Data Logic
    if (process.env.ALLOW_MOCK_AUTH === 'true') {
      const mockHistory = Array.from({ length: 14 }).map((_, i) => {
        const date = new Date();
        date.setDate(date.getDate() - i);
        return {
          date: date.toISOString().slice(0, 10),
          leads: Math.floor(Math.random() * 20) + 5,
          engagement: Math.floor(Math.random() * 40) + 30,
          conversions: Math.floor(Math.random() * 5) + 1,
          feedbackScore: Number((4 + Math.random()).toFixed(1)),
        };
      }).reverse();

      return {
        leads: 145,
        engagement: 68,
        conversions: 12,
        feedbackScore: 4.8,
        jobBreakdown: {
          active: 3,
          queued: 5,
          failed: 0,
        },
        recentJobs: [
          { jobId: 'job-123', scenarioId: 'lead-gen-v1', status: 'active', updatedAt: new Date().toISOString() },
          { jobId: 'job-124', scenarioId: 'nurture-seq', status: 'queued', updatedAt: new Date().toISOString() },
          { jobId: 'job-125', scenarioId: 'outreach-bot', status: 'completed', updatedAt: new Date().toISOString() },
        ],
        history: mockHistory,
      };
    }

    try {
      const jobsSnap = await firestore
        .collection('automations')
        .doc(userId)
        .collection('jobs')
        .orderBy('updatedAt', 'desc')
        .limit(15)
        .get();

      let leads = 0;
      let engagement = 0;
      let conversions = 0;
      let feedbackScore = 4.2;
      let active = 0;
      let queued = 0;
      let failed = 0;

      jobsSnap.forEach(doc => {
        const data = doc.data();
        const status = (data.status as string | undefined)?.toLowerCase() ?? 'queued';
        if (status === 'active') active += 1;
        else if (status === 'failed') failed += 1;
        else queued += 1;

        leads += (data.analytics?.leads as number | undefined) ?? 8;
        engagement += (data.analytics?.engagement as number | undefined) ?? 40;
        conversions += (data.analytics?.conversions as number | undefined) ?? 3;
        feedbackScore += RatingWeights[status] ?? 0.5;
      });

      const historySnap = await firestore
        .collection('analytics')
        .doc(userId)
        .collection('daily')
        .orderBy('date', 'desc')
        .limit(14)
        .get();

      const history = historySnap.docs
        .map(doc => {
          const data = doc.data();
          const samples = Number(data.samples ?? 1) || 1;
          return {
            date: (data.date as string) ?? doc.id,
            leads: Math.round(Number(data.leads ?? 0) / samples),
            engagement: Math.round(Number(data.engagement ?? 0) / samples),
            conversions: Math.round(Number(data.conversions ?? 0) / samples),
            feedbackScore: Number(((Number(data.feedbackScore ?? 0) / samples) || 0).toFixed(1)),
          };
        })
        .reverse();

      if (history.length) {
        const divisor = history.length;
        leads = history.reduce((sum, day) => sum + day.leads, 0) / divisor;
        engagement = history.reduce((sum, day) => sum + day.engagement, 0) / divisor;
        conversions = history.reduce((sum, day) => sum + day.conversions, 0) / divisor;
        feedbackScore = history.reduce((sum, day) => sum + day.feedbackScore, 0) / divisor;
      } else {
        const divisor = Math.max(jobsSnap.size, 1);
        leads = leads / divisor;
        engagement = engagement / divisor;
        conversions = conversions / divisor;
        feedbackScore = feedbackScore / divisor;
      }

      return {
        leads: Math.round(leads),
        engagement: Math.round(engagement),
        conversions: Math.round(conversions),
        feedbackScore: Math.min(5, Number(feedbackScore.toFixed(1))),
        jobBreakdown: {
          active,
          queued,
          failed,
        },
        recentJobs: jobsSnap.docs.map(doc => {
          const data = doc.data();
          const updatedAt = data.updatedAt as admin.firestore.Timestamp | undefined;
          return {
            jobId: data.jobId as string,
            scenarioId: (data.scenarioId as string) ?? null,
            status: (data.status as string) ?? 'queued',
            updatedAt: updatedAt ? updatedAt.toDate().toISOString() : undefined,
          };
        }),
        history: history.length
          ? history
          : [
              {
                date: new Date().toISOString().slice(0, 10),
                leads: Math.round(leads),
                engagement: Math.round(engagement),
                conversions: Math.round(conversions),
                feedbackScore: Number(feedbackScore.toFixed(1)),
              },
            ],
      };
    } catch (error) {
      console.warn('Firestore analytics fetch failed, returning fallback data', error);
      // Fallback if Firestore fails even if mock auth is off (or if it crashes during fetch)
      return {
        leads: 0,
        engagement: 0,
        conversions: 0,
        feedbackScore: 0,
        jobBreakdown: { active: 0, queued: 0, failed: 0 },
        recentJobs: [],
        history: []
      };
    }
  }
}

export type OutboundAnalyticsUpdate = {
  prospectsFound?: number;
  messagesSent?: number;
  responders?: number;
  replies?: number;
  positiveReplies?: number;
  conversions?: number;
  demosBooked?: number;
  industryBreakdown?: Record<string, number>;
};

export type OutboundMetric =
  | 'outbound_prospects'
  | 'outbound_sent'
  | 'outbound_responder'
  | 'outbound_reply'
  | 'outbound_positive_reply'
  | 'outbound_converted'
  | 'demos_booked';

export type OutboundMetricMetadata = {
  industry?: string;
  industryBreakdown?: Record<string, number>;
};

type OutboundFallbackStats = {
  prospectsContacted: number;
  responders: number;
  replies: number;
  positiveReplies: number;
  conversions: number;
  demoBookings: number;
};

const outboundFallbackCache = new Map<string, OutboundFallbackStats>();

const outboundScore = (value?: Partial<OutboundFallbackStats>) =>
  Number(value?.prospectsContacted ?? 0) +
  Number(value?.responders ?? 0) +
  Number(value?.replies ?? 0) +
  Number(value?.positiveReplies ?? 0) +
  Number(value?.conversions ?? 0) +
  Number(value?.demoBookings ?? 0);

const getScopeKeys = (scope?: AnalyticsScope) =>
  buildScopeCandidates(scope)
    .map(candidate => resolveAnalyticsScopeKey(candidate))
    .filter((key, index, all) => Boolean(key) && all.indexOf(key) === index);

function readOutboundFallback(scope?: AnalyticsScope): OutboundFallbackStats | null {
  let best: OutboundFallbackStats | null = null;
  let bestScore = 0;
  for (const key of getScopeKeys(scope)) {
    const cached = outboundFallbackCache.get(key);
    const score = outboundScore(cached);
    if (!cached || score <= bestScore) continue;
    best = cached;
    bestScore = score;
  }
  return best;
}

function setOutboundFallback(scope: AnalyticsScope | undefined, stats: OutboundFallbackStats) {
  for (const key of getScopeKeys(scope)) {
    outboundFallbackCache.set(key, stats);
  }
}

function applyOutboundFallbackUpdate(scope: AnalyticsScope | undefined, update: OutboundAnalyticsUpdate) {
  const base =
    readOutboundFallback(scope) ??
    ({
      prospectsContacted: 0,
      responders: 0,
      replies: 0,
      positiveReplies: 0,
      conversions: 0,
      demoBookings: 0,
    } as OutboundFallbackStats);
  const next: OutboundFallbackStats = {
    prospectsContacted: base.prospectsContacted + Number(update.messagesSent ?? 0),
    responders: base.responders + Number(update.responders ?? 0),
    replies: base.replies + Number(update.replies ?? 0),
    positiveReplies: base.positiveReplies + Number(update.positiveReplies ?? 0),
    conversions: base.conversions + Number(update.conversions ?? 0),
    demoBookings: base.demoBookings + Number(update.demosBooked ?? 0),
  };
  setOutboundFallback(scope, next);
}

export async function incrementMetric(
  metric: OutboundMetric,
  amount = 1,
  metadata?: OutboundMetricMetadata,
  scope?: AnalyticsScope
) {
  const update: OutboundAnalyticsUpdate = {};
  if (metric === 'outbound_prospects') update.prospectsFound = amount;
  if (metric === 'outbound_sent') update.messagesSent = amount;
  if (metric === 'outbound_responder') update.responders = amount;
  if (metric === 'outbound_reply') update.replies = amount;
  if (metric === 'outbound_positive_reply') update.positiveReplies = amount;
  if (metric === 'outbound_converted') update.conversions = amount;
  if (metric === 'demos_booked') update.demosBooked = amount;

  const breakdown =
    metadata?.industryBreakdown ??
    (metadata?.industry
      ? {
          [metadata.industry]: amount,
        }
      : undefined);

  if (breakdown) update.industryBreakdown = breakdown;

  await incrementOutboundAnalytics(update, scope);
}

export async function incrementOutboundAnalytics(update: OutboundAnalyticsUpdate, scope?: AnalyticsScope) {
  if (
    !update.prospectsFound &&
    !update.messagesSent &&
    !update.responders &&
    !update.replies &&
    !update.positiveReplies &&
    !update.conversions &&
    !update.demosBooked &&
    !update.industryBreakdown
  ) {
    return;
  }

  applyOutboundFallbackUpdate(scope, update);

  const date = new Date().toISOString().slice(0, 10);
  const docRef = outboundAnalyticsCollection(scope).doc(date);

  try {
    await firestore.runTransaction(async tx => {
      const snap = await tx.get(docRef);
      const existing = snap.exists
        ? (snap.data() as {
            prospectsFound?: number;
            messagesSent?: number;
            responders?: number;
            replies?: number;
            positiveReplies?: number;
            conversions?: number;
            demosBooked?: number;
            industryCounts?: Record<string, number>;
            industryLabels?: Record<string, string>;
            topIndustry?: string | null;
          })
        : {};

      const industryCounts = { ...(existing.industryCounts ?? {}) };
      const industryLabels = { ...(existing.industryLabels ?? {}) };

      if (update.industryBreakdown) {
        Object.entries(update.industryBreakdown).forEach(([industry, value]) => {
          const key = sanitizeIndustryKey(industry);
          if (!key) return;
          industryCounts[key] = (industryCounts[key] ?? 0) + value;
          industryLabels[key] = industry;
        });
      }

      const topIndustryKey = Object.entries(industryCounts)
        .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
        .map(([key]) => key)[0];

      const payload = {
        date,
        prospectsFound: (existing.prospectsFound ?? 0) + (update.prospectsFound ?? 0),
        messagesSent: (existing.messagesSent ?? 0) + (update.messagesSent ?? 0),
        responders: (existing.responders ?? 0) + (update.responders ?? 0),
        replies: (existing.replies ?? 0) + (update.replies ?? 0),
        positiveReplies: (existing.positiveReplies ?? 0) + (update.positiveReplies ?? 0),
        conversions: (existing.conversions ?? 0) + (update.conversions ?? 0),
        demosBooked: (existing.demosBooked ?? 0) + (update.demosBooked ?? 0),
        industryCounts,
        industryLabels,
        topIndustry: topIndustryKey ? industryLabels[topIndustryKey] ?? topIndustryKey : existing.topIndustry ?? null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      tx.set(docRef, payload, { merge: true });
    });

    await outboundSummaryDoc(scope).set(
      {
        prospectsFound: admin.firestore.FieldValue.increment(update.prospectsFound ?? 0),
        messagesSent: admin.firestore.FieldValue.increment(update.messagesSent ?? 0),
        responders: admin.firestore.FieldValue.increment(update.responders ?? 0),
        replies: admin.firestore.FieldValue.increment(update.replies ?? 0),
        positiveReplies: admin.firestore.FieldValue.increment(update.positiveReplies ?? 0),
        conversions: admin.firestore.FieldValue.increment(update.conversions ?? 0),
        demosBooked: admin.firestore.FieldValue.increment(update.demosBooked ?? 0),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  } catch (error) {
    console.warn('Firestore outbound analytics increment failed; using fallback cache', error);
  }
}

function sanitizeIndustryKey(industry?: string) {
  if (!industry) return null;
  return industry
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .slice(0, 50);
}

export type OutboundStats = {
  prospectsContacted: number;
  responders: number;
  replies: number;
  positiveReplies: number;
  conversions: number;
  demoBookings: number;
  conversionRate: number;
};

export async function getOutboundStats(scope?: AnalyticsScope): Promise<OutboundStats> {
  if (process.env.ALLOW_MOCK_AUTH === 'true') {
    return {
      prospectsContacted: 1250,
      responders: 295,
      replies: 340,
      positiveReplies: 85,
      conversions: 42,
      demoBookings: 18,
      conversionRate: 0.03
    };
  }

  try {
    const data = await readSummaryWithFallback<{
      prospectsFound?: number;
      messagesSent?: number;
      responders?: number;
      replies?: number;
      positiveReplies?: number;
      conversions?: number;
      demosBooked?: number;
    }>(outboundSummaryDoc, scope, [
      'prospectsFound',
      'messagesSent',
      'responders',
      'replies',
      'positiveReplies',
      'conversions',
      'demosBooked',
    ]);
    const prospectsContacted = data.messagesSent ?? 0;
    const responders = data.responders ?? data.replies ?? 0;
    const replies = data.replies ?? 0;
    const positiveReplies = data.positiveReplies ?? 0;
    const conversions = data.conversions ?? 0;
    const demoBookings = data.demosBooked ?? 0;
    const conversionRate = prospectsContacted ? conversions / prospectsContacted : 0;
    const result = {
      prospectsContacted,
      responders,
      replies,
      positiveReplies,
      conversions,
      demoBookings,
      conversionRate: Number(conversionRate.toFixed(2)),
    };
    if (outboundScore(result) > 0) {
      setOutboundFallback(scope, result);
      return result;
    }
    const cached = readOutboundFallback(scope);
    if (cached && outboundScore(cached) > 0) {
      const cachedRate = cached.prospectsContacted
        ? cached.conversions / cached.prospectsContacted
        : 0;
      return {
        ...cached,
        conversionRate: Number(cachedRate.toFixed(2)),
      };
    }
    return result;
  } catch (error) {
    console.warn('Firestore outbound stats fetch failed', error);
    const cached = readOutboundFallback(scope);
    if (cached && outboundScore(cached) > 0) {
      const cachedRate = cached.prospectsContacted
        ? cached.conversions / cached.prospectsContacted
        : 0;
      return {
        ...cached,
        conversionRate: Number(cachedRate.toFixed(2)),
      };
    }
    return {
      prospectsContacted: 0,
      responders: 0,
      replies: 0,
      positiveReplies: 0,
      conversions: 0,
      demoBookings: 0,
      conversionRate: 0
    };
  }
}

export type InboundAnalyticsUpdate = {
  messages?: number;
  leads?: number;
  sentimentTotal?: number;
};

export async function incrementInboundAnalytics(update: InboundAnalyticsUpdate, scope?: AnalyticsScope) {
  if (!update.messages && !update.leads && !update.sentimentTotal) return;
  await writeDailySummary(inboundAnalyticsCollection(scope), inboundSummaryDoc(scope), {
    messages: update.messages ?? 0,
    leads: update.leads ?? 0,
    sentimentTotal: update.sentimentTotal ?? 0,
    sentimentSamples: update.messages ?? 0,
  });
}

export type EngagementAnalyticsUpdate = {
  commentsDetected?: number;
  repliesSent?: number;
  conversions?: number;
};

export async function incrementEngagementAnalytics(update: EngagementAnalyticsUpdate, scope?: AnalyticsScope) {
  if (!update.commentsDetected && !update.repliesSent && !update.conversions) return;
  await writeDailySummary(engagementAnalyticsCollection(scope), engagementSummaryDoc(scope), {
    commentsDetected: update.commentsDetected ?? 0,
    repliesSent: update.repliesSent ?? 0,
    conversions: update.conversions ?? 0,
  });
}

export type FollowupAnalyticsUpdate = {
  sent?: number;
  replies?: number;
  conversions?: number;
};

export async function incrementFollowupAnalytics(update: FollowupAnalyticsUpdate, scope?: AnalyticsScope) {
  if (!update.sent && !update.replies && !update.conversions) return;
  await writeDailySummary(followupAnalyticsCollection(scope), followupSummaryDoc(scope), {
    sent: update.sent ?? 0,
    replies: update.replies ?? 0,
    conversions: update.conversions ?? 0,
  });
}

export type WebLeadAnalyticsUpdate = {
  leads?: number;
  messages?: number;
};

export async function incrementWebLeadAnalytics(update: WebLeadAnalyticsUpdate, scope?: AnalyticsScope) {
  if (!update.leads && !update.messages) return;
  await writeDailySummary(webLeadAnalyticsCollection(scope), webLeadSummaryDoc(scope), {
    leads: update.leads ?? 0,
    messages: update.messages ?? 0,
  });
}

export type WebTrafficSource =
  | 'facebook'
  | 'instagram'
  | 'threads'
  | 'x'
  | 'web'
  | 'other';

export type WebTrafficAnalyticsUpdate = {
  visitors?: number;
  interactions?: number;
  redirectClicks?: number;
  source?: string;
};

export type WebTrafficStats = {
  visitors: number;
  interactions: number;
  redirectClicks: number;
  engagementRate: number;
  sourceVisitors: Record<string, number>;
  sourceInteractions: Record<string, number>;
  sourceRedirectClicks: Record<string, number>;
};

type WebTrafficFallbackStats = {
  visitors: number;
  interactions: number;
  redirectClicks: number;
  sourceVisitors: Record<string, number>;
  sourceInteractions: Record<string, number>;
  sourceRedirectClicks: Record<string, number>;
};

const webTrafficFallbackCache = new Map<string, WebTrafficFallbackStats>();

const webTrafficScore = (value?: Partial<WebTrafficFallbackStats>) =>
  Number(value?.visitors ?? 0) +
  Number(value?.interactions ?? 0) +
  Number(value?.redirectClicks ?? 0);

function readWebTrafficFallback(scope?: AnalyticsScope): WebTrafficFallbackStats | null {
  let best: WebTrafficFallbackStats | null = null;
  let bestScore = 0;
  for (const key of getScopeKeys(scope)) {
    const cached = webTrafficFallbackCache.get(key);
    const score = webTrafficScore(cached);
    if (!cached || score <= bestScore) continue;
    best = cached;
    bestScore = score;
  }
  return best;
}

function setWebTrafficFallback(scope: AnalyticsScope | undefined, stats: WebTrafficFallbackStats) {
  for (const key of getScopeKeys(scope)) {
    webTrafficFallbackCache.set(key, stats);
  }
}

function applyWebTrafficFallbackUpdate(
  scope: AnalyticsScope | undefined,
  sourceKey: string,
  visitors: number,
  interactions: number,
  redirectClicks: number,
) {
  const base =
    readWebTrafficFallback(scope) ??
    ({
      visitors: 0,
      interactions: 0,
      redirectClicks: 0,
      sourceVisitors: {},
      sourceInteractions: {},
      sourceRedirectClicks: {},
    } as WebTrafficFallbackStats);

  const sourceVisitors = { ...(base.sourceVisitors ?? {}) };
  const sourceInteractions = { ...(base.sourceInteractions ?? {}) };
  const sourceRedirectClicks = { ...(base.sourceRedirectClicks ?? {}) };
  if (visitors > 0) sourceVisitors[sourceKey] = (sourceVisitors[sourceKey] ?? 0) + visitors;
  if (interactions > 0) sourceInteractions[sourceKey] = (sourceInteractions[sourceKey] ?? 0) + interactions;
  if (redirectClicks > 0) sourceRedirectClicks[sourceKey] = (sourceRedirectClicks[sourceKey] ?? 0) + redirectClicks;

  setWebTrafficFallback(scope, {
    visitors: base.visitors + visitors,
    interactions: base.interactions + interactions,
    redirectClicks: base.redirectClicks + redirectClicks,
    sourceVisitors,
    sourceInteractions,
    sourceRedirectClicks,
  });
}

const normalizeCounterMap = (value: unknown) => {
  if (!value || typeof value !== 'object') return {};
  const entries = Object.entries(value as Record<string, unknown>).map(([key, raw]) => {
    const count = Number(raw ?? 0);
    return [key, Number.isFinite(count) ? count : 0] as const;
  });
  return Object.fromEntries(entries.filter((entry) => entry[1] > 0));
};

const normalizeWebTrafficSource = (value?: string): WebTrafficSource => {
  const raw = (value ?? '').trim().toLowerCase();
  if (!raw) return 'web';
  if (raw.includes('instagram') || raw === 'ig') return 'instagram';
  if (raw.includes('facebook') || raw === 'fb') return 'facebook';
  if (raw.includes('threads')) return 'threads';
  if (raw.includes('twitter') || raw === 'x' || raw.includes('x.com') || raw.includes('t.co')) return 'x';
  if (raw.includes('web') || raw.includes('direct')) return 'web';
  return 'other';
};

export async function incrementWebTrafficAnalytics(update: WebTrafficAnalyticsUpdate, scope?: AnalyticsScope) {
  const visitors = Number(update.visitors ?? 0);
  const interactions = Number(update.interactions ?? 0);
  const redirectClicks = Number(update.redirectClicks ?? 0);
  if (!visitors && !interactions && !redirectClicks) return;

  const sourceKey = normalizeWebTrafficSource(update.source);
  applyWebTrafficFallbackUpdate(scope, sourceKey, visitors, interactions, redirectClicks);

  const date = new Date().toISOString().slice(0, 10);
  const docRef = webTrafficAnalyticsCollection(scope).doc(date);

  try {
    await firestore.runTransaction(async tx => {
      const snap = await tx.get(docRef);
      const existing = snap.exists
        ? (snap.data() as {
            visitors?: number;
            interactions?: number;
            redirectClicks?: number;
            sourceVisitors?: Record<string, number>;
            sourceInteractions?: Record<string, number>;
            sourceRedirectClicks?: Record<string, number>;
          })
        : {};

      const sourceVisitors = { ...(existing.sourceVisitors ?? {}) };
      const sourceInteractions = { ...(existing.sourceInteractions ?? {}) };
      const sourceRedirectClicks = { ...(existing.sourceRedirectClicks ?? {}) };

      if (visitors > 0) {
        sourceVisitors[sourceKey] = (sourceVisitors[sourceKey] ?? 0) + visitors;
      }
      if (interactions > 0) {
        sourceInteractions[sourceKey] = (sourceInteractions[sourceKey] ?? 0) + interactions;
      }
      if (redirectClicks > 0) {
        sourceRedirectClicks[sourceKey] = (sourceRedirectClicks[sourceKey] ?? 0) + redirectClicks;
      }

      tx.set(
        docRef,
        {
          date,
          visitors: (existing.visitors ?? 0) + visitors,
          interactions: (existing.interactions ?? 0) + interactions,
          redirectClicks: (existing.redirectClicks ?? 0) + redirectClicks,
          sourceVisitors,
          sourceInteractions,
          sourceRedirectClicks,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    });

    const summaryPayload: Record<string, unknown> = {
      visitors: admin.firestore.FieldValue.increment(visitors),
      interactions: admin.firestore.FieldValue.increment(interactions),
      redirectClicks: admin.firestore.FieldValue.increment(redirectClicks),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (visitors > 0) {
      summaryPayload[`sourceVisitors.${sourceKey}`] = admin.firestore.FieldValue.increment(visitors);
    }
    if (interactions > 0) {
      summaryPayload[`sourceInteractions.${sourceKey}`] = admin.firestore.FieldValue.increment(interactions);
    }
    if (redirectClicks > 0) {
      summaryPayload[`sourceRedirectClicks.${sourceKey}`] = admin.firestore.FieldValue.increment(redirectClicks);
    }

    await webTrafficSummaryDoc(scope).set(summaryPayload, { merge: true });
  } catch (error) {
    console.warn('Firestore web traffic increment failed; using fallback cache', error);
  }
}

type SummaryDoc = admin.firestore.DocumentReference<admin.firestore.DocumentData>;

async function writeDailySummary(collection: FirebaseFirestore.CollectionReference, summaryDoc: SummaryDoc, counters: Record<string, number>) {
  const date = new Date().toISOString().slice(0, 10);
  const docRef = collection.doc(date);
  const payload: Record<string, unknown> = {
    date,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  Object.entries(counters).forEach(([key, value]) => {
    payload[key] = admin.firestore.FieldValue.increment(value);
  });

  await firestore.runTransaction(async tx => {
    tx.set(docRef, payload, { merge: true });
  });

  await summaryDoc.set(
    Object.fromEntries(
      Object.entries(counters).map(([key, value]) => [key, admin.firestore.FieldValue.increment(value)]),
    ),
    { merge: true },
  );
}

export type InboundStats = {
  messages: number;
  leads: number;
  avgSentiment: number;
  conversionRate: number;
};

export async function getInboundStats(scope?: AnalyticsScope): Promise<InboundStats> {
  try {
    const data = await readSummaryWithFallback<{
      messages?: number;
      leads?: number;
      sentimentTotal?: number;
      sentimentSamples?: number;
    }>(inboundSummaryDoc, scope, ['messages', 'leads', 'sentimentTotal', 'sentimentSamples']);
    const messages = Number(data.messages ?? 0);
    const leads = Number(data.leads ?? 0);
    const sentimentTotal = Number(data.sentimentTotal ?? 0);
    const samples = Number(data.sentimentSamples ?? Math.max(messages, 1));
    const avgSentiment = samples ? sentimentTotal / samples : 0;
    const conversionRate = messages ? leads / messages : 0;
    return {
      messages,
      leads,
      avgSentiment: Number(avgSentiment.toFixed(2)),
      conversionRate: Number(conversionRate.toFixed(2)),
    };
  } catch (error) {
    console.warn('Firestore inbound stats fetch failed', error);
    return {
      messages: 0,
      leads: 0,
      avgSentiment: 0,
      conversionRate: 0,
    };
  }
}

export type EngagementStats = {
  comments: number;
  replies: number;
  conversions: number;
  conversionRate: number;
};

export async function getEngagementStats(scope?: AnalyticsScope): Promise<EngagementStats> {
  try {
    const data = await readSummaryWithFallback<{
      commentsDetected?: number;
      repliesSent?: number;
      conversions?: number;
    }>(engagementSummaryDoc, scope, ['commentsDetected', 'repliesSent', 'conversions']);
    const comments = Number(data.commentsDetected ?? 0);
    const replies = Number(data.repliesSent ?? 0);
    const conversions = Number(data.conversions ?? 0);
    const conversionRate = comments ? conversions / comments : 0;
    return {
      comments,
      replies,
      conversions,
      conversionRate: Number(conversionRate.toFixed(2)),
    };
  } catch (error) {
    console.warn('Firestore engagement stats fetch failed', error);
    return {
      comments: 0,
      replies: 0,
      conversions: 0,
      conversionRate: 0,
    };
  }
}

export type FollowupStats = {
  sent: number;
  replies: number;
  conversions: number;
  replyRate: number;
  conversionRate: number;
};

export async function getFollowupStats(scope?: AnalyticsScope): Promise<FollowupStats> {
  try {
    const data = await readSummaryWithFallback<{
      sent?: number;
      replies?: number;
      conversions?: number;
    }>(followupSummaryDoc, scope, ['sent', 'replies', 'conversions']);
    const sent = Number(data.sent ?? 0);
    const replies = Number(data.replies ?? 0);
    const conversions = Number(data.conversions ?? 0);
    return {
      sent,
      replies,
      conversions,
      replyRate: sent ? Number((replies / sent).toFixed(2)) : 0,
      conversionRate: sent ? Number((conversions / sent).toFixed(2)) : 0,
    };
  } catch (error) {
    console.warn('Firestore follow-up stats fetch failed', error);
    return {
      sent: 0,
      replies: 0,
      conversions: 0,
      replyRate: 0,
      conversionRate: 0,
    };
  }
}

export type WebLeadStats = {
  leads: number;
  messages: number;
  conversionRate: number;
};

export async function getWebLeadStats(scope?: AnalyticsScope): Promise<WebLeadStats> {
  try {
    const data = await readSummaryWithFallback<{
      leads?: number;
      messages?: number;
    }>(webLeadSummaryDoc, scope, ['leads', 'messages']);
    const leads = Number(data.leads ?? 0);
    const messages = Number(data.messages ?? 0);
    const conversionRate = messages ? leads / messages : leads ? 1 : 0;
    return {
      leads,
      messages,
      conversionRate: Number(conversionRate.toFixed(2)),
    };
  } catch (error) {
    console.warn('Firestore web lead stats fetch failed', error);
    return {
      leads: 0,
      messages: 0,
      conversionRate: 0,
    };
  }
}

export async function getWebTrafficStats(scope?: AnalyticsScope): Promise<WebTrafficStats> {
  try {
    const doc = await webTrafficSummaryDoc(scope).get();
    const data = doc.data() ?? {};
    const visitors = Number(data.visitors ?? 0);
    const interactions = Number(data.interactions ?? 0);
    const redirectClicks = Number(data.redirectClicks ?? 0);
    const engagementRate = visitors > 0 ? (interactions / visitors) * 100 : 0;
    const result: WebTrafficStats = {
      visitors,
      interactions,
      redirectClicks,
      engagementRate: Number(engagementRate.toFixed(2)),
      sourceVisitors: normalizeCounterMap(data.sourceVisitors),
      sourceInteractions: normalizeCounterMap(data.sourceInteractions),
      sourceRedirectClicks: normalizeCounterMap(data.sourceRedirectClicks),
    };
    if (webTrafficScore(result) > 0) {
      setWebTrafficFallback(scope, {
        visitors: result.visitors,
        interactions: result.interactions,
        redirectClicks: result.redirectClicks,
        sourceVisitors: result.sourceVisitors,
        sourceInteractions: result.sourceInteractions,
        sourceRedirectClicks: result.sourceRedirectClicks,
      });
      return result;
    }
    const cached = readWebTrafficFallback(scope);
    if (cached && webTrafficScore(cached) > 0) {
      const cachedRate = cached.visitors > 0 ? (cached.interactions / cached.visitors) * 100 : 0;
      return {
        visitors: cached.visitors,
        interactions: cached.interactions,
        redirectClicks: cached.redirectClicks,
        engagementRate: Number(cachedRate.toFixed(2)),
        sourceVisitors: { ...(cached.sourceVisitors ?? {}) },
        sourceInteractions: { ...(cached.sourceInteractions ?? {}) },
        sourceRedirectClicks: { ...(cached.sourceRedirectClicks ?? {}) },
      };
    }
    return result;
  } catch (error) {
    console.warn('Firestore web traffic stats fetch failed', error);
    const cached = readWebTrafficFallback(scope);
    if (cached && webTrafficScore(cached) > 0) {
      const cachedRate = cached.visitors > 0 ? (cached.interactions / cached.visitors) * 100 : 0;
      return {
        visitors: cached.visitors,
        interactions: cached.interactions,
        redirectClicks: cached.redirectClicks,
        engagementRate: Number(cachedRate.toFixed(2)),
        sourceVisitors: { ...(cached.sourceVisitors ?? {}) },
        sourceInteractions: { ...(cached.sourceInteractions ?? {}) },
        sourceRedirectClicks: { ...(cached.sourceRedirectClicks ?? {}) },
      };
    }
    return {
      visitors: 0,
      interactions: 0,
      redirectClicks: 0,
      engagementRate: 0,
      sourceVisitors: {},
      sourceInteractions: {},
      sourceRedirectClicks: {},
    };
  }
}
