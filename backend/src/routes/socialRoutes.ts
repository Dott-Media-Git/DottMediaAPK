import { Router, Request } from 'express';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import admin from 'firebase-admin';
import { z } from 'zod';
import { requireFirebase, AuthedRequest } from '../middleware/firebaseAuth';
import { socialSchedulingService } from '../packages/services/socialSchedulingService';
import { consumeUsage, resolveBillingScope } from '../services/billing/billingService';
import { socialPostingService } from '../packages/services/socialPostingService';
import { socialAnalyticsService } from '../packages/services/socialAnalyticsService';
import { autoPostService } from '../services/autoPostService';
import { supabaseFallbackService } from '../services/supabaseFallbackService';
import { firestore } from '../db/firestore';
import { config } from '../config';
import { getTikTokIntegration, getYouTubeIntegration } from '../services/socialIntegrationService';
import { resolveFacebookPageId, resolveInstagramAccountId, resolveThreadsAccountId } from '../services/socialAccountResolver';
import { fetchBwinMetaSocialProfile, resolveKnownLiveSocialProfile } from '../services/liveSocialMetricsService';
import { canUsePrimarySocialDefaults } from '../utils/socialAccess';
import { createSignedState, verifySignedState } from '../utils/oauthState';

const CRON_SECRET = process.env.CRON_SECRET;
const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? 'v23.0';
const META_GRAPH_BASE = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
const THREADS_GRAPH_VERSION = process.env.THREADS_GRAPH_VERSION ?? 'v1.0';
const THREADS_GRAPH_BASE_URL = process.env.THREADS_GRAPH_BASE_URL ?? 'https://graph.threads.net';
const HISTORY_LIVE_FETCH_TIMEOUT_MS = Math.max(Number(process.env.HISTORY_LIVE_FETCH_TIMEOUT_MS ?? 6000), 1000);
const HISTORY_DAILY_TIMEOUT_MS = Math.max(Number(process.env.HISTORY_DAILY_TIMEOUT_MS ?? 5000), 1000);

const router = Router();

type RenderEnv = Record<string, string>;
type MetaSignedRequestPayload = {
  algorithm?: string;
  issued_at?: number;
  user_id?: string;
  [key: string]: unknown;
};

let renderEnvCache: RenderEnv | null | undefined;

const BWIN_USER_ID = (process.env.BWIN_USER_ID ?? '1zvY9nNyXMcfxdPQEyx0bIdK7r53').trim();
const BWIN_SCOPE_ALIASES = new Set(['bwinbetug', BWIN_USER_ID, process.env.BWIN_SCOPE_ID, process.env.BWIN_TRACK_OWNER_ID].filter(Boolean));

const isBwinHistoryRequest = (...values: Array<string | null | undefined>) =>
  values.some(value => {
    const normalized = String(value ?? '').trim();
    return normalized ? BWIN_SCOPE_ALIASES.has(normalized) || normalized.toLowerCase().includes('ball_analytics') : false;
  });

const toHistoryTimestamp = (value: string | number | Date) => {
  const millis = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(millis) ? { seconds: Math.floor(millis / 1000) } : undefined;
};

const deriveFacebookPageToken = async (pageId: string, accessToken: string) => {
  try {
    const response = await axios.get(`${META_GRAPH_BASE}/me/accounts`, {
      params: { fields: 'id,access_token', access_token: accessToken },
      timeout: 30000,
    });
    const page = (Array.isArray(response.data?.data) ? response.data.data : []).find(
      (entry: any) => String(entry?.id ?? '') === pageId,
    );
    return String(page?.access_token ?? accessToken).trim();
  } catch {
    return accessToken;
  }
};

type LiveHistoryProfile = NonNullable<ReturnType<typeof resolveKnownLiveSocialProfile>>;

const mergeLiveHistoryProfiles = (...profiles: Array<LiveHistoryProfile | null | undefined>): LiveHistoryProfile | null => {
  const merged = profiles.reduce<LiveHistoryProfile | null>((acc, profile) => {
    if (!profile) return acc;
    return {
      id: acc?.id ?? profile.id,
      email: acc?.email ?? profile.email,
      socialAccounts: {
        ...(acc?.socialAccounts ?? {}),
        ...(profile.socialAccounts ?? {}),
      },
    };
  }, null);
  return merged?.socialAccounts ? merged : null;
};

