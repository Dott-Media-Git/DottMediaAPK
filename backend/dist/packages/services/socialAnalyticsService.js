import admin from 'firebase-admin';
import { firestore } from '../../db/firestore.js';
import { supabaseFallbackService } from '../../services/supabaseFallbackService.js';
const dailyCollection = firestore.collection('analytics').doc('socialDaily').collection('user');
export class SocialAnalyticsService {
    isMissingIndexError(error) {
        const err = error;
        const message = `${err?.message ?? ''} ${err?.details ?? ''}`.toLowerCase();
        return err?.code === 9 && message.includes('index');
    }
    async incrementDaily(payload) {
        const date = new Date().toISOString().slice(0, 10);
        const docRef = dailyCollection.doc(`${payload.userId}_${date}`);
        try {
            await firestore.runTransaction(async (tx) => {
                const snap = await tx.get(docRef);
                const snapshotData = snap.data();
                const perPlatform = snapshotData?.perPlatform ?? {};
                perPlatform[payload.platform] = (perPlatform[payload.platform] ?? 0) + 1;
                const update = {
                    userId: payload.userId,
                    date,
                    postsAttempted: (snapshotData?.postsAttempted ?? 0) + 1,
                    perPlatform,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                };
                if (payload.status === 'posted')
                    update.postsPosted = (snapshotData?.postsPosted ?? 0) + 1;
                if (payload.status === 'failed')
                    update.postsFailed = (snapshotData?.postsFailed ?? 0) + 1;
                if (payload.status === 'skipped_limit')
                    update.postsSkipped = (snapshotData?.postsSkipped ?? 0) + 1;
                tx.set(docRef, update, { merge: true });
            });
        }
        catch (error) {
            console.warn('[social-analytics] firestore increment failed; using fallback', error);
        }
        try {
            await supabaseFallbackService.incrementSocialDaily({
                userId: payload.userId,
                date,
                platform: payload.platform,
                status: payload.status,
            });
        }
        catch (error) {
            console.warn('[social-analytics] supabase increment failed', error);
        }
    }
    async getDailySummary(userId, limit = 14) {
        const merged = new Map();
        try {
            let snap;
            try {
                snap = await dailyCollection.where('userId', '==', userId).orderBy('date', 'desc').limit(limit).get();
            }
            catch (error) {
                if (!this.isMissingIndexError(error))
                    throw error;
                snap = await dailyCollection.where('userId', '==', userId).limit(limit).get();
            }
            snap.docs.forEach(doc => {
                const row = doc.data();
                const key = String(row.date ?? doc.id ?? '');
                if (!key)
                    return;
                merged.set(key, row);
            });
        }
        catch (error) {
            console.warn('[social-analytics] firestore daily summary failed', error);
        }
        try {
            const fallbackRows = await supabaseFallbackService.getSocialDailySummary(userId, limit);
            fallbackRows.forEach(row => {
                const key = String(row.date ?? '');
                if (!key)
                    return;
                const existing = merged.get(key) ?? {};
                const next = {
                    ...row,
                    postsAttempted: Math.max(Number(existing.postsAttempted ?? 0), Number(row.postsAttempted ?? 0)),
                    postsPosted: Math.max(Number(existing.postsPosted ?? 0), Number(row.postsPosted ?? 0)),
                    postsFailed: Math.max(Number(existing.postsFailed ?? 0), Number(row.postsFailed ?? 0)),
                    postsSkipped: Math.max(Number(existing.postsSkipped ?? 0), Number(row.postsSkipped ?? 0)),
                    perPlatform: {
                        ...(existing.perPlatform ?? {}),
                        ...(row.perPlatform ?? {}),
                    },
                };
                merged.set(key, next);
            });
        }
        catch (error) {
            console.warn('[social-analytics] supabase daily summary failed', error);
        }
        return Array.from(merged.values())
            .sort((a, b) => `${b?.date ?? ''}`.localeCompare(`${a?.date ?? ''}`))
            .slice(0, limit);
    }
}
export const socialAnalyticsService = new SocialAnalyticsService();
