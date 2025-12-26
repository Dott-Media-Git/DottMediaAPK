import admin from 'firebase-admin';
import { firestore } from '../../db/firestore';

const dailyCollection = firestore.collection('analytics').doc('socialDaily').collection('user');

type IncrementPayload = {
  userId: string;
  status: 'posted' | 'failed' | 'skipped_limit';
  platform: string;
};

export class SocialAnalyticsService {
  private isMissingIndexError(error: unknown) {
    const err = error as { code?: number; message?: string; details?: string };
    const message = `${err?.message ?? ''} ${err?.details ?? ''}`.toLowerCase();
    return err?.code === 9 && message.includes('index');
  }

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
    let snap: FirebaseFirestore.QuerySnapshot<FirebaseFirestore.DocumentData>;
    try {
      snap = await dailyCollection.where('userId', '==', userId).orderBy('date', 'desc').limit(limit).get();
    } catch (error) {
      if (!this.isMissingIndexError(error)) throw error;
      snap = await dailyCollection.where('userId', '==', userId).limit(limit).get();
    }
    const rows = snap.docs.map(doc => doc.data());
    rows.sort((a: any, b: any) => `${b?.date ?? ''}`.localeCompare(`${a?.date ?? ''}`));
    return rows;
  }
}

export const socialAnalyticsService = new SocialAnalyticsService();
