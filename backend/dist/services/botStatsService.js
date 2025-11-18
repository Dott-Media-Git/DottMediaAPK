import admin from 'firebase-admin';
import { firestore } from '../lib/firebase';
import { Platforms, } from '../types/bot';
import { sampleConversations, sampleStats } from '../lib/seedData';
import { CRMSyncService } from './crmSyncService';
const statsCollection = firestore.collection('stats');
const latestDoc = statsCollection.doc('latest');
const leadsCollection = firestore.collection('leads');
const conversationsCollection = firestore.collection('conversations');
const followUpsCollection = firestore.collection('follow_ups');
const followUpLogsCollection = firestore.collection('follow_up_logs');
const outreachLogsCollection = firestore.collection('outreach_logs');
const bookingsCollection = firestore.collection('scheduler_bookings');
const emptyIntentCounts = () => ({
    'Lead Inquiry': 0,
    Support: 0,
    'Demo Booking': 0,
    'General Chat': 0,
});
const emptyResponseCounts = () => ({
    Pricing: 0,
    Onboarding: 0,
    Demo: 0,
    Support: 0,
    General: 0,
});
const ensureCategory = (counts, intent) => ({
    ...emptyIntentCounts(),
    ...counts,
    [intent]: (counts[intent] ?? 0) + 1,
});
const ensureResponseType = (counts, responseType) => ({
    ...emptyResponseCounts(),
    ...counts,
    [responseType]: (counts[responseType] ?? 0) + 1,
});
const determineTopCategory = (counts) => {
    return Object.entries(counts).reduce((top, current) => {
        if (current[1] > top[1])
            return current;
        return top;
    }, ['Lead Inquiry', 0])[0];
};
const emptyPlatformStats = () => ({
    messages: 0,
    leads: 0,
    responseTimeTotalMs: 0,
    responseSamples: 0,
    sentimentTotal: 0,
    sentimentSamples: 0,
    conversionCount: 0,
});
const createPlatformMap = () => Platforms.reduce((acc, platform) => {
    acc[platform] = emptyPlatformStats();
    return acc;
}, {});
const ensurePlatformStats = (existing) => {
    const current = existing ? { ...existing } : createPlatformMap();
    Platforms.forEach(platform => {
        if (!current[platform])
            current[platform] = emptyPlatformStats();
    });
    return current;
};
const ensureActiveUsersByPlatform = (existing) => {
    const current = existing ? { ...existing } : {};
    Platforms.forEach(platform => {
        if (!current[platform])
            current[platform] = [];
    });
    return current;
};
export class BotStatsService {
    constructor() {
        this.crmSync = new CRMSyncService();
    }
    async recordSession(summary) {
        const dateKey = new Date().toISOString().slice(0, 10);
        const statsDoc = statsCollection.doc(dateKey);
        await firestore.runTransaction(async (tx) => {
            const existingSnap = await tx.get(statsDoc);
            const existing = (existingSnap.exists ? existingSnap.data() : {}) ?? {};
            const totalMessagesToday = (existing.totalMessagesToday ?? 0) + summary.conversation.messages.length;
            const newLeadsToday = (existing.newLeadsToday ?? 0) + (summary.isLead ? 1 : 0);
            const responseSamples = (existing.responseSamples ?? 0) + 1;
            const responseTimeTotalMs = (existing.responseTimeTotalMs ?? 0) + summary.responseTimeMs;
            const sentimentSamples = (existing.sentimentSamples ?? 0) + 1;
            const sentimentTotal = (existing.sentimentTotal ?? 0) + summary.conversation.sentiment_score;
            const conversionCount = (existing.conversionCount ?? 0) + (summary.isLead ? 1 : 0);
            const intentCounts = ensureCategory(existing.intentCounts ?? emptyIntentCounts(), summary.conversation.intent_category);
            const responseTypeCounts = ensureResponseType(existing.responseTypeCounts ?? emptyResponseCounts(), summary.conversation.response_type);
            const activeUsers = Array.from(new Set([...(existing.activeUsers ?? []), summary.conversation.user_id]));
            const platformBreakdown = ensurePlatformStats(existing.platformBreakdown);
            const platformStats = platformBreakdown[summary.conversation.platform];
            platformStats.messages += summary.conversation.messages.length;
            platformStats.leads += summary.isLead ? 1 : 0;
            platformStats.responseTimeTotalMs += summary.responseTimeMs;
            platformStats.responseSamples += 1;
            platformStats.sentimentTotal += summary.conversation.sentiment_score;
            platformStats.sentimentSamples += 1;
            platformStats.conversionCount += summary.isLead ? 1 : 0;
            const activeUsersByPlatform = ensureActiveUsersByPlatform(existing.activeUsersByPlatform);
            const platformUsers = new Set([
                ...(activeUsersByPlatform[summary.conversation.platform] ?? []),
                summary.conversation.user_id,
            ]);
            activeUsersByPlatform[summary.conversation.platform] = Array.from(platformUsers);
            const learningEfficiency = Number((0.6 * (existing.learningEfficiency ?? 0) +
                0.4 * Math.max(0, summary.leadScore) / 100).toFixed(3));
            const doc = {
                date: dateKey,
                totalMessagesToday,
                newLeadsToday,
                responseSamples,
                responseTimeTotalMs,
                sentimentSamples,
                sentimentTotal,
                conversionCount,
                intentCounts,
                responseTypeCounts,
                activeUsers,
                activeUsersByPlatform,
                mostCommonCategory: determineTopCategory(intentCounts),
                avgResponseTime: Number((responseTimeTotalMs / responseSamples / 1000).toFixed(1)),
                conversionRate: Number((conversionCount / Math.max(totalMessagesToday, 1)).toFixed(2)),
                platformBreakdown,
                learningEfficiency,
            };
            tx.set(statsDoc, doc);
            tx.set(latestDoc, {
                ...doc,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });
        });
    }
    async forwardLead(payload) {
        await this.crmSync.syncLead({
            ...payload,
            leadScore: payload.leadScore,
            leadTier: payload.leadTier,
        });
    }
    buildSummary(doc) {
        if (!doc) {
            const fallback = sampleStats[sampleStats.length - 1];
            return {
                totalMessagesToday: fallback.totalMessagesToday,
                newLeadsToday: fallback.newLeadsToday,
                mostCommonCategory: fallback.mostCommonCategory,
                avgResponseTime: fallback.avgResponseTime,
                conversionRate: fallback.conversionRate,
                avgSentiment: 4.2,
            };
        }
        const avgSentiment = Number(((doc.sentimentTotal ?? 0) / Math.max(doc.sentimentSamples ?? 1, 1)).toFixed(1));
        return {
            totalMessagesToday: doc.totalMessagesToday ?? 0,
            newLeadsToday: doc.newLeadsToday ?? 0,
            mostCommonCategory: doc.mostCommonCategory ?? 'General Chat',
            avgResponseTime: doc.avgResponseTime ?? 45,
            conversionRate: doc.conversionRate ?? 0,
            avgSentiment,
        };
    }
    buildChart(points) {
        return points
            .sort((a, b) => a.date.localeCompare(b.date))
            .map(point => ({
            label: point.date.slice(5),
            value: Number(point.value.toFixed(2)),
        }));
    }
    async fetchDocs(limit = 14) {
        const snap = await statsCollection.where('date', '>=', '2000-01-01').orderBy('date', 'desc').limit(limit).get();
        if (snap.empty) {
            return [];
        }
        return snap.docs.map(doc => doc.data());
    }
    platformMetrics(doc) {
        if (!doc?.platformBreakdown) {
            return Platforms.map(platform => ({
                platform,
                messages: 0,
                leads: 0,
                avgResponseTime: 0,
                avgSentiment: 0,
                conversionRate: 0,
            }));
        }
        return Platforms.map(platform => {
            const stats = doc.platformBreakdown?.[platform] ?? emptyPlatformStats();
            return {
                platform,
                messages: stats.messages,
                leads: stats.leads,
                avgResponseTime: stats.responseSamples ? Number((stats.responseTimeTotalMs / stats.responseSamples / 1000).toFixed(1)) : 0,
                avgSentiment: stats.sentimentSamples ? Number((stats.sentimentTotal / stats.sentimentSamples).toFixed(1)) : 0,
                conversionRate: stats.messages ? Number((stats.conversionCount / stats.messages).toFixed(2)) : 0,
            };
        });
    }
    async fetchTopConversations(limit = 10) {
        const snap = await firestore.collection('conversations').orderBy('created_at', 'desc').limit(limit).get();
        if (snap.empty) {
            return sampleConversations;
        }
        return snap.docs.map(doc => doc.data());
    }
    async getStats() {
        const docs = await this.fetchDocs(14);
        const statsDocs = docs.length
            ? docs
            : sampleStats.map(stat => ({
                date: stat.date,
                totalMessagesToday: stat.totalMessagesToday,
                newLeadsToday: stat.newLeadsToday,
                responseTimeTotalMs: 0,
                responseSamples: 1,
                intentCounts: stat.categoryCounts,
                responseTypeCounts: stat.responseTypeCounts,
                activeUsers: [stat.totalMessagesToday.toString()],
                activeUsersByPlatform: Platforms.reduce((acc, platform) => {
                    acc[platform] = [`${platform}-${stat.totalMessagesToday}`];
                    return acc;
                }, {}),
                sentimentTotal: 0.6,
                sentimentSamples: 1,
                platformBreakdown: stat.platformBreakdown,
                conversionCount: Math.round(stat.conversionRate * stat.totalMessagesToday),
                mostCommonCategory: stat.mostCommonCategory,
                avgResponseTime: stat.avgResponseTime,
                conversionRate: stat.conversionRate,
            }));
        const summary = this.buildSummary(statsDocs[0]);
        const dailyMessages = this.buildChart(statsDocs.slice(0, 7).map(doc => ({ date: doc.date, value: doc.totalMessagesToday })));
        const weeklyMessagesByPlatform = Platforms.map(platform => ({
            platform,
            series: this.buildChart(statsDocs.slice(0, 7).map(doc => ({
                date: doc.date,
                value: doc.platformBreakdown?.[platform]?.messages ?? 0,
            }))),
        }));
        const leadsByPlatform = Platforms.map(platform => ({
            label: platform,
            value: statsDocs[0]?.platformBreakdown?.[platform]?.leads ?? 0,
        }));
        const latestCounts = statsDocs[0]?.intentCounts ?? emptyIntentCounts();
        const categoryBreakdown = Object.entries(latestCounts).map(([label, value]) => ({
            label,
            value,
        }));
        const platformMetrics = this.platformMetrics(statsDocs[0]);
        const activeUsers = statsDocs[0]?.activeUsers?.length ?? 0;
        const topConversations = await this.fetchTopConversations(10);
        return {
            summary,
            charts: {
                dailyMessages,
                weeklyMessagesByPlatform,
                leadsByPlatform,
            },
            platformMetrics,
            categoryBreakdown,
            activeUsers,
            topConversations,
            learningEfficiency: statsDocs[0]?.learningEfficiency ?? summary.avgSentiment,
        };
    }
    async getLeadInsights() {
        const [leadsSnap, convSnap, statsSnap, followPendingSnap, followLogsSnap, outreachSnap, bookingsSnap] = await Promise.all([
            leadsCollection.orderBy('created_at', 'desc').limit(400).get(),
            conversationsCollection.orderBy('created_at', 'desc').limit(400).get(),
            statsCollection.orderBy('date', 'desc').limit(7).get(),
            followUpsCollection.where('status', '==', 'pending').get(),
            followUpLogsCollection.orderBy('sentAt', 'desc').limit(200).get(),
            outreachLogsCollection.orderBy('createdAt', 'desc').limit(200).get(),
            bookingsCollection.orderBy('createdAt', 'desc').limit(200).get(),
        ]);
        const statsDocs = statsSnap.docs.map(doc => doc.data());
        const tierCounts = { hot: 0, warm: 0, cold: 0 };
        leadsSnap.forEach(doc => {
            const tier = doc.data().leadTier ?? 'warm';
            tierCounts[tier] = (tierCounts[tier] ?? 0) + 1;
        });
        const leadTiers = Object.entries(tierCounts).map(([label, value]) => ({ label, value }));
        const intentCounts = {};
        const responseMixCounts = {};
        let positive = 0;
        let neutral = 0;
        let negative = 0;
        convSnap.forEach(doc => {
            const data = doc.data();
            intentCounts[data.intent_category] = (intentCounts[data.intent_category] ?? 0) + 1;
            responseMixCounts[data.response_type] = (responseMixCounts[data.response_type] ?? 0) + 1;
            if (data.sentiment_score > 0.3)
                positive += 1;
            else if (data.sentiment_score < -0.3)
                negative += 1;
            else
                neutral += 1;
        });
        const intentBreakdown = Object.entries(intentCounts).map(([label, value]) => ({ label, value }));
        const responseMix = Object.entries(responseMixCounts).map(([label, value]) => ({ label, value }));
        const sentimentBuckets = [
            { label: 'Positive', value: positive },
            { label: 'Neutral', value: neutral },
            { label: 'Negative', value: negative },
        ];
        const conversionTrend = statsDocs
            .sort((a, b) => a.date.localeCompare(b.date))
            .map(doc => ({
            label: doc.date.slice(5),
            value: doc.newLeadsToday,
        }));
        const followUpSent = followLogsSnap.size;
        const followUpPending = followPendingSnap.size;
        const followUpSuccessRate = Number((followUpSent / Math.max(followUpSent + followUpPending, 1)).toFixed(2));
        const outreachSent = outreachSnap.docs.filter(doc => doc.data().status === 'sent').length;
        const outreachReplies = outreachSnap.docs.filter(doc => Boolean(doc.data().replyAt)).length;
        const outreachReplyRate = Number((outreachReplies / Math.max(outreachSent, 1)).toFixed(2));
        const bookings = bookingsSnap.docs.filter(doc => doc.data().status === 'confirmed').length;
        const learningEfficiency = statsDocs.length > 0
            ? Number((statsDocs.map(doc => doc.learningEfficiency ?? 0).reduce((sum, val) => sum + val, 0) / statsDocs.length).toFixed(3))
            : 0;
        return {
            intentBreakdown,
            sentimentBuckets,
            leadTiers,
            conversionTrend,
            responseMix,
            followUp: {
                sent: followUpSent,
                pending: followUpPending,
                successRate: followUpSuccessRate,
            },
            outreach: {
                sent: outreachSent,
                replies: outreachReplies,
                replyRate: outreachReplyRate,
            },
            roi: {
                bookings,
                learningEfficiency,
            },
        };
    }
}
