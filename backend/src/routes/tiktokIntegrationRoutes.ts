import {mountTikTokSandboxContext} from './tiktokSandboxContext';
import {queryTikTokCreator} from '../services/tiktokReviewedPublisher';
import {mountTikTokReviewRoutes} from './tiktokReviewRoutes';
import {tikTokEnvironment, tikTokConnectionKey, tikTokClient, tikTokSandboxUsername} from '../services/tiktokReviewConfig';
import { Router, Request } from 'express';
import { z } from 'zod';
import axios from 'axios';
import createHttpError from 'http-errors';
import admin from 'firebase-admin';
import { config } from '../config';
import { requireFirebaseStrict, AuthedRequest } from '../middleware/firebaseAuth';
import { createSignedState, verifySignedState } from '../utils/oauthState';
import {
  disconnectTikTok,
  getTikTokIntegration,
  revealTikTokRefreshToken,
  upsertTikTokIntegration,
} from '../services/socialIntegrationService';
import { firestore } from '../db/firestore';
import { consumeUsage, resolveBillingScope } from '../services/billing/billingService';
import { oauthSuccessRedirect, sanitizeOAuthReturnUrl } from '../utils/oauthRedirect';

const router = Router();
mountTikTokSandboxContext(router);
router.get('/integrations/tiktok/review-version', (_req,res)=>res.json({version:'2026-10-30',requiresCreatorReview:true,sandboxAccess:'restricted'}));

const CALLBACK_PATH = '/integrations/tiktok/callback';

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
const computeConnectUrl = (req: Request) => `${getBaseUrl(req)}/integrations/tiktok/connect`;

const getScopes = () => ['user.info.basic', 'video.publish'];

const splitScopes = (value: unknown) =>
  String(value ?? '')
    .split(/[,\s]+/)
    .map(scope => scope.trim())
    .filter(Boolean);

const assertRequiredScopes = (required: string[], value: unknown) => {
  const granted = new Set(splitScopes(value));
  if (granted.size === 0) return;
  const missing = required.filter(scope => !granted.has(scope));
  if (missing.length) {
    throw new Error(`Missing required TikTok permissions: ${missing.join(', ')}`);
  }
};

const safeErrorCode = (error: unknown) => {
  const value = error as { code?: unknown; name?: unknown };
  const code = value?.code ?? value?.name;
  return code === undefined || code === null ? 'unknown' : String(code).slice(0, 80);
};

const classifyTikTokStorageError = (error: unknown) => {
  const code = safeErrorCode(error).toUpperCase();
  const message = String((error as { message?: unknown })?.message ?? '');
  if (code === '8' || /RESOURCE_EXHAUSTED|QUOTA\s+EXCEEDED/i.test(message)) {
    return {
      status: 503,
      message: 'TikTok connection storage is temporarily unavailable because the database quota is exhausted. Please retry after the quota resets.',
    };
  }
  if (code === '7' || /PERMISSION_DENIED|PERMISSION\s+DENIED/i.test(message)) {
    return {
      status: 503,
      message: 'TikTok connection storage is not authorized. Please contact support.',
    };
  }
  return { status: 500, message: 'Unable to securely store the TikTok connection.' };
};

const ensureTikTokClientConfig = (req: Request) => {
  const clientKey = tikTokClient().clientKey;
  const clientSecret = tikTokClient().clientSecret;
  const redirectUri = tikTokClient().redirectUri || computeRedirectUri(req);
  if (!clientKey || !clientSecret) {
    throw createHttpError(400, 'Missing TIKTOK_CLIENT_KEY or TIKTOK_CLIENT_SECRET');
  }
  return { clientKey, clientSecret, redirectUri, scopes: getScopes() };
};

