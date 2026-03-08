import { Router, Request } from 'express';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import admin from 'firebase-admin';
import createHttpError from 'http-errors';
import { requireFirebase, AuthedRequest } from '../middleware/firebaseAuth';
import { createSignedState, verifySignedState } from '../utils/oauthState';
import { firestore } from '../db/firestore';
import { autoPostService } from '../services/autoPostService';

const router = Router();

const CALLBACK_PATH = '/integrations/meta/callback';
const THREADS_CALLBACK_PATH = '/integrations/threads/callback';
const GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? 'v23.0';
const THREADS_GRAPH_VERSION = process.env.THREADS_GRAPH_VERSION ?? 'v1.0';
const THREADS_GRAPH_BASE_URL = process.env.THREADS_GRAPH_BASE_URL ?? 'https://graph.threads.net';

type RenderEnv = Record<string, string>;
type MetaPage = {
  id?: string;
  name?: string;
  access_token?: string;
  instagram_business_account?: {
    id?: string;
    username?: string;
  };
};

type ThreadsProfile = {
  id?: string;
  username?: string;
};

let renderEnvCache: RenderEnv | null | undefined;

const normalizeBaseUrl = (value: string) => value.replace(/\/+$/, '');

const getBaseUrl = (req: Request) => {
  const envBase = process.env.BASE_URL ?? process.env.RENDER_EXTERNAL_URL;
  if (envBase) return normalizeBaseUrl(envBase);
  const forwardedProto = (req.header('x-forwarded-proto') || '').split(',')[0].trim();
  const proto = forwardedProto || req.protocol;
  const forwardedHost = (req.header('x-forwarded-host') || '').split(',')[0].trim();
  const host = forwardedHost || req.get('host');
  return normalizeBaseUrl(`${proto}://${host}`);
};

const computeRedirectUri = (req: Request) => `${getBaseUrl(req)}${CALLBACK_PATH}`;

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
      console.warn('[meta] failed to parse .render-env.json fallback', error);
    }
  }

  renderEnvCache = {};
  return renderEnvCache;
};

const getMetaAppConfig = (req: Request) => {
  const renderEnv = resolveRenderEnv();
  const appId =
    process.env.META_APP_ID ??
    process.env.FACEBOOK_APP_ID ??
    renderEnv.META_APP_ID ??
    renderEnv.FACEBOOK_APP_ID ??
    '';
  const appSecret =
    process.env.META_APP_SECRET ??
    process.env.FACEBOOK_APP_SECRET ??
    renderEnv.META_APP_SECRET ??
    renderEnv.FACEBOOK_APP_SECRET ??
    '';
  const redirectUri = process.env.META_REDIRECT_URI ?? renderEnv.META_REDIRECT_URI ?? computeRedirectUri(req);

  if (!appId || !appSecret) {
    throw createHttpError(400, 'Missing META_APP_ID or META_APP_SECRET');
  }

  return { appId, appSecret, redirectUri };
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
  const redirectUri = process.env.THREADS_REDIRECT_URI ?? renderEnv.THREADS_REDIRECT_URI ?? `${getBaseUrl(req)}${THREADS_CALLBACK_PATH}`;

  if (!appId || !appSecret) {
    throw createHttpError(400, 'Missing THREADS_APP_ID or THREADS_APP_SECRET');
  }

  return { appId, appSecret, redirectUri };
};

const getScopes = () => {
  const renderEnv = resolveRenderEnv();
  const raw = process.env.META_APP_SCOPES ?? renderEnv.META_APP_SCOPES ?? '';
  if (raw.trim()) {
    return raw
      .split(',')
      .map(scope => scope.trim())
      .filter(Boolean);
  }

  return [
    'pages_show_list',
    'pages_read_engagement',
    'pages_manage_posts',
    'pages_manage_metadata',
    'publish_video',
    'instagram_basic',
    'instagram_content_publish',
    'threads_basic',
    'threads_content_publish',
    'business_management',
  ];
};

