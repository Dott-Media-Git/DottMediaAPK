import cron from 'node-cron';
import axios from 'axios';
import admin from 'firebase-admin';
import { config } from '../config.js';
import { firestore } from '../db/firestore.js';
import { generateReply, likeInstagramComment, replyToInstagramComment } from '../services/autoReplyService.js';
const GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? 'v19.0';
const enabled = process.env.IG_COMMENT_POLL_ENABLED !== 'false';
const scheduleExpression = process.env.IG_COMMENT_POLL_CRON ?? '*/1 * * * *';
const mediaLimit = Math.max(Number(process.env.IG_COMMENT_MEDIA_LIMIT ?? 5), 1);
const commentLimit = Math.max(Number(process.env.IG_COMMENT_LIMIT ?? 10), 1);
const windowHours = Math.max(Number(process.env.IG_COMMENT_WINDOW_HOURS ?? 24), 1);
const isAlreadyExistsError = (error) => {
    const err = error;
    return err.code === 6 || err.code === 'already-exists' || err.message?.includes('ALREADY_EXISTS') === true;
};
const withinWindow = (timestamp) => {
    if (!timestamp)
        return true;
    const createdAt = new Date(timestamp).getTime();
    if (!Number.isFinite(createdAt))
        return true;
    return Date.now() - createdAt <= windowHours * 60 * 60 * 1000;
};
const fetchRecentMedia = async (igBusinessId, accessToken) => {
    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${igBusinessId}/media`;
    const response = await axios.get(url, {
        params: {
            fields: 'id,timestamp',
            limit: mediaLimit,
            access_token: accessToken,
        },
    });
    return response.data?.data ?? [];
};
const fetchComments = async (mediaId, accessToken) => {
    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${mediaId}/comments`;
    const response = await axios.get(url, {
        params: {
            fields: 'id,text,timestamp,from',
            limit: commentLimit,
            access_token: accessToken,
        },
    });
    return response.data?.data ?? [];
};
const upsertReplyStatus = async (docRef, status, error) => {
    const update = {
        replyStatus: status,
        replyAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (error)
        update.replyError = error;
    await docRef.update(update);
};
const processComment = async (comment, igBusinessId, accessToken) => {
    const commentId = comment.id;
    const text = comment.text?.trim();
    const fromId = comment.from?.id;
    if (!commentId || !text)
        return;
    if (fromId && fromId === igBusinessId)
        return;
    if (!withinWindow(comment.timestamp))
        return;
    const dedupeKey = `instagram_comment_${commentId}`;
    const docRef = firestore.collection('messages').doc(dedupeKey);
    try {
        await docRef.create({
            platform: 'instagram',
            type: 'comment',
            senderId: fromId,
            text,
            commentId,
            source: 'poller',
            replyStatus: 'pending',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
    }
    catch (error) {
        if (isAlreadyExistsError(error))
            return;
        throw error;
    }
    try {
        const reply = await generateReply(text, 'instagram', undefined, 'comment');
        await replyToInstagramComment(commentId, reply, accessToken);
        await upsertReplyStatus(docRef, 'sent');
        await likeInstagramComment(commentId, accessToken).catch(err => console.warn('[ig-comment-poll] like failed', err.message));
    }
    catch (error) {
        await upsertReplyStatus(docRef, 'failed', error.message);
        console.warn('[ig-comment-poll] reply failed', error.message);
    }
};
const pollOnce = async () => {
    const igBusinessId = config.channels.instagram.businessId;
    const accessToken = config.channels.instagram.accessToken;
    if (!igBusinessId || !accessToken) {
        console.warn('[ig-comment-poll] missing IG credentials; polling skipped');
        return;
    }
    try {
        const media = await fetchRecentMedia(igBusinessId, accessToken);
        for (const item of media) {
            const comments = await fetchComments(item.id, accessToken);
            for (const comment of comments) {
                await processComment(comment, igBusinessId, accessToken);
            }
        }
    }
    catch (error) {
        console.warn('[ig-comment-poll] poll failed', error.message);
    }
};
export function scheduleInstagramCommentPollJob() {
    if (!enabled) {
        console.info('[ig-comment-poll] disabled');
        return;
    }
    cron.schedule(scheduleExpression, async () => {
        await pollOnce();
    });
    console.info(`[ig-comment-poll] job scheduled (${scheduleExpression}).`);
    void pollOnce();
}
scheduleInstagramCommentPollJob();
