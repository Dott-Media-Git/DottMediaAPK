import { Router } from 'express';
import { z } from 'zod';
import createHttpError from 'http-errors';
import axios from 'axios';
import { google } from 'googleapis';
import { config } from '../config.js';
import { requireFirebase } from '../middleware/firebaseAuth.js';
import { createSignedState, verifySignedState } from '../utils/oauthState.js';
import { disconnectYouTube, getYouTubeIntegration, revealYouTubeRefreshToken, upsertYouTubeIntegration, updateYouTubeIntegrationDefaults, } from '../services/socialIntegrationService.js';
import { validateVideoUrl } from '../services/videoUrlService.js';
import { enqueueYouTubeUpload, enqueueYouTubeSoraUpload, getYouTubeJobStatus } from '../services/youtubeUploadService.js';
import { firestore } from '../db/firestore.js';
const router = Router();
const CALLBACK_PATH = '/integrations/youtube/callback';
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
const computeConnectUrl = (req) => `${getBaseUrl(req)}/integrations/youtube/connect`;
const ensureYouTubeClientConfig = (req) => {
    const clientId = config.youtube.clientId;
    const clientSecret = config.youtube.clientSecret;
    const redirectUri = config.youtube.redirectUri || computeRedirectUri(req);
    if (!clientId || !clientSecret) {
        throw createHttpError(400, 'Missing YOUTUBE_CLIENT_ID or YOUTUBE_CLIENT_SECRET');
    }
    return { clientId, clientSecret, redirectUri };
};
const buildOAuthUrl = (req, userId) => {
    const { clientId, redirectUri } = ensureYouTubeClientConfig(req);
    const state = createSignedState(userId);
    const oauthUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    oauthUrl.searchParams.set('client_id', clientId);
    oauthUrl.searchParams.set('redirect_uri', redirectUri);
    oauthUrl.searchParams.set('response_type', 'code');
    oauthUrl.searchParams.set('scope', 'https://www.googleapis.com/auth/youtube.upload');
    oauthUrl.searchParams.set('access_type', 'offline');
    oauthUrl.searchParams.set('prompt', 'consent');
    oauthUrl.searchParams.set('include_granted_scopes', 'true');
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
router.get('/integrations/youtube/config', ...adminGate, async (req, res, next) => {
    try {
        const computedRedirectUri = computeRedirectUri(req);
        const configuredRedirectUri = config.youtube.redirectUri || '';
        const redirectUri = configuredRedirectUri || computedRedirectUri;
        res.json({
            clientIdConfigured: Boolean(config.youtube.clientId),
            clientSecretConfigured: Boolean(config.youtube.clientSecret),
            redirectUri,
            computedRedirectUri,
            configuredRedirectUri: configuredRedirectUri || null,
            callbackPath: CALLBACK_PATH,
            connectUrl: computeConnectUrl(req),
        });
    }
    catch (error) {
        next(error);
    }
});
router.get('/integrations/youtube/health', ...adminGate, async (req, res, next) => {
    try {
        const missing = [];
        if (!config.youtube.clientId)
            missing.push('YOUTUBE_CLIENT_ID');
        if (!config.youtube.clientSecret)
            missing.push('YOUTUBE_CLIENT_SECRET');
        const computedRedirectUri = computeRedirectUri(req);
        const configuredRedirectUri = config.youtube.redirectUri || '';
        const issues = [];
        if (configuredRedirectUri) {
            try {
                const configuredHost = new URL(configuredRedirectUri).host;
                const computedHost = new URL(computedRedirectUri).host;
                if (configuredHost !== computedHost) {
                    issues.push('YOUTUBE_REDIRECT_URI host does not match BASE_URL/RENDER_EXTERNAL_URL host.');
                }
            }
            catch {
                issues.push('YOUTUBE_REDIRECT_URI is not a valid URL.');
            }
        }
        const ok = missing.length === 0 && issues.length === 0;
        res.json({
            ok,
            missing,
            issues,
            computedRedirectUri,
            configuredRedirectUri: configuredRedirectUri || null,
        });
    }
    catch (error) {
        next(error);
    }
});
router.get('/integrations/youtube/status', ...adminGate, async (req, res, next) => {
    try {
        const userId = req.authUser?.uid;
        if (!userId)
            throw createHttpError(401, 'Unauthorized');
        const status = await getYouTubeIntegration(userId);
        res.json({ status });
    }
    catch (error) {
        next(error);
    }
});
router.get('/integrations/youtube/connect', ...adminGate, async (req, res, next) => {
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
router.get('/integrations/youtube/connect-url', ...adminGate, async (req, res, next) => {
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
router.get('/integrations/youtube/callback', async (req, res) => {
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const stateParam = typeof req.query.state === 'string' ? req.query.state : '';
    const state = verifySignedState(stateParam);
    if (!code || !state) {
        res.status(400).send(renderCallbackHtml('YouTube connection failed', 'Invalid OAuth state or missing code.'));
        return;
    }
    let tokenResponse;
    try {
        const { clientId, clientSecret, redirectUri } = ensureYouTubeClientConfig(req);
        const params = new URLSearchParams({
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code',
        });
        tokenResponse = await axios.post('https://oauth2.googleapis.com/token', params.toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });
    }
    catch (error) {
        console.error('[youtube] token exchange failed', error);
        res.status(400).send(renderCallbackHtml('YouTube connection failed', 'Unable to exchange authorization code.'));
        return;
    }
    const refreshToken = tokenResponse?.data?.refresh_token;
    const accessToken = tokenResponse?.data?.access_token;
    const expiresIn = Number(tokenResponse?.data?.expires_in ?? 0);
    if (!refreshToken) {
        res
            .status(400)
            .send(renderCallbackHtml('Refresh token missing', 'Google did not return a refresh token. Please reconnect with prompt=consent or revoke access in Google and try again.'));
        return;
    }
    let channelId = null;
    let channelTitle = null;
    try {
        const { clientId, clientSecret, redirectUri } = ensureYouTubeClientConfig(req);
        const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirectUri || undefined);
        oauth2.setCredentials({ access_token: accessToken });
        const youtube = google.youtube({ version: 'v3', auth: oauth2 });
        const response = await youtube.channels.list({ part: ['snippet'], mine: true });
        const channel = response.data.items?.[0];
        channelId = channel?.id ?? null;
        channelTitle = channel?.snippet?.title ?? null;
    }
    catch (error) {
        console.warn('[youtube] channel lookup failed', error);
    }
    try {
        await upsertYouTubeIntegration(state.userId, {
            refreshToken,
            accessToken,
            accessTokenExpiresAt: expiresIn ? Date.now() + expiresIn * 1000 : null,
            channelId,
            channelTitle,
            privacyStatus: 'unlisted',
            revealToken: true,
        });
    }
    catch (error) {
        console.error('[youtube] failed to store integration', error);
        res.status(500).send(renderCallbackHtml('YouTube connection failed', 'Unable to store refresh token.'));
        return;
    }
    res.status(200).send(renderCallbackHtml('YouTube connected', 'You can close this window and return to Dott Media.'));
});
const pasteSchema = z.object({
    refreshToken: z.string().min(1).optional(),
    token: z.string().min(1).optional(),
    raw: z.string().min(1).optional(),
    json: z.string().min(1).optional(),
    clientId: z.string().optional(),
    clientSecret: z.string().optional(),
    redirectUri: z.string().optional(),
    privacyStatus: z.enum(['private', 'public', 'unlisted']).optional(),
});
router.post('/integrations/youtube/paste-token', ...adminGate, async (req, res, next) => {
    try {
        const payload = pasteSchema.parse(req.body ?? {});
        let refreshToken = payload.refreshToken || payload.token || payload.raw || '';
        let parsedJson = null;
        if (!refreshToken && payload.json) {
            try {
                parsedJson = JSON.parse(payload.json);
            }
            catch {
                throw createHttpError(400, 'Invalid JSON payload');
            }
            refreshToken = parsedJson?.refreshToken ?? parsedJson?.token ?? '';
        }
        if (parsedJson && !payload.privacyStatus && parsedJson.privacyStatus) {
            payload.privacyStatus = parsedJson.privacyStatus;
        }
        if (!refreshToken) {
            throw createHttpError(400, 'Missing refresh token payload');
        }
        const userId = req.authUser?.uid;
        if (!userId)
            throw createHttpError(401, 'Unauthorized');
        await upsertYouTubeIntegration(userId, {
            refreshToken,
            privacyStatus: payload.privacyStatus ?? undefined,
            revealToken: false,
        });
        const warnings = [];
        const clientId = payload.clientId ?? parsedJson?.clientId;
        const clientSecret = payload.clientSecret ?? parsedJson?.clientSecret;
        const redirectUri = payload.redirectUri ?? parsedJson?.redirectUri;
        if (clientId && clientId !== config.youtube.clientId) {
            warnings.push('Provided clientId does not match configured YOUTUBE_CLIENT_ID.');
        }
        if (clientSecret && clientSecret !== config.youtube.clientSecret) {
            warnings.push('Provided clientSecret does not match configured YOUTUBE_CLIENT_SECRET.');
        }
        if (redirectUri && redirectUri !== config.youtube.redirectUri) {
            warnings.push('Provided redirectUri does not match configured YOUTUBE_REDIRECT_URI.');
        }
        res.json({ ok: true, warnings });
    }
    catch (error) {
        next(error);
    }
});
router.post('/integrations/youtube/defaults', ...adminGate, async (req, res, next) => {
    try {
        const payload = z
            .object({
            privacyStatus: z.enum(['private', 'public', 'unlisted']),
        })
            .parse(req.body ?? {});
        const userId = req.authUser?.uid;
        if (!userId)
            throw createHttpError(401, 'Unauthorized');
        await updateYouTubeIntegrationDefaults(userId, payload);
        res.json({ ok: true });
    }
    catch (error) {
        next(error);
    }
});
router.post('/integrations/youtube/reveal', ...adminGate, async (req, res, next) => {
    try {
        const userId = req.authUser?.uid;
        if (!userId)
            throw createHttpError(401, 'Unauthorized');
        const result = await revealYouTubeRefreshToken(userId);
        res.json(result);
    }
    catch (error) {
        next(error);
    }
});
router.post('/integrations/youtube/disconnect', ...adminGate, async (req, res, next) => {
    try {
        const userId = req.authUser?.uid;
        if (!userId)
            throw createHttpError(401, 'Unauthorized');
        await disconnectYouTube(userId);
        res.json({ ok: true });
    }
    catch (error) {
        next(error);
    }
});
router.post('/integrations/youtube/validate-video-url', ...adminGate, async (req, res, next) => {
    try {
        const payload = z.object({ videoUrl: z.string().url() }).parse(req.body ?? {});
        const result = await validateVideoUrl(payload.videoUrl);
        res.json(result);
    }
    catch (error) {
        next(error);
    }
});
const uploadSchema = z.object({
    videoUrl: z.string().url(),
    title: z.string().min(1).optional(),
    description: z.string().optional(),
    tags: z.array(z.string().min(1)).optional(),
    privacyStatus: z.enum(['private', 'public', 'unlisted']).optional(),
    scheduledPublishTime: z.string().optional(),
});
router.post('/youtube/upload', requireFirebase, async (req, res, next) => {
    try {
        const authUser = req.authUser;
        if (!authUser)
            throw createHttpError(401, 'Unauthorized');
        const payload = uploadSchema.parse(req.body ?? {});
        const validation = await validateVideoUrl(payload.videoUrl);
        if (!validation.ok) {
            res.status(400).json(validation);
            return;
        }
        const scheduledPublishTime = payload.scheduledPublishTime?.trim();
        if (scheduledPublishTime) {
            const parsed = new Date(scheduledPublishTime);
            if (Number.isNaN(parsed.getTime())) {
                throw createHttpError(400, 'scheduledPublishTime must be a valid ISO timestamp');
            }
        }
        const result = await enqueueYouTubeUpload(authUser.uid, {
            videoUrl: payload.videoUrl,
            title: payload.title,
            description: payload.description,
            tags: payload.tags,
            privacyStatus: payload.privacyStatus,
            scheduledPublishTime: scheduledPublishTime || undefined,
        });
        res.json({ ok: true, jobId: result.jobId });
    }
    catch (error) {
        next(error);
    }
});
const soraSchema = z.object({
    prompt: z.string().min(10),
    model: z.enum(['sora-2', 'sora-2-pro']).optional(),
    seconds: z.enum(['4', '8', '12']).optional(),
    size: z.enum(['720x1280', '1280x720', '1024x1792', '1792x1024']).optional(),
    title: z.string().min(1).optional(),
    description: z.string().optional(),
    tags: z.array(z.string().min(1)).optional(),
    privacyStatus: z.enum(['private', 'public', 'unlisted']).optional(),
    scheduledPublishTime: z.string().optional(),
    shorts: z.boolean().optional(),
});
router.post('/youtube/sora', ...adminGate, async (req, res, next) => {
    try {
        const authUser = req.authUser;
        if (!authUser)
            throw createHttpError(401, 'Unauthorized');
        const payload = soraSchema.parse(req.body ?? {});
        if (!config.openAI.apiKey) {
            throw createHttpError(400, 'Missing OPENAI_API_KEY');
        }
        const scheduledPublishTime = payload.scheduledPublishTime?.trim();
        if (scheduledPublishTime) {
            const parsed = new Date(scheduledPublishTime);
            if (Number.isNaN(parsed.getTime())) {
                throw createHttpError(400, 'scheduledPublishTime must be a valid ISO timestamp');
            }
        }
        const result = await enqueueYouTubeSoraUpload(authUser.uid, {
            prompt: payload.prompt,
            model: payload.model,
            seconds: payload.seconds ?? '12',
            size: payload.size ?? '720x1280',
            title: payload.title,
            description: payload.description,
            tags: payload.tags,
            privacyStatus: payload.privacyStatus ?? 'public',
            scheduledPublishTime: scheduledPublishTime || undefined,
            shorts: payload.shorts ?? true,
        });
        res.json({ ok: true, jobId: result.jobId });
    }
    catch (error) {
        next(error);
    }
});
router.get('/youtube/status/:jobId', requireFirebase, async (req, res, next) => {
    try {
        const authUser = req.authUser;
        if (!authUser)
            throw createHttpError(401, 'Unauthorized');
        const job = await getYouTubeJobStatus(req.params.jobId);
        if (!job || job.userId !== authUser.uid) {
            throw createHttpError(404, 'Upload job not found');
        }
        res.json({ ok: true, job });
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
