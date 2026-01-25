import admin from 'firebase-admin';
import { firestore } from '../db/firestore.js';
import { resolveAnalyticsScopeKey } from './analyticsScope.js';
const RatingWeights = {
    active: 1,
    queued: 0.6,
    failed: 0.2,
};
const analyticsRoot = (scope) => firestore.collection('analytics').doc(resolveAnalyticsScopeKey(scope));
const outboundAnalyticsCollection = (scope) => analyticsRoot(scope).collection('outboundDaily');
const outboundSummaryDoc = (scope) => analyticsRoot(scope).collection('summaries').doc('outbound');
const inboundAnalyticsCollection = (scope) => analyticsRoot(scope).collection('inboundDaily');
const inboundSummaryDoc = (scope) => analyticsRoot(scope).collection('summaries').doc('inbound');
const engagementAnalyticsCollection = (scope) => analyticsRoot(scope).collection('engagementDaily');
const engagementSummaryDoc = (scope) => analyticsRoot(scope).collection('summaries').doc('engagement');
const followupAnalyticsCollection = (scope) => analyticsRoot(scope).collection('followupsDaily');
const followupSummaryDoc = (scope) => analyticsRoot(scope).collection('summaries').doc('followups');
const webLeadAnalyticsCollection = (scope) => analyticsRoot(scope).collection('webLeadsDaily');
const webLeadSummaryDoc = (scope) => analyticsRoot(scope).collection('summaries').doc('webLeads');
export class AnalyticsService {
    async getSummary(userId) {
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
                const status = data.status?.toLowerCase() ?? 'queued';
                if (status === 'active')
                    active += 1;
                else if (status === 'failed')
                    failed += 1;
                else
                    queued += 1;
                leads += data.analytics?.leads ?? 8;
                engagement += data.analytics?.engagement ?? 40;
                conversions += data.analytics?.conversions ?? 3;
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
                    date: data.date ?? doc.id,
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
            }
            else {
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
                    const updatedAt = data.updatedAt;
                    return {
                        jobId: data.jobId,
                        scenarioId: data.scenarioId ?? null,
                        status: data.status ?? 'queued',
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
        catch (error) {
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
export async function incrementMetric(metric, amount = 1, metadata, scope) {
    const update = {};
    if (metric === 'outbound_prospects')
        update.prospectsFound = amount;
    if (metric === 'outbound_sent')
        update.messagesSent = amount;
    if (metric === 'outbound_reply')
        update.replies = amount;
    if (metric === 'outbound_positive_reply')
        update.positiveReplies = amount;
    if (metric === 'outbound_converted')
        update.conversions = amount;
    if (metric === 'demos_booked')
        update.demosBooked = amount;
    const breakdown = metadata?.industryBreakdown ??
        (metadata?.industry
            ? {
                [metadata.industry]: amount,
            }
            : undefined);
    if (breakdown)
        update.industryBreakdown = breakdown;
    await incrementOutboundAnalytics(update, scope);
}
export async function incrementOutboundAnalytics(update, scope) {
    if (!update.prospectsFound &&
        !update.messagesSent &&
        !update.replies &&
        !update.positiveReplies &&
        !update.conversions &&
        !update.demosBooked &&
        !update.industryBreakdown) {
        return;
    }
    const date = new Date().toISOString().slice(0, 10);
    const docRef = outboundAnalyticsCollection(scope).doc(date);
    await firestore.runTransaction(async (tx) => {
        const snap = await tx.get(docRef);
        const existing = snap.exists
            ? snap.data()
            : {};
        const industryCounts = { ...(existing.industryCounts ?? {}) };
        const industryLabels = { ...(existing.industryLabels ?? {}) };
        if (update.industryBreakdown) {
            Object.entries(update.industryBreakdown).forEach(([industry, value]) => {
                const key = sanitizeIndustryKey(industry);
                if (!key)
                    return;
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
    await outboundSummaryDoc(scope).set({
        prospectsFound: admin.firestore.FieldValue.increment(update.prospectsFound ?? 0),
        messagesSent: admin.firestore.FieldValue.increment(update.messagesSent ?? 0),
        replies: admin.firestore.FieldValue.increment(update.replies ?? 0),
        positiveReplies: admin.firestore.FieldValue.increment(update.positiveReplies ?? 0),
        conversions: admin.firestore.FieldValue.increment(update.conversions ?? 0),
        demosBooked: admin.firestore.FieldValue.increment(update.demosBooked ?? 0),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
}
function sanitizeIndustryKey(industry) {
    if (!industry)
        return null;
    return industry
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .slice(0, 50);
}
export async function getOutboundStats(scope) {
    if (process.env.ALLOW_MOCK_AUTH === 'true') {
        return {
            prospectsContacted: 1250,
            replies: 340,
            positiveReplies: 85,
            conversions: 42,
            demoBookings: 18,
            conversionRate: 0.03
        };
    }
    try {
        const doc = await outboundSummaryDoc(scope).get();
        const data = doc.exists
            ? doc.data()
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
    catch (error) {
        console.warn('Firestore outbound stats fetch failed', error);
        return {
            prospectsContacted: 0,
            replies: 0,
            positiveReplies: 0,
            conversions: 0,
            demoBookings: 0,
            conversionRate: 0
        };
    }
}
export async function incrementInboundAnalytics(update, scope) {
    if (!update.messages && !update.leads && !update.sentimentTotal)
        return;
    await writeDailySummary(inboundAnalyticsCollection(scope), inboundSummaryDoc(scope), {
        messages: update.messages ?? 0,
        leads: update.leads ?? 0,
        sentimentTotal: update.sentimentTotal ?? 0,
        sentimentSamples: update.messages ?? 0,
    });
}
export async function incrementEngagementAnalytics(update, scope) {
    if (!update.commentsDetected && !update.repliesSent && !update.conversions)
        return;
    await writeDailySummary(engagementAnalyticsCollection(scope), engagementSummaryDoc(scope), {
        commentsDetected: update.commentsDetected ?? 0,
        repliesSent: update.repliesSent ?? 0,
        conversions: update.conversions ?? 0,
    });
}
export async function incrementFollowupAnalytics(update, scope) {
    if (!update.sent && !update.replies && !update.conversions)
        return;
    await writeDailySummary(followupAnalyticsCollection(scope), followupSummaryDoc(scope), {
        sent: update.sent ?? 0,
        replies: update.replies ?? 0,
        conversions: update.conversions ?? 0,
    });
}
export async function incrementWebLeadAnalytics(update, scope) {
    if (!update.leads && !update.messages)
        return;
    await writeDailySummary(webLeadAnalyticsCollection(scope), webLeadSummaryDoc(scope), {
        leads: update.leads ?? 0,
        messages: update.messages ?? 0,
    });
}
async function writeDailySummary(collection, summaryDoc, counters) {
    const date = new Date().toISOString().slice(0, 10);
    const docRef = collection.doc(date);
    const payload = {
        date,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    Object.entries(counters).forEach(([key, value]) => {
        payload[key] = admin.firestore.FieldValue.increment(value);
    });
    await firestore.runTransaction(async (tx) => {
        tx.set(docRef, payload, { merge: true });
    });
    await summaryDoc.set(Object.fromEntries(Object.entries(counters).map(([key, value]) => [key, admin.firestore.FieldValue.increment(value)])), { merge: true });
}
export async function getInboundStats(scope) {
    const doc = await inboundSummaryDoc(scope).get();
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
export async function getEngagementStats(scope) {
    const doc = await engagementSummaryDoc(scope).get();
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
export async function getFollowupStats(scope) {
    const doc = await followupSummaryDoc(scope).get();
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
export async function getWebLeadStats(scope) {
    const doc = await webLeadSummaryDoc(scope).get();
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
