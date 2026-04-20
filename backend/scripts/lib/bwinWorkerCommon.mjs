import crypto from 'crypto';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

export const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
export const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
export const GRAPH_VERSION = (process.env.META_GRAPH_VERSION || 'v19.0').trim();
export const WORKER_CONFIG_BUCKET = 'worker-config';
export const WORKER_CONFIG_OBJECT = 'bwin-meta-accounts.json';
export const BWIN_USER_ID = (process.env.BWIN_USER_ID || '1zvY9nNyXMcfxdPQEyx0bIdK7r53').trim();

export function requireEnv(name, value) {
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function supabaseHeaders(contentType = 'application/json') {
  return {
    apikey: requireEnv('SUPABASE_SERVICE_ROLE_KEY', SUPABASE_SERVICE_ROLE_KEY),
    Authorization: `Bearer ${requireEnv('SUPABASE_SERVICE_ROLE_KEY', SUPABASE_SERVICE_ROLE_KEY)}`,
    'Content-Type': contentType,
  };
}

export async function getBwinAccounts() {
  if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const response = await axios.get(
        `${SUPABASE_URL}/storage/v1/object/authenticated/${WORKER_CONFIG_BUCKET}/${WORKER_CONFIG_OBJECT}`,
        {
          headers: {
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
          timeout: 30000,
        },
      );
      const payload = response.data || {};
      return {
        facebook: payload.facebook || {},
        instagram: payload.instagram || {},
      };
    } catch (error) {
      const status = error?.response?.status;
      const message = error?.response?.data?.error ?? error?.message;
      console.warn('[bwin-common] supabase config fetch failed', status, message);
    }
  }

  const fallback = {
    facebook: {
      pageId: (process.env.BWIN_FACEBOOK_PAGE_ID || '').trim(),
      accessToken: (process.env.BWIN_FACEBOOK_PAGE_TOKEN || '').trim(),
    },
    instagram: {
      accountId: (process.env.BWIN_INSTAGRAM_ACCOUNT_ID || '').trim(),
      accessToken: (process.env.BWIN_INSTAGRAM_ACCESS_TOKEN || '').trim(),
    },
  };

  if (
    fallback.facebook.pageId &&
    fallback.facebook.accessToken &&
    fallback.instagram.accountId &&
    fallback.instagram.accessToken
  ) {
    return fallback;
  }

  throw new Error('Bwin Meta accounts missing (supabase config + env fallback unavailable).');
}

export async function uploadImageBuffer(buffer, options = {}) {
  requireEnv('SUPABASE_URL', SUPABASE_URL);
  const bucket = (options.bucket || 'bwin-news').trim();
  const extension = (options.extension || 'jpg').trim().replace(/^\./, '') || 'jpg';
  const contentType = (options.contentType || 'image/jpeg').trim() || 'image/jpeg';
  const prefix = (options.prefix || new Date().toISOString().slice(0, 10)).trim() || new Date().toISOString().slice(0, 10);
  const objectPath = `${prefix}/${crypto.randomUUID()}.${extension}`;

  await axios.post(`${SUPABASE_URL}/storage/v1/object/${bucket}/${objectPath}`, buffer, {
    headers: {
      ...supabaseHeaders(contentType),
      'x-upsert': 'true',
    },
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    timeout: 60000,
  });

  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${objectPath}`;
}

export async function publishToInstagramImage({ accountId, accessToken, imageUrl, caption }) {
  const baseUrl = `https://graph.facebook.com/${GRAPH_VERSION}/${accountId}`;
  const create = await axios.post(
    `${baseUrl}/media`,
    new URLSearchParams({
      image_url: imageUrl,
      caption,
      access_token: accessToken,
    }),
    { timeout: 60000 },
  );
  const creationId = create.data?.id;
  const publish = await axios.post(
    `${baseUrl}/media_publish`,
    new URLSearchParams({
      creation_id: creationId,
      access_token: accessToken,
    }),
    { timeout: 60000 },
  );
  return {
    creationId,
    remoteId: publish.data?.id || creationId || null,
  };
}

export async function publishToFacebookImage({ pageId, accessToken, imageUrl, caption }) {
  const response = await axios.post(
    `https://graph.facebook.com/${GRAPH_VERSION}/${pageId}/photos`,
    new URLSearchParams({
      url: imageUrl,
      message: caption,
      access_token: accessToken,
    }),
    { timeout: 60000 },
  );
  return {
    remoteId: response.data?.post_id || response.data?.id || null,
  };
}

export async function upsertScheduledRows(rows) {
  if (!rows?.length) return;
  requireEnv('SUPABASE_URL', SUPABASE_URL);
  await axios.post(`${SUPABASE_URL}/rest/v1/dott_scheduled_posts`, rows, {
    headers: {
      ...supabaseHeaders(),
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    params: { on_conflict: 'id' },
    timeout: 30000,
  });
}

export async function queryScheduledRows(params = {}) {
  requireEnv('SUPABASE_URL', SUPABASE_URL);
  const response = await axios.get(`${SUPABASE_URL}/rest/v1/dott_scheduled_posts`, {
    headers: supabaseHeaders(),
    params,
    timeout: 30000,
  });
  return Array.isArray(response.data) ? response.data : [];
}

export async function queryScheduledRowById(id, select = 'id') {
  const rows = await queryScheduledRows({
    select,
    id: `eq.${id}`,
    limit: 1,
  });
  return rows[0] || null;
}
