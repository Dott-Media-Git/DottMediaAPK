import cron from 'node-cron';
import axios from 'axios';
import admin from 'firebase-admin';
import { config } from '../config';
import { firestore } from '../db/firestore';
import { generateReply, likeInstagramComment, replyToInstagramComment } from '../services/autoReplyService';
import { supabaseFallbackService } from '../services/supabaseFallbackService';

const GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? 'v19.0';
const enabled = process.env.IG_COMMENT_POLL_ENABLED !== 'false';
const scheduleExpression = process.env.IG_COMMENT_POLL_CRON ?? '*/1 * * * *';
const mediaLimit = Math.max(Number(process.env.IG_COMMENT_MEDIA_LIMIT ?? 5), 1);
const commentLimit = Math.max(Number(process.env.IG_COMMENT_LIMIT ?? 10), 1);
const windowHours = Math.max(Number(process.env.IG_COMMENT_WINDOW_HOURS ?? 24), 1);

type MediaItem = { id: string; timestamp?: string };
type CommentItem = { id: string; text?: string; timestamp?: string; from?: { id?: string } };
type PollTarget = { userId?: string; igBusinessId: string; accessToken: string };

const CLIENT_POLL_USER_IDS = [
  'acmVetCcOiTHeGk5D7eDYieamDF3',
  'D1iNgjLKNRaQhH35M0NmGfw1LVD2',
  'vzdH1DnfFLVjlY8bBgC26WACmmw2',
];

const isAlreadyExistsError = (error: unknown) => {
  const err = error as { code?: number | string; message?: string };
  return err.code === 6 || err.code === 'already-exists' || err.message?.includes('ALREADY_EXISTS') === true;
};

const shouldRetryExisting = (data?: admin.firestore.DocumentData) => {
  if (!data) return true;
  const status = data.replyStatus as string | undefined;
  if (status === 'sent' || status === 'pending') return false;
  if (status !== 'failed') return true;
  const retryDelayMs = Math.max(Number(process.env.META_COMMENT_RETRY_DELAY_MS ?? 300000), 0);
  if (!retryDelayMs) return true;
  const replyAtMs =
    typeof data.replyAt?.toMillis === 'function'
      ? data.replyAt.toMillis()
      : typeof data.replyAt?.toDate === 'function'
        ? data.replyAt.toDate().getTime()
        : 0;
  return !replyAtMs || Date.now() - replyAtMs >= retryDelayMs;
};

const withinWindow = (timestamp?: string) => {
  if (!timestamp) return true;
  const createdAt = new Date(timestamp).getTime();
  if (!Number.isFinite(createdAt)) return true;
  return Date.now() - createdAt <= windowHours * 60 * 60 * 1000;
};

const fetchRecentMedia = async (igBusinessId: string, accessToken: string) => {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${igBusinessId}/media`;
  const response = await axios.get(url, {
    params: {
      fields: 'id,timestamp',
      limit: mediaLimit,
      access_token: accessToken,
    },
    timeout: 30000,
  });
  return (response.data?.data as MediaItem[] | undefined) ?? [];
};

const fetchComments = async (mediaId: string, accessToken: string) => {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${mediaId}/comments`;
  const response = await axios.get(url, {
    params: {
      fields: 'id,text,timestamp,from',
      limit: commentLimit,
      access_token: accessToken,
    },
    timeout: 30000,
  });
  return (response.data?.data as CommentItem[] | undefined) ?? [];
};