const fetchKnownMetaHistoryPosts = async (knownProfile: LiveHistoryProfile | null) => {
  if (!knownProfile?.socialAccounts) return [];
  const posts: any[] = [];
  const facebook = knownProfile.socialAccounts.facebook;
  if (facebook?.pageId && facebook?.accessToken) {
    try {
      const pageToken = await deriveFacebookPageToken(String(facebook.pageId), String(facebook.accessToken));
      const response = await axios.get(`${META_GRAPH_BASE}/${facebook.pageId}/posts`, {
        params: {
          fields: 'id,created_time,message,permalink_url,full_picture',
          limit: 50,
          access_token: pageToken,
        },
        timeout: 30000,
      });
      (Array.isArray(response.data?.data) ? response.data.data : []).forEach((post: any) => {
        const createdAt = toHistoryTimestamp(String(post?.created_time ?? ''));
        if (!post?.id || !createdAt) return;
        posts.push({
          id: `meta-facebook-${post.id}`,
          platform: 'facebook',
          status: 'posted',
          caption: String(post.message ?? ''),
          remoteId: String(post.id),
          postedAt: createdAt,
          createdAt,
          imageUrls: post.full_picture ? [String(post.full_picture)] : [],
          permalink: post.permalink_url ?? null,
          source: 'meta_live',
        });
      });
    } catch (error) {
      console.warn('[social-history-route] live Facebook history fetch failed', error instanceof Error ? error.message : String(error));
    }
  }

  const instagram = knownProfile.socialAccounts.instagram;
  if (instagram?.accountId && instagram?.accessToken) {
    try {
      const response = await axios.get(`${META_GRAPH_BASE}/${instagram.accountId}/media`, {
        params: {
          fields: 'id,timestamp,caption,media_type,media_product_type,media_url,permalink,thumbnail_url',
          limit: 50,
          access_token: instagram.accessToken,
        },
        timeout: 30000,
      });
      (Array.isArray(response.data?.data) ? response.data.data : []).forEach((post: any) => {
        const createdAt = toHistoryTimestamp(String(post?.timestamp ?? ''));
        if (!post?.id || !createdAt) return;
        const productType = String(post.media_product_type ?? '').toUpperCase();
        const mediaType = String(post.media_type ?? '').toUpperCase();
        const platform =
          productType === 'STORY'
            ? 'instagram_story'
            : productType === 'REELS' || mediaType === 'VIDEO'
              ? 'instagram_reels'
              : 'instagram';
        const mediaUrl = post.media_url || post.thumbnail_url;
        posts.push({
          id: `meta-instagram-${post.id}`,
          platform,
          status: 'posted',
          caption: String(post.caption ?? ''),
          remoteId: String(post.id),
          postedAt: createdAt,
          createdAt,
          imageUrls: mediaUrl ? [String(mediaUrl)] : [],
          videoUrl: mediaType === 'VIDEO' && post.media_url ? String(post.media_url) : undefined,
          permalink: post.permalink ?? null,
          source: 'meta_live',
        });
      });
    } catch (error) {
      console.warn('[social-history-route] live Instagram history fetch failed', error instanceof Error ? error.message : String(error));
    }
  }

  const threads = knownProfile.socialAccounts.threads;
  if (threads?.accountId && threads?.accessToken) {
    try {
      const response = await axios.get(`${THREADS_GRAPH_BASE_URL}/${THREADS_GRAPH_VERSION}/${threads.accountId}/threads`, {
        params: {
          fields: 'id,timestamp,text,media_product_type,permalink',
          limit: 50,
          access_token: threads.accessToken,
        },
        timeout: 30000,
      });
      (Array.isArray(response.data?.data) ? response.data.data : []).forEach((post: any) => {
        const createdAt = toHistoryTimestamp(String(post?.timestamp ?? ''));
        if (!post?.id || !createdAt) return;
        posts.push({
          id: `threads-${post.id}`,
          platform: 'threads',
          status: 'posted',
          caption: String(post.text ?? ''),
          remoteId: String(post.id),
          postedAt: createdAt,
          createdAt,
          imageUrls: [],
          permalink: post.permalink ?? null,
          source: 'threads_live',
        });
      });
    } catch (error) {
      console.warn('[social-history-route] live Threads history fetch failed', error instanceof Error ? error.message : String(error));
    }
  }
  return posts;
};

const fetchSocialLogHistoryPosts = async (userId: string) => {
  if (!userId) return [];
  const posts: any[] = [];
  try {
    const snap = await firestore.collection('socialLogs').where('userId', '==', userId).orderBy('postedAt', 'desc').limit(100).get();
    snap.docs.forEach(doc => {
      const data = doc.data() as Record<string, any>;
      posts.push({
        id: `social-log-${doc.id}`,
        platform: String(data.platform ?? 'social'),
        status: String(data.status ?? 'posted'),
        remoteId: data.responseId ? String(data.responseId) : undefined,
        postedAt: data.postedAt ?? data.createdAt,
        createdAt: data.postedAt ?? data.createdAt,
        caption: '',
        source: 'social_log',
        error: data.error ?? null,
      });
    });
  } catch (error) {
    console.warn('[social-history-route] Firestore social log history fetch failed', error instanceof Error ? error.message : String(error));
  }
  try {
    const logs = await supabaseFallbackService.getSocialLogsByUser(userId, 100);
    logs.forEach((log: any, index: number) => {
      posts.push({
        id: `supabase-social-log-${log.responseId ?? log.scheduledPostId ?? index}`,
        platform: String(log.platform ?? 'social'),
        status: String(log.status ?? 'posted'),
        remoteId: log.responseId ? String(log.responseId) : undefined,
        postedAt: log.postedAt,
        createdAt: log.postedAt,
        caption: '',
        source: 'social_log',
        error: log.error ?? null,
      });
    });
  } catch (error) {
    console.warn('[social-history-route] Supabase social log history fetch failed', error instanceof Error ? error.message : String(error));
  }
  return posts;
};

const withFallbackTimeout = async <T,>(label: string, promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> => {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>(resolve => {
        timeout = setTimeout(() => {
          console.warn(`[social-history-route] ${label} timed out after ${timeoutMs}ms`);
          resolve(fallback);
        }, timeoutMs);
      }),
    ]);
  } catch (error) {
    console.warn(`[social-history-route] ${label} failed`, error instanceof Error ? error.message : String(error));
    return fallback;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};

const timestampSeconds = (value: any) => {
  if (!value) return 0;
  if (typeof value === 'number') return value > 1e12 ? Math.floor(value / 1000) : Math.floor(value);
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : Math.floor(parsed / 1000);
  }
  if (value instanceof Date) return Math.floor(value.getTime() / 1000);
  if (typeof value.toDate === 'function') return Math.floor(value.toDate().getTime() / 1000);
  if (typeof value.toMillis === 'function') return Math.floor(value.toMillis() / 1000);
  if (typeof value.seconds === 'number') return value.seconds;
  if (typeof value._seconds === 'number') return value._seconds;
  return 0;
};

const isUserFacingHistoryPlatform = (platform?: string) => {
  const raw = String(platform ?? '').toLowerCase().trim();
  return Boolean(raw) && raw !== 'social' && !raw.endsWith('_worker');
};

const mergeHistoryPosts = (basePosts: any[], livePosts: any[]) => {
  const byKey = new Map<string, any>();
  [...basePosts, ...livePosts].forEach(post => {
    if (!isUserFacingHistoryPlatform(post.platform)) return;
    const key = String(post.remoteId || post.id || `${post.platform}-${timestampSeconds(post.postedAt ?? post.createdAt)}`);
    const existing = byKey.get(key);
    if (!existing || timestampSeconds(post.postedAt ?? post.createdAt) > timestampSeconds(existing.postedAt ?? existing.createdAt)) {
      byKey.set(key, post);
    }
  });
  return Array.from(byKey.values()).sort(
    (a, b) => timestampSeconds(b.postedAt ?? b.createdAt) - timestampSeconds(a.postedAt ?? a.createdAt),
  );
};

