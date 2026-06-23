import { Router, Request } from 'express';
import axios from 'axios';
import admin from 'firebase-admin';
import createHttpError from 'http-errors';
import { requireFirebase, AuthedRequest } from '../middleware/firebaseAuth';
import { createSignedState, verifySignedState } from '../utils/oauthState';
import { firestore } from '../db/firestore';
import { consumeUsage, resolveBillingScope } from '../services/billing/billingService';

const router = Router();

const CALLBACK_PATH = '/integrations/linkedin/callback';
const LINKEDIN_API = 'https://api.linkedin.com';
const DEFAULT_SCOPES = ['openid', 'profile', 'w_member_social'];

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
const computeConnectUrl = (req: Request) => `${getBaseUrl(req)}/integrations/linkedin/connect`;

const splitScopes = (value: unknown) =>
  String(value ?? '')
    .split(/[,\s]+/)
    .map(scope => scope.trim())
    .filter(Boolean);

const getScopes = () => {
  const raw = process.env.LINKEDIN_SCOPES?.trim();
  return raw ? splitScopes(raw) : DEFAULT_SCOPES;
};

const getClientConfig = (req: Request) => {
  const clientId = process.env.LINKEDIN_CLIENT_ID ?? '';
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET ?? '';
  const redirectUri = process.env.LINKEDIN_REDIRECT_URI ?? computeRedirectUri(req);
  if (!clientId || !clientSecret) {
    throw createHttpError(400, 'Missing LINKEDIN_CLIENT_ID or LINKEDIN_CLIENT_SECRET');
  }
  return { clientId, clientSecret, redirectUri };
};

const buildOAuthUrl = (req: Request, userId: string, orgId?: string | null, email?: string | null) => {
  const { clientId, redirectUri } = getClientConfig(req);
  const state = createSignedState(userId, { platform: 'linkedin', orgId: orgId || undefined, email: email || undefined });
  const oauthUrl = new URL('https://www.linkedin.com/oauth/v2/authorization');
  oauthUrl.searchParams.set('response_type', 'code');
  oauthUrl.searchParams.set('client_id', clientId);
  oauthUrl.searchParams.set('redirect_uri', redirectUri);
  oauthUrl.searchParams.set('scope', getScopes().join(' '));
  oauthUrl.searchParams.set('state', state);
  return oauthUrl.toString();
};

const assertRequiredScopes = (value: unknown) => {
  const granted = new Set(splitScopes(value));
  if (granted.size === 0) return;
  const required = getScopes();
  const missing = required.filter(scope => !granted.has(scope));
  if (missing.length) {
    throw new Error(`Missing required LinkedIn permissions: ${missing.join(', ')}`);
  }
};

const fetchLinkedInUrn = async (accessToken: string) => {
  const openIdResponse = await axios.get(`${LINKEDIN_API}/v2/userinfo`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: 30000,
  });
  const sub = openIdResponse.data?.sub ? String(openIdResponse.data.sub) : '';
  if (sub) return { urn: `urn:li:person:${sub}`, name: openIdResponse.data?.name ? String(openIdResponse.data.name) : null };

  const profileResponse = await axios.get(`${LINKEDIN_API}/v2/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: 30000,
  });
  const id = profileResponse.data?.id ? String(profileResponse.data.id) : '';
  if (!id) throw new Error('LinkedIn profile ID missing');
  return { urn: `urn:li:person:${id}`, name: null };
};

router.get('/integrations/linkedin/config', requireFirebase, async (req, res, next) => {
  try {
    const configuredRedirectUri = process.env.LINKEDIN_REDIRECT_URI ?? '';
    res.json({
      clientIdConfigured: Boolean(process.env.LINKEDIN_CLIENT_ID),
      clientSecretConfigured: Boolean(process.env.LINKEDIN_CLIENT_SECRET),
      redirectUri: configuredRedirectUri || computeRedirectUri(req),
      computedRedirectUri: computeRedirectUri(req),
      configuredRedirectUri: configuredRedirectUri || null,
      callbackPath: CALLBACK_PATH,
      scopes: getScopes(),
      connectUrl: computeConnectUrl(req),
    });
  } catch (error) {
    next(error);
  }
});

router.get('/integrations/linkedin/connect', requireFirebase, async (req, res, next) => {
  try {
    const authUser = (req as AuthedRequest).authUser;
    const userId = authUser?.uid;
    if (!userId) throw createHttpError(401, 'Unauthorized');
    res.redirect(buildOAuthUrl(req, userId, req.header('x-org-id'), authUser?.email));
  } catch (error) {
    next(error);
  }
});

router.get('/integrations/linkedin/connect-url', requireFirebase, async (req, res, next) => {
  try {
    const authUser = (req as AuthedRequest).authUser;
    const userId = authUser?.uid;
    if (!userId) throw createHttpError(401, 'Unauthorized');
    res.json({ url: buildOAuthUrl(req, userId, req.header('x-org-id'), authUser?.email) });
  } catch (error) {
    next(error);
  }
});

router.get('/integrations/linkedin/callback', async (req, res) => {
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const stateParam = typeof req.query.state === 'string' ? req.query.state : '';
  const state = verifySignedState(stateParam);
  if (!code || !state) {
    res.status(400).send(renderCallbackHtml('LinkedIn connection failed', 'Invalid OAuth state or missing code.'));
    return;
  }

  let tokenResponse: any;
  try {
    const { clientId, clientSecret, redirectUri } = getClientConfig(req);
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    });
    tokenResponse = await axios.post('https://www.linkedin.com/oauth/v2/accessToken', params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 30000,
    });
  } catch (error) {
    console.error('[linkedin] token exchange failed', error);
    res.status(400).send(renderCallbackHtml('LinkedIn connection failed', 'Unable to exchange authorization code.'));
    return;
  }

  const accessToken = tokenResponse?.data?.access_token as string | undefined;
  if (!accessToken) {
    res.status(400).send(renderCallbackHtml('LinkedIn connection failed', 'Missing access token.'));
    return;
  }

  try {
    assertRequiredScopes(tokenResponse?.data?.scope);
    const profile = await fetchLinkedInUrn(accessToken);
    const existingSnap = await firestore.collection('users').doc(state.userId).get();
    const existingData = existingSnap.exists ? existingSnap.data() : {};
    if (!existingData?.socialAccounts?.linkedin) {
      await consumeUsage(
        resolveBillingScope(
          state.userId,
          typeof state.orgId === 'string' ? state.orgId : undefined,
          typeof state.email === 'string' ? state.email : typeof existingData?.email === 'string' ? existingData.email : undefined,
        ),
        'connectedSocials',
        1,
      );
    }
    await firestore.collection('users').doc(state.userId).set(
      {
        socialAccounts: {
          linkedin: {
            accessToken,
            urn: profile.urn,
            name: profile.name,
            scope: tokenResponse?.data?.scope ?? getScopes().join(' '),
            connectedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
        },
      },
      { merge: true },
    );
  } catch (error) {
    console.error('[linkedin] failed to store integration', error);
    res.status(400).send(renderCallbackHtml('LinkedIn connection failed', (error as Error).message));
    return;
  }

  res.status(200).send(renderCallbackHtml('LinkedIn connected', 'You can close this window and return to Dott Media.'));
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
