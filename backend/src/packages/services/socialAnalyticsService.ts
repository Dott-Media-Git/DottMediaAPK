import admin from 'firebase-admin';
import { firestore } from '../../db/firestore';
import { supabaseFallbackService } from '../../services/supabaseFallbackService';

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
    try {
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
    } catch (error) {
      console.warn('[social-analytics] firestore increment failed; using fallback', error);
    }

    try {
      await supabaseFallbackService.incrementSocialDaily({
        userId: payload.userId,
        date,
        platform: payload.platform,
        status: payload.status,
      });
    } catch (error) {
      console.warn('[social-analytics] supabase increment failed', error);
    }
  }

  async getDailySummary(userId: string, limit = 14) {
    const merged = new Map<string, Record<string, unknown>>();

    try {
      let snap: FirebaseFirestore.QuerySnapshot<FirebaseFirestore.DocumentData>;
      try {
        snap = await dailyCollection.where('userId', '==', userId).orderBy('date', 'desc').limit(limit).get();
      } catch (error) {
        if (!this.isMissingIndexError(error)) throw error;
        snap = await dailyCollection.where('userId', '==', userId).limit(limit).get();
      }
      snap.docs.forEach(doc => {
        const row = doc.data() as Record<string, unknown>;
        const key = String(row.date ?? doc.id ?? '');
        if (!key) return;
        merged.set(key, row);
      });
    } catch (error) {
      console.warn('[social-analytics] firestore daily summary failed', error);
    }

    try {
      const fallbackRows = await supabaseFallbackService.getSocialDailySummary(userId, limit);
      fallbackRows.forEach(row => {
        const key = String(row.date ?? '');
        if (!key) return;
        const existing = merged.get(key) ?? {};
        const next = {
          ...row,
          postsAttempted: Math.max(Number(existing.postsAttempted ?? 0), Number(row.postsAttempted ?? 0)),
          postsPosted: Math.max(Number(existing.postsPosted ?? 0), Number(row.postsPosted ?? 0)),
          postsFailed: Math.max(Number(existing.postsFailed ?? 0), Number(row.postsFailed ?? 0)),
          postsSkipped: Math.max(Number(existing.postsSkipped ?? 0), Number(row.postsSkipped ?? 0)),
          perPlatform: {
            ...((existing.perPlatform as Record<string, number> | undefined) ?? {}),
            ...((row.perPlatform as Record<string, number> | undefined) ?? {}),
          },
        };
        merged.set(key, next);
      });
    } catch (error) {
      console.warn('[social-analytics] supabase daily summary failed', error);
    }

    return Array.from(merged.values())
      .sort((a: any, b: any) => `${b?.date ?? ''}`.localeCompare(`${a?.date ?? ''}`))
      .slice(0, limit);
  }
}

export const socialAnalyticsService = new SocialAnalyticsService();
