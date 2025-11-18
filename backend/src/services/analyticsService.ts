import admin from 'firebase-admin';
import { firestore } from '../lib/firebase';

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

const outboundAnalyticsCollection = firestore.collection('analytics').doc('outbound').collection('daily');
const outboundSummaryDoc = firestore.collection('analytics').doc('outboundSummary');
const inboundAnalyticsCollection = firestore.collection('analytics').doc('inbound').collection('daily');
const inboundSummaryDoc = firestore.collection('analytics').doc('inboundSummary');
const engagementAnalyticsCollection = firestore.collection('analytics').doc('engagement').collection('daily');
const engagementSummaryDoc = firestore.collection('analytics').doc('engagementSummary');
const followupAnalyticsCollection = firestore.collection('analytics').doc('followups').collection('daily');
const followupSummaryDoc = firestore.collection('analytics').doc('followupsSummary');
const webLeadAnalyticsCollection = firestore.collection('analytics').doc('webLeads').collection('daily');
const webLeadSummaryDoc = firestore.collection('analytics').doc('webLeadsSummary');

export class AnalyticsService {
  async getSummary(userId: string): Promise<AnalyticsSummary> {
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
  }
}

export type OutboundAnalyticsUpdate = {
  prospectsFound?: number;
  messagesSent?: number;
  replies?: number;
  positiveReplies?: number;
  conversions?: number;
  demosBooked?: number;
  industryBreakdown?: Record<string, number>;
};

export type OutboundMetric =
  | 'outbound_prospects'
  | 'outbound_sent'
  | 'outbound_reply'
  | 'outbound_positive_reply'
  | 'outbound_converted'
  | 'demos_booked';

export type OutboundMetricMetadata = {
  industry?: string;
  industryBreakdown?: Record<string, number>;
};

export async function incrementMetric(metric: OutboundMetric, amount = 1, metadata?: OutboundMetricMetadata) {
  const update: OutboundAnalyticsUpdate = {};
  if (metric === 'outbound_prospects') update.prospectsFound = amount;
  if (metric === 'outbound_sent') update.messagesSent = amount;
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

  await incrementOutboundAnalytics(update);
}

export async function incrementOutboundAnalytics(update: OutboundAnalyticsUpdate) {
  if (
    !update.prospectsFound &&
    !update.messagesSent &&
    !update.replies &&
    !update.positiveReplies &&
    !update.conversions &&
    !update.demosBooked &&
    !update.industryBreakdown
  ) {
    return;
  }

  const date = new Date().toISOString().slice(0, 10);
  const docRef = outboundAnalyticsCollection.doc(date);

  await firestore.runTransaction(async tx => {
    const snap = await tx.get(docRef);
    const existing = snap.exists
      ? (snap.data() as {
          prospectsFound?: number;
          messagesSent?: number;
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

  await outboundSummaryDoc.set(
    {
      prospectsFound: admin.firestore.FieldValue.increment(update.prospectsFound ?? 0),
      messagesSent: admin.firestore.FieldValue.increment(update.messagesSent ?? 0),
      replies: admin.firestore.FieldValue.increment(update.replies ?? 0),
      positiveReplies: admin.firestore.FieldValue.increment(update.positiveReplies ?? 0),
      conversions: admin.firestore.FieldValue.increment(update.conversions ?? 0),
      demosBooked: admin.firestore.FieldValue.increment(update.demosBooked ?? 0),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
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
  replies: number;
  positiveReplies: number;
  conversions: number;
  demoBookings: number;
  conversionRate: number;
};

export async function getOutboundStats(): Promise<OutboundStats> {
  const doc = await outboundSummaryDoc.get();
  const data = doc.exists
    ? (doc.data() as {
        prospectsFound?: number;
        messagesSent?: number;
        replies?: number;
        positiveReplies?: number;
        conversions?: number;
        demosBooked?: number;
      })
    : {};
  const prospectsContacted = data.messagesSent ?? 0;
  const replies = data.replies ?? 0;
  const positiveReplies = data.positiveReplies ?? 0;
  const conversions = data.conversions ?? 0;
  const demoBookings = data.demosBooked ?? 0;
  const conversionRate = prospectsContacted ? conversions / prospectsContacted : 0;
  return {
    prospectsContacted,
    replies,
    positiveReplies,
    conversions,
    demoBookings,
    conversionRate: Number(conversionRate.toFixed(2)),
  };
}

export type InboundAnalyticsUpdate = {
  messages?: number;
  leads?: number;
  sentimentTotal?: number;
};

export async function incrementInboundAnalytics(update: InboundAnalyticsUpdate) {
  if (!update.messages && !update.leads && !update.sentimentTotal) return;
  await writeDailySummary(inboundAnalyticsCollection, inboundSummaryDoc, {
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

export async function incrementEngagementAnalytics(update: EngagementAnalyticsUpdate) {
  if (!update.commentsDetected && !update.repliesSent && !update.conversions) return;
  await writeDailySummary(engagementAnalyticsCollection, engagementSummaryDoc, {
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

export async function incrementFollowupAnalytics(update: FollowupAnalyticsUpdate) {
  if (!update.sent && !update.replies && !update.conversions) return;
  await writeDailySummary(followupAnalyticsCollection, followupSummaryDoc, {
    sent: update.sent ?? 0,
    replies: update.replies ?? 0,
    conversions: update.conversions ?? 0,
  });
}

export type WebLeadAnalyticsUpdate = {
  leads?: number;
  messages?: number;
};

export async function incrementWebLeadAnalytics(update: WebLeadAnalyticsUpdate) {
  if (!update.leads && !update.messages) return;
  await writeDailySummary(webLeadAnalyticsCollection, webLeadSummaryDoc, {
    leads: update.leads ?? 0,
    messages: update.messages ?? 0,
  });
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

export async function getInboundStats(): Promise<InboundStats> {
  const doc = await inboundSummaryDoc.get();
  const data = doc.data() ?? {};
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
}

export type EngagementStats = {
  comments: number;
  replies: number;
  conversions: number;
  conversionRate: number;
};

export async function getEngagementStats(): Promise<EngagementStats> {
  const doc = await engagementSummaryDoc.get();
  const data = doc.data() ?? {};
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
}

export type FollowupStats = {
  sent: number;
  replies: number;
  conversions: number;
  replyRate: number;
  conversionRate: number;
};

export async function getFollowupStats(): Promise<FollowupStats> {
  const doc = await followupSummaryDoc.get();
  const data = doc.data() ?? {};
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
}

export type WebLeadStats = {
  leads: number;
  messages: number;
  conversionRate: number;
};

export async function getWebLeadStats(): Promise<WebLeadStats> {
  const doc = await webLeadSummaryDoc.get();
  const data = doc.data() ?? {};
  const leads = Number(data.leads ?? 0);
  const messages = Number(data.messages ?? 0);
  const conversionRate = messages ? leads / messages : leads ? 1 : 0;
  return {
    leads,
    messages,
    conversionRate: Number(conversionRate.toFixed(2)),
  };
}
