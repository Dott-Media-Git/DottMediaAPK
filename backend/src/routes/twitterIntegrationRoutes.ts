import { Router, Request } from 'express';
import admin from 'firebase-admin';
import createHttpError from 'http-errors';
import { TwitterApi } from 'twitter-api-v2';
import { requireFirebase, requireFirebaseForm, AuthedRequest } from '../middleware/firebaseAuth';
import { firestore } from '../db/firestore';
import { consumeUsage, resolveBillingScope } from '../services/billing/billingService';
import { oauthSuccessRedirect } from '../utils/oauthRedirect';

const router = Router();

const CALLBACK_PATH = '/integrations/twitter/callback';
const REQUEST_COLLECTION = 'twitterOAuthRequests';

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
const computeConnectUrl = (req: Request) => `${getBaseUrl(req)}/integrations/twitter/connect`;

const getAppConfig = () => {
  const appKey = process.env.TWITTER_API_KEY ?? process.env.TWITTER_CONSUMER_KEY ?? '';
  const appSecret = process.env.TWITTER_API_SECRET ?? process.env.TWITTER_CONSUMER_SECRET ?? '';
  if (!appKey || !appSecret) {
    throw createHttpError(400, 'Missing TWITTER_API_KEY or TWITTER_API_SECRET');
  }
  return { appKey, appSecret };
};

const getClient = () => {
  const { appKey, appSecret } = getAppConfig();
  return new TwitterApi({ appKey, appSecret });
};

const buildOAuthUrl = async (req: Request, userId: string, orgId?: string | null, email?: string | null) => {
  const callbackUrl = process.env.TWITTER_REDIRECT_URI ?? process.env.X_REDIRECT_URI ?? computeRedirectUri(req);
  const result = await getClient().generateAuthLink(callbackUrl, { linkMode: 'authorize' });
  await firestore.collection(REQUEST_COLLECTION).doc(result.oauth_token).set({
    userId,
    orgId: orgId || null,
    email: email || null,
    oauthToken: result.oauth_token,
    oauthTokenSecret: result.oauth_token_secret,
    callbackUrl,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return result.url;
};

router.get('/integrations/twitter/config', requireFirebase, async (req, res, next) => {
  try {
    const configuredRedirectUri = process.env.TWITTER_REDIRECT_URI ?? process.env.X_REDIRECT_URI ?? '';
    res.json({
      appKeyConfigured: Boolean(process.env.TWITTER_API_KEY ?? process.env.TWITTER_CONSUMER_KEY),
      appSecretConfigured: Boolean(process.env.TWITTER_API_SECRET ?? process.env.TWITTER_CONSUMER_SECRET),
      redirectUri: configuredRedirectUri || computeRedirectUri(req),
      computedRedirectUri: computeRedirectUri(req),
      configuredRedirectUri: configuredRedirectUri || null,
      callbackPath: CALLBACK_PATH,
      connectUrl: computeConnectUrl(req),
    });
  } catch (error) {
    next(error);
  }
});

router.get('/integrations/twitter/connect', requireFirebase, async (req, res, next) => {
  try {
    const authUser = (req as AuthedRequest).authUser;
    const userId = authUser?.uid;
    if (!userId) throw createHttpError(401, 'Unauthorized');
    res.redirect(await buildOAuthUrl(req, userId, req.header('x-org-id'), authUser?.email));
  } catch (error) {
    next(error);
  }
});

router.post('/integrations/twitter/start', requireFirebaseForm, async (req, res, next) => {
  try {
    const authUser = (req as AuthedRequest).authUser;
    if (!authUser?.uid) throw createHttpError(401, 'Unauthorized');
    const orgId = typeof req.body?.orgId === 'string' ? req.body.orgId : null;
    res.redirect(303, await buildOAuthUrl(req, authUser.uid, orgId, authUser.email));
  } catch (error) {
    next(error);
  }
});

router.get('/integrations/twitter/connect-url', requireFirebase, async (req, res, next) => {
  try {
    const authUser = (req as AuthedRequest).authUser;
    const userId = authUser?.uid;
    if (!userId) throw createHttpError(401, 'Unauthorized');
    res.json({ url: await buildOAuthUrl(req, userId, req.header('x-org-id'), authUser?.email) });
  } catch (error) {
    next(error);
  }
});

router.get('/integrations/twitter/callback', async (req, res) => {
  const oauthToken = typeof req.query.oauth_token === 'string' ? req.query.oauth_token : '';
  const oauthVerifier = typeof req.query.oauth_verifier === 'string' ? req.query.oauth_verifier : '';
  if (!oauthToken || !oauthVerifier) {
    res.status(400).send(renderCallbackHtml('X connection failed', 'Missing OAuth token or verifier.'));
    return;
  }

  const requestRef = firestore.collection(REQUEST_COLLECTION).doc(oauthToken);
  const requestSnap = await requestRef.get();
  if (!requestSnap.exists) {
    res.status(400).send(renderCallbackHtml('X connection failed', 'OAuth request expired or was not found.'));
    return;
  }
  const requestData = requestSnap.data() as { userId?: string; orgId?: string | null; email?: string | null; oauthTokenSecret?: string } | undefined;
  if (!requestData?.userId || !requestData.oauthTokenSecret) {
    res.status(400).send(renderCallbackHtml('X connection failed', 'OAuth request is incomplete.'));
    return;
  }

  try {
    const client = new TwitterApi({
      ...getAppConfig(),
      accessToken: oauthToken,
      accessSecret: requestData.oauthTokenSecret,
    });
    const login = await client.login(oauthVerifier);
    const verified = await login.client.v2.me();
    const existingSnap = await firestore.collection('users').doc(requestData.userId).get();
    const existingData = existingSnap.exists ? existingSnap.data() : {};
    if (!existingData?.socialAccounts?.twitter) {
      await consumeUsage(
        resolveBillingScope(
          requestData.userId,
          requestData.orgId || undefined,
          requestData.email || (typeof existingData?.email === 'string' ? existingData.email : undefined),
        ),
        'connectedSocials',
        1,
      );
    }
    await firestore.collection('users').doc(requestData.userId).set(
      {
        socialAccounts: {
          twitter: {
            accessToken: login.accessToken,
            accessSecret: login.accessSecret,
            username: verified.data?.username ?? null,
            userId: verified.data?.id ?? null,
            connectedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
        },
      },
      { merge: true },
    );
    await requestRef.delete();
  } catch (error) {
    console.error('[twitter] OAuth callback failed', error);
    res.status(400).send(renderCallbackHtml('X connection failed', 'Unable to finish X authorization.'));
    return;
  }

  res.redirect(303, oauthSuccessRedirect('twitter'));
});

const renderCallbackHtml = (title: string, message: string) => `<!doctype html>
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

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, char => {
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

export default router;