const buildHistorySummary = (posts: any[]) =>
  posts.reduce(
    (acc, post) => {
      const platform = String(post.platform ?? 'unknown');
      const status = String(post.status ?? 'unknown');
      acc.perPlatform[platform] = (acc.perPlatform[platform] ?? 0) + 1;
      acc.byStatus[status] = (acc.byStatus[status] ?? 0) + 1;
      return acc;
    },
    { perPlatform: {} as Record<string, number>, byStatus: {} as Record<string, number> },
  );

const normalizePostedPlatformForSummary = (platform?: string) => {
  const raw = String(platform ?? '').toLowerCase();
  if (!raw || raw.endsWith('_worker') || raw === 'social') return '';
  if (raw === 'instagram_story' || raw === 'instagram_reels') return 'instagram';
  if (raw === 'facebook_story') return 'facebook';
  if (raw === 'twitter') return 'x';
  return raw;
};

const buildTodayHistory = (posts: any[]) => {
  const todayDate = new Date().toISOString().slice(0, 10);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todaySeconds = Math.floor(todayStart.getTime() / 1000);
  const todayPosts = posts.filter(post => post.status === 'posted' && timestampSeconds(post.postedAt ?? post.createdAt) >= todaySeconds);
  const todaySummary = todayPosts.reduce(
    (acc, post) => {
      acc.totalPosted += 1;
      const platform = normalizePostedPlatformForSummary(post.platform);
      if (platform) acc.perPlatform[platform] = (acc.perPlatform[platform] ?? 0) + 1;
      if (post.videoUrl || ['instagram_reels', 'youtube', 'tiktok'].includes(String(post.platform ?? '').toLowerCase())) {
        acc.videoPosts += 1;
      }
      return acc;
    },
    { date: todayDate, totalPosted: 0, videoPosts: 0, perPlatform: {} as Record<string, number> },
  );
  return { todayPosts, todaySummary };
};

const normalizeBaseUrl = (value: string) => value.replace(/\/+$/, '');

const resolveRenderEnv = (): RenderEnv => {
  if (renderEnvCache !== undefined) {
    return renderEnvCache ?? {};
  }

  const candidates = [
    path.resolve(process.cwd(), '.render-env.json'),
    path.resolve(process.cwd(), 'backend/.render-env.json'),
  ];

  for (const candidate of candidates) {
    try {
      if (!fs.existsSync(candidate)) continue;
      const raw = fs.readFileSync(candidate, 'utf8').replace(/^\uFEFF/, '');
      renderEnvCache = JSON.parse(raw) as RenderEnv;
      return renderEnvCache;
    } catch (error) {
      console.warn('[threads] failed to parse .render-env.json fallback', error);
    }
  }

  renderEnvCache = {};
  return renderEnvCache;
};

const getBaseUrl = (req: Request) => {
  const envBase = process.env.BASE_URL ?? process.env.RENDER_EXTERNAL_URL;
  if (envBase) return normalizeBaseUrl(envBase);
  const forwardedProto = (req.header('x-forwarded-proto') || '').split(',')[0].trim();
  const proto = forwardedProto || req.protocol;
  const forwardedHost = (req.header('x-forwarded-host') || '').split(',')[0].trim();
  const host = forwardedHost || req.get('host');
  return normalizeBaseUrl(`${proto}://${host}`);
};

const getThreadsAppConfig = (req: Request) => {
  const renderEnv = resolveRenderEnv();
  const appId =
    process.env.THREADS_APP_ID ??
    process.env.INSTAGRAM_APP_ID ??
    process.env.META_APP_ID ??
    renderEnv.THREADS_APP_ID ??
    renderEnv.INSTAGRAM_APP_ID ??
    renderEnv.META_APP_ID ??
    '';
  const appSecret =
    process.env.THREADS_APP_SECRET ??
    process.env.INSTAGRAM_APP_SECRET ??
    process.env.META_APP_SECRET ??
    renderEnv.THREADS_APP_SECRET ??
    renderEnv.INSTAGRAM_APP_SECRET ??
    renderEnv.META_APP_SECRET ??
    '';
  const redirectUri =
    process.env.THREADS_REDIRECT_URI ??
    renderEnv.THREADS_REDIRECT_URI ??
    `${getBaseUrl(req)}/api/social/threads/callback`;

  if (!appId || !appSecret) {
    throw new Error('Missing Threads app credentials');
  }

  return { appId, appSecret, redirectUri };
};

const getThreadsScopes = () => {
  const renderEnv = resolveRenderEnv();
  const raw = process.env.THREADS_APP_SCOPES ?? renderEnv.THREADS_APP_SCOPES ?? '';
  if (raw.trim()) {
    return raw
      .split(',')
      .map(scope => scope.trim())
      .filter(Boolean);
  }

  return ['threads_basic', 'threads_content_publish'];
};

const buildThreadsConnectUrl = (req: Request, userId: string, orgId?: string | null, email?: string | null) => {
  const { appId, redirectUri } = getThreadsAppConfig(req);
  const url = new URL(process.env.THREADS_AUTHORIZE_URL ?? 'https://threads.net/oauth/authorize');
  url.searchParams.set('client_id', appId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', getThreadsScopes().join(','));
  url.searchParams.set('state', createSignedState(userId, { orgId: orgId || undefined, email: email || undefined }));
  return url.toString();
};

const exchangeThreadsCodeForToken = async (req: Request, code: string) => {
  const { appId, appSecret, redirectUri } = getThreadsAppConfig(req);
  const body = new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
    code,
  });

  const response = await axios.post(`${THREADS_GRAPH_BASE_URL}/oauth/access_token`, body.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  return response.data?.access_token as string | undefined;
};