const buildOAuthUrl = (req: Request, userId: string, orgId?: string | null, email?: string | null, returnUrl?: unknown) => {
  const { clientKey, redirectUri, scopes } = ensureTikTokClientConfig(req);
  let safeReturn = sanitizeOAuthReturnUrl(returnUrl);
  if(tikTokEnvironment()==='sandbox'){const back=new URL(oauthSuccessRedirect('tiktok',safeReturn));back.searchParams.set('tiktokSandbox','1');safeReturn=back.toString();}
  const state = createSignedState(userId, {
    platform: 'tiktok',
    environment: tikTokEnvironment(),
    orgId: orgId || undefined,
    email: email || undefined,
    returnUrl: safeReturn,
  });
  const oauthUrl = new URL('https://www.tiktok.com/v2/auth/authorize/');
  oauthUrl.searchParams.set('client_key', clientKey);
  oauthUrl.searchParams.set('redirect_uri', redirectUri);
  oauthUrl.searchParams.set('response_type', 'code');
  oauthUrl.searchParams.set('scope', scopes.join(','));
  oauthUrl.searchParams.set('state', state);
  return oauthUrl.toString();
};

const requireOrgAdminIfPresent = async (req: Request, _res: unknown, next: (err?: unknown) => void) => {
  try {
    const orgId = req.header('x-org-id')?.trim();
    if (!orgId) return next();
    const authUser = (req as AuthedRequest).authUser;
    if (!authUser) return next(createHttpError(401, 'Unauthorized'));
    const membershipId = `${orgId}_${authUser.uid}`;
    const doc = await firestore.collection('orgUsers').doc(membershipId).get();
    if (!doc.exists) return next(createHttpError(403, 'Not a member of this org'));
    const role = (doc.data()?.role as string | undefined) ?? '';
    if (role !== 'Owner' && role !== 'Admin') {
      return next(createHttpError(403, 'Insufficient role'));
    }
    return next();
  } catch (error) {
    return next(createHttpError(500, 'Failed to verify org role'));
  }
};

const adminGate = [requireFirebaseStrict, requireOrgAdminIfPresent];
const userGate = [requireFirebaseStrict];

router.get('/integrations/tiktok/config', ...userGate, async (req, res, next) => {
  try {
    const computedRedirectUri = computeRedirectUri(req);
    const configuredRedirectUri = tikTokClient().redirectUri || '';
    const redirectUri = configuredRedirectUri || computedRedirectUri;
    res.json({
      clientKeyConfigured: Boolean(tikTokClient().clientKey),
      clientSecretConfigured: Boolean(tikTokClient().clientSecret),
      redirectUri,
      computedRedirectUri,
      configuredRedirectUri: configuredRedirectUri || null,
      callbackPath: CALLBACK_PATH,
      scopes: getScopes(),
      environment: tikTokEnvironment(),
      connectUrl: computeConnectUrl(req),
    });
  } catch (error) {
    next(error);
  }
});

router.get('/integrations/tiktok/status', ...userGate, async (req, res, next) => {
  try {
    const userId = (req as AuthedRequest).authUser?.uid;
    if (!userId) throw createHttpError(401, 'Unauthorized');
    const status = await getTikTokIntegration(tikTokConnectionKey(userId));
    res.json({ status });
  } catch (error) {
    next(error);
  }
});

router.get('/integrations/tiktok/connect', ...userGate, async (req, res, next) => {
  try {
    const authUser = (req as AuthedRequest).authUser;
    const userId = authUser?.uid;
    if (!userId) throw createHttpError(401, 'Unauthorized');
    const oauthUrl = buildOAuthUrl(req, userId, req.header('x-org-id'), authUser?.email, req.query.returnUrl);
    res.redirect(oauthUrl);
  } catch (error) {
    next(error);
  }
});

router.post('/integrations/tiktok/start', (req, res, next) => {
  if (typeof req.body?.idToken === 'string') req.headers.authorization = 'Bearer ' + req.body.idToken;
  return requireFirebaseStrict(req, res, next);
}, async (req, res, next) => {
  try {
    const authUser = (req as AuthedRequest).authUser;
    if (!authUser?.uid) throw createHttpError(401, 'Unauthorized');
    const orgId = typeof req.body?.orgId === 'string' ? req.body.orgId : null;
    res.redirect(303, buildOAuthUrl(req, authUser.uid, orgId, authUser.email, req.body?.returnUrl));
  } catch (error) {
    next(error);
  }
});