const upsertReplyStatus = async (
  docRef: admin.firestore.DocumentReference<admin.firestore.DocumentData>,
  status: 'sent' | 'failed',
  error?: string,
) => {
  const update: Record<string, unknown> = {
    replyStatus: status,
    replyAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (error) update.replyError = error;
  await docRef.update(update);
};

const processComment = async (comment: CommentItem, target: PollTarget) => {
  const commentId = comment.id;
  const text = comment.text?.trim();
  const fromId = comment.from?.id;
  if (!commentId || !text) return;
  if (fromId && fromId === target.igBusinessId) return;
  if (!withinWindow(comment.timestamp)) return;

  const dedupeKey = `instagram_comment_${commentId}`;
  const legacyDedupeKey = `instagram_comment_${target.igBusinessId}_${commentId}`;
  const docRef = firestore.collection('messages').doc(dedupeKey);
  try {
    await docRef.create({
      platform: 'instagram',
      type: 'comment',
      senderId: fromId,
      text,
      commentId,
      ownerId: target.userId,
      accountId: target.igBusinessId,
      source: 'poller',
      replyStatus: 'pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (error) {
    if (isAlreadyExistsError(error)) {
      const snap = await docRef.get();
      if (!shouldRetryExisting(snap.data())) return;
      await docRef.set(
        {
          platform: 'instagram',
          type: 'comment',
          senderId: fromId,
          text,
          commentId,
          ownerId: target.userId,
          accountId: target.igBusinessId,
          source: 'poller',
          replyStatus: 'pending',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    } else {
      const legacySnap = await firestore.collection('messages').doc(legacyDedupeKey).get();
      if (legacySnap.exists && !shouldRetryExisting(legacySnap.data())) return;
      throw error;
    }
  }

  try {
    const reply = await generateReply(text, 'instagram', target.userId, 'comment');
    await replyToInstagramComment(commentId, reply, target.accessToken);
    await upsertReplyStatus(docRef, 'sent');
    await likeInstagramComment(commentId, target.accessToken).catch(err =>
      console.warn('[ig-comment-poll] like failed', (err as Error).message)
    );
  } catch (error) {
    await upsertReplyStatus(docRef, 'failed', (error as Error).message);
    console.warn('[ig-comment-poll] reply failed', (error as Error).message);
  }
};

const loadClientTargets = async (): Promise<PollTarget[]> => {
  const targets: PollTarget[] = [];
  if (config.channels.instagram.businessId && config.channels.instagram.accessToken) {
    targets.push({
      igBusinessId: config.channels.instagram.businessId,
      accessToken: config.channels.instagram.accessToken,
    });
  }

  const configuredIds = (process.env.IG_COMMENT_POLL_USER_IDS ?? '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  const userIds = Array.from(new Set([...CLIENT_POLL_USER_IDS, ...configuredIds]));

  await Promise.all(
    userIds.map(async userId => {
      try {
        const snap = await firestore.collection('users').doc(userId).get();
        const instagram = (snap.data() as { socialAccounts?: { instagram?: { accountId?: string; accessToken?: string } } } | undefined)
          ?.socialAccounts?.instagram;
        if (instagram?.accountId && instagram.accessToken) {
          targets.push({ userId, igBusinessId: instagram.accountId, accessToken: instagram.accessToken });
          return;
        }
      } catch (error) {
        console.warn('[ig-comment-poll] Firestore target lookup failed', userId, (error as Error).message);
      }

      try {
        const fallback = await supabaseFallbackService.getSocialAccounts(userId);
        const instagram = (fallback?.socialAccounts as { instagram?: { accountId?: string; accessToken?: string } } | undefined)
          ?.instagram;
        if (instagram?.accountId && instagram.accessToken) {
          targets.push({ userId, igBusinessId: instagram.accountId, accessToken: instagram.accessToken });
        }
      } catch (error) {
        console.warn('[ig-comment-poll] Supabase target lookup failed', userId, (error as Error).message);
      }
    }),
  );

  const seen = new Set<string>();
  return targets.filter(target => {
    const key = `${target.igBusinessId}:${target.accessToken}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const pollInstagramCommentsOnce = async () => {
  const targets = await loadClientTargets();
  if (!targets.length) {
    console.warn('[ig-comment-poll] missing IG credentials; polling skipped');
    return;
  }

  for (const target of targets) {
    try {
      const media = await fetchRecentMedia(target.igBusinessId, target.accessToken);
      for (const item of media) {
        const comments = await fetchComments(item.id, target.accessToken);
        for (const comment of comments) {
          await processComment(comment, target);
        }
      }
    } catch (error) {
      console.warn('[ig-comment-poll] poll failed', {
        igBusinessId: target.igBusinessId,
        error: (error as Error).message,
      });
    }
  }
};

export function scheduleInstagramCommentPollJob() {
  if (!enabled) {
    console.info('[ig-comment-poll] disabled');
    return;
  }

  cron.schedule(scheduleExpression, async () => {
    await pollInstagramCommentsOnce();
  });
  console.info(`[ig-comment-poll] job scheduled (${scheduleExpression}).`);

  if (process.env.META_COMMENT_POLL_ON_STARTUP === 'true') {
    void pollInstagramCommentsOnce();
  }
}

scheduleInstagramCommentPollJob();