const exchangeThreadsLongLivedToken = async (req: Request, shortLivedToken: string) => {
  const { appSecret } = getThreadsAppConfig(req);
  const response = await axios.get(`${THREADS_GRAPH_BASE_URL}/access_token`, {
    params: {
      grant_type: 'th_exchange_token',
      client_secret: appSecret,
      access_token: shortLivedToken,
    },
  });
  return (response.data?.access_token as string | undefined) ?? shortLivedToken;
};

const fetchThreadsMe = async (accessToken: string) => {
  const response = await axios.get(`${THREADS_GRAPH_BASE_URL}/${THREADS_GRAPH_VERSION}/me`, {
    params: {
      fields: 'id,username',
      access_token: accessToken,
    },
  });
  return {
    id: response.data?.id as string | undefined,
    username: response.data?.username as string | undefined,
  };
};

const loadStoredSocialAccounts = async (userId: string) => {
  let userData: { email?: string | null; socialAccounts?: Record<string, any> } = {};

  try {
    const userDoc = await firestore.collection('users').doc(userId).get();
    userData = (userDoc.data() as { email?: string | null; socialAccounts?: Record<string, any> } | undefined) ?? {};
  } catch (error) {
    console.warn('[social] Firestore social account lookup failed; using fallback store', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (!userData.socialAccounts || Object.keys(userData.socialAccounts).length === 0) {
    try {
      const fallback = await supabaseFallbackService.getSocialAccounts(userId);
      if (fallback?.socialAccounts) {
        userData = {
          email: fallback.email ?? userData.email ?? null,
          socialAccounts: fallback.socialAccounts as Record<string, any>,
        };
      }
    } catch (error) {
      console.warn('[social] fallback social account lookup failed', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return userData;
};

const loadStatusSocialAccounts = async (userId: string, email?: string | null) => {
  const stored = await loadStoredSocialAccounts(userId);
  const knownProfile =
    resolveKnownLiveSocialProfile(userId) ||
    resolveKnownLiveSocialProfile(email) ||
    resolveKnownLiveSocialProfile(stored.email);
  const bwinProfile = isBwinHistoryRequest(userId, email, stored.email)
    ? await fetchBwinMetaSocialProfile()
    : null;
  const merged = mergeLiveHistoryProfiles(
    knownProfile,
    bwinProfile,
    stored.socialAccounts
      ? {
          id: userId,
          email: stored.email ?? email ?? null,
          socialAccounts: stored.socialAccounts,
        }
      : null,
  );
  return {
    email: stored.email ?? email ?? null,
    socialAccounts: merged?.socialAccounts ?? stored.socialAccounts ?? {},
  };
};

const persistSocialAccounts = async (
  userId: string,
  payload: { email?: string | null; socialAccounts: Record<string, any> },
) => {
  let firestoreError: unknown = null;
  let fallbackError: unknown = null;

  try {
    await firestore.collection('users').doc(userId).set(
      { socialAccounts: payload.socialAccounts },
      { merge: true },
    );
  } catch (error) {
    firestoreError = error;
    console.warn('[social] Firestore social account save failed; saving to fallback store', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    await supabaseFallbackService.upsertSocialAccounts(userId, payload);
  } catch (error) {
    fallbackError = error;
    console.warn('[social] fallback social account save failed', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (firestoreError && fallbackError) {
    throw fallbackError;
  }
};

const mergeAutopostPlatforms = async (userId: string, platformsToAdd: string[]) => {
  const autopostRef = firestore.collection('autopostJobs').doc(userId);
  const autopostSnap = await autopostRef.get();
  const autopostData = autopostSnap.data() ?? {};
  const platformSet = new Set(((autopostData.platforms as string[] | undefined) ?? []).filter(Boolean));
  const trendPlatformSet = new Set(((autopostData.trendPlatforms as string[] | undefined) ?? []).filter(Boolean));

  for (const platform of platformsToAdd) {
    platformSet.add(platform);
    if (!platform.endsWith('_story') && platform !== 'instagram_reels') {
      trendPlatformSet.add(platform);
    }
  }

  await autopostRef.set(
    {
      userId,
      platforms: Array.from(platformSet),
      trendPlatforms: Array.from(trendPlatformSet),
      updatedAt: new Date(),
    },
    { merge: true },
  );
};

const renderThreadsCallbackHtml = (title: string, message: string) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      body { font-family: Arial, sans-serif; background:#0b1020; color:#f8fafc; display:flex; min-height:100vh; align-items:center; justify-content:center; margin:0; }
      .card { width:min(92vw, 520px); background:#11182c; border:1px solid rgba(148,163,184,.25); border-radius:20px; padding:28px; box-shadow:0 18px 50px rgba(0,0,0,.35); }
      h1 { margin:0 0 12px; font-size:24px; }
      p { margin:0; line-height:1.6; color:#cbd5e1; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>${title}</h1>
      <p>${message}</p>
    </div>
  </body>
</html>`;

const base64UrlToBuffer = (value: string) => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + padding, 'base64');
};

const parseSignedRequest = (signedRequest: string | undefined, secret: string) => {
  if (!signedRequest || !secret) return null;
  const [encodedSignature, encodedPayload] = signedRequest.split('.');
  if (!encodedSignature || !encodedPayload) return null;
  const expected = createHmac('sha256', secret).update(encodedPayload).digest();
  const provided = base64UrlToBuffer(encodedSignature);
  if (expected.length !== provided.length) return null;
  if (!timingSafeEqual(expected, provided)) return null;
  try {
    return JSON.parse(base64UrlToBuffer(encodedPayload).toString('utf8')) as MetaSignedRequestPayload;
  } catch {
    return null;
  }
};

const renderThreadsManagementHtml = (title: string, message: string) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      body { font-family: Arial, sans-serif; background:#0b1020; color:#f8fafc; display:flex; min-height:100vh; align-items:center; justify-content:center; margin:0; }
      .card { width:min(92vw, 560px); background:#11182c; border:1px solid rgba(148,163,184,.25); border-radius:20px; padding:28px; box-shadow:0 18px 50px rgba(0,0,0,.35); }
      h1 { margin:0 0 12px; font-size:24px; }
      p { margin:0; line-height:1.6; color:#cbd5e1; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>${title}</h1>
      <p>${message}</p>
    </div>
  </body>
</html>`;

const scheduleSchema = z
  .object({
    userId: z.string().min(1),
    platforms: z
      .array(
        z.enum([
          'instagram',
          'instagram_reels',
          'instagram_story',
          'facebook',
          'facebook_story',
          'linkedin',
          'twitter',
          'x',
          'threads',
          'tiktok',
          'youtube',
          'whatsapp',
        ]),
      )
      .min(1),
    images: z.array(z.string().min(1)).optional(),
    videoUrl: z.string().url().optional(),
    youtubeVideoUrl: z.string().url().optional(),
    tiktokVideoUrl: z.string().url().optional(),
    instagramReelsVideoUrl: z.string().url().optional(),
    videoTitle: z.string().min(1).optional(),
    caption: z.string().min(4),
    hashtags: z.string().optional(),
    scheduledFor: z.string(),
    timesPerDay: z.number().int().min(1).max(5),
  })
  .superRefine((data, ctx) => {
    const hasYoutube = data.platforms.includes('youtube');
    const hasTikTok = data.platforms.includes('tiktok');
    const hasReels = data.platforms.includes('instagram_reels');
    const videoCapable = new Set(['facebook', 'facebook_story', 'instagram_story', 'linkedin']);
    const hasImagePlatform = data.platforms.some(platform => {
      if (platform === 'youtube' || platform === 'tiktok' || platform === 'instagram_reels') return false;
      if (platform === 'whatsapp') return false;
      if (videoCapable.has(platform) && data.videoUrl) return false;
      return true;
    });
    if (hasImagePlatform && (!data.images || data.images.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['images'],
        message: 'Images are required for the selected platforms.',
      });
    }
    if (hasYoutube && !(data.youtubeVideoUrl || data.videoUrl)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['videoUrl'],
        message: 'YouTube video URL is required.',
      });
    }
    if (hasTikTok && !(data.tiktokVideoUrl || data.videoUrl)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['videoUrl'],
        message: 'TikTok video URL is required.',
      });
    }
    if (hasReels && !data.instagramReelsVideoUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['instagramReelsVideoUrl'],
        message: 'Instagram Reels video URL is required.',
      });
    }
  });

const autoPostSchema = z
  .object({
    platforms: z
      .array(
        z.enum([
          'instagram',
          'instagram_reels',
          'instagram_story',
          'facebook',
          'facebook_story',
          'linkedin',
          'twitter',
          'x',
          'threads',
          'tiktok',
          'youtube',
          'whatsapp',
        ]),
      )
      .min(1)
      .optional(),
    prompt: z.string().optional(),
    businessType: z.string().optional(),
    videoUrl: z.string().url().optional(),
    videoUrls: z.array(z.string().url()).optional(),
    videoTitle: z.string().min(1).optional(),
    youtubePrivacyStatus: z.enum(['private', 'public', 'unlisted']).optional(),
    youtubeVideoUrl: z.string().url().optional(),
    youtubeVideoUrls: z.array(z.string().url()).optional(),
    youtubeShorts: z.boolean().optional(),
    tiktokVideoUrl: z.string().url().optional(),
    tiktokVideoUrls: z.array(z.string().url()).optional(),
    instagramReelsVideoUrl: z.string().url().optional(),
    instagramReelsVideoUrls: z.array(z.string().url()).optional(),
    reelsIntervalHours: z.number().positive().optional(),
    generatedContent: z
      .object({
        images: z.array(z.string().url()),
        caption_instagram: z.string(),
        caption_linkedin: z.string(),
        caption_x: z.string(),
        hashtags_instagram: z.string(),
        hashtags_generic: z.string(),
        image_error: z.string().optional(),
        video_url: z.string().url().optional(),
        video_error: z.string().optional(),
      })
      .optional(),
  })
  .superRefine((data, ctx) => {
    const platforms = data.platforms ?? [];
    const hasYoutube = platforms.includes('youtube');
    const hasTikTok = platforms.includes('tiktok');
    const hasReels = platforms.includes('instagram_reels');
    const youtubeHasVideo = Boolean(data.youtubeVideoUrl) || Boolean(data.youtubeVideoUrls?.length) || Boolean(data.videoUrl) || Boolean(data.videoUrls?.length);
    const tiktokHasVideo = Boolean(data.tiktokVideoUrl) || Boolean(data.tiktokVideoUrls?.length) || Boolean(data.videoUrl) || Boolean(data.videoUrls?.length);
    const reelsHasVideo =
      Boolean(data.instagramReelsVideoUrl) ||
      Boolean(data.instagramReelsVideoUrls?.length) ||
      Boolean(data.videoUrl) ||
      Boolean(data.videoUrls?.length);
    if (hasYoutube && !youtubeHasVideo) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['youtubeVideoUrl'],
        message: 'YouTube video URL is required.',
      });
    }
    if (hasTikTok && !tiktokHasVideo) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['tiktokVideoUrl'],
        message: 'TikTok video URL is required.',
      });
    }
    if (hasReels && !reelsHasVideo) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['instagramReelsVideoUrl'],
        message: 'Instagram Reels video URL is required (instagramReelsVideoUrl or videoUrl).',
      });
    }
  });

