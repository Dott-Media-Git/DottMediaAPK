import { Router } from 'express';
import { z } from 'zod';
import axios from 'axios';
import createHttpError from 'http-errors';
import { config } from '../config.js';
import { requireFirebase } from '../middleware/firebaseAuth.js';
import { createSignedState, verifySignedState } from '../utils/oauthState.js';
import { disconnectTikTok, getTikTokIntegration, revealTikTokRefreshToken, upsertTikTokIntegration, } from '../services/socialIntegrationService.js';
import { firestore } from '../db/firestore.js';
const router = Router();
const CALLBACK_PATH = '/integrations/tiktok/callback';
const normalizeBaseUrl = (value) => value.replace(/\/+$/, '');
const getBaseUrl = (req) => {
    const envBase = process.env.BASE_URL ?? process.env.RENDER_EXTERNAL_URL;
    if (envBase)
        return normalizeBaseUrl(envBase);
    const forwardedProto = (req.header('x-forwarded-proto') || '').split(',')[0].trim();
    const proto = forwardedProto || req.protocol;
    const forwardedHost = (req.header('x-forwarded-host') || '').split(',')[0].trim();
    const host = forwardedHost || req.get('host');
    return normalizeBaseUrl(`${proto}://${host}`);
};
const computeRedirectUri = (req) => `${getBaseUrl(req)}${CALLBACK_PATH}`;
const computeConnectUrl = (req) => `${getBaseUrl(req)}/integrations/tiktok/connect`;
const getScopes = () => {
    const raw = process.env.TIKTOK_SCOPES?.trim();
    return raw ? raw.split(',').map(scope => scope.trim()).filter(Boolean) : ['user.info.basic', 'video.upload', 'video.publish'];
};
const ensureTikTokClientConfig = (req) => {
    const clientKey = config.tiktok.clientKey;
    const clientSecret = config.tiktok.clientSecret;
    const redirectUri = config.tiktok.redirectUri || computeRedirectUri(req);
    if (!clientKey || !clientSecret) {
        throw createHttpError(400, 'Missing TIKTOK_CLIENT_KEY or TIKTOK_CLIENT_SECRET');
    }
    return { clientKey, clientSecret, redirectUri, scopes: getScopes() };
};
const buildOAuthUrl = (req, userId) => {
    const { clientKey, redirectUri, scopes } = ensureTikTokClientConfig(req);
    const state = createSignedState(userId);
    const oauthUrl = new URL('https://www.tiktok.com/v2/auth/authorize/');
    oauthUrl.searchParams.set('client_key', clientKey);
    oauthUrl.searchParams.set('redirect_uri', redirectUri);
    oauthUrl.searchParams.set('response_type', 'code');
    oauthUrl.searchParams.set('scope', scopes.join(','));
    oauthUrl.searchParams.set('state', state);
    return oauthUrl.toString();
};
const requireOrgAdminIfPresent = async (req, _res, next) => {
    try {
        const orgId = req.header('x-org-id')?.trim();
        if (!orgId)
            return next();
        const authUser = req.authUser;
        if (!authUser)
            return next(createHttpError(401, 'Unauthorized'));
        const membershipId = `${orgId}_${authUser.uid}`;
        const doc = await firestore.collection('orgUsers').doc(membershipId).get();
        if (!doc.exists)
            return next(createHttpError(403, 'Not a member of this org'));
        const role = doc.data()?.role ?? '';
        if (role !== 'Owner' && role !== 'Admin') {
            return next(createHttpError(403, 'Insufficient role'));
        }
        return next();
    }
    catch (error) {
        return next(createHttpError(500, 'Failed to verify org role'));
    }
};
const adminGate = [requireFirebase, requireOrgAdminIfPresent];
router.get('/integrations/tiktok/config', ...adminGate, async (req, res, next) => {
    try {
        const computedRedirectUri = computeRedirectUri(req);
        const configuredRedirectUri = config.tiktok.redirectUri || '';
        const redirectUri = configuredRedirectUri || computedRedirectUri;
        res.json({
            clientKeyConfigured: Boolean(config.tiktok.clientKey),
            clientSecretConfigured: Boolean(config.tiktok.clientSecret),
            redirectUri,
            computedRedirectUri,
            configuredRedirectUri: configuredRedirectUri || null,
            callbackPath: CALLBACK_PATH,
            scopes: getScopes(),
            connectUrl: computeConnectUrl(req),
        });
    }
    catch (error) {
        next(error);
    }
});
router.get('/integrations/tiktok/status', ...adminGate, async (req, res, next) => {
    try {
        const userId = req.authUser?.uid;
        if (!userId)
            throw createHttpError(401, 'Unauthorized');
        const status = await getTikTokIntegration(userId);
        res.json({ status });
    }
    catch (error) {
        next(error);
    }
});
router.get('/integrations/tiktok/connect', ...adminGate, async (req, res, next) => {
    try {
        const userId = req.authUser?.uid;
        if (!userId)
            throw createHttpError(401, 'Unauthorized');
        const oauthUrl = buildOAuthUrl(req, userId);
        res.redirect(oauthUrl);
    }
    catch (error) {
        next(error);
    }
});
router.get('/integrations/tiktok/connect-url', ...adminGate, async (req, res, next) => {
    try {
        const userId = req.authUser?.uid;
        if (!userId)
            throw createHttpError(401, 'Unauthorized');
        const oauthUrl = buildOAuthUrl(req, userId);
        res.json({ url: oauthUrl });
    }
    catch (error) {
        next(error);
    }
});
router.get('/integrations/tiktok/callback', async (req, res) => {
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const stateParam = typeof req.query.state === 'string' ? req.query.state : '';
    const state = verifySignedState(stateParam);
    if (!code || !state) {
        res.status(400).send(renderCallbackHtml('TikTok connection failed', 'Invalid OAuth state or missing code.'));
        return;
    }
    let tokenResponse;
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
    }
    catch (error) {
        console.error('[tiktok] token exchange failed', error);
        res.status(400).send(renderCallbackHtml('TikTok connection failed', 'Unable to exchange authorization code.'));
        return;
    }
    const payload = tokenResponse?.data?.data ?? tokenResponse?.data ?? {};
    const accessToken = payload.access_token;
    const refreshToken = payload.refresh_token;
    const expiresIn = Number(payload.expires_in ?? 0);
    const refreshExpiresIn = Number(payload.refresh_expires_in ?? 0);
    const openId = payload.open_id;
    const scope = payload.scope;
    if (!accessToken) {
        res.status(400).send(renderCallbackHtml('TikTok connection failed', 'Missing access token.'));
        return;
    }
    try {
        await upsertTikTokIntegration(state.userId, {
            accessToken,
            refreshToken,
            accessTokenExpiresAt: expiresIn ? Date.now() + expiresIn * 1000 : null,
            refreshTokenExpiresAt: refreshExpiresIn ? Date.now() + refreshExpiresIn * 1000 : null,
            openId,
            scope,
            revealToken: true,
        });
    }
    catch (error) {
        console.error('[tiktok] failed to store integration', error);
        res.status(500).send(renderCallbackHtml('TikTok connection failed', 'Unable to store access token.'));
        return;
    }
    res.status(200).send(renderCallbackHtml('TikTok connected', 'You can close this window and return to Dott Media.'));
});
router.post('/integrations/tiktok/token', ...adminGate, async (req, res, next) => {
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
        const userId = req.authUser?.uid;
        if (!userId)
            throw createHttpError(401, 'Unauthorized');
        await upsertTikTokIntegration(userId, {
            accessToken: payload.accessToken,
            refreshToken: payload.refreshToken,
            accessTokenExpiresAt: payload.expiresIn ? Date.now() + payload.expiresIn * 1000 : null,
            refreshTokenExpiresAt: payload.refreshExpiresIn ? Date.now() + payload.refreshExpiresIn * 1000 : null,
            openId: payload.openId,
            scope: payload.scope,
            revealToken: true,
        });
        res.json({ ok: true });
    }
    catch (error) {
        next(error);
    }
});
router.post('/integrations/tiktok/reveal', ...adminGate, async (req, res, next) => {
    try {
        const userId = req.authUser?.uid;
        if (!userId)
            throw createHttpError(401, 'Unauthorized');
        const result = await revealTikTokRefreshToken(userId);
        res.json(result);
    }
    catch (error) {
        next(error);
    }
});
router.post('/integrations/tiktok/disconnect', ...adminGate, async (req, res, next) => {
    try {
        const userId = req.authUser?.uid;
        if (!userId)
            throw createHttpError(401, 'Unauthorized');
        await disconnectTikTok(userId);
        res.json({ ok: true });
    }
    catch (error) {
        next(error);
    }
});
function renderCallbackHtml(title, message) {
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
function escapeHtml(value) {
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
export default router;
