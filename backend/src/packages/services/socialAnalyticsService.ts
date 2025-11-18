import admin from 'firebase-admin';
import { firestore } from '../../lib/firebase';

const dailyCollection = firestore.collection('analytics').doc('socialDaily').collection('user');

type IncrementPayload = {
  userId: string;
  status: 'posted' | 'failed' | 'skipped_limit';
  platform: string;
};

export class SocialAnalyticsService {
  async incrementDaily(payload: IncrementPayload) {
    const date = new Date().toISOString().slice(0, 10);
    const docRef = dailyCollection.doc(`${payload.userId}_${date}`);
    await firestore.runTransaction(async tx => {
      const snap = await tx.get(docRef);
      const snapshotData = snap.data() as Record<string, unknown> | undefined;
      const perPlatform = (snapshotData?.perPlatform as Record<string, number>) ?? {};
      perPlatform[payload.platform] = (perPlatform[payload.platform] ?? 0) + 1;
      const update: Record<string, unknown> = {
        userId: payload.userId,
        date,
        postsAttempted: ((snapshotData?.postsAttempted as number) ?? 0) + 1,
        perPlatform,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      if (payload.status === 'posted') update.postsPosted = ((snapshotData?.postsPosted as number) ?? 0) + 1;
      if (payload.status === 'failed') update.postsFailed = ((snapshotData?.postsFailed as number) ?? 0) + 1;
      if (payload.status === 'skipped_limit') update.postsSkipped = ((snapshotData?.postsSkipped as number) ?? 0) + 1;
      tx.set(docRef, update, { merge: true });
    });
  }

  async getDailySummary(userId: string, limit = 14) {
    const snap = await dailyCollection.where('userId', '==', userId).orderBy('date', 'desc').limit(limit).get();
    return snap.docs.map(doc => doc.data());
  }
}

export const socialAnalyticsService = new SocialAnalyticsService();