router.post('/posts/schedule', requireFirebase, async (req, res, next) => {
  try {
    const payload = scheduleSchema.parse(req.body);
    const authUser = (req as AuthedRequest).authUser;
    if (!authUser || authUser.uid !== payload.userId) {
      return res.status(403).json({ message: 'Cannot schedule for another user' });
    }
    await consumeUsage(
      resolveBillingScope(authUser.uid, req.header('x-org-id'), authUser.email),
      'scheduledPosts',
      Math.max(payload.platforms.length * payload.timesPerDay, 1),
    );
    const result = await socialSchedulingService.schedulePosts({ ...payload, billingUsageConsumed: true });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/autopost/runNow', requireFirebase, async (req, res, next) => {
  try {
    const authUser = (req as AuthedRequest).authUser;
    if (!authUser) return res.status(401).json({ message: 'Unauthorized' });

    const payload = autoPostSchema.parse(req.body ?? {});
    const userId = authUser.uid;

    // Ensure a job exists and capture prompt/businessType updates if provided.
    const result = await autoPostService.start({
      userId,
      platforms: payload.platforms,
      prompt: payload.prompt,
      businessType: payload.businessType,
      videoUrl: payload.videoUrl,
      videoUrls: payload.videoUrls,
      videoTitle: payload.videoTitle,
      youtubePrivacyStatus: payload.youtubePrivacyStatus,
      youtubeVideoUrl: payload.youtubeVideoUrl,
      youtubeVideoUrls: payload.youtubeVideoUrls,
      youtubeShorts: payload.youtubeShorts,
      tiktokVideoUrl: payload.tiktokVideoUrl,
      tiktokVideoUrls: payload.tiktokVideoUrls,
      instagramReelsVideoUrl: payload.instagramReelsVideoUrl,
      instagramReelsVideoUrls: payload.instagramReelsVideoUrls,
      reelsIntervalHours: payload.reelsIntervalHours,
      generatedContent: payload.generatedContent,
    });
    res.json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
});

router.get('/social/runQueue', async (req, res, next) => {
  try {
    if (CRON_SECRET && req.query.token !== CRON_SECRET) {
      return res.status(401).json({ message: 'Invalid token' });
    }
    const result = await socialPostingService.runQueue();
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get('/social/history', requireFirebase, async (req, res, next) => {
  try {
    const authUser = (req as AuthedRequest).authUser;
    if (!authUser) return res.status(401).json({ message: 'Unauthorized' });

    const requestedUserId = typeof req.query.userId === 'string' ? req.query.userId.trim() : '';
    let historyUserId = '';
    let storedEmail = '';
    let storedSocialAccounts: Record<string, unknown> | undefined;
    try {
      const userDoc = await firestore.collection('users').doc(authUser.uid).get();
      const userData = userDoc.data() ?? {};
      historyUserId = ((userData.historyUserId as string | undefined) ?? '').trim();
      storedEmail = ((userData.email as string | undefined) ?? '').trim();
      storedSocialAccounts = userData.socialAccounts as Record<string, unknown> | undefined;
    } catch (error) {
      console.warn('[social-history-route] user lookup failed; using direct auth user id', {
        userId: authUser.uid,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (requestedUserId && requestedUserId !== authUser.uid && requestedUserId !== historyUserId) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const knownProfile =
      resolveKnownLiveSocialProfile(requestedUserId) ||
      resolveKnownLiveSocialProfile(historyUserId) ||
      resolveKnownLiveSocialProfile(authUser.uid) ||
      resolveKnownLiveSocialProfile(authUser.email) ||
      resolveKnownLiveSocialProfile(storedEmail);
    const bwinProfile = isBwinHistoryRequest(requestedUserId, historyUserId, authUser.uid, authUser.email, storedEmail)
      ? await fetchBwinMetaSocialProfile()
      : null;
    const userId = requestedUserId || historyUserId || knownProfile?.id || bwinProfile?.id || authUser.uid;
    const history = await socialPostingService.getHistory(userId);
    const storedProfile = storedSocialAccounts
      ? {
          id: userId,
          email: storedEmail || authUser.email || null,
          socialAccounts: storedSocialAccounts as NonNullable<ReturnType<typeof resolveKnownLiveSocialProfile>>['socialAccounts'],
        }
      : null;
    const liveHistoryProfile = mergeLiveHistoryProfiles(knownProfile, bwinProfile, storedProfile);
    const [liveMetaPosts, socialLogPosts] = await Promise.all([
      withFallbackTimeout('live social history enrichment', fetchKnownMetaHistoryPosts(liveHistoryProfile), HISTORY_LIVE_FETCH_TIMEOUT_MS, []),
      fetchSocialLogHistoryPosts(userId),
    ]);
    const storedPosts = [...(history.posts ?? []), ...(history.todayPosts ?? [])];
    const posts = mergeHistoryPosts(storedPosts, [...liveMetaPosts, ...socialLogPosts]).slice(0, 400);
    const { todayPosts, todaySummary } = buildTodayHistory(posts);
    const summary = buildHistorySummary(posts);
    const daily = await withFallbackTimeout(
      'daily social history summary',
      socialAnalyticsService.getDailySummary(userId),
      HISTORY_DAILY_TIMEOUT_MS,
      [],
    );
    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    });
    res.json({ ...history, posts, summary, todayPosts, todaySummary, daily, userId });
  } catch (error) {
    next(error);
  }
});

router.get('/social/status', requireFirebase, async (req, res, next) => {
  try {
    const authUser = (req as AuthedRequest).authUser;
    if (!authUser) return res.status(401).json({ message: 'Unauthorized' });

    const userData = await loadStatusSocialAccounts(authUser.uid, authUser.email);
    const accounts = userData?.socialAccounts ?? {};
    const allowDefaults = canUsePrimarySocialDefaults(userData, authUser.uid);
    let youtube: Awaited<ReturnType<typeof getYouTubeIntegration>> | null = null;
    let tiktok: Awaited<ReturnType<typeof getTikTokIntegration>> | null = null;
    try {
      youtube = await getYouTubeIntegration(authUser.uid);
    } catch (error) {
      console.warn('[social-status-route] youtube lookup failed', error);
    }
    try {
      tiktok = await getTikTokIntegration(authUser.uid);
    } catch (error) {
      console.warn('[social-status-route] tiktok lookup failed', error);
    }

    const status = {
      facebook:
        Boolean(accounts.facebook?.accessToken && accounts.facebook?.pageId) ||
        (allowDefaults && Boolean(config.channels.facebook.pageToken && config.channels.facebook.pageId)),
      instagram:
        Boolean(accounts.instagram?.accessToken && accounts.instagram?.accountId) ||
        (allowDefaults && Boolean(config.channels.instagram.accessToken && config.channels.instagram.businessId)),
      threads:
        Boolean(accounts.threads?.accessToken && accounts.threads?.accountId) ||
        (allowDefaults && Boolean(config.channels.threads.accessToken && config.channels.threads.profileId)) ||
        (isBwinHistoryRequest(authUser.uid, authUser.email, userData?.email) &&
          process.env.BWIN_THREADS_CONNECTED === 'true'),
      linkedin:
        Boolean(accounts.linkedin?.accessToken && accounts.linkedin?.urn) ||
        (allowDefaults && Boolean(config.linkedin.accessToken && config.linkedin.organizationId)),
      twitter: Boolean(accounts.twitter?.accessToken && accounts.twitter?.accessSecret),
      whatsapp:
        Boolean(accounts.whatsapp?.accessToken && accounts.whatsapp?.phoneNumberId) ||
        (allowDefaults && Boolean(config.whatsapp.token && config.whatsapp.phoneNumberId)),
      youtube: Boolean(youtube?.connected),
      tiktok:
        Boolean(tiktok?.connected) ||
        (allowDefaults && Boolean(config.tiktok.accessToken && config.tiktok.openId)),
    };

    res.json({ status });
  } catch (error) {
    next(error);
  }
});

router.get('/social/threads/connect-url', requireFirebase, async (req, res, next) => {
  try {
    const authUser = (req as AuthedRequest).authUser;
    if (!authUser) return res.status(401).json({ message: 'Unauthorized' });
    res.json({ url: buildThreadsConnectUrl(req, authUser.uid, req.header('x-org-id'), authUser.email) });
  } catch (error) {
    next(error);
  }
});

router.get('/social/threads/connect', requireFirebase, async (req, res, next) => {
  try {
    const authUser = (req as AuthedRequest).authUser;
    if (!authUser) return res.status(401).json({ message: 'Unauthorized' });
    res.redirect(buildThreadsConnectUrl(req, authUser.uid, req.header('x-org-id'), authUser.email));
  } catch (error) {
    next(error);
  }
});

router.get('/social/threads/callback', async (req, res) => {
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const stateParam = typeof req.query.state === 'string' ? req.query.state : '';
  const state = verifySignedState(stateParam);

  if (!code || !state) {
    res.status(400).send(renderThreadsCallbackHtml('Threads connection failed', 'Invalid OAuth state or missing code.'));
    return;
  }

  try {
    const shortLivedToken = await exchangeThreadsCodeForToken(req, code);
    if (!shortLivedToken) {
      throw new Error('Missing short-lived Threads token');
    }

    const accessToken = await exchangeThreadsLongLivedToken(req, shortLivedToken);
    const profile = await fetchThreadsMe(accessToken);
    if (!profile.id) {
      throw new Error('Unable to resolve Threads profile');
    }

    const userData = await loadStoredSocialAccounts(state.userId);
    const currentAccounts = { ...(userData.socialAccounts ?? {}) };
    const wasThreadsConnected = Boolean(currentAccounts.threads);

    currentAccounts.threads = {
      accessToken,
      accountId: profile.id,
      username: profile.username ?? currentAccounts.threads?.username,
    };

    if (!wasThreadsConnected) {
      await consumeUsage(
        resolveBillingScope(
          state.userId,
          typeof state.orgId === 'string' ? state.orgId : undefined,
          typeof state.email === 'string' ? state.email : userData.email ?? undefined,
        ),
        'connectedSocials',
        1,
      );
    }

    await persistSocialAccounts(state.userId, { email: userData.email ?? null, socialAccounts: currentAccounts });
    try {
      await mergeAutopostPlatforms(state.userId, ['threads']);
    } catch (error) {
      console.warn('[threads] autopost platform merge failed after successful credential save', {
        userId: state.userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    res
      .status(200)
      .send(
        renderThreadsCallbackHtml(
          'Threads connected',
          `Threads${profile.username ? ` (@${profile.username})` : ''} is now connected. You can close this window and return to Dott Media.`,
        ),
      );
  } catch (error) {
    console.error('[threads] callback failed', error);
    res
      .status(400)
      .send(
        renderThreadsCallbackHtml(
          'Threads connection failed',
          (error as Error).message || 'Unable to complete the Threads connection flow.',
        ),
      );
  }
});

router.get('/social/threads/uninstall', (_req, res) => {
  res
    .status(200)
    .send(renderThreadsManagementHtml('Threads uninstall callback', 'This endpoint is active and accepts Meta deauthorization callbacks.'));
});

router.post('/social/threads/uninstall', async (req, res) => {
  try {
    const signedRequest =
      typeof req.body?.signed_request === 'string'
        ? req.body.signed_request
        : typeof req.query.signed_request === 'string'
          ? req.query.signed_request
          : undefined;
    const { appSecret } = getThreadsAppConfig(req);
    const payload = parseSignedRequest(signedRequest, appSecret);

    await firestore.collection('metaThreadsUninstalls').add({
      payload,
      signedRequestPresent: Boolean(signedRequest),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('[threads] uninstall callback failed', error);
    res.status(200).json({ success: true });
  }
});

router.get('/social/threads/delete', (_req, res) => {
  res
    .status(200)
    .send(renderThreadsManagementHtml('Threads data deletion callback', 'This endpoint is active and accepts Meta data deletion requests.'));
});

router.post('/social/threads/delete', async (req, res) => {
  try {
    const signedRequest =
      typeof req.body?.signed_request === 'string'
        ? req.body.signed_request
        : typeof req.query.signed_request === 'string'
          ? req.query.signed_request
          : undefined;
    const { appSecret } = getThreadsAppConfig(req);
    const payload = parseSignedRequest(signedRequest, appSecret);
    const confirmationCode = randomBytes(12).toString('hex');
    const statusUrl = `${getBaseUrl(req)}/api/social/threads/delete-status/${confirmationCode}`;

    await firestore.collection('metaThreadsDeletionRequests').doc(confirmationCode).set({
      confirmationCode,
      payload,
      signedRequestPresent: Boolean(signedRequest),
      status: 'received',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.status(200).json({
      url: statusUrl,
      confirmation_code: confirmationCode,
    });
  } catch (error) {
    console.error('[threads] delete callback failed', error);
    res.status(500).json({ message: 'Unable to process deletion request' });
  }
});

router.get('/social/threads/delete-status/:code', async (req, res) => {
  try {
    const code = String(req.params.code ?? '').trim();
    if (!code) {
      res.status(400).send(renderThreadsManagementHtml('Deletion status unavailable', 'Missing confirmation code.'));
      return;
    }

    const snap = await firestore.collection('metaThreadsDeletionRequests').doc(code).get();
    if (!snap.exists) {
      res.status(404).send(renderThreadsManagementHtml('Deletion status unavailable', 'No deletion request was found for this confirmation code.'));
      return;
    }

    res
      .status(200)
      .send(renderThreadsManagementHtml('Deletion request received', `Confirmation code ${code} has been recorded and is pending processing.`));
  } catch (error) {
    console.error('[threads] delete status failed', error);
    res.status(500).send(renderThreadsManagementHtml('Deletion status unavailable', 'Unable to read deletion request status.'));
  }
});

const credentialsSchema = z.object({
  userId: z.string().min(1),
  credentials: z.object({
    facebook: z.object({ accessToken: z.string(), pageId: z.string().optional(), pageName: z.string().optional() }).optional(),
    instagram: z.object({ accessToken: z.string(), accountId: z.string().optional(), username: z.string().optional() }).optional(),
    threads: z.object({ accessToken: z.string(), accountId: z.string().optional(), username: z.string().optional() }).optional(),
    linkedin: z.object({ accessToken: z.string(), urn: z.string() }).optional(),
    twitter: z
      .object({
        accessToken: z.string(),
        accessSecret: z.string(),
        // Optional per-user X app credentials. When provided, they override the server-wide TWITTER_API_KEY/SECRET.
        appKey: z.string().optional(),
        appSecret: z.string().optional(),
        consumerKey: z.string().optional(),
        consumerSecret: z.string().optional(),
      })
      .optional(),
    tiktok: z
      .object({
        accessToken: z.string(),
        openId: z.string(),
        refreshToken: z.string().optional(),
        clientKey: z.string().optional(),
        clientSecret: z.string().optional(),
      })
      .optional(),
    youtube: z
      .object({
        refreshToken: z.string(),
        accessToken: z.string().optional(),
        clientId: z.string().optional(),
        clientSecret: z.string().optional(),
        redirectUri: z.string().optional(),
        privacyStatus: z.enum(['private', 'public', 'unlisted']).optional(),
        channelId: z.string().optional(),
      })
      .optional(),
  }),
});

router.post('/social/credentials', requireFirebase, async (req, res, next) => {
  try {
    const payload = credentialsSchema.parse(req.body);
    const authUser = (req as AuthedRequest).authUser;
    if (!authUser || authUser.uid !== payload.userId) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    if (payload.credentials.facebook) {
      const pageId = payload.credentials.facebook.pageId?.trim() ?? '';
      const resolved = await resolveFacebookPageId(payload.credentials.facebook.accessToken, pageId || undefined);
      if (resolved?.pageId) {
        payload.credentials.facebook.pageId = resolved.pageId;
        if (!payload.credentials.facebook.pageName && resolved.pageName) {
          payload.credentials.facebook.pageName = resolved.pageName;
        }
        // Prefer storing the Page access token so posting doesn't break when a user token expires.
        if (resolved.pageToken) {
          payload.credentials.facebook.accessToken = resolved.pageToken;
        }
      }
      if (!payload.credentials.facebook.pageId?.trim()) {
        return res.status(400).json({
          message: 'Facebook pageId is required. Connect a Facebook Page or provide pageId.',
        });
      }
    }

    if (payload.credentials.instagram) {
      const accountId = payload.credentials.instagram.accountId?.trim() ?? '';
      if (!accountId) {
        const resolved = await resolveInstagramAccountId(payload.credentials.instagram.accessToken);
        if (resolved?.accountId) {
          payload.credentials.instagram.accountId = resolved.accountId;
          if (!payload.credentials.instagram.username && resolved.username) {
            payload.credentials.instagram.username = resolved.username;
          }
        }
      }
      if (!payload.credentials.instagram.accountId?.trim()) {
        return res.status(400).json({
          message: 'Instagram accountId is required. Connect an Instagram Business account or provide accountId.',
        });
      }
    }

    if (payload.credentials.instagram && !payload.credentials.threads) {
      const resolved = await resolveThreadsAccountId(
        payload.credentials.instagram.accessToken,
        payload.credentials.instagram.accountId,
      );
      if (resolved?.accountId) {
        payload.credentials.threads = {
          accessToken: payload.credentials.instagram.accessToken,
          accountId: resolved.accountId,
          username: resolved.username,
        };
      }
    }

    if (payload.credentials.threads && !payload.credentials.threads.accountId?.trim() && payload.credentials.instagram) {
      const resolved = await resolveThreadsAccountId(
        payload.credentials.threads.accessToken,
        payload.credentials.instagram.accountId,
      );
      if (resolved?.accountId) {
        payload.credentials.threads.accountId = resolved.accountId;
        if (!payload.credentials.threads.username && resolved.username) {
          payload.credentials.threads.username = resolved.username;
        }
      }
    }

    if (payload.credentials.threads && !payload.credentials.threads.accountId?.trim()) {
      return res.status(400).json({
        message: 'Threads accountId is required. Connect a Threads profile or provide accountId.',
      });
    }

    await persistSocialAccounts(payload.userId, { socialAccounts: payload.credentials });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

export default router;
