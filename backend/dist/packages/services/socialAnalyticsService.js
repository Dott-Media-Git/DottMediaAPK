import admin from 'firebase-admin';
import { firestore } from '../../lib/firebase';
const dailyCollection = firestore.collection('analytics').doc('socialDaily').collection('user');
export class SocialAnalyticsService {
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
        const snap = await dailyCollection.where('userId', '==', userId).orderBy('date', 'desc').limit(limit).get();
        return snap.docs.map(doc => doc.data());
    }
}
export const socialAnalyticsService = new SocialAnalyticsService();
