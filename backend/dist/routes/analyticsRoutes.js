import { Router } from 'express';
import { requireFirebase } from '../middleware/firebaseAuth';
import { firestore } from '../db/firestore';
import { AnalyticsService, getActivityHeatmap, incrementWebTrafficAnalytics, getOutboundStats, getInboundStats, getEngagementStats, getFollowupStats, getWebLeadStats, } from '../services/analyticsService';
import { getLiveSocialMetrics } from '../services/liveSocialMetricsService';
const router = Router();
const analytics = new AnalyticsService();
const bwinBetTargetUrl = 'https://bwinbetug.com';
const webTrackAllowedHosts = (process.env.WEB_TRACK_ALLOWED_HOSTS ??
    'bwinbetug.info,www.bwinbetug.info,bwinbetug.com,www.bwinbetug.com')
    .split(',')
    .map(host => host.trim().toLowerCase())
    .filter(Boolean);
const webTrackSharedSecret = process.env.WEB_TRACK_SHARED_SECRET?.trim() || '';
const extractHostname = (value) => {
    if (!value)
        return '';
    try {
        return new URL(value).hostname.toLowerCase();
    }
    catch {
        return '';
    }
};
const isAllowedWebTrackHost = (value) => {
    const hostname = extractHostname(value);
    if (!hostname)
        return false;
    return webTrackAllowedHosts.some(allowed => hostname === allowed || hostname.endsWith(`.${allowed}`));
};
const normalizeTrafficSource = (value) => {
    const raw = (value ?? '').trim().toLowerCase();
    if (!raw)
        return 'web';
    if (raw.includes('instagram') || raw === 'ig')
        return 'instagram';
    if (raw.includes('facebook') || raw === 'fb')
        return 'facebook';
    if (raw.includes('threads'))
        return 'threads';
    if (raw.includes('twitter') || raw === 'x' || raw.includes('x.com') || raw.includes('t.co'))
        return 'x';
    if (raw.includes('linkedin'))
        return 'linkedin';
    if (raw.includes('tiktok') || raw.includes('tik tok'))
        return 'tiktok';
    if (raw.includes('youtube') || raw.includes('youtu.be'))
        return 'youtube';
    if (raw.includes('whatsapp') || raw.includes('wa.me'))
        return 'whatsapp';
    if (raw.includes('web') || raw.includes('direct'))
        return 'web';
    return 'other';
};
const normalizeTrafficPlacement = (value) => {
    const raw = (value ?? '').trim().toLowerCase();
    if (!raw)
        return 'other';
    if (raw.includes('bio') || raw.includes('profile'))
        return 'bio';
    if (raw.includes('story'))
        return 'story';
    if (raw.includes('reel'))
        return 'reel';
    if (raw.includes('dm') || raw.includes('message'))
        return 'dm';
    if (raw.includes('comment'))
        return 'comment';
    if (raw.includes('web') || raw.includes('site') || raw.includes('page'))
        return 'website';
    if (raw.includes('post') || raw.includes('caption'))
        return 'post';
    return 'other';
};
const inferTrafficSource = (input) => {
    const direct = normalizeTrafficSource(input.source || input.utmSource);
    if (direct !== 'web' || input.source || input.utmSource)
        return direct;
    const referrer = (input.referrer ?? '').toLowerCase();
    if (referrer.includes('instagram'))
        return 'instagram';
    if (referrer.includes('facebook'))
        return 'facebook';
    if (referrer.includes('threads'))
        return 'threads';
    if (referrer.includes('t.co') || referrer.includes('x.com') || referrer.includes('twitter'))
        return 'x';
    if (referrer.includes('linkedin'))
        return 'linkedin';
    if (referrer.includes('tiktok'))
        return 'tiktok';
    if (referrer.includes('youtube') || referrer.includes('youtu.be'))
        return 'youtube';
    if (referrer.includes('whatsapp') || referrer.includes('wa.me'))
        return 'whatsapp';
    return 'web';
};
router.get('/analytics', requireFirebase, async (req, res, next) => {
    try {
        const authUser = req.authUser;
        if (!authUser) {
            return res.status(401).json({ message: 'Unauthorized' });
        }
        const data = await analytics.getSummary(authUser.uid);
        res.json({ analytics: data });
    }
    catch (err) {
        next(err);
    }
});
router.get('/stats/outbound', requireFirebase, async (req, res, next) => {
    try {
        const authUser = req.authUser;
        const scopeId = typeof req.query.scopeId === 'string' ? req.query.scopeId : undefined;
        const stats = await getOutboundStats({ userId: authUser?.uid, scopeId });
        res.json({ stats });
    }
    catch (err) {
        next(err);
    }
});
router.post('/stats/webTrack', async (req, res, next) => {
    try {
        const token = (req.get('x-web-track-key') ?? '').trim();
        if (webTrackSharedSecret) {
            if (!token || token !== webTrackSharedSecret) {
                return res.status(401).json({ message: 'Invalid tracking key' });
            }
        }
        else {
            const origin = req.get('origin') ?? '';
            const referer = req.get('referer') ?? '';
            const bodyReferrer = typeof req.body?.referrer === 'string' ? req.body.referrer : '';
            if (!isAllowedWebTrackHost(origin) &&
                !isAllowedWebTrackHost(referer) &&
                !isAllowedWebTrackHost(bodyReferrer)) {
                return res.status(403).json({ message: 'Untrusted origin' });
            }
        }
        const event = typeof req.body?.event === 'string' ? req.body.event.trim().toLowerCase() : '';
        if (!['visit', 'interaction', 'redirect_click'].includes(event)) {
            return res.status(400).json({ message: 'Invalid event' });
        }
        let scopeId = typeof req.body?.scopeId === 'string' ? req.body.scopeId.trim() : '';
        let ownerId = typeof req.body?.ownerId === 'string' ? req.body.ownerId.trim() : '';
        const ownerEmailRaw = typeof req.body?.ownerEmail === 'string' ? req.body.ownerEmail.trim().toLowerCase() : '';
        if (!scopeId && !ownerId && ownerEmailRaw) {
            const userSnap = await firestore.collection('users').where('email', '==', ownerEmailRaw).limit(1).get();
            if (!userSnap.empty) {
                const userDoc = userSnap.docs[0];
                const userData = userDoc.data();
                ownerId = userDoc.id;
                scopeId = (userData.orgId ?? '').trim();
            }
        }
        if (!scopeId && !ownerId) {
            return res.status(400).json({ message: 'scopeId, ownerId, or ownerEmail is required' });
        }
        const targetUrl = typeof req.body?.targetUrl === 'string' ? req.body.targetUrl : '';
        const source = inferTrafficSource({
            source: typeof req.body?.source === 'string' ? req.body.source : undefined,
            utmSource: typeof req.body?.utmSource === 'string' ? req.body.utmSource : undefined,
            referrer: typeof req.body?.referrer === 'string' ? req.body.referrer : req.get('referer') ?? undefined,
        });
        const placement = normalizeTrafficPlacement(typeof req.body?.placement === 'string' ? req.body.placement : undefined);
        const isBwinRedirect = event !== 'redirect_click' || /(^|\/|\.)bwinbetug\.com(\/|$)/i.test(targetUrl);
        const visitors = event === 'visit' ? 1 : 0;
        const interactions = event === 'interaction' ? 1 : 0;
        const redirectClicks = event === 'redirect_click' && isBwinRedirect ? 1 : 0;
        if (visitors || interactions || redirectClicks) {
            await incrementWebTrafficAnalytics({
                visitors,
                interactions,
                redirectClicks,
                source,
                placement,
            }, { scopeId: scopeId || undefined, userId: ownerId || undefined });
        }
        res.json({ ok: true, source, tracked: Boolean(visitors || interactions || redirectClicks) });
    }
    catch (error) {
        next(error);
    }
});
router.get('/stats/bwinRedirect', async (req, res) => {
    const ownerId = typeof req.query.ownerId === 'string' ? req.query.ownerId.trim() : '';
    const scopeId = typeof req.query.scopeId === 'string' ? req.query.scopeId.trim() : '';
    const source = normalizeTrafficSource(typeof req.query.source === 'string' ? req.query.source : 'social');
    const placement = normalizeTrafficPlacement(typeof req.query.placement === 'string' ? req.query.placement : 'post');
    try {
        if (ownerId || scopeId) {
            await incrementWebTrafficAnalytics({
                redirectClicks: 1,
                source,
                placement,
            }, { scopeId: scopeId || undefined, userId: ownerId || undefined });
        }
    }
    catch (error) {
        console.warn('[analytics] failed to record bwin redirect click', error);
    }
    res.set('Cache-Control', 'no-store, max-age=0');
    res.redirect(302, bwinBetTargetUrl);
});
router.get('/stats/inbound', requireFirebase, async (req, res, next) => {
    try {
        const authUser = req.authUser;
        const scopeId = typeof req.query.scopeId === 'string' ? req.query.scopeId : undefined;
        const stats = await getInboundStats({ userId: authUser?.uid, scopeId });
        res.json({ stats });
    }
    catch (error) {
        next(error);
    }
});
router.get('/stats/engagement', requireFirebase, async (req, res, next) => {
    try {
        const authUser = req.authUser;
        const scopeId = typeof req.query.scopeId === 'string' ? req.query.scopeId : undefined;
        const stats = await getEngagementStats({ userId: authUser?.uid, scopeId });
        res.json({ stats });
    }
    catch (error) {
        next(error);
    }
});
router.get('/stats/followups', requireFirebase, async (req, res, next) => {
    try {
        const authUser = req.authUser;
        const scopeId = typeof req.query.scopeId === 'string' ? req.query.scopeId : undefined;
        const stats = await getFollowupStats({ userId: authUser?.uid, scopeId });
        res.json({ stats });
    }
    catch (error) {
        next(error);
    }
});
router.get('/stats/webLeads', requireFirebase, async (req, res, next) => {
    try {
        const authUser = req.authUser;
        const scopeId = typeof req.query.scopeId === 'string' ? req.query.scopeId : undefined;
        const stats = await getWebLeadStats({ userId: authUser?.uid, scopeId });
        res.json({ stats });
    }
    catch (error) {
        next(error);
    }
});
router.get('/stats/socialLive', requireFirebase, async (req, res, next) => {
    try {
        const authUser = req.authUser;
        if (!authUser)
            return res.status(401).json({ message: 'Unauthorized' });
        const scopeId = typeof req.query.scopeId === 'string' ? req.query.scopeId : undefined;
        const lookbackRaw = typeof req.query.lookbackHours === 'string' ? Number(req.query.lookbackHours) : undefined;
        const lookbackHours = Number.isFinite(lookbackRaw) && lookbackRaw > 0 ? Number(lookbackRaw) : undefined;
        const stats = await getLiveSocialMetrics(authUser.uid, {
            lookbackHours,
            scope: { userId: authUser.uid, scopeId },
        });
        res.set({
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
            Pragma: 'no-cache',
            Expires: '0',
        });
        res.json({ stats });
    }
    catch (error) {
        next(error);
    }
});
router.get('/stats/activityHeatmap', requireFirebase, async (req, res, next) => {
    try {
        const authUser = req.authUser;
        if (!authUser)
            return res.status(401).json({ message: 'Unauthorized' });
        const scopeId = typeof req.query.scopeId === 'string' ? req.query.scopeId : undefined;
        const daysRaw = typeof req.query.days === 'string' ? Number(req.query.days) : undefined;
        const days = Number.isFinite(daysRaw) && daysRaw > 0 ? Number(daysRaw) : 14;
        const stats = await getActivityHeatmap({ userId: authUser.uid, scopeId }, days);
        res.set({
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
            Pragma: 'no-cache',
            Expires: '0',
        });
        res.json({ stats });
    }
    catch (error) {
        next(error);
    }
});
export default router;