const buildOAuthUrl = (req: Request, userId: string) => {
  const { appId, redirectUri } = getMetaAppConfig(req);
  const state = createSignedState(userId);
  const url = new URL(`https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`);
  url.searchParams.set('client_id', appId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', getScopes().join(','));
  url.searchParams.set('state', state);
  return url.toString();
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

const buildThreadsOAuthUrl = (req: Request, userId: string) => {
  const { appId, redirectUri } = getThreadsAppConfig(req);
  const state = createSignedState(userId);
  const url = new URL(process.env.THREADS_AUTHORIZE_URL ?? 'https://threads.net/oauth/authorize');
  url.searchParams.set('client_id', appId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', getThreadsScopes().join(','));
  url.searchParams.set('state', state);
  return url.toString();
};

const exchangeCodeForToken = async (req: Request, code: string) => {
  const { appId, appSecret, redirectUri } = getMetaAppConfig(req);
  const response = await axios.get(`https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`, {
    params: {
      client_id: appId,
      client_secret: appSecret,
      redirect_uri: redirectUri,
      code,
    },
  });
  return response.data?.access_token as string | undefined;
};

const exchangeLongLivedToken = async (req: Request, shortLivedToken: string) => {
  const { appId, appSecret } = getMetaAppConfig(req);
  const response = await axios.get(`https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`, {
    params: {
      grant_type: 'fb_exchange_token',
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: shortLivedToken,
    },
  });
  return (response.data?.access_token as string | undefined) ?? shortLivedToken;
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

const fetchManagedPages = async (userAccessToken: string) => {
  const response = await axios.get(`https://graph.facebook.com/${GRAPH_VERSION}/me/accounts`, {
    params: {
      fields: 'id,name,access_token,instagram_business_account{id,username}',
      access_token: userAccessToken,
    },
  });
  return ((response.data?.data as MetaPage[] | undefined) ?? []).filter(page => page.id);
};

const fetchThreadsProfile = async (userAccessToken: string, instagramAccountId?: string) => {
  if (!instagramAccountId) return null;
  try {
    const response = await axios.get(`https://graph.facebook.com/${GRAPH_VERSION}/${instagramAccountId}`, {
      params: {
        fields: 'threads_profile{id,username}',
        access_token: userAccessToken,
      },
    });
    return (response.data?.threads_profile as ThreadsProfile | undefined) ?? null;
  } catch (error) {
    console.warn('[meta] failed to resolve Threads profile', (error as Error).message);
    return null;
  }
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

  const postPlatformSet = new Set(((autopostData.platforms as string[] | undefined) ?? []).filter(Boolean));
  const trendPlatformSet = new Set(((autopostData.trendPlatforms as string[] | undefined) ?? []).filter(Boolean));

  for (const platform of platformsToAdd) {
    postPlatformSet.add(platform);
    if (!platform.endsWith('_story') && platform !== 'instagram_reels') {
      trendPlatformSet.add(platform);
    }
  }

  if (!autopostSnap.exists) {
    await autoPostService.start({
      userId,
      platforms: Array.from(postPlatformSet),
    });
  }

  await autopostRef.set(
    {
      platforms: Array.from(postPlatformSet),
      trendPlatforms: Array.from(trendPlatformSet),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
};

const renderCallbackHtml = (title: string, message: string) => `<!doctype html>
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

router.get('/integrations/meta/config', requireFirebase, async (req, res, next) => {
  try {
    const { appId, redirectUri } = getMetaAppConfig(req);
    res.json({
      appIdConfigured: Boolean(appId),
      appSecretConfigured: true,
      redirectUri,
      scopes: getScopes(),
      callbackPath: CALLBACK_PATH,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/integrations/meta/connect', requireFirebase, async (req, res, next) => {
  try {
    const userId = (req as AuthedRequest).authUser?.uid;
    if (!userId) throw createHttpError(401, 'Unauthorized');
    res.redirect(buildOAuthUrl(req, userId));
  } catch (error) {
    next(error);
  }
});

router.get('/integrations/meta/connect-url', requireFirebase, async (req, res, next) => {
  try {
    const userId = (req as AuthedRequest).authUser?.uid;
    if (!userId) throw createHttpError(401, 'Unauthorized');
    res.json({ url: buildOAuthUrl(req, userId) });
  } catch (error) {
    next(error);
  }
});

router.get('/integrations/threads/config', requireFirebase, async (req, res, next) => {
  try {
    const { appId, redirectUri } = getThreadsAppConfig(req);
    res.json({
      appIdConfigured: Boolean(appId),
      appSecretConfigured: true,
      redirectUri,
      scopes: getThreadsScopes(),
      callbackPath: THREADS_CALLBACK_PATH,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/integrations/threads/connect', requireFirebase, async (req, res, next) => {
  try {
    const userId = (req as AuthedRequest).authUser?.uid;
    if (!userId) throw createHttpError(401, 'Unauthorized');
    res.redirect(buildThreadsOAuthUrl(req, userId));
  } catch (error) {
    next(error);
  }
});

router.get('/integrations/threads/connect-url', requireFirebase, async (req, res, next) => {
  try {
    const userId = (req as AuthedRequest).authUser?.uid;
    if (!userId) throw createHttpError(401, 'Unauthorized');
    res.json({ url: buildThreadsOAuthUrl(req, userId) });
  } catch (error) {
    next(error);
  }
});

router.get('/integrations/meta/callback', async (req, res) => {
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const stateParam = typeof req.query.state === 'string' ? req.query.state : '';
  const state = verifySignedState(stateParam);

  if (!code || !state) {
    res.status(400).send(renderCallbackHtml('Meta connection failed', 'Invalid OAuth state or missing code.'));
    return;
  }

  try {
    const shortLivedToken = await exchangeCodeForToken(req, code);
    if (!shortLivedToken) {
      throw new Error('Missing short-lived user token');
    }

    const userAccessToken = await exchangeLongLivedToken(req, shortLivedToken);
    const pages = await fetchManagedPages(userAccessToken);
    if (!pages.length) {
      throw new Error('No managed Facebook Pages found for this Meta account');
    }

    const userRef = firestore.collection('users').doc(state.userId);
    const userSnap = await userRef.get();
    const userData = (userSnap.data() as { socialAccounts?: Record<string, any> } | undefined) ?? {};
    const currentAccounts = { ...(userData.socialAccounts ?? {}) };
    const preferredPageId = String(currentAccounts.facebook?.pageId ?? '').trim();

    const selectedPage =
      (preferredPageId ? pages.find(page => page.id === preferredPageId) : null) ??
      pages[0];

    if (!selectedPage?.id || !selectedPage?.access_token) {
      throw new Error('Unable to resolve a usable Facebook Page token');
    }

    currentAccounts.facebook = {
      accessToken: selectedPage.access_token,
      userAccessToken,
      pageId: selectedPage.id,
      pageName: selectedPage.name ?? currentAccounts.facebook?.pageName,
    };

    const instagramAccount = selectedPage.instagram_business_account;
    if (instagramAccount?.id) {
      currentAccounts.instagram = {
        accessToken: userAccessToken,
        accountId: instagramAccount.id,
        username: instagramAccount.username ?? currentAccounts.instagram?.username,
      };

      const threadsProfile = await fetchThreadsProfile(userAccessToken, instagramAccount.id);
      if (threadsProfile?.id) {
        currentAccounts.threads = {
          accessToken: userAccessToken,
          accountId: threadsProfile.id,
          username: threadsProfile.username ?? currentAccounts.threads?.username,
        };
      }
    }

    await userRef.set({ socialAccounts: currentAccounts }, { merge: true });

    await mergeAutopostPlatforms(
      state.userId,
      [
        'facebook',
        currentAccounts.instagram?.accountId ? 'instagram' : null,
        currentAccounts.threads?.accountId ? 'threads' : null,
      ].filter(Boolean) as string[],
    );

    const connectedChannels = [
      'Facebook',
      currentAccounts.instagram?.accountId ? 'Instagram' : null,
      currentAccounts.threads?.accountId ? 'Threads' : null,
    ]
      .filter(Boolean)
      .join(', ');

    res
      .status(200)
      .send(
        renderCallbackHtml(
          'Meta connected',
          `${connectedChannels || 'Facebook'} is now connected. You can close this window and return to Dott Media.`,
        ),
      );
  } catch (error) {
    console.error('[meta] connection failed', error);
    res
      .status(400)
      .send(
        renderCallbackHtml(
          'Meta connection failed',
          (error as Error).message || 'Unable to complete the Meta connection flow.',
        ),
      );
  }
});

router.get('/integrations/threads/callback', async (req, res) => {
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const stateParam = typeof req.query.state === 'string' ? req.query.state : '';
  const state = verifySignedState(stateParam);

  if (!code || !state) {
    res.status(400).send(renderCallbackHtml('Threads connection failed', 'Invalid OAuth state or missing code.'));
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
        renderCallbackHtml(
          'Threads connected',
          `Threads${profile.username ? ` (@${profile.username})` : ''} is now connected. You can close this window and return to Dott Media.`,
        ),
      );
  } catch (error) {
    console.error('[threads] connection failed', error);
    res
      .status(400)
      .send(
        renderCallbackHtml(
          'Threads connection failed',
          (error as Error).message || 'Unable to complete the Threads connection flow.',
        ),
      );
  }
});

export default router;
