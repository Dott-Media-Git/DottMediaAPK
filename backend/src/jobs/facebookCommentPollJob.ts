import cron from 'node-cron';
import axios from 'axios';
import admin from 'firebase-admin';
import { config } from '../config';
import { firestore } from '../db/firestore';
import { generateReply, likeFacebookComment, replyToFacebookComment } from '../services/autoReplyService';
import { supabaseFallbackService } from '../services/supabaseFallbackService';

const GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? 'v19.0';
const enabled = process.env.FB_COMMENT_POLL_ENABLED !== 'false';
const scheduleExpression = process.env.FB_COMMENT_POLL_CRON ?? '*/1 * * * *';
const postLimit = Math.max(Number(process.env.FB_COMMENT_POST_LIMIT ?? 8), 1);
const commentLimit = Math.max(Number(process.env.FB_COMMENT_LIMIT ?? 25), 1);
const windowHours = Math.max(Number(process.env.FB_COMMENT_WINDOW_HOURS ?? 24), 1);

type PostItem = { id: string; created_time?: string };
type CommentItem = { id: string; message?: string; created_time?: string; from?: { id?: string } };
type PollTarget = { userId?: string; pageId: string; accessToken: string };

const CLIENT_POLL_USER_IDS = [
  'tCE1FQ1cOFgdupOXP23mPUMQRAz1',
  '80bYIeiuukNFtUvXTUobXmfC7pu1',
  'LVR7p3WzdFM51ds92Kacf6S40og2',
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

const fetchRecentPosts = async (pageId: string, accessToken: string) => {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${pageId}/posts`;
  const response = await axios.get(url, {
    params: {
      fields: 'id,created_time',
      limit: postLimit,
      access_token: accessToken,
    },
    timeout: 30000,
  });
  return (response.data?.data as PostItem[] | undefined) ?? [];
};

const fetchComments = async (postId: string, accessToken: string) => {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${postId}/comments`;
  const response = await axios.get(url, {
    params: {
      fields: 'id,message,created_time,from',
      filter: 'stream',
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

const reserveComment = async (comment: CommentItem, target: PollTarget) => {
  const commentId = comment.id;
  const text = comment.message?.trim();
  const fromId = comment.from?.id;
  if (!commentId || !text) return null;
  if (fromId && fromId === target.pageId) return null;
  if (!withinWindow(comment.created_time)) return null;

  const docRef = firestore.collection('messages').doc(`facebook_comment_${commentId}`);
  try {
    await docRef.create({
      platform: 'facebook',
      type: 'comment',
      senderId: fromId,
      text,
      commentId,
      ownerId: target.userId,
      accountId: target.pageId,
      source: 'poller',
      replyStatus: 'pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { docRef, text, commentId };
  } catch (error) {
    if (!isAlreadyExistsError(error)) throw error;
    const snap = await docRef.get();
    if (!shouldRetryExisting(snap.data())) return null;
    await docRef.set(
      {
        platform: 'facebook',
        type: 'comment',
        senderId: fromId,
        text,
        commentId,
        ownerId: target.userId,
        accountId: target.pageId,
        source: 'poller',
        replyStatus: 'pending',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return { docRef, text, commentId };
  }
};

const processComment = async (comment: CommentItem, target: PollTarget) => {
  const reserved = await reserveComment(comment, target);
  if (!reserved) return;

  try {
    const reply = await generateReply(reserved.text, 'facebook', target.userId, 'comment');
    await replyToFacebookComment(reserved.commentId, reply, target.accessToken);
    await upsertReplyStatus(reserved.docRef, 'sent');
    await likeFacebookComment(reserved.commentId, target.accessToken).catch(err =>
      console.warn('[fb-comment-poll] like failed', (err as Error).message),
    );
  } catch (error) {
    await upsertReplyStatus(reserved.docRef, 'failed', (error as Error).message);
    console.warn('[fb-comment-poll] reply failed', (error as Error).message);
  }
};

const loadClientTargets = async (): Promise<PollTarget[]> => {
  const targets: PollTarget[] = [];
  if (config.channels.facebook.pageId && config.channels.facebook.pageToken) {
    targets.push({
      pageId: config.channels.facebook.pageId,
      accessToken: config.channels.facebook.pageToken,
    });
  }

  const configuredIds = (process.env.FB_COMMENT_POLL_USER_IDS ?? '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  const userIds = Array.from(new Set([...CLIENT_POLL_USER_IDS, ...configuredIds]));

  await Promise.all(
    userIds.map(async userId => {
      try {
        const snap = await firestore.collection('users').doc(userId).get();
        const facebook = (snap.data() as { socialAccounts?: { facebook?: { pageId?: string; accessToken?: string } } } | undefined)
          ?.socialAccounts?.facebook;
        if (facebook?.pageId && facebook.accessToken) {
          targets.push({ userId, pageId: facebook.pageId, accessToken: facebook.accessToken });
          return;
        }
      } catch (error) {
        console.warn('[fb-comment-poll] Firestore target lookup failed', userId, (error as Error).message);
      }

      try {
        const fallback = await supabaseFallbackService.getSocialAccounts(userId);
        const facebook = (fallback?.socialAccounts as { facebook?: { pageId?: string; accessToken?: string } } | undefined)
          ?.facebook;
        if (facebook?.pageId && facebook.accessToken) {
          targets.push({ userId, pageId: facebook.pageId, accessToken: facebook.accessToken });
        }
      } catch (error) {
        console.warn('[fb-comment-poll] Supabase target lookup failed', userId, (error as Error).message);
      }
    }),
  );

  const seen = new Set<string>();
  return targets.filter(target => {
    const key = `${target.pageId}:${target.accessToken}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const pollFacebookCommentsOnce = async () => {
  const targets = await loadClientTargets();
  if (!targets.length) {
    console.warn('[fb-comment-poll] missing Facebook credentials; polling skipped');
    return;
  }

  for (const target of targets) {
    try {
      const posts = await fetchRecentPosts(target.pageId, target.accessToken);
      for (const post of posts) {
        const comments = await fetchComments(post.id, target.accessToken);
        for (const comment of comments) {
          await processComment(comment, target);
        }
      }
    } catch (error) {
      console.warn('[fb-comment-poll] poll failed', {
        pageId: target.pageId,
        error: (error as Error).message,
      });
    }
  }
};

export function scheduleFacebookCommentPollJob() {
  if (!enabled) {
    console.info('[fb-comment-poll] disabled');
    return;
  }

  cron.schedule(scheduleExpression, async () => {
    await pollFacebookCommentsOnce();
  });
  console.info(`[fb-comment-poll] job scheduled (${scheduleExpression}).`);

  if (process.env.META_COMMENT_POLL_ON_STARTUP === 'true') {
    void pollFacebookCommentsOnce();
  }
}

scheduleFacebookCommentPollJob();
