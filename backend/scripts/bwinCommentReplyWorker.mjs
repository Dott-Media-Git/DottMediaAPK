import axios from 'axios';

const BWIN_USER_ID = process.env.BWIN_USER_ID || '1zvY9nNyXMcfxdPQEyx0bIdK7r53';
const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v19.0';
const WORKER_TAG = 'bwin_comment_reply_worker';
const WORKER_CONFIG_BUCKET = 'worker-config';
const WORKER_CONFIG_OBJECT = 'bwin-meta-accounts.json';
const IG_MEDIA_LIMIT = Math.max(Number(process.env.BWIN_COMMENT_MEDIA_LIMIT ?? 12), 1);
const COMMENT_LIMIT = Math.max(Number(process.env.BWIN_COMMENT_LIMIT ?? 10), 1);
const WINDOW_HOURS = Math.max(Number(process.env.BWIN_COMMENT_WINDOW_HOURS ?? 48), 1);

function requireEnv(name, value) {
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function supabaseHeaders() {
  return {
    apikey: requireEnv('SUPABASE_SERVICE_ROLE_KEY', SUPABASE_SERVICE_ROLE_KEY),
    Authorization: `Bearer ${requireEnv('SUPABASE_SERVICE_ROLE_KEY', SUPABASE_SERVICE_ROLE_KEY)}`,
    'Content-Type': 'application/json',
  };
}

async function getBwinAccounts() {
  const response = await axios.get(
    `${requireEnv('SUPABASE_URL', SUPABASE_URL)}/storage/v1/object/authenticated/${WORKER_CONFIG_BUCKET}/${WORKER_CONFIG_OBJECT}`,
    {
      headers: {
        apikey: requireEnv('SUPABASE_SERVICE_ROLE_KEY', SUPABASE_SERVICE_ROLE_KEY),
        Authorization: `Bearer ${requireEnv('SUPABASE_SERVICE_ROLE_KEY', SUPABASE_SERVICE_ROLE_KEY)}`,
      },
      timeout: 30000,
    },
  );
  const payload = response.data || {};
  const facebook = payload.facebook || {};
  const instagram = payload.instagram || {};
  if (!facebook.pageId || !facebook.accessToken || !instagram.accountId || !instagram.accessToken) {
    throw new Error('Bwin Meta worker config is incomplete');
  }
  return { facebook, instagram };
}

function isWithinWindow(timestamp) {
  if (!timestamp) return true;
  const createdAt = new Date(timestamp).getTime();
  if (!Number.isFinite(createdAt)) return true;
  return Date.now() - createdAt <= WINDOW_HOURS * 60 * 60 * 1000;
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function buildReply(text) {
  const body = normalizeText(text).toLowerCase();
  if (!body) {
    return 'Thanks for the support. For more football updates or to place bets, follow the link in the bio.';
  }
  if (body.includes('?') || /\b(odds|which|when|where|who|how|ticket|bet|tips|prediction|fixture|game|match)\b/.test(body)) {
    return 'Thanks for the support. For more football updates or to place bets, follow the link in the bio.';
  }
  if (/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\s!?.]+$/u.test(body) || body.length <= 12) {
    return 'Thanks for the support. For more football updates or to place bets, follow the link in the bio.';
  }
  return 'Thanks for the support. For more football updates or to place bets, follow the link in the bio.';
}

async function hasProcessedComment(externalKey) {
  const response = await axios.get(`${SUPABASE_URL}/rest/v1/dott_social_logs`, {
    headers: supabaseHeaders(),
    params: {
      select: 'id,status',
      user_id: `eq.${BWIN_USER_ID}`,
      scheduled_post_id: `eq.${externalKey}`,
      limit: 1,
    },
    timeout: 30000,
  });
  return Array.isArray(response.data) && response.data.length > 0;
}

async function appendLogs(entries) {
  if (!entries.length) return;
  await axios.post(`${SUPABASE_URL}/rest/v1/dott_social_logs`, entries, {
    headers: {
      ...supabaseHeaders(),
      Prefer: 'return=minimal',
    },
    timeout: 30000,
  });
}

async function fetchInstagramMedia(instagram) {
  const response = await axios.get(`https://graph.facebook.com/${GRAPH_VERSION}/${instagram.accountId}/media`, {
    params: {
      access_token: instagram.accessToken,
      fields: 'id,timestamp,permalink',
      limit: IG_MEDIA_LIMIT,
    },
    timeout: 30000,
  });
  return response.data?.data || [];
}

async function fetchInstagramComments(mediaId, instagram) {
  const response = await axios.get(`https://graph.facebook.com/${GRAPH_VERSION}/${mediaId}/comments`, {
    params: {
      access_token: instagram.accessToken,
      fields: 'id,text,timestamp,from,username,replies{id,from{id,username}}',
      limit: COMMENT_LIMIT,
    },
    timeout: 30000,
  });
  return response.data?.data || [];
}

async function fetchFacebookPosts(facebook) {
  const response = await axios.get(`https://graph.facebook.com/${GRAPH_VERSION}/${facebook.pageId}/posts`, {
    params: {
      access_token: facebook.accessToken,
      fields: 'id,message,created_time,permalink_url',
      limit: IG_MEDIA_LIMIT,
    },
    timeout: 30000,
  });
  return response.data?.data || [];
}

async function fetchFacebookComments(postId, facebook) {
  const response = await axios.get(`https://graph.facebook.com/${GRAPH_VERSION}/${postId}/comments`, {
    params: {
      access_token: facebook.accessToken,
      fields: 'id,message,created_time,from',
      limit: COMMENT_LIMIT,
    },
    timeout: 30000,
  });
  return response.data?.data || [];
}

async function replyToInstagramComment(commentId, message, instagram) {
  await axios.post(`https://graph.facebook.com/${GRAPH_VERSION}/${commentId}/likes`, null, {
    params: { access_token: instagram.accessToken },
    timeout: 30000,
  }).catch(() => {});
  return axios.post(`https://graph.facebook.com/${GRAPH_VERSION}/${commentId}/replies`, null, {
    params: {
      access_token: instagram.accessToken,
      message,
    },
    timeout: 30000,
  });
}

async function replyToFacebookComment(commentId, message, facebook) {
  await axios.post(`https://graph.facebook.com/${GRAPH_VERSION}/${commentId}/likes`, null, {
    params: { access_token: facebook.accessToken },
    timeout: 30000,
  }).catch(() => {});
  return axios.post(`https://graph.facebook.com/${GRAPH_VERSION}/${commentId}/comments`, null, {
    params: {
      access_token: facebook.accessToken,
      message,
    },
    timeout: 30000,
  });
}

function hasExistingInstagramReply(comment, instagram) {
  const replies = Array.isArray(comment?.replies?.data) ? comment.replies.data : [];
  const selfUsername = normalizeText(instagram.username).toLowerCase();
  return replies.some(reply => {
    const fromId = normalizeText(reply?.from?.id);
    const fromUsername = normalizeText(reply?.from?.username).toLowerCase();
    return fromId === normalizeText(instagram.accountId) || (selfUsername && fromUsername === selfUsername);
  });
}

function buildLogEntry(platform, externalKey, status, payload, responseId = null, error = null) {
  return {
    user_id: BWIN_USER_ID,
    platform,
    scheduled_post_id: externalKey,
    status,
    response_id: responseId,
    error,
    posted_at: new Date().toISOString(),
    payload,
  };
}

async function processInstagramComments(instagram) {
  const media = await fetchInstagramMedia(instagram);
  const logs = [];
  let replied = 0;
  let skipped = 0;

  for (const item of media) {
    const comments = await fetchInstagramComments(item.id, instagram);
    for (const comment of comments) {
      const commentId = comment?.id;
      const text = normalizeText(comment?.text);
      const username = normalizeText(comment?.from?.username || comment?.username).toLowerCase();
      const fromId = normalizeText(comment?.from?.id);
      const selfUsername = normalizeText(instagram.username).toLowerCase();
      if (!commentId || !text || !isWithinWindow(comment?.timestamp)) continue;
      if (fromId === normalizeText(instagram.accountId) || (selfUsername && username === selfUsername)) continue;
      if (hasExistingInstagramReply(comment, instagram)) {
        skipped += 1;
        continue;
      }

      const externalKey = `external:comment:instagram:${commentId}`;
      if (await hasProcessedComment(externalKey)) {
        skipped += 1;
        continue;
      }

      const reply = buildReply(text);
      const payload = {
        worker: WORKER_TAG,
        platform: 'instagram',
        mediaId: item.id,
        permalink: item.permalink,
        commentId,
        commentText: text,
        from: comment?.from || null,
        reply,
      };

      try {
        const response = await replyToInstagramComment(commentId, reply, instagram);
        logs.push(buildLogEntry('instagram_comment_reply', externalKey, 'posted', payload, response?.data?.id || null, null));
        replied += 1;
      } catch (error) {
        logs.push(
          buildLogEntry(
            'instagram_comment_reply',
            externalKey,
            'failed',
            payload,
            null,
            error instanceof Error ? error.message : String(error),
          ),
        );
      }
    }
  }

  await appendLogs(logs);
  return { replied, skipped, logs: logs.length };
}

async function processFacebookComments(facebook) {
  const logs = [];
  let replied = 0;
  let skipped = 0;

  try {
    const posts = await fetchFacebookPosts(facebook);
    for (const post of posts) {
      const comments = await fetchFacebookComments(post.id, facebook);
      for (const comment of comments) {
        const commentId = comment?.id;
        const text = normalizeText(comment?.message);
        if (!commentId || !text || !isWithinWindow(comment?.created_time)) continue;

        const externalKey = `external:comment:facebook:${commentId}`;
        if (await hasProcessedComment(externalKey)) {
          skipped += 1;
          continue;
        }

        const reply = buildReply(text);
        const payload = {
          worker: WORKER_TAG,
          platform: 'facebook',
          postId: post.id,
          permalink: post.permalink_url,
          commentId,
          commentText: text,
          from: comment?.from || null,
          reply,
        };

        try {
          const response = await replyToFacebookComment(commentId, reply, facebook);
          logs.push(buildLogEntry('facebook_comment_reply', externalKey, 'posted', payload, response?.data?.id || null, null));
          replied += 1;
        } catch (error) {
          logs.push(
            buildLogEntry(
              'facebook_comment_reply',
              externalKey,
              'failed',
              payload,
              null,
              error instanceof Error ? error.message : String(error),
            ),
          );
        }
      }
    }
  } catch (error) {
    const data = error?.response?.data;
    const code = data?.error?.code;
    const message = data ? JSON.stringify(data) : (error instanceof Error ? error.message : String(error));
    if (code === 10) {
      console.warn('[bwin-comment-reply-worker] facebook comment read unavailable', message);
    } else {
      logs.push(
        buildLogEntry('facebook_comment_reply_worker', 'external:comment:facebook:worker', 'failed', { worker: WORKER_TAG }, null, message),
      );
    }
  }

  await appendLogs(logs);
  return { replied, skipped, logs: logs.length };
}

async function main() {
  requireEnv('SUPABASE_URL', SUPABASE_URL);
  requireEnv('SUPABASE_SERVICE_ROLE_KEY', SUPABASE_SERVICE_ROLE_KEY);

  const { facebook, instagram } = await getBwinAccounts();
  const [igResult, fbResult] = await Promise.all([
    processInstagramComments(instagram),
    processFacebookComments(facebook),
  ]);

  console.log(
    JSON.stringify({
      ok: true,
      worker: WORKER_TAG,
      instagram: igResult,
      facebook: fbResult,
    }),
  );
}

main().catch(error => {
  console.error('[bwin-comment-reply-worker] failed', error);
  process.exit(1);
});