router.get('/integrations/tiktok/connect-url', ...userGate, async (req, res, next) => {
  try {
    const authUser = (req as AuthedRequest).authUser;
    const userId = authUser?.uid;
    if (!userId) throw createHttpError(401, 'Unauthorized');
    const oauthUrl = buildOAuthUrl(req, userId, req.header('x-org-id'), authUser?.email, req.query.returnUrl);
    res.json({ url: oauthUrl });
  } catch (error) {
    next(error);
  }
});

router.get('/integrations/tiktok/callback', async (req, res) => {
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const stateParam = typeof req.query.state === 'string' ? req.query.state : '';
  const oauthError = typeof req.query.error === 'string' ? req.query.error : '';
  const oauthErrorDescription =
    typeof req.query.error_description === 'string' ? req.query.error_description : '';
  const oauthLogId = typeof req.query.log_id === 'string' ? req.query.log_id : '';
  const state = verifySignedState(stateParam);
  if (oauthError) {
    const detail = oauthErrorDescription || oauthError;
    const supportId = oauthLogId ? ` TikTok reference: ${oauthLogId}.` : '';
    res.status(400).send(renderCallbackHtml('TikTok connection failed', `${detail}.${supportId}`));
    return;
  }
  if (!state || state.platform !== 'tiktok' || state.environment !== tikTokEnvironment()) {
    res
      .status(400)
      .send(renderCallbackHtml('TikTok connection failed', 'The secure OAuth session expired. Return to Dott Media and tap Connect TikTok again.'));
    return;
  }
  if (!code) {
    res
      .status(400)
      .send(renderCallbackHtml('TikTok connection failed', 'TikTok did not return an authorization code. Confirm this account is a target user for the app sandbox, then retry.'));
    return;
  }

  let tokenResponse: any;
  try {
    const { clientKey, clientSecret, redirectUri } = ensureTikTokClientConfig(req);
    const params = new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    });
    tokenResponse = await axios.post('https://open.tiktokapis.com/v2/oauth/token/', params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  } catch (error) {
    console.error('[tiktok] token exchange failed', {status: axios.isAxiosError(error)?error.response?.status:undefined});
    res.status(400).send(renderCallbackHtml('TikTok connection failed', 'Unable to exchange authorization code.'));
    return;
  }

  const payload = tokenResponse?.data?.data ?? tokenResponse?.data ?? {};
  const accessToken = payload.access_token as string | undefined;
  const refreshToken = payload.refresh_token as string | undefined;
  const expiresIn = Number(payload.expires_in ?? 0);
  const refreshExpiresIn = Number(payload.refresh_expires_in ?? 0);
  const openId = payload.open_id as string | undefined;
  const scope = payload.scope as string | undefined;

  if (!accessToken) {
    res.status(400).send(renderCallbackHtml('TikTok connection failed', 'Missing access token.'));
    return;
  }

  try {
    assertRequiredScopes(getScopes(), scope);
  } catch (error) {
    res.status(400).send(renderCallbackHtml('TikTok connection failed', (error as Error).message));
    return;
  }

  if (tikTokEnvironment() === 'sandbox') {
    try {
      const creator = await queryTikTokCreator(accessToken);
      if (tikTokSandboxUsername() && creator.creator_username?.toLowerCase() !== tikTokSandboxUsername()!.toLowerCase()) {
        res.status(403).send(renderCallbackHtml('TikTok connection failed', 'Use the configured TikTok sandbox target account and retry.'));
        return;
      }
    } catch (error) {
      console.error('[tiktok] sandbox creator verification failed', { code: safeErrorCode(error) });
      res.status(502).send(renderCallbackHtml('TikTok connection failed', 'Unable to verify the TikTok sandbox account. Please retry.'));
      return;
    }
  }

  try {
    const existing = tikTokEnvironment() === 'production'
      ? await getTikTokIntegration(tikTokConnectionKey(state.userId))
      : null;
    if (!existing?.connected && tikTokEnvironment() === 'production') {
      const userSnap = await firestore.collection('users').doc(state.userId).get().catch(() => null);
      const userData = userSnap?.exists ? userSnap.data() : {};
      await consumeUsage(
        resolveBillingScope(
          state.userId,
          typeof state.orgId === 'string' ? state.orgId : undefined,
          typeof state.email === 'string' ? state.email : typeof userData?.email === 'string' ? userData.email : undefined,
        ),
        'connectedSocials',
        1,
      );
    }
    await upsertTikTokIntegration(tikTokConnectionKey(state.userId), {
      accessToken,
      refreshToken,
      accessTokenExpiresAt: expiresIn ? Date.now() + expiresIn * 1000 : null,
      refreshTokenExpiresAt: refreshExpiresIn ? Date.now() + refreshExpiresIn * 1000 : null,
      openId,
      scope,
      revealToken: true,
    });

  } catch (error) {
    const classified = classifyTikTokStorageError(error);
    console.error('[tiktok] failed to store integration', { code: safeErrorCode(error) });
    res.status(classified.status).send(renderCallbackHtml('TikTok connection failed', classified.message));
    return;
  }

  res.redirect(303, oauthSuccessRedirect('tiktok', state.returnUrl));
});

