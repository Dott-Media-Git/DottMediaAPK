import admin from 'firebase-admin';
import { firestore } from '../../db/firestore.js';
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
    async getDailySummary(userId, limit = 14) {
        let snap;
        try {
            snap = await dailyCollection.where('userId', '==', userId).orderBy('date', 'desc').limit(limit).get();
        }
        catch (error) {
            if (!this.isMissingIndexError(error))
                throw error;
            snap = await dailyCollection.where('userId', '==', userId).limit(limit).get();
        }
        const rows = snap.docs.map(doc => doc.data());
        rows.sort((a, b) => `${b?.date ?? ''}`.localeCompare(`${a?.date ?? ''}`));
        return rows;
    }
}
export const socialAnalyticsService = new SocialAnalyticsService();
