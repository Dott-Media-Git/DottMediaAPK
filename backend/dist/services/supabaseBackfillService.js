import { firestore } from '../db/firestore.js';
import { supabaseFallbackService } from './supabaseFallbackService.js';
const autopostCollection = firestore.collection('autopostJobs');
const scheduledPostsCollection = firestore.collection('scheduledPosts');
const socialLimitsCollection = firestore.collection('socialLimits');
const socialDailyCollection = firestore.collection('analytics').doc('socialDaily').collection('user');
const analyticsCollection = firestore.collection('analytics');
const usersCollection = firestore.collection('users');
const MAX_AUTPOST_JOBS = Math.max(Number(process.env.SUPABASE_BACKFILL_AUTPOST_LIMIT ?? 200), 1);
const MAX_SCHEDULED_POSTS = Math.max(Number(process.env.SUPABASE_BACKFILL_SCHEDULED_LIMIT ?? 3000), 1);
const MAX_SOCIAL_LIMITS = Math.max(Number(process.env.SUPABASE_BACKFILL_SOCIAL_LIMITS ?? 3000), 1);
const MAX_SOCIAL_DAILY = Math.max(Number(process.env.SUPABASE_BACKFILL_SOCIAL_DAILY ?? 3000), 1);
const MAX_ANALYTICS_DAILY = Math.max(Number(process.env.SUPABASE_BACKFILL_ANALYTICS_DAILY ?? 120), 1);
const MAX_SOCIAL_ACCOUNTS = Math.max(Number(process.env.SUPABASE_BACKFILL_SOCIAL_ACCOUNTS ?? 500), 1);
let backfillPromise = null;
const toIsoString = (value) => {
    if (!value)
        return null;
    if (typeof value === 'string') {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
    }
    if (value instanceof Date)
        return value.toISOString();
    if (typeof value === 'number') {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
    }
    if (typeof value === 'object') {
        const candidate = value;
        if (typeof candidate.toDate === 'function')
            return candidate.toDate().toISOString();
        if (typeof candidate.seconds === 'number')
            return new Date(candidate.seconds * 1000).toISOString();
        if (typeof candidate._seconds === 'number')
            return new Date(candidate._seconds * 1000).toISOString();
    }
    return null;
};
const normalizeUserId = (scopeKey) => (scopeKey && scopeKey !== 'global' ? scopeKey : null);
const mapScheduledPost = (id, data) => ({
    id,
    userId: String(data.userId ?? ''),
    platform: String(data.platform ?? ''),
    status: String(data.status ?? 'pending'),
    targetDate: typeof data.targetDate === 'string' ? data.targetDate : undefined,
    caption: typeof data.caption === 'string' ? data.caption : '',
    hashtags: typeof data.hashtags === 'string' ? data.hashtags : '',
    imageUrls: Array.isArray(data.imageUrls) ? data.imageUrls.map(entry => String(entry)).filter(Boolean) : [],
    videoUrl: typeof data.videoUrl === 'string' ? data.videoUrl : undefined,
    videoTitle: typeof data.videoTitle === 'string' ? data.videoTitle : undefined,
    scheduledFor: data.scheduledFor,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    postedAt: data.postedAt,
    remoteId: typeof data.remoteId === 'string' ? data.remoteId : null,
    errorMessage: typeof data.errorMessage === 'string' ? data.errorMessage : null,
    source: typeof data.source === 'string' ? data.source : null,
});
const mapSocialDaily = (data) => ({
    userId: String(data.userId ?? ''),
    date: String(data.date ?? ''),
    postsAttempted: Number(data.postsAttempted ?? 0),
    postsPosted: Number(data.postsPosted ?? 0),
    postsFailed: Number(data.postsFailed ?? 0),
    postsSkipped: Number(data.postsSkipped ?? 0),
    perPlatform: data.perPlatform && typeof data.perPlatform === 'object'
        ? data.perPlatform
        : {},
});
const metricFromCollectionName = (collectionName) => {
    if (collectionName === 'daily')
        return 'dashboardDaily';
    if (collectionName.endsWith('Daily'))
        return collectionName.slice(0, -'Daily'.length);
    return null;
};
async function backfillAutopostJobs() {
    const snap = await autopostCollection.limit(MAX_AUTPOST_JOBS).get();
    for (const doc of snap.docs) {
        const data = doc.data();
        await supabaseFallbackService.upsertAutopostJob(doc.id, {
            userId: doc.id,
            ...data,
        });
    }
    return snap.size;
}
async function backfillSocialAccounts() {
    const snap = await usersCollection.limit(MAX_SOCIAL_ACCOUNTS).get();
    let count = 0;
    for (const doc of snap.docs) {
        const data = doc.data();
        const socialAccounts = data.socialAccounts && typeof data.socialAccounts === 'object'
            ? data.socialAccounts
            : {};
        if (!Object.keys(socialAccounts).length)
            continue;
        await supabaseFallbackService.upsertSocialAccounts(doc.id, {
            email: typeof data.email === 'string' ? data.email : null,
            socialAccounts,
        });
        count += 1;
    }
    return count;
}
async function backfillScheduledPosts() {
    let snap;
    try {
        snap = await scheduledPostsCollection.orderBy('createdAt', 'desc').limit(MAX_SCHEDULED_POSTS).get();
    }
    catch {
        snap = await scheduledPostsCollection.limit(MAX_SCHEDULED_POSTS).get();
    }
    const posts = snap.docs
        .map(doc => mapScheduledPost(doc.id, doc.data()))
        .filter(post => post.userId && post.platform);
    if (posts.length) {
        await supabaseFallbackService.upsertScheduledPosts(posts);
    }
    return posts.length;
}
async function backfillSocialLimits() {
    const snap = await socialLimitsCollection.limit(MAX_SOCIAL_LIMITS).get();
    const rows = snap.docs
        .map(doc => {
        const data = doc.data();
        return {
            key: doc.id,
            userId: String(data.userId ?? ''),
            date: String(data.date ?? ''),
            postedCount: Number(data.postedCount ?? 0),
            scheduledCount: Number(data.scheduledCount ?? 0),
        };
    })
        .filter(row => row.key && row.userId && row.date);
    if (rows.length) {
        await supabaseFallbackService.upsertSocialLimits(rows);
    }
    return rows.length;
}
async function backfillSocialDaily() {
    let snap;
    try {
        snap = await socialDailyCollection.orderBy('date', 'desc').limit(MAX_SOCIAL_DAILY).get();
    }
    catch {
        snap = await socialDailyCollection.limit(MAX_SOCIAL_DAILY).get();
    }
    const rows = snap.docs
        .map(doc => mapSocialDaily(doc.data()))
        .filter(row => row.userId && row.date);
    if (rows.length) {
        await supabaseFallbackService.upsertSocialDailyRows(rows);
    }
    return rows.length;
}
async function backfillAnalytics() {
    const metricSummaries = [];
    const metricDailyRows = [];
    const scopeDocs = await analyticsCollection.listDocuments();
    for (const scopeDoc of scopeDocs) {
        const scopeKey = scopeDoc.id;
        if (scopeKey === 'socialDaily')
            continue;
        const userId = normalizeUserId(scopeKey);
        const collections = await scopeDoc.listCollections();
        for (const collection of collections) {
            if (collection.id === 'summaries') {
                const summarySnap = await collection.limit(100).get();
                summarySnap.docs.forEach(doc => {
                    const data = doc.data();
                    metricSummaries.push({
                        scopeKey,
                        metric: doc.id,
                        counters: data,
                        userId,
                    });
                });
                continue;
            }
            const metric = metricFromCollectionName(collection.id);
            if (!metric)
                continue;
            let dailySnap;
            try {
                dailySnap = await collection.orderBy('date', 'desc').limit(MAX_ANALYTICS_DAILY).get();
            }
            catch {
                dailySnap = await collection.limit(MAX_ANALYTICS_DAILY).get();
            }
            dailySnap.docs.forEach(doc => {
                const data = doc.data();
                const date = String(data.date ?? doc.id ?? '');
                if (!date)
                    return;
                metricDailyRows.push({
                    scopeKey,
                    metric,
                    date,
                    counters: data,
                    userId,
                });
            });
        }
    }
    if (metricSummaries.length) {
        await supabaseFallbackService.upsertMetricSummaries(metricSummaries);
    }
    if (metricDailyRows.length) {
        await supabaseFallbackService.upsertMetricDailyRows(metricDailyRows);
    }
    return {
        summaries: metricSummaries.length,
        daily: metricDailyRows.length,
    };
}
export const backfillSupabaseFallback = async () => {
    if (backfillPromise)
        return backfillPromise;
    backfillPromise = (async () => {
        if (!supabaseFallbackService.isConfigured()) {
            console.info('[supabase-backfill] fallback not configured; skipping backfill');
            return false;
        }
        try {
            const [autopostJobs, socialAccounts, scheduledPosts, socialLimits, socialDaily, analytics] = await Promise.all([
                backfillAutopostJobs(),
                backfillSocialAccounts(),
                backfillScheduledPosts(),
                backfillSocialLimits(),
                backfillSocialDaily(),
                backfillAnalytics(),
            ]);
            console.info('[supabase-backfill] completed', {
                autopostJobs,
                socialAccounts,
                scheduledPosts,
                socialLimits,
                socialDaily,
                metricSummaries: analytics.summaries,
                metricDaily: analytics.daily,
            });
            return true;
        }
        catch (error) {
            console.warn('[supabase-backfill] failed', error instanceof Error ? error.message : error);
            return false;
        }
    })();
    return backfillPromise;
};
