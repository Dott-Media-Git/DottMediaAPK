import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import admin from 'firebase-admin';
import createHttpError from 'http-errors';
import { requireFirebase } from '../middleware/firebaseAuth.js';
import { createSignedState, verifySignedState } from '../utils/oauthState.js';
import { firestore } from '../db/firestore.js';
import { autoPostService } from '../services/autoPostService.js';
import { supabaseFallbackService } from '../services/supabaseFallbackService.js';
const router = Router();
const CALLBACK_PATH = '/integrations/meta/callback';
const THREADS_CALLBACK_PATH = '/integrations/threads/callback';
const GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? 'v23.0';
const THREADS_GRAPH_VERSION = process.env.THREADS_GRAPH_VERSION ?? 'v1.0';
const THREADS_GRAPH_BASE_URL = process.env.THREADS_GRAPH_BASE_URL ?? 'https://graph.threads.net';
let renderEnvCache;
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
const resolveRenderEnv = () => {
    if (renderEnvCache !== undefined) {
        return renderEnvCache ?? {};
    }
    const candidates = [
        path.resolve(process.cwd(), '.render-env.json'),
        path.resolve(process.cwd(), 'backend/.render-env.json'),
    ];
    for (const candidate of candidates) {
        try {
            if (!fs.existsSync(candidate))
                continue;
            const raw = fs.readFileSync(candidate, 'utf8').replace(/^\uFEFF/, '');
            renderEnvCache = JSON.parse(raw);
            return renderEnvCache;
        }
        catch (error) {
            console.warn('[meta] failed to parse .render-env.json fallback', error);
        }
    }
    renderEnvCache = {};
    return renderEnvCache;
};
const getMetaAppConfig = (req) => {
    const renderEnv = resolveRenderEnv();
    const appId = process.env.META_APP_ID ??
        process.env.FACEBOOK_APP_ID ??
        renderEnv.META_APP_ID ??
        renderEnv.FACEBOOK_APP_ID ??
        '';
    const appSecret = process.env.META_APP_SECRET ??
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
const getThreadsAppConfig = (req) => {
    const renderEnv = resolveRenderEnv();
    const appId = process.env.THREADS_APP_ID ??
        process.env.INSTAGRAM_APP_ID ??
        process.env.META_APP_ID ??
        renderEnv.THREADS_APP_ID ??
        renderEnv.INSTAGRAM_APP_ID ??
        renderEnv.META_APP_ID ??
        '';
    const appSecret = process.env.THREADS_APP_SECRET ??
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
const splitScopes = (value) => value
    .split(',')
    .map(scope => scope.trim())
    .filter(Boolean);
const uniqueScopes = (...scopeGroups) => Array.from(new Set(scopeGroups.flat().filter(Boolean)));
const defaultFacebookScopes = [
    'pages_show_list',
    'pages_read_engagement',
    'pages_manage_posts',
    'pages_manage_metadata',
    'publish_video',
    'business_management',
];
const defaultInstagramScopes = [
    'pages_show_list',
    'pages_read_engagement',
    'instagram_basic',
    'instagram_content_publish',
    'business_management',
];
const getScopes = (platform = 'all') => {
    const renderEnv = resolveRenderEnv();
    const platformEnvKey = platform === 'facebook'
        ? 'META_FACEBOOK_SCOPES'
        : platform === 'instagram'
            ? 'META_INSTAGRAM_SCOPES'
            : 'META_APP_SCOPES';
    const raw = process.env[platformEnvKey] ??
        renderEnv[platformEnvKey] ??
        process.env.META_APP_SCOPES ??
        renderEnv.META_APP_SCOPES ??
        '';
    if (raw.trim()) {
        return splitScopes(raw);
    }
    if (platform === 'facebook')
        return defaultFacebookScopes;
    if (platform === 'instagram')
        return defaultInstagramScopes;
    return uniqueScopes(defaultFacebookScopes, defaultInstagramScopes);
};
const getBusinessLoginConfigId = (platform = 'all') => {
    const renderEnv = resolveRenderEnv();
    const platformEnvKey = platform === 'facebook'
        ? 'META_FACEBOOK_CONFIG_ID'
        : platform === 'instagram'
            ? 'META_INSTAGRAM_CONFIG_ID'
            : 'META_BUSINESS_LOGIN_CONFIG_ID';
    return (process.env[platformEnvKey] ??
        renderEnv[platformEnvKey] ??
        process.env.META_BUSINESS_LOGIN_CONFIG_ID ??
        renderEnv.META_BUSINESS_LOGIN_CONFIG_ID ??
        '').trim();
};
const shouldIncludeScopeWithBusinessConfig = () => String(process.env.META_INCLUDE_SCOPE_WITH_CONFIG_ID ?? resolveRenderEnv().META_INCLUDE_SCOPE_WITH_CONFIG_ID ?? '')
    .toLowerCase()
    .trim() === 'true';
const normalizeMetaConnectPlatform = (value) => {
    const platform = String(value ?? '').toLowerCase();
    if (platform === 'facebook' || platform === 'instagram')
        return platform;
    return 'all';
};
const buildOAuthUrl = (req, userId, platform = 'all') => {
    const { appId, redirectUri } = getMetaAppConfig(req);
    const state = createSignedState(userId, { platform });
    const url = new URL(`https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`);
    url.searchParams.set('client_id', appId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('state', state);
    url.searchParams.set('auth_type', 'rerequest');
    url.searchParams.set('return_scopes', 'true');
    const businessLoginConfigId = getBusinessLoginConfigId(platform);
    if (businessLoginConfigId) {
        url.searchParams.set('config_id', businessLoginConfigId);
        url.searchParams.set('override_default_response_type', 'true');
        if (shouldIncludeScopeWithBusinessConfig()) {
            url.searchParams.set('scope', getScopes(platform).join(','));
        }
    }
    else {
        url.searchParams.set('scope', getScopes(platform).join(','));
    }
    return url.toString();
};
const getThreadsScopes = () => {
    const renderEnv = resolveRenderEnv();
    const raw = process.env.THREADS_APP_SCOPES ?? renderEnv.THREADS_APP_SCOPES ?? '';
    if (raw.trim()) {
        return splitScopes(raw);
    }
    return ['threads_basic', 'threads_content_publish'];
};
const buildThreadsOAuthUrl = (req, userId) => {
    const { appId, redirectUri } = getThreadsAppConfig(req);
    const state = createSignedState(userId, { platform: 'threads' });
    const url = new URL(process.env.THREADS_AUTHORIZE_URL ?? 'https://threads.net/oauth/authorize');
    url.searchParams.set('client_id', appId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', getThreadsScopes().join(','));
    url.searchParams.set('state', state);
    url.searchParams.set('return_scopes', 'true');
    return url.toString();
};
const exchangeCodeForToken = async (req, code) => {
    const { appId, appSecret, redirectUri } = getMetaAppConfig(req);
    const response = await axios.get(`https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`, {
        params: {
            client_id: appId,
            client_secret: appSecret,
            redirect_uri: redirectUri,
            code,
        },
    });
    return response.data?.access_token;
};
const exchangeLongLivedToken = async (req, shortLivedToken) => {
    const { appId, appSecret } = getMetaAppConfig(req);
    const response = await axios.get(`https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`, {
        params: {
            grant_type: 'fb_exchange_token',
            client_id: appId,
            client_secret: appSecret,
            fb_exchange_token: shortLivedToken,
        },
    });
    return response.data?.access_token ?? shortLivedToken;
};
const fetchGrantedPermissions = async (userAccessToken) => {
    const response = await axios.get(`https://graph.facebook.com/${GRAPH_VERSION}/me/permissions`, {
        params: {
            access_token: userAccessToken,
        },
    });
    return new Set((response.data?.data ?? [])
        .filter(entry => entry.status === 'granted' && entry.permission)
        .map(entry => String(entry.permission)));
};
const assertRequiredPermissions = async (userAccessToken, platform) => {
    const requiredScopes = getScopes(platform);
    const grantedScopes = await fetchGrantedPermissions(userAccessToken);
    const missingScopes = requiredScopes.filter(scope => !grantedScopes.has(scope));
    if (missingScopes.length) {
        throw new Error(`Meta did not grant required permissions: ${missingScopes.join(', ')}`);
    }
};
const addScopesFromValue = (target, value) => {
    if (!value)
        return;
    if (Array.isArray(value)) {
        value.forEach(item => {
            if (typeof item === 'string') {
                item
                    .split(/[\s,]+/)
                    .map(scope => scope.trim())
                    .filter(Boolean)
                    .forEach(scope => target.add(scope));
            }
            else if (item && typeof item === 'object') {
                const permission = item.permission
                    ?? item.name
                    ?? item.scope;
                if (permission)
                    target.add(String(permission));
            }
        });
        return;
    }
    if (typeof value === 'string') {
        value
            .split(/[\s,]+/)
            .map(scope => scope.trim())
            .filter(Boolean)
            .forEach(scope => target.add(scope));
    }
};
const extractScopesFromPayload = (payload) => {
    const scopes = new Set();
    if (!payload)
        return scopes;
    ['scope', 'scopes', 'permissions', 'granted_scopes', 'grantedScopes'].forEach(key => {
        addScopesFromValue(scopes, payload[key]);
    });
    return scopes;
};
const assertRequiredThreadsScopes = (requiredScopes, grantedScopes, deniedScopes) => {
    const explicitlyDenied = requiredScopes.filter(scope => deniedScopes.has(scope));
    if (explicitlyDenied.length) {
        throw new Error(`Threads did not grant required permissions: ${explicitlyDenied.join(', ')}`);
    }
    if (!grantedScopes.size)
        return;
    const missingScopes = requiredScopes.filter(scope => !grantedScopes.has(scope));
    if (missingScopes.length) {
        throw new Error(`Threads did not grant required permissions: ${missingScopes.join(', ')}`);
    }
};
const exchangeThreadsCodeForToken = async (req, code) => {
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
    return {
        accessToken: response.data?.access_token,
        grantedScopes: extractScopesFromPayload(response.data),
    };
};
const exchangeThreadsLongLivedToken = async (req, shortLivedToken) => {
    const { appSecret } = getThreadsAppConfig(req);
    const response = await axios.get(`${THREADS_GRAPH_BASE_URL}/access_token`, {
        params: {
            grant_type: 'th_exchange_token',
            client_secret: appSecret,
            access_token: shortLivedToken,
        },
    });
    return {
        accessToken: response.data?.access_token ?? shortLivedToken,
        grantedScopes: extractScopesFromPayload(response.data),
    };
};
const fetchManagedPages = async (userAccessToken) => {
    const response = await axios.get(`https://graph.facebook.com/${GRAPH_VERSION}/me/accounts`, {
        params: {
            fields: 'id,name,access_token,instagram_business_account{id,username}',
            access_token: userAccessToken,
        },
    });
    return (response.data?.data ?? []).filter(page => page.id);
};
const buildConnectedMetaAssets = (pages) => pages
    .filter(page => page.id)
    .map(page => ({
    id: String(page.id),
    ...(page.name ? { name: page.name } : {}),
    ...(page.instagram_business_account?.id
        ? {
            instagramBusinessAccount: {
                id: String(page.instagram_business_account.id),
                ...(page.instagram_business_account.username
                    ? { username: page.instagram_business_account.username }
                    : {}),
            },
        }
        : {}),
}));
const fetchThreadsProfile = async (userAccessToken, instagramAccountId) => {
    if (!instagramAccountId)
        return null;
    try {
        const response = await axios.get(`https://graph.facebook.com/${GRAPH_VERSION}/${instagramAccountId}`, {
            params: {
                fields: 'threads_profile{id,username}',
                access_token: userAccessToken,
            },
        });
        return response.data?.threads_profile ?? null;
    }
    catch (error) {
        console.warn('[meta] failed to resolve Threads profile', error.message);
        return null;
    }
};
const fetchThreadsMe = async (accessToken) => {
    const response = await axios.get(`${THREADS_GRAPH_BASE_URL}/${THREADS_GRAPH_VERSION}/me`, {
        params: {
            fields: 'id,username',
            access_token: accessToken,
        },
    });
    return {
        id: response.data?.id,
        username: response.data?.username,
    };
};
const loadStoredSocialAccounts = async (userId) => {
    let userData = {};
    try {
        const userDoc = await firestore.collection('users').doc(userId).get();
        userData = userDoc.data() ?? {};
    }
    catch (error) {
        console.warn('[meta] Firestore social account lookup failed; using fallback store', {
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
                    socialAccounts: fallback.socialAccounts,
                };
            }
        }
        catch (error) {
            console.warn('[meta] fallback social account lookup failed', {
                userId,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
    return userData;
};
const persistSocialAccounts = async (userId, payload) => {
    let firestoreError = null;
    let fallbackError = null;
    try {
        await firestore.collection('users').doc(userId).set({ socialAccounts: payload.socialAccounts }, { merge: true });
    }
    catch (error) {
        firestoreError = error;
        console.warn('[meta] Firestore social account save failed; saving to fallback store', {
            userId,
            error: error instanceof Error ? error.message : String(error),
        });
    }
    try {
        await supabaseFallbackService.upsertSocialAccounts(userId, payload);
    }
    catch (error) {
        fallbackError = error;
        console.warn('[meta] fallback social account save failed', {
            userId,
            error: error instanceof Error ? error.message : String(error),
        });
    }
    if (firestoreError && fallbackError) {
        throw fallbackError;
    }
};
const mergeAutopostPlatforms = async (userId, platformsToAdd) => {
    const autopostRef = firestore.collection('autopostJobs').doc(userId);
    const autopostSnap = await autopostRef.get();
    const autopostData = autopostSnap.data() ?? {};
    const postPlatformSet = new Set((autopostData.platforms ?? []).filter(Boolean));
    const trendPlatformSet = new Set((autopostData.trendPlatforms ?? []).filter(Boolean));
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
    await autopostRef.set({
        platforms: Array.from(postPlatformSet),
        trendPlatforms: Array.from(trendPlatformSet),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
};
const renderCallbackHtml = (title, message) => `<!doctype html>
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
            scopes: getScopes('all'),
            facebookScopes: getScopes('facebook'),
            instagramScopes: getScopes('instagram'),
            callbackPath: CALLBACK_PATH,
        });
    }
    catch (error) {
        next(error);
    }
});
router.get('/integrations/meta/connect', requireFirebase, async (req, res, next) => {
    try {
        const userId = req.authUser?.uid;
        if (!userId)
            throw createHttpError(401, 'Unauthorized');
        const platform = normalizeMetaConnectPlatform(req.query.platform);
        res.redirect(buildOAuthUrl(req, userId, platform));
    }
    catch (error) {
        next(error);
    }
});
router.get('/integrations/meta/connect-url', requireFirebase, async (req, res, next) => {
    try {
        const userId = req.authUser?.uid;
        if (!userId)
            throw createHttpError(401, 'Unauthorized');
        const platform = normalizeMetaConnectPlatform(req.query.platform);
        res.json({ url: buildOAuthUrl(req, userId, platform), platform });
    }
    catch (error) {
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
    }
    catch (error) {
        next(error);
    }
});
router.get('/integrations/threads/connect', requireFirebase, async (req, res, next) => {
    try {
        const userId = req.authUser?.uid;
        if (!userId)
            throw createHttpError(401, 'Unauthorized');
        res.redirect(buildThreadsOAuthUrl(req, userId));
    }
    catch (error) {
        next(error);
    }
});
router.get('/integrations/threads/connect-url', requireFirebase, async (req, res, next) => {
    try {
        const userId = req.authUser?.uid;
        if (!userId)
            throw createHttpError(401, 'Unauthorized');
        res.json({ url: buildThreadsOAuthUrl(req, userId) });
    }
    catch (error) {
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
        const userData = await loadStoredSocialAccounts(state.userId);
        const currentAccounts = { ...(userData.socialAccounts ?? {}) };
        const requestedPlatform = normalizeMetaConnectPlatform(state.platform);
        const userAccessToken = await exchangeLongLivedToken(req, shortLivedToken);
        await assertRequiredPermissions(userAccessToken, requestedPlatform);
        const pages = await fetchManagedPages(userAccessToken);
        if (!pages.length) {
            throw new Error('No managed Facebook Pages found for this Meta account');
        }
        currentAccounts.meta = {
            ...(currentAccounts.meta ?? {}),
            connectedAt: new Date().toISOString(),
            pages: buildConnectedMetaAssets(pages),
        };
        const preferredPageId = String(currentAccounts.facebook?.pageId ?? '').trim();
        const preferredPage = preferredPageId ? pages.find(page => page.id === preferredPageId) : null;
        const selectedPage = (requestedPlatform === 'instagram' && preferredPage?.instagram_business_account?.id ? preferredPage : null) ??
            (requestedPlatform !== 'instagram' ? preferredPage : null) ??
            (requestedPlatform === 'instagram' ? pages.find(page => page.instagram_business_account?.id) : null) ??
            pages[0];
        if (!selectedPage?.id || !selectedPage?.access_token) {
            throw new Error('Unable to resolve a usable Facebook Page token');
        }
        const connectedPlatforms = [];
        if (requestedPlatform === 'facebook' || requestedPlatform === 'all') {
            currentAccounts.facebook = {
                accessToken: selectedPage.access_token,
                userAccessToken,
                pageId: selectedPage.id,
                pageName: selectedPage.name ?? currentAccounts.facebook?.pageName,
            };
            connectedPlatforms.push('facebook');
        }
        const instagramAccount = selectedPage.instagram_business_account;
        if (requestedPlatform === 'instagram' && !instagramAccount?.id) {
            throw new Error('No Instagram Business account is linked to the selected Facebook Page in Meta Business Suite.');
        }
        if ((requestedPlatform === 'instagram' || requestedPlatform === 'all') && instagramAccount?.id) {
            currentAccounts.instagram = {
                accessToken: userAccessToken,
                accountId: instagramAccount.id,
                username: instagramAccount.username ?? currentAccounts.instagram?.username,
            };
            connectedPlatforms.push('instagram');
            if (requestedPlatform === 'all') {
                const threadsProfile = await fetchThreadsProfile(userAccessToken, instagramAccount.id);
                if (threadsProfile?.id) {
                    currentAccounts.threads = {
                        accessToken: userAccessToken,
                        accountId: threadsProfile.id,
                        username: threadsProfile.username ?? currentAccounts.threads?.username,
                    };
                    connectedPlatforms.push('threads');
                }
            }
        }
        await persistSocialAccounts(state.userId, { email: userData.email ?? null, socialAccounts: currentAccounts });
        try {
            await mergeAutopostPlatforms(state.userId, connectedPlatforms);
        }
        catch (error) {
            console.warn('[meta] autopost platform merge failed after successful credential save', {
                userId: state.userId,
                error: error instanceof Error ? error.message : String(error),
            });
        }
        const connectedChannels = [
            connectedPlatforms.includes('facebook') ? 'Facebook' : null,
            connectedPlatforms.includes('instagram') ? 'Instagram' : null,
            connectedPlatforms.includes('threads') ? 'Threads' : null,
        ]
            .filter(Boolean)
            .join(', ');
        res
            .status(200)
            .send(renderCallbackHtml('Meta connected', `${connectedChannels || 'Facebook'} is now connected. You can close this window and return to Dott Media.`));
    }
    catch (error) {
        console.error('[meta] connection failed', error);
        res
            .status(400)
            .send(renderCallbackHtml('Meta connection failed', error.message || 'Unable to complete the Meta connection flow.'));
    }
});
router.get('/integrations/threads/callback', async (req, res) => {
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const stateParam = typeof req.query.state === 'string' ? req.query.state : '';
    const state = verifySignedState(stateParam);
    const deniedScopes = extractScopesFromPayload({ denied_scopes: req.query.denied_scopes });
    const callbackGrantedScopes = extractScopesFromPayload({ granted_scopes: req.query.granted_scopes, scope: req.query.scope });
    if (!code || !state) {
        res.status(400).send(renderCallbackHtml('Threads connection failed', 'Invalid OAuth state or missing code.'));
        return;
    }
    try {
        const requiredScopes = getThreadsScopes();
        assertRequiredThreadsScopes(requiredScopes, callbackGrantedScopes, deniedScopes);
        const shortLivedToken = await exchangeThreadsCodeForToken(req, code);
        if (!shortLivedToken.accessToken) {
            throw new Error('Missing short-lived Threads token');
        }
        const longLivedToken = await exchangeThreadsLongLivedToken(req, shortLivedToken.accessToken);
        const grantedScopes = new Set([
            ...Array.from(callbackGrantedScopes),
            ...Array.from(shortLivedToken.grantedScopes),
            ...Array.from(longLivedToken.grantedScopes),
        ]);
        assertRequiredThreadsScopes(requiredScopes, grantedScopes, deniedScopes);
        const accessToken = longLivedToken.accessToken;
        const profile = await fetchThreadsMe(accessToken);
        if (!profile.id) {
            throw new Error('Unable to resolve Threads profile');
        }
        const userData = await loadStoredSocialAccounts(state.userId);
        const currentAccounts = { ...(userData.socialAccounts ?? {}) };
        currentAccounts.threads = {
            accessToken,
            accountId: profile.id,
            username: profile.username ?? currentAccounts.threads?.username,
        };
        await persistSocialAccounts(state.userId, { email: userData.email ?? null, socialAccounts: currentAccounts });
        try {
            await mergeAutopostPlatforms(state.userId, ['threads']);
        }
        catch (error) {
            console.warn('[threads] autopost platform merge failed after successful credential save', {
                userId: state.userId,
                error: error instanceof Error ? error.message : String(error),
            });
        }
        res
            .status(200)
            .send(renderCallbackHtml('Threads connected', `Threads${profile.username ? ` (@${profile.username})` : ''} is now connected. You can close this window and return to Dott Media.`));
    }
    catch (error) {
        console.error('[threads] connection failed', error);
        res
            .status(400)
            .send(renderCallbackHtml('Threads connection failed', error.message || 'Unable to complete the Threads connection flow.'));
    }
});
export default router;