router.post('/integrations/tiktok/token', ...userGate, async (req, res, next) => {
  try {
    const payload = z
      .object({
        accessToken: z.string().min(1),
        refreshToken: z.string().min(1).optional(),
        openId: z.string().min(1).optional(),
        expiresIn: z.number().int().positive().optional(),
        refreshExpiresIn: z.number().int().positive().optional(),
        scope: z.string().optional(),
      })
      .parse(req.body ?? {});
    const userId = (req as AuthedRequest).authUser?.uid;
    if (!userId) throw createHttpError(401, 'Unauthorized');
    if(tikTokEnvironment()==='sandbox'){const creator=await queryTikTokCreator(payload.accessToken);if(creator.creator_username?.toLowerCase()!==tikTokSandboxUsername()?.toLowerCase())throw createHttpError(403,'Use the configured TikTok sandbox target account');}
    await upsertTikTokIntegration(tikTokConnectionKey(userId), {
      accessToken: payload.accessToken,
      refreshToken: payload.refreshToken,
      accessTokenExpiresAt: payload.expiresIn ? Date.now() + payload.expiresIn * 1000 : null,
      refreshTokenExpiresAt: payload.refreshExpiresIn ? Date.now() + payload.refreshExpiresIn * 1000 : null,
      openId: payload.openId,
      scope: payload.scope,
      revealToken: true,
    });

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.post('/integrations/tiktok/reveal', ...userGate, async (req, res, next) => {
  try {
    const userId = (req as AuthedRequest).authUser?.uid;
    if (!userId) throw createHttpError(401, 'Unauthorized');
    const result = await revealTikTokRefreshToken(tikTokConnectionKey(userId));
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/integrations/tiktok/disconnect', ...userGate, async (req, res, next) => {
  try {
    const userId = (req as AuthedRequest).authUser?.uid;
    if (!userId) throw createHttpError(401, 'Unauthorized');
    await disconnectTikTok(tikTokConnectionKey(userId));
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

function renderCallbackHtml(title: string, message: string) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      body { font-family: Arial, sans-serif; background:#0b0b13; color:#f4f4f8; display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; }
      .card { background:#161623; padding:32px; border-radius:16px; max-width:480px; border:1px solid #2b2b3d; }
      h1 { font-size:20px; margin:0 0 12px 0; }
      p { margin:0; color:#c7c7d8; line-height:1.5; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(message)}</p>
    </div>
  </body>
</html>`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, char => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#039;';
      default:
        return char;
    }
  });
}

mountTikTokReviewRoutes(router);
export default router;
