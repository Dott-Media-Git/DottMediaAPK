import { Router, Request } from 'express';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { z } from 'zod';
import { requireFirebase, AuthedRequest } from '../middleware/firebaseAuth';
import { socialSchedulingService } from '../packages/services/socialSchedulingService';
import { socialPostingService } from '../packages/services/socialPostingService';
import { socialAnalyticsService } from '../packages/services/socialAnalyticsService';
import { autoPostService } from '../services/autoPostService';
import { firestore } from '../db/firestore';
import { config } from '../config';
import { getTikTokIntegration, getYouTubeIntegration } from '../services/socialIntegrationService';
import { resolveFacebookPageId, resolveInstagramAccountId, resolveThreadsAccountId } from '../services/socialAccountResolver';
import { canUsePrimarySocialDefaults } from '../utils/socialAccess';
import { createSignedState, verifySignedState } from '../utils/oauthState';

const CRON_SECRET = process.env.CRON_SECRET;
const THREADS_GRAPH_VERSION = process.env.THREADS_GRAPH_VERSION ?? 'v1.0';
const THREADS_GRAPH_BASE_URL = process.env.THREADS_GRAPH_BASE_URL ?? 'https://graph.threads.net';

const router = Router();

type RenderEnv = Record<string, string>;

let renderEnvCache: RenderEnv | null | undefined;

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

const buildThreadsConnectUrl = (req: Request, userId: string) => {
  const { appId, redirectUri } = getThreadsAppConfig(req);
  const url = new URL(process.env.THREADS_AUTHORIZE_URL ?? 'https://threads.net/oauth/authorize');
  url.searchParams.set('client_id', appId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', getThreadsScopes().join(','));
  url.searchParams.set('state', createSignedState(userId));
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
    const result = await socialSchedulingService.schedulePosts(payload);
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
    const userDoc = await firestore.collection('users').doc(authUser.uid).get();
    const historyUserId = (userDoc.data()?.historyUserId as string | undefined)?.trim();

    if (requestedUserId && requestedUserId !== authUser.uid && requestedUserId !== historyUserId) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const userId = requestedUserId || historyUserId || authUser.uid;
    const history = await socialPostingService.getHistory(userId);
    const daily = await socialAnalyticsService.getDailySummary(userId);
    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    });
    res.json({ ...history, daily, userId });
  } catch (error) {
    next(error);
  }
});

router.get('/social/status', requireFirebase, async (req, res, next) => {
  try {
    const authUser = (req as AuthedRequest).authUser;
    if (!authUser) return res.status(401).json({ message: 'Unauthorized' });

    const userDoc = await firestore.collection('users').doc(authUser.uid).get();
    const userData = userDoc.data() as { email?: string | null; socialAccounts?: Record<string, any> } | undefined;
    const accounts = userData?.socialAccounts ?? {};
    const allowDefaults = canUsePrimarySocialDefaults(userData);
    const youtube = await getYouTubeIntegration(authUser.uid);
    const tiktok = await getTikTokIntegration(authUser.uid);

    const status = {
      facebook:
        Boolean(accounts.facebook?.accessToken && accounts.facebook?.pageId) ||
        (allowDefaults && Boolean(config.channels.facebook.pageToken && config.channels.facebook.pageId)),
      instagram:
        Boolean(accounts.instagram?.accessToken && accounts.instagram?.accountId) ||
        (allowDefaults && Boolean(config.channels.instagram.accessToken && config.channels.instagram.businessId)),
      threads:
        Boolean(accounts.threads?.accessToken && accounts.threads?.accountId) ||
        (allowDefaults && Boolean(config.channels.threads.accessToken && config.channels.threads.profileId)),
      linkedin:
        Boolean(accounts.linkedin?.accessToken && accounts.linkedin?.urn) ||
        (allowDefaults && Boolean(config.linkedin.accessToken && config.linkedin.organizationId)),
      twitter: Boolean(accounts.twitter?.accessToken && accounts.twitter?.accessSecret),
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
    res.json({ url: buildThreadsConnectUrl(req, authUser.uid) });
  } catch (error) {
    next(error);
  }
});

router.get('/social/threads/connect', requireFirebase, async (req, res, next) => {
  try {
    const authUser = (req as AuthedRequest).authUser;
    if (!authUser) return res.status(401).json({ message: 'Unauthorized' });
    res.redirect(buildThreadsConnectUrl(req, authUser.uid));
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

    const userRef = firestore.collection('users').doc(state.userId);
    const userSnap = await userRef.get();
    const userData = (userSnap.data() as { socialAccounts?: Record<string, any> } | undefined) ?? {};
    const currentAccounts = { ...(userData.socialAccounts ?? {}) };

    currentAccounts.threads = {
      accessToken,
      accountId: profile.id,
      username: profile.username ?? currentAccounts.threads?.username,
    };

    await userRef.set({ socialAccounts: currentAccounts }, { merge: true });
    await mergeAutopostPlatforms(state.userId, ['threads']);

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

    await firestore.collection('users').doc(payload.userId).set(
      { socialAccounts: payload.credentials },
      { merge: true }
    );

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

export default router;
