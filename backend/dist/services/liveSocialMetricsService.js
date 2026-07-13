import axios from 'axios';
import { TwitterApi } from 'twitter-api-v2';
import { firestore } from '../db/firestore.js';
import { config } from '../config.js';
import { canUsePrimarySocialDefaults } from '../utils/socialAccess.js';
import { getOutboundStats, getWebTrafficStats } from './analyticsService.js';
import { resolveAnalyticsScopeKey } from './analyticsScope.js';
import { supabaseFallbackService } from './supabaseFallbackService.js';
const GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? 'v23.0';
const THREADS_GRAPH_VERSION = process.env.THREADS_GRAPH_VERSION ?? 'v1.0';
const THREADS_GRAPH_BASE_URL = process.env.THREADS_GRAPH_BASE_URL ?? 'https://graph.threads.net';
const MAX_POSTS_PER_PLATFORM = Math.max(Number(process.env.LIVE_SOCIAL_MAX_POSTS ?? 20), 5);
const LOOKBACK_HOURS_DEFAULT = Math.max(Number(process.env.LIVE_SOCIAL_LOOKBACK_HOURS ?? 72), 1);
const CACHE_TTL_MS = Math.max(Number(process.env.LIVE_SOCIAL_CACHE_MS ?? 120000), 10000);
const POST_METRIC_CACHE_TTL_MS = Math.max(Number(process.env.LIVE_SOCIAL_POST_CACHE_MS ?? 300000), 30000);
const SHECARE_USER_ID = 'tCE1FQ1cOFgdupOXP23mPUMQRAz1';
const SHECARE_FACEBOOK_PAGE_ID = '1114686181730831';
const SHECARE_INSTAGRAM_ACCOUNT_ID = '17841437471047291';
const liveMetricsCache = new Map();
const postMetricCache = new Map();
const postMetricInFlight = new Map();
const facebookPageTokenCache = new Map();
const emptyPlatformMetric = () => ({
    connected: false,
    views: 0,
    interactions: 0,
    engagementRate: 0,
    conversions: 0,
    postsAnalyzed: 0,
});
const toMillis = (value) => {
    if (!value)
        return 0;
    if (typeof value.toDate === 'function')
        return value.toDate().getTime();
    if (typeof value.seconds === 'number')
        return value.seconds * 1000;
    if (typeof value._seconds === 'number')
        return value._seconds * 1000;
    return 0;
};
const parseInsightValue = (container, metricName) => {
    const items = Array.isArray(container?.data) ? container.data : [];
    const match = items.find((entry) => entry?.name === metricName);
    const raw = Array.isArray(match?.values) ? match.values[0]?.value : undefined;
    if (typeof raw === 'number')
        return raw;
    if (raw && typeof raw === 'object') {
        if (typeof raw.value === 'number')
            return raw.value;
        const firstNumeric = Object.values(raw).find(value => typeof value === 'number');
        if (typeof firstNumeric === 'number')
            return firstNumeric;
    }
    return 0;
};
const parseInsightArrayValue = (entries, metricName) => {
    const row = entries.find(entry => entry?.name === metricName);
    const raw = Array.isArray(row?.values) ? row.values[0]?.value : undefined;
    if (typeof raw === 'number')
        return raw;
    if (raw && typeof raw === 'object') {
        const firstNumeric = Object.values(raw).find(value => typeof value === 'number');
        if (typeof firstNumeric === 'number')
            return firstNumeric;
    }
    return 0;
};
const toUniqueIds = (items) => Array.from(new Set(items.filter(Boolean)));
const sum = (values) => values.reduce((acc, value) => acc + value, 0);
const toNumber = (value) => {
    const numeric = Number(value ?? 0);
    return Number.isFinite(numeric) ? numeric : 0;
};
const pickWebTrafficRows = (candidates) => {
    if (candidates.length === 0)
        return [];
    const withScores = candidates.map(candidate => {
        const score = candidate.rows.reduce((acc, row) => acc + toNumber(row.visitors) + toNumber(row.interactions) + toNumber(row.redirectClicks), 0);
        return { rows: candidate.rows, score };
    });
    withScores.sort((a, b) => b.score - a.score);
    return withScores[0]?.rows ?? [];
};
const mergeCounterMap = (target, raw) => {
    if (!raw || typeof raw !== 'object')
        return;
    Object.entries(raw).forEach(([key, value]) => {
        const counter = toNumber(value);
        if (counter <= 0)
            return;
        target[key] = (target[key] ?? 0) + counter;
    });
};
const formatRate = (interactions, views) => views > 0 ? Number(((interactions / views) * 100).toFixed(2)) : 0;
const withPostMetricCache = async (cacheKey, loader) => {
    const now = Date.now();
    const cached = postMetricCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
        return cached.data;
    }
    const inFlight = postMetricInFlight.get(cacheKey);
    if (inFlight) {
        return inFlight;
    }
    const pending = loader()
        .then(data => {
        postMetricCache.set(cacheKey, {
            expiresAt: Date.now() + POST_METRIC_CACHE_TTL_MS,
            data,
        });
        return data;
    })
        .finally(() => {
        postMetricInFlight.delete(cacheKey);
    });
    postMetricInFlight.set(cacheKey, pending);
    return pending;
};
const getTwitterCredential = (accounts) => {
    const account = accounts.twitter;
    if (!account?.accessToken || !account?.accessSecret)
        return null;
    const appKey = account.appKey ??
        account.consumerKey ??
        process.env.TWITTER_API_KEY ??
        process.env.TWITTER_CONSUMER_KEY;
    const appSecret = account.appSecret ??
        account.consumerSecret ??
        process.env.TWITTER_API_SECRET ??
        process.env.TWITTER_CONSUMER_SECRET;
    if (!appKey || !appSecret)
        return null;
    return {
        appKey,
        appSecret,
        accessToken: account.accessToken,
        accessSecret: account.accessSecret,
    };
};
const resolveBwinScopeId = () => (process.env.BWIN_SCOPE_ID ?? process.env.BWIN_TRACK_OWNER_ID ?? '').trim();
const BWIN_USER_ID = (process.env.BWIN_USER_ID ?? '1zvY9nNyXMcfxdPQEyx0bIdK7r53').trim();
const BWIN_KNOWN_SCOPE_IDS = ['bwinbetug', BWIN_USER_ID].filter(Boolean);
const isBwinScopeRequest = (scope, userId) => {
    const bwinScopeId = resolveBwinScopeId();
    const candidates = [
        scope?.scopeId,
        scope?.userId,
        scope?.email,
        userId,
    ]
        .map(value => String(value ?? '').trim())
        .filter(Boolean);
    const bwinCandidates = new Set([...BWIN_KNOWN_SCOPE_IDS, bwinScopeId].filter(Boolean));
    return candidates.some(candidate => bwinCandidates.has(candidate) || candidate.toLowerCase().includes('ball_analytics'));
};
const getBwinEnvTwitterCredential = () => {
    const accessToken = process.env.BWIN_X_ACCESS_TOKEN ??
        process.env.BWIN_TWITTER_ACCESS_TOKEN ??
        '';
    const accessSecret = process.env.BWIN_X_ACCESS_SECRET ??
        process.env.BWIN_TWITTER_ACCESS_SECRET ??
        '';
    const appKey = process.env.BWIN_X_APP_KEY ??
        process.env.BWIN_TWITTER_APP_KEY ??
        process.env.TWITTER_API_KEY ??
        process.env.TWITTER_CONSUMER_KEY ??
        '';
    const appSecret = process.env.BWIN_X_APP_SECRET ??
        process.env.BWIN_TWITTER_APP_SECRET ??
        process.env.TWITTER_API_SECRET ??
        process.env.TWITTER_CONSUMER_SECRET ??
        '';
    if (!accessToken || !accessSecret || !appKey || !appSecret)
        return null;
    return {
        appKey,
        appSecret,
        accessToken,
        accessSecret,
    };
};
const extractTwitterViews = (data) => {
    const nonPublic = data?.non_public_metrics?.impression_count;
    if (typeof nonPublic === 'number')
        return nonPublic;
    const organic = data?.organic_metrics?.impression_count;
    if (typeof organic === 'number')
        return organic;
    const publicViews = data?.public_metrics?.impression_count;
    if (typeof publicViews === 'number')
        return publicViews;
    return 0;
};
const extractTwitterInteractions = (data) => {
    const publicMetrics = data?.public_metrics ?? {};
    const organic = data?.organic_metrics ?? {};
    const likes = typeof publicMetrics.like_count === 'number'
        ? publicMetrics.like_count
        : typeof organic.like_count === 'number'
            ? organic.like_count
            : 0;
    const replies = typeof publicMetrics.reply_count === 'number'
        ? publicMetrics.reply_count
        : typeof organic.reply_count === 'number'
            ? organic.reply_count
            : 0;
    const reposts = typeof publicMetrics.retweet_count === 'number'
        ? publicMetrics.retweet_count
        : typeof organic.retweet_count === 'number'
            ? organic.retweet_count
            : 0;
    const quotes = typeof publicMetrics.quote_count === 'number'
        ? publicMetrics.quote_count
        : typeof organic.quote_count === 'number'
            ? organic.quote_count
            : 0;
    return likes + replies + reposts + quotes;
};
const collectRemoteIds = (posts, platformNames) => toUniqueIds(posts
    .filter(post => platformNames.includes(post.platform))
    .map(post => (post.remoteId ?? '').trim())
    .filter(Boolean)
    .slice(0, MAX_POSTS_PER_PLATFORM));
const mergePostedRows = (...sources) => {
    const merged = new Map();
    sources.flat().forEach(post => {
        const platform = String(post.platform ?? '').trim();
        const remoteId = String(post.remoteId ?? '').trim();
        const postedAtMs = toMillis(post.postedAt);
        if (!platform || !remoteId || !postedAtMs)
            return;
        const key = `${platform}:${remoteId}`;
        const existing = merged.get(key);
        if (!existing || postedAtMs > toMillis(existing.postedAt)) {
            merged.set(key, {
                platform,
                status: 'posted',
                remoteId,
                postedAt: post.postedAt,
            });
        }
    });
    return Array.from(merged.values());
};
export const fetchBwinMetaSocialProfile = async () => {
    const envFacebook = {
        pageId: (process.env.BWIN_FACEBOOK_PAGE_ID ?? '').trim(),
        accessToken: (process.env.BWIN_FACEBOOK_PAGE_TOKEN ?? '').trim(),
    };
    const envInstagram = {
        accountId: (process.env.BWIN_INSTAGRAM_ACCOUNT_ID ?? '').trim(),
        accessToken: (process.env.BWIN_INSTAGRAM_ACCESS_TOKEN ?? '').trim(),
    };
    const envTwitter = getBwinEnvTwitterCredential();
    let facebook = envFacebook;
    let instagram = envInstagram;
    const supabaseUrl = (process.env.SUPABASE_URL ?? '').trim().replace(/\/$/, '');
    const supabaseKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
    const configObject = (process.env.FOOTBALL_ANALYTICS_META_CONFIG_OBJECT ?? process.env.BWIN_META_CONFIG_OBJECT ?? 'bwin-meta-accounts.json').trim();
    if (supabaseUrl && supabaseKey && configObject) {
        try {
            const response = await axios.get(`${supabaseUrl}/storage/v1/object/authenticated/worker-config/${configObject}`, {
                headers: {
                    apikey: supabaseKey,
                    Authorization: `Bearer ${supabaseKey}`,
                },
                timeout: 30000,
            });
            const payload = response.data ?? {};
            facebook = {
                pageId: String(payload.facebook?.pageId ?? payload.facebook?.page_id ?? facebook.pageId ?? '').trim(),
                accessToken: String(payload.facebook?.accessToken ?? payload.facebook?.access_token ?? facebook.accessToken ?? '').trim(),
            };
            instagram = {
                accountId: String(payload.instagram?.accountId ?? payload.instagram?.account_id ?? instagram.accountId ?? '').trim(),
                accessToken: String(payload.instagram?.accessToken ?? payload.instagram?.access_token ?? instagram.accessToken ?? '').trim(),
            };
        }
        catch (error) {
            console.warn('[live-social] Bwin Meta worker config unavailable', error instanceof Error ? error.message : String(error));
        }
    }
    const socialAccounts = {};
    if (facebook.pageId && facebook.accessToken) {
        socialAccounts.facebook = {
            pageId: facebook.pageId,
            accessToken: facebook.accessToken,
        };
    }
    if (instagram.accountId && instagram.accessToken) {
        socialAccounts.instagram = {
            accountId: instagram.accountId,
            accessToken: instagram.accessToken,
        };
    }
    if (envTwitter) {
        socialAccounts.twitter = {
            accessToken: envTwitter.accessToken,
            accessSecret: envTwitter.accessSecret,
            appKey: envTwitter.appKey,
            appSecret: envTwitter.appSecret,
        };
    }
    if (!Object.keys(socialAccounts).length)
        return null;
    return {
        id: BWIN_USER_ID,
        email: 'ball_analytics',
        socialAccounts,
    };
};
const resolveFacebookPageAccessToken = async (facebookAccount) => {
    const pageId = facebookAccount.pageId?.trim();
    const accessToken = facebookAccount.accessToken?.trim();
    if (!pageId || !accessToken)
        return '';
    const cacheKey = `${pageId}:${accessToken.slice(-12)}`;
    const cached = facebookPageTokenCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now())
        return cached.token;
    try {
        const response = await axios.get(`https://graph.facebook.com/${GRAPH_VERSION}/me/accounts`, {
            params: {
                fields: 'id,access_token',
                access_token: accessToken,
            },
            timeout: 30000,
        });
        const page = (Array.isArray(response.data?.data) ? response.data.data : []).find((entry) => String(entry?.id ?? '') === pageId);
        const pageToken = String(page?.access_token ?? '').trim();
        if (pageToken) {
            facebookPageTokenCache.set(cacheKey, {
                expiresAt: Date.now() + POST_METRIC_CACHE_TTL_MS,
                token: pageToken,
            });
            return pageToken;
        }
    }
    catch {
        // If this is already a page token, /me/accounts may fail; try it directly below.
    }
    return accessToken;
};
const asPostedRow = (platform, remoteId, postedAtMs) => ({
    platform,
    status: 'posted',
    remoteId,
    postedAt: { seconds: Math.floor(postedAtMs / 1000) },
});
const normalizeSocialLogPost = (entry) => {
    const platform = String(entry.platform ?? '').trim();
    const status = String(entry.status ?? '').trim().toLowerCase();
    const remoteId = String(entry.responseId ?? '').trim();
    const postedAtMs = toMillis(entry.postedAt);
    if (!platform || status !== 'posted' || !remoteId || !postedAtMs)
        return null;
    return {
        platform,
        status: 'posted',
        remoteId,
        postedAt: entry.postedAt,
    };
};
const hasSocialAccounts = (profile) => Boolean(profile?.socialAccounts && Object.keys(profile.socialAccounts).length > 0);
const isKnownLiveSocialProfile = (profile) => Boolean(profile?.id &&
    KNOWN_LIVE_SOCIAL_PROFILES.some(known => known.userId === profile.id ||
        (!!profile.email && known.email?.toLowerCase() === profile.email.toLowerCase())));
const rootMetaToken = () => (process.env.META_GRAPH_TOKEN ??
    process.env.CLIENT_META_USER_TOKEN ??
    process.env.INSTAGRAM_ACCESS_TOKEN ??
    process.env.FACEBOOK_PAGE_TOKEN ??
    '').trim();
const rootFacebookToken = () => (process.env.META_GRAPH_TOKEN ??
    process.env.CLIENT_META_USER_TOKEN ??
    process.env.FACEBOOK_PAGE_TOKEN ??
    '').trim();
const rootInstagramToken = () => (process.env.META_GRAPH_TOKEN ??
    process.env.CLIENT_META_USER_TOKEN ??
    process.env.INSTAGRAM_ACCESS_TOKEN ??
    '').trim();
const rootThreadsToken = () => (process.env.THREADS_ACCESS_TOKEN ??
    process.env.DOTT_ENERGY_THREADS_ACCESS_TOKEN ??
    process.env.DOTTENERGY_THREADS_ACCESS_TOKEN ??
    process.env.DOTT_HR_THREADS_ACCESS_TOKEN ??
    process.env.DOTTHR_THREADS_ACCESS_TOKEN ??
    '').trim();
const rootLinkedInToken = () => (process.env.LINKEDIN_ACCESS_TOKEN ?? '').trim();
const knownAccountToken = (envKeys, fallback) => {
    for (const key of envKeys) {
        const value = process.env[key]?.trim();
        if (value)
            return value;
    }
    return fallback();
};
const KNOWN_LIVE_SOCIAL_PROFILES = [
    {
        userId: 'cMPZQccGggbhZe9dbvtxFmBehP02',
        email: 'xbrasio@gmail.com',
        facebookPageId: process.env.DOTT_MAIN_FACEBOOK_PAGE_ID ?? process.env.FACEBOOK_PAGE_ID ?? '1150240071508730',
        instagramAccountId: process.env.DOTT_MAIN_INSTAGRAM_BUSINESS_ID ?? process.env.INSTAGRAM_BUSINESS_ID ?? '1861959871343966',
        threadsAccountId: '28808899498698518',
        linkedinAuthorUrn: 'urn:li:person:VQV6WSzWDf',
        facebookTokenEnv: ['DOTT_MAIN_FACEBOOK_PAGE_TOKEN', 'FACEBOOK_PAGE_TOKEN'],
        instagramTokenEnv: ['DOTT_MAIN_INSTAGRAM_ACCESS_TOKEN', 'INSTAGRAM_ACCESS_TOKEN', 'FACEBOOK_PAGE_TOKEN'],
        threadsTokenEnv: ['DOTT_MAIN_THREADS_ACCESS_TOKEN', 'THREADS_ACCESS_TOKEN'],
        linkedinTokenEnv: ['DOTT_MAIN_LINKEDIN_ACCESS_TOKEN', 'LINKEDIN_ACCESS_TOKEN'],
    },
    {
        userId: 'HAo6YtFvhKgSySa8EoERKYYq2IV2',
        email: 'brasioxirin@gmail.com',
        facebookPageId: process.env.DOTT_MAIN_FACEBOOK_PAGE_ID ?? process.env.FACEBOOK_PAGE_ID ?? '1150240071508730',
        instagramAccountId: process.env.DOTT_MAIN_INSTAGRAM_BUSINESS_ID ?? process.env.INSTAGRAM_BUSINESS_ID ?? '1861959871343966',
        threadsAccountId: '28808899498698518',
        linkedinAuthorUrn: 'urn:li:person:VQV6WSzWDf',
        facebookTokenEnv: ['DOTT_MAIN_FACEBOOK_PAGE_TOKEN', 'FACEBOOK_PAGE_TOKEN'],
        instagramTokenEnv: ['DOTT_MAIN_INSTAGRAM_ACCESS_TOKEN', 'INSTAGRAM_ACCESS_TOKEN', 'FACEBOOK_PAGE_TOKEN'],
        threadsTokenEnv: ['DOTT_MAIN_THREADS_ACCESS_TOKEN', 'THREADS_ACCESS_TOKEN'],
        linkedinTokenEnv: ['DOTT_MAIN_LINKEDIN_ACCESS_TOKEN', 'LINKEDIN_ACCESS_TOKEN'],
    },
    {
        userId: SHECARE_USER_ID,
        email: 'shecaredoctor@gmail.com',
        facebookPageId: SHECARE_FACEBOOK_PAGE_ID,
        instagramAccountId: SHECARE_INSTAGRAM_ACCOUNT_ID,
        facebookTokenEnv: ['SHECARE_FACEBOOK_PAGE_TOKEN', 'SHECARE_FACEBOOK_ACCESS_TOKEN'],
        instagramTokenEnv: ['SHECARE_INSTAGRAM_ACCESS_TOKEN'],
    },
    {
        userId: '80bYIeiuukNFtUvXTUobXmfC7pu1',
        email: 'kingbrasio100@gmail.com',
        facebookPageId: '1158550557346330',
        instagramAccountId: '17841426388091930',
        threadsAccountId: '27456972033906662',
        facebookTokenEnv: ['DOTT_HR_FACEBOOK_PAGE_TOKEN', 'DOTT_HR_FACEBOOK_ACCESS_TOKEN', 'DOTTHR_FACEBOOK_PAGE_TOKEN'],
        instagramTokenEnv: ['DOTT_HR_INSTAGRAM_ACCESS_TOKEN', 'DOTTHR_INSTAGRAM_ACCESS_TOKEN'],
        threadsTokenEnv: ['DOTT_HR_THREADS_ACCESS_TOKEN', 'DOTTHR_THREADS_ACCESS_TOKEN', 'DOTT_HR_THREADS_TOKEN'],
    },
    {
        userId: 'LVR7p3WzdFM51ds92Kacf6S40og2',
        facebookPageId: '1165009866702868',
        threadsAccountId: '27610824738535971',
        facebookTokenEnv: ['DOTTENERGY_FACEBOOK_PAGE_TOKEN', 'DOTTENERGY_FACEBOOK_ACCESS_TOKEN'],
        instagramTokenEnv: ['DOTTENERGY_INSTAGRAM_ACCESS_TOKEN'],
        threadsTokenEnv: ['DOTT_ENERGY_THREADS_ACCESS_TOKEN', 'DOTTENERGY_THREADS_ACCESS_TOKEN', 'DOTT_ENERGY_THREADS_TOKEN'],
    },
    {
        userId: 'acmVetCcOiTHeGk5D7eDYieamDF3',
        facebookPageId: '1191892417341226',
        instagramAccountId: '17841414110816982',
        facebookTokenEnv: ['CARMARKETPLACE_FACEBOOK_PAGE_TOKEN', 'CARMARKETPLACE_FACEBOOK_ACCESS_TOKEN'],
        instagramTokenEnv: ['CARMARKETPLACE_INSTAGRAM_ACCESS_TOKEN'],
    },
    {
        userId: 'D1iNgjLKNRaQhH35M0NmGfw1LVD2',
        facebookPageId: '1254924081027995',
        instagramAccountId: '17841448080672466',
        facebookTokenEnv: ['STAYSPHERE_FACEBOOK_PAGE_TOKEN', 'STAYSPHERE_FACEBOOK_ACCESS_TOKEN'],
        instagramTokenEnv: ['STAYSPHERE_INSTAGRAM_ACCESS_TOKEN'],
    },
    {
        userId: 'vzdH1DnfFLVjlY8bBgC26WACmmw2',
        facebookPageId: '1121885391014110',
        instagramAccountId: '17841412643148539',
        facebookTokenEnv: ['GAMERS44LIFE_FACEBOOK_PAGE_TOKEN', 'GAMERS44LIFE_FACEBOOK_ACCESS_TOKEN'],
        instagramTokenEnv: ['GAMERS44LIFE_INSTAGRAM_ACCESS_TOKEN'],
    },
];
export const resolveKnownLiveSocialProfile = (scopeId) => {
    const key = String(scopeId ?? '').trim();
    if (!key)
        return null;
    const known = KNOWN_LIVE_SOCIAL_PROFILES.find(profile => profile.userId === key || profile.email?.toLowerCase() === key.toLowerCase());
    if (!known)
        return null;
    const facebookToken = knownAccountToken(known.facebookTokenEnv ?? [], rootFacebookToken);
    const instagramToken = knownAccountToken(known.instagramTokenEnv ?? [], rootInstagramToken);
    const threadsToken = knownAccountToken(known.threadsTokenEnv ?? [], rootThreadsToken);
    const linkedinToken = knownAccountToken(known.linkedinTokenEnv ?? [], rootLinkedInToken);
    const socialAccounts = {};
    if (known.facebookPageId && facebookToken) {
        socialAccounts.facebook = {
            accessToken: facebookToken,
            pageId: known.facebookPageId,
        };
    }
    if (known.instagramAccountId && instagramToken) {
        socialAccounts.instagram = {
            accessToken: instagramToken,
            accountId: known.instagramAccountId,
        };
    }
    if (known.threadsAccountId && threadsToken) {
        socialAccounts.threads = {
            accessToken: threadsToken,
            accountId: known.threadsAccountId,
        };
    }
    if (known.linkedinAuthorUrn && linkedinToken) {
        socialAccounts.linkedin = {
            accessToken: linkedinToken,
            urn: known.linkedinAuthorUrn,
            name: 'Dott - Media',
        };
    }
    if (!Object.keys(socialAccounts).length)
        return null;
    return {
        id: known.userId,
        email: known.email ?? null,
        socialAccounts,
    };
};
const mergeSocialProfiles = (profiles) => {
    const mergedAccounts = {};
    let email;
    let orgId;
    let id;
    profiles.forEach(profile => {
        if (!profile)
            return;
        if (!id && profile.id)
            id = profile.id;
        if (!email && profile.email)
            email = profile.email;
        if (!orgId && profile.orgId)
            orgId = profile.orgId;
        const accounts = profile.socialAccounts ?? {};
        Object.entries(accounts).forEach(([platform, account]) => {
            const current = mergedAccounts[platform];
            if (!current || !Object.keys(current).length) {
                mergedAccounts[platform] = account;
                return;
            }
            const mergedAccount = {
                ...current,
                ...account,
            };
            ['accessToken', 'userAccessToken', 'pageToken'].forEach(tokenKey => {
                const currentToken = current[tokenKey];
                if (typeof currentToken === 'string' && currentToken.trim()) {
                    mergedAccount[tokenKey] = currentToken;
                }
            });
            mergedAccounts[platform] = mergedAccount;
        });
    });
    if (!id && !email && !orgId && !Object.keys(mergedAccounts).length)
        return undefined;
    return { id, email, orgId, socialAccounts: mergedAccounts };
};
const mergeSocialAccountsPreservingTokens = (base, overlay) => {
    if (!overlay)
        return base;
    Object.entries(overlay).forEach(([platform, account]) => {
        const current = base[platform];
        if (!current || !Object.keys(current).length) {
            base[platform] = account;
            return;
        }
        const mergedAccount = {
            ...current,
            ...account,
        };
        ['accessToken', 'userAccessToken', 'pageToken'].forEach(tokenKey => {
            const currentToken = current[tokenKey];
            if (typeof currentToken === 'string' && currentToken.trim()) {
                mergedAccount[tokenKey] = currentToken;
            }
        });
        base[platform] = mergedAccount;
    });
    return base;
};
const fetchSupabaseSocialProfile = async (userId) => {
    try {
        const fallback = await supabaseFallbackService.getSocialAccounts(userId);
        if (!fallback)
            return null;
        return {
            id: userId,
            email: fallback.email ?? null,
            socialAccounts: fallback.socialAccounts,
        };
    }
    catch (error) {
        console.warn('[socialLive] supabase social account fetch failed', { userId, error });
        return null;
    }
};
const resolveLiveMetricOwners = async (userId, scope) => {
    const rawScopeId = scope?.scopeId?.trim();
    const rawEmail = scope?.email?.trim();
    const candidateIds = Array.from(new Set([rawScopeId, userId].filter(Boolean)));
    const profilesById = new Map();
    const orderedProfiles = [];
    let accountLevelMetaOnly = false;
    const addProfile = (profile) => {
        if (!profile)
            return;
        if (isKnownLiveSocialProfile(profile)) {
            accountLevelMetaOnly = true;
        }
        const profileId = profile.id?.trim();
        if (profileId && profilesById.has(profileId)) {
            const existing = profilesById.get(profileId);
            const merged = mergeSocialProfiles([existing, profile]);
            if (!merged)
                return;
            profilesById.set(profileId, merged);
            const index = orderedProfiles.findIndex(entry => entry.id === profileId);
            if (index >= 0) {
                orderedProfiles[index] = merged;
            }
            else {
                orderedProfiles.push(merged);
            }
        }
        else if (profileId) {
            profilesById.set(profileId, profile);
            orderedProfiles.push(profile);
        }
        else if (!profileId) {
            orderedProfiles.push(profile);
        }
    };
    await Promise.all(candidateIds.map(async (candidateId) => {
        try {
            const snap = await firestore.collection('users').doc(candidateId).get();
            if (snap.exists) {
                const data = snap.data();
                addProfile({
                    id: snap.id,
                    email: data.email ?? null,
                    orgId: data.orgId ?? null,
                    socialAccounts: data.socialAccounts,
                });
            }
        }
        catch (error) {
            console.warn('[socialLive] firestore user fetch failed', { userId: candidateId, error });
        }
    }));
    [...orderedProfiles].forEach(profile => {
        addProfile(resolveKnownLiveSocialProfile(profile.email));
        addProfile(resolveKnownLiveSocialProfile(profile.orgId));
    });
    addProfile(resolveKnownLiveSocialProfile(rawEmail));
    if (rawScopeId) {
        try {
            const snap = await firestore.collection('users').where('orgId', '==', rawScopeId).limit(5).get();
            snap.docs.forEach(doc => {
                const data = doc.data();
                addProfile({
                    id: doc.id,
                    email: data.email ?? null,
                    orgId: data.orgId ?? null,
                    socialAccounts: data.socialAccounts,
                });
            });
        }
        catch (error) {
            console.warn('[socialLive] firestore org owner lookup failed', { scopeId: rawScopeId, error });
        }
    }
    await Promise.all(candidateIds.map(async (candidateId) => {
        addProfile(resolveKnownLiveSocialProfile(candidateId));
        const fallback = await fetchSupabaseSocialProfile(candidateId);
        addProfile(fallback);
        if (!hasSocialAccounts(fallback)) {
            addProfile(resolveKnownLiveSocialProfile(candidateId));
        }
    }));
    const ownerIds = Array.from(new Set([
        ...orderedProfiles.map(profile => profile.id).filter(Boolean),
        ...candidateIds,
    ]));
    return {
        ownerIds: ownerIds.length ? ownerIds : [userId],
        userProfile: mergeSocialProfiles(orderedProfiles),
        accountLevelMetaOnly,
    };
};
const buildWithDefaults = (userData, userId) => {
    const allowDefaults = canUsePrimarySocialDefaults(userData, userId);
    const merged = { ...(userData?.socialAccounts ?? {}) };
    if (allowDefaults) {
        if (!merged.facebook?.accessToken && config.channels.facebook.pageToken) {
            merged.facebook = {
                accessToken: config.channels.facebook.pageToken,
                pageId: config.channels.facebook.pageId,
            };
        }
        if (!merged.instagram?.accessToken && config.channels.instagram.accessToken) {
            merged.instagram = {
                accessToken: config.channels.instagram.accessToken,
                accountId: config.channels.instagram.businessId,
            };
        }
        if (!merged.threads?.accessToken && config.channels.threads.accessToken) {
            merged.threads = {
                accessToken: config.channels.threads.accessToken,
                accountId: config.channels.threads.profileId,
            };
        }
    }
    return merged;
};
const fetchFacebookMetric = async (postId, facebookAccount) => {
    return withPostMetricCache(`facebook:${facebookAccount.pageId ?? 'page'}:${postId}`, async () => {
        const publishToken = await resolveFacebookPageAccessToken(facebookAccount);
        const metricsToken = publishToken || facebookAccount.userAccessToken?.trim() || facebookAccount.accessToken?.trim() || '';
        if (!publishToken) {
            return { views: 0, interactions: 0 };
        }
        try {
            const basicFields = postId.includes('_')
                ? 'id,likes.summary(true),reactions.summary(true),comments.summary(true),shares'
                : 'id,likes.summary(true),reactions.summary(true),comments.summary(true),shares,page_story_id';
            const basic = await axios.get(`https://graph.facebook.com/${GRAPH_VERSION}/${postId}`, {
                params: {
                    fields: basicFields,
                    access_token: publishToken,
                },
                timeout: 30000,
            });
            const likes = Number(basic.data?.likes?.summary?.total_count ?? 0);
            const reactions = Number(basic.data?.reactions?.summary?.total_count ?? 0);
            const comments = Number(basic.data?.comments?.summary?.total_count ?? 0);
            const shares = Number(basic.data?.shares?.count ?? 0);
            let views = 0;
            let interactions = Math.max(likes, reactions) + comments + shares;
            const analyticsPostId = typeof basic.data?.page_story_id === 'string' && basic.data.page_story_id
                ? basic.data.page_story_id
                : postId;
            try {
                const insights = await axios.get(`https://graph.facebook.com/${GRAPH_VERSION}/${analyticsPostId}/insights`, {
                    params: {
                        metric: 'post_clicks,post_reactions_by_type_total,post_activity_by_action_type',
                        access_token: metricsToken,
                    },
                    timeout: 30000,
                });
                const insightBlock = insights.data;
                const postClicks = parseInsightValue(insightBlock, 'post_clicks');
                const reactions = parseInsightValue(insightBlock, 'post_reactions_by_type_total');
                const activities = parseInsightValue(insightBlock, 'post_activity_by_action_type');
                if (postClicks + reactions + activities > interactions) {
                    interactions = postClicks + reactions + activities;
                }
            }
            catch {
                // Optional insights can fail if permission is unavailable; keep base metrics.
            }
            return { views, interactions };
        }
        catch {
            return { views: 0, interactions: 0 };
        }
    });
};
const fetchRecentFacebookPosts = async (facebookAccount, cutoffMs) => {
    const pageId = facebookAccount.pageId?.trim();
    const accessToken = await resolveFacebookPageAccessToken(facebookAccount);
    if (!pageId || !accessToken)
        return [];
    try {
        const response = await axios.get(`https://graph.facebook.com/${GRAPH_VERSION}/${pageId}/posts`, {
            params: {
                fields: 'id,created_time',
                limit: MAX_POSTS_PER_PLATFORM,
                access_token: accessToken,
            },
            timeout: 30000,
        });
        return (Array.isArray(response.data?.data) ? response.data.data : [])
            .map((post) => {
            const remoteId = String(post?.id ?? '').trim();
            const postedAtMs = Date.parse(String(post?.created_time ?? ''));
            if (!remoteId || !Number.isFinite(postedAtMs) || postedAtMs < cutoffMs)
                return null;
            return asPostedRow('facebook', remoteId, postedAtMs);
        })
            .filter((post) => Boolean(post));
    }
    catch (error) {
        console.warn('[socialLive] direct Facebook timeline fetch failed', error);
        return [];
    }
};
const fetchFacebookPageMetric = async (facebookAccount, cutoffMs) => {
    const pageId = facebookAccount.pageId?.trim();
    const accessToken = await resolveFacebookPageAccessToken(facebookAccount);
    if (!pageId || !accessToken)
        return { views: 0, interactions: 0 };
    const until = Math.floor(Date.now() / 1000);
    const since = Math.max(Math.floor(cutoffMs / 1000), until - (30 * 24 * 60 * 60 - 1));
    try {
        const response = await axios.get(`https://graph.facebook.com/${GRAPH_VERSION}/${pageId}/insights`, {
            params: {
                metric: 'page_views_total,page_total_actions',
                period: 'day',
                since,
                until,
                access_token: accessToken,
            },
            timeout: 30000,
        });
        const rows = Array.isArray(response.data?.data) ? response.data.data : [];
        const metricTotal = (metric) => rows
            .find((row) => row?.name === metric)
            ?.values?.reduce((acc, entry) => acc + toNumber(entry?.value), 0) ?? 0;
        return {
            views: metricTotal('page_views_total'),
            interactions: metricTotal('page_total_actions'),
        };
    }
    catch (error) {
        console.warn('[socialLive] direct Facebook page insights fetch failed', error);
        return { views: 0, interactions: 0 };
    }
};
const fetchInstagramAccountMetric = async (instagramAccount, cutoffMs) => {
    const accountId = instagramAccount.accountId?.trim();
    const accessToken = instagramAccount.accessToken?.trim();
    if (!accountId || !accessToken)
        return { views: 0, interactions: 0 };
    const until = Math.floor(Date.now() / 1000);
    const since = Math.max(Math.floor(cutoffMs / 1000), until - (30 * 24 * 60 * 60 - 1));
    try {
        const response = await axios.get(`https://graph.facebook.com/${GRAPH_VERSION}/${accountId}/insights`, {
            params: {
                metric: 'views,reach,total_interactions',
                period: 'day',
                metric_type: 'total_value',
                since,
                until,
                access_token: accessToken,
            },
            timeout: 30000,
        });
        const rows = Array.isArray(response.data?.data) ? response.data.data : [];
        const metricTotal = (metric) => {
            const row = rows.find((entry) => entry?.name === metric);
            const totalValue = toNumber(row?.total_value?.value);
            if (totalValue > 0)
                return totalValue;
            return row?.values?.reduce((acc, entry) => acc + toNumber(entry?.value), 0) ?? 0;
        };
        const result = {
            views: metricTotal('views') || metricTotal('reach'),
            interactions: metricTotal('total_interactions'),
        };
        if (result.views > 0 || result.interactions > 0)
            return result;
    }
    catch (error) {
        console.warn('[socialLive] direct Instagram account insights window fetch failed', error instanceof Error ? error.message : String(error));
    }
    try {
        const response = await axios.get(`https://graph.facebook.com/v24.0/${accountId}/insights`, {
            params: {
                metric: 'views,reach,total_interactions',
                period: 'day',
                metric_type: 'total_value',
                since,
                until,
                access_token: accessToken,
            },
            timeout: 30000,
        });
        const rows = Array.isArray(response.data?.data) ? response.data.data : [];
        const metricTotal = (metric) => toNumber(rows.find((entry) => entry?.name === metric)?.total_value?.value);
        return {
            views: metricTotal('views') || metricTotal('reach'),
            interactions: metricTotal('total_interactions'),
        };
    }
    catch (fallbackError) {
        console.warn('[socialLive] direct Instagram account insights fetch failed', {
            fallback: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
        });
    }
    return { views: 0, interactions: 0 };
};
const fetchInstagramMetric = async (mediaId, accessToken) => {
    return withPostMetricCache(`instagram:${mediaId}`, async () => {
        try {
            const basic = await axios.get(`https://graph.facebook.com/${GRAPH_VERSION}/${mediaId}`, {
                params: {
                    fields: 'id,like_count,comments_count,media_type,media_product_type',
                    access_token: accessToken,
                },
                timeout: 30000,
            });
            const likes = Number(basic.data?.like_count ?? 0);
            const comments = Number(basic.data?.comments_count ?? 0);
            let views = 0;
            let interactions = likes + comments;
            try {
                const insights = await axios.get(`https://graph.facebook.com/${GRAPH_VERSION}/${mediaId}/insights`, {
                    params: {
                        metric: 'views,reach,saved,shares,total_interactions',
                        access_token: accessToken,
                    },
                    timeout: 30000,
                });
                const rows = Array.isArray(insights.data?.data) ? insights.data.data : [];
                views =
                    parseInsightArrayValue(rows, 'views') ||
                        parseInsightArrayValue(rows, 'reach');
                interactions =
                    parseInsightArrayValue(rows, 'total_interactions') ||
                        likes +
                            comments +
                            parseInsightArrayValue(rows, 'saved') +
                            parseInsightArrayValue(rows, 'shares');
            }
            catch {
                // Optional insights can fail if scope is not available.
            }
            return { views, interactions };
        }
        catch {
            return { views: 0, interactions: 0 };
        }
    });
};
const fetchThreadsMetric = async (mediaId, accessToken) => {
    return withPostMetricCache(`threads:${mediaId}`, async () => {
        try {
            const response = await axios.get(`${THREADS_GRAPH_BASE_URL}/${THREADS_GRAPH_VERSION}/${mediaId}/insights`, {
                params: {
                    metric: 'views,likes,replies,reposts,quotes',
                    access_token: accessToken,
                },
                timeout: 30000,
            });
            const rows = Array.isArray(response.data?.data) ? response.data.data : [];
            const views = parseInsightArrayValue(rows, 'views');
            const interactions = parseInsightArrayValue(rows, 'likes') +
                parseInsightArrayValue(rows, 'replies') +
                parseInsightArrayValue(rows, 'reposts') +
                parseInsightArrayValue(rows, 'quotes');
            return { views, interactions };
        }
        catch {
            return { views: 0, interactions: 0 };
        }
    });
};
const fetchThreadsAccountMetric = async (threadsAccount, cutoffMs) => {
    const accountId = threadsAccount.accountId?.trim();
    const accessToken = threadsAccount.accessToken?.trim();
    if (!accountId || !accessToken)
        return { views: 0, interactions: 0, followers: 0 };
    const until = Math.floor(Date.now() / 1000);
    const since = Math.max(Math.floor(cutoffMs / 1000), until - (30 * 24 * 60 * 60 - 1));
    try {
        const response = await axios.get(`${THREADS_GRAPH_BASE_URL}/${THREADS_GRAPH_VERSION}/${accountId}/threads_insights`, {
            params: {
                metric: 'views,likes,replies,reposts,quotes,followers_count',
                period: 'day',
                since,
                until,
                access_token: accessToken,
            },
            timeout: 30000,
        });
        const rows = Array.isArray(response.data?.data) ? response.data.data : [];
        const metricTotal = (metric) => {
            const row = rows.find((entry) => entry?.name === metric);
            const totalValue = toNumber(row?.total_value?.value);
            if (totalValue > 0)
                return totalValue;
            return Array.isArray(row?.values)
                ? row.values.reduce((acc, entry) => acc + toNumber(entry?.value), 0)
                : 0;
        };
        return {
            views: metricTotal('views'),
            interactions: metricTotal('likes') +
                metricTotal('replies') +
                metricTotal('reposts') +
                metricTotal('quotes'),
            followers: metricTotal('followers_count'),
        };
    }
    catch (error) {
        console.warn('[socialLive] direct Threads account insights fetch failed', error instanceof Error ? error.message : String(error));
        return { views: 0, interactions: 0, followers: 0 };
    }
};
const fetchRecentInstagramMedia = async (instagramAccount, cutoffMs) => {
    const accountId = instagramAccount.accountId?.trim();
    const accessToken = instagramAccount.accessToken?.trim();
    if (!accountId || !accessToken)
        return [];
    try {
        const response = await axios.get(`https://graph.facebook.com/${GRAPH_VERSION}/${accountId}/media`, {
            params: {
                fields: 'id,timestamp,media_product_type',
                limit: MAX_POSTS_PER_PLATFORM,
                access_token: accessToken,
            },
            timeout: 30000,
        });
        return (Array.isArray(response.data?.data) ? response.data.data : [])
            .map((media) => {
            const remoteId = String(media?.id ?? '').trim();
            const postedAtMs = Date.parse(String(media?.timestamp ?? ''));
            if (!remoteId || !Number.isFinite(postedAtMs) || postedAtMs < cutoffMs)
                return null;
            const product = String(media?.media_product_type ?? '').toLowerCase();
            const platform = product.includes('story')
                ? 'instagram_story'
                : product.includes('reels')
                    ? 'instagram_reels'
                    : 'instagram';
            return asPostedRow(platform, remoteId, postedAtMs);
        })
            .filter((post) => Boolean(post));
    }
    catch (error) {
        console.warn('[socialLive] direct Instagram media fetch failed', error);
        return [];
    }
};
const fetchRecentThreadsMedia = async (threadsAccount, cutoffMs) => {
    const accountId = threadsAccount.accountId?.trim();
    const accessToken = threadsAccount.accessToken?.trim();
    if (!accountId || !accessToken)
        return [];
    try {
        const response = await axios.get(`${THREADS_GRAPH_BASE_URL}/${THREADS_GRAPH_VERSION}/${accountId}/threads`, {
            params: {
                fields: 'id,timestamp',
                limit: MAX_POSTS_PER_PLATFORM,
                access_token: accessToken,
            },
            timeout: 30000,
        });
        return (Array.isArray(response.data?.data) ? response.data.data : [])
            .map((thread) => {
            const remoteId = String(thread?.id ?? '').trim();
            const postedAtMs = Date.parse(String(thread?.timestamp ?? ''));
            if (!remoteId || !Number.isFinite(postedAtMs) || postedAtMs < cutoffMs)
                return null;
            return asPostedRow('threads', remoteId, postedAtMs);
        })
            .filter((post) => Boolean(post));
    }
    catch (error) {
        console.warn('[socialLive] direct Threads timeline fetch failed', error);
        return [];
    }
};
const fetchXMetric = async (tweetId, credentials) => {
    return withPostMetricCache(`x:${tweetId}`, async () => {
        const client = new TwitterApi(credentials).readWrite;
        try {
            const full = await client.v2.singleTweet(tweetId, {
                'tweet.fields': ['public_metrics', 'non_public_metrics', 'organic_metrics'],
            });
            const data = full?.data;
            return {
                views: extractTwitterViews(data),
                interactions: extractTwitterInteractions(data),
            };
        }
        catch {
            try {
                const fallback = await client.v2.singleTweet(tweetId, {
                    'tweet.fields': ['public_metrics'],
                });
                const data = fallback?.data;
                return {
                    views: extractTwitterViews(data),
                    interactions: extractTwitterInteractions(data),
                };
            }
            catch {
                return { views: 0, interactions: 0 };
            }
        }
    });
};
const fetchOwnXTimelineMetrics = async (credentials) => {
    const client = new TwitterApi(credentials).readWrite;
    try {
        const me = await client.v2.me();
        const meId = String(me?.data?.id ?? '').trim();
        if (!meId)
            return { views: 0, interactions: 0, postsAnalyzed: 0 };
        const timeline = await client.v2.userTimeline(meId, {
            max_results: 10,
            exclude: ['replies', 'retweets'],
            'tweet.fields': ['public_metrics', 'non_public_metrics', 'organic_metrics'],
        });
        const tweets = Array.isArray(timeline?.data?.data)
            ? timeline.data.data
            : Array.isArray(timeline?.tweets)
                ? timeline.tweets
                : [];
        const views = sum(tweets.map(tweet => extractTwitterViews(tweet)));
        const interactions = sum(tweets.map(tweet => extractTwitterInteractions(tweet)));
        return {
            views,
            interactions,
            postsAnalyzed: tweets.length,
        };
    }
    catch {
        return { views: 0, interactions: 0, postsAnalyzed: 0 };
    }
};
export async function getLiveSocialMetrics(userId, options) {
    const lookbackHours = Math.max(options?.lookbackHours ?? LOOKBACK_HOURS_DEFAULT, 1);
    const scopeKey = resolveAnalyticsScopeKey(options?.scope);
    const fallbackScopeKey = resolveAnalyticsScopeKey({ userId });
    const scopeKeys = Array.from(new Set([scopeKey, fallbackScopeKey].filter(Boolean)));
    const cacheKey = `${userId}:${scopeKey}:${lookbackHours}`;
    const now = Date.now();
    const cached = liveMetricsCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
        return cached.data;
    }
    const cutoffMs = Date.now() - lookbackHours * 60 * 60 * 1000;
    const lookbackDays = Math.max(Math.ceil(lookbackHours / 24) + 1, 2);
    const minDate = new Date(cutoffMs).toISOString().slice(0, 10);
    try {
        const ownerContext = await resolveLiveMetricOwners(userId, options?.scope);
        const ownerIds = ownerContext.ownerIds;
        const [recentPosted, outbound, webTrafficCandidates] = await Promise.all([
            (async () => {
                const scheduledRows = [];
                await Promise.all(ownerIds.map(async (ownerId) => {
                    try {
                        const postsSnap = await firestore.collection('scheduledPosts').where('userId', '==', ownerId).limit(500).get();
                        scheduledRows.push(...postsSnap.docs
                            .map(doc => doc.data())
                            .filter(post => post.status === 'posted' && toMillis(post.postedAt) >= cutoffMs));
                    }
                    catch (error) {
                        console.warn('[socialLive] firestore scheduled posts fetch failed', { userId: ownerId, error });
                    }
                }));
                let fallbackRows = [];
                await Promise.all(ownerIds.map(async (ownerId) => {
                    try {
                        const fallbackPosts = await supabaseFallbackService.getPostsByUser(ownerId, 500);
                        fallbackRows.push(...fallbackPosts
                            .map(post => post)
                            .filter(post => post.status === 'posted' && toMillis(post.postedAt) >= cutoffMs));
                    }
                    catch (error) {
                        console.warn('[socialLive] supabase scheduled posts fetch failed', { userId: ownerId, error });
                    }
                }));
                let fallbackLogRows = [];
                await Promise.all(ownerIds.map(async (ownerId) => {
                    try {
                        fallbackLogRows.push(...(await supabaseFallbackService.getSocialLogsByUser(ownerId, 500))
                            .map(entry => normalizeSocialLogPost({
                            platform: entry.platform,
                            status: entry.status,
                            responseId: entry.responseId,
                            postedAt: entry.postedAt,
                        }))
                            .filter((post) => Boolean(post))
                            .filter(post => toMillis(post.postedAt) >= cutoffMs));
                    }
                    catch (error) {
                        console.warn('[socialLive] supabase social log fetch failed', { userId: ownerId, error });
                    }
                }));
                return mergePostedRows(scheduledRows, fallbackRows, fallbackLogRows);
            })(),
            getOutboundStats(options?.scope ?? { userId }),
            Promise.all(scopeKeys.map(async (key) => {
                try {
                    const snap = await firestore
                        .collection('analytics')
                        .doc(key)
                        .collection('webTrafficDaily')
                        .orderBy('date', 'desc')
                        .limit(lookbackDays)
                        .get();
                    const rows = snap.docs
                        .map(doc => doc.data())
                        .filter(row => {
                        const date = typeof row.date === 'string' ? row.date : '';
                        return date && date >= minDate;
                    });
                    if (rows.length) {
                        return { key, rows };
                    }
                }
                catch (error) {
                    console.warn('[socialLive] firestore web traffic daily fetch failed', error);
                }
                try {
                    const fallbackRows = await supabaseFallbackService.getMetricDailyRows('webTraffic', { scopeId: key }, lookbackDays, minDate);
                    const rows = fallbackRows.map(row => ({
                        date: row.date,
                        visitors: toNumber(row.counters?.visitors),
                        interactions: toNumber(row.counters?.interactions),
                        redirectClicks: toNumber(row.counters?.redirectClicks),
                        sourceRedirectClicks: row.counters?.sourceRedirectClicks ?? {},
                    }));
                    return { key, rows };
                }
                catch (error) {
                    console.warn('[socialLive] supabase web traffic fetch failed', { scopeId: key, error });
                    return { key, rows: [] };
                }
            })),
        ]);
        const userData = ownerContext.userProfile;
        const primaryOwnerId = userData?.id ?? ownerIds[0] ?? userId;
        const accounts = buildWithDefaults(userData, primaryOwnerId);
        const knownRuntimeProfile = resolveKnownLiveSocialProfile(options?.scope?.scopeId) ||
            resolveKnownLiveSocialProfile(userId) ||
            resolveKnownLiveSocialProfile(options?.scope?.email) ||
            resolveKnownLiveSocialProfile(userData?.email);
        if (knownRuntimeProfile?.socialAccounts) {
            mergeSocialAccountsPreservingTokens(accounts, knownRuntimeProfile.socialAccounts);
        }
        if ([userId, options?.scope?.scopeId, primaryOwnerId].includes(SHECARE_USER_ID)) {
            const shecareMetaToken = process.env.SHECARE_INSTAGRAM_ACCESS_TOKEN?.trim() ||
                process.env.META_GRAPH_TOKEN?.trim() ||
                process.env.CLIENT_META_USER_TOKEN?.trim() ||
                '';
            if (shecareMetaToken) {
                accounts.facebook = {
                    accessToken: shecareMetaToken,
                    pageId: SHECARE_FACEBOOK_PAGE_ID,
                };
                accounts.instagram = {
                    accessToken: shecareMetaToken,
                    accountId: SHECARE_INSTAGRAM_ACCOUNT_ID,
                };
            }
        }
        if (isBwinScopeRequest(options?.scope, userId)) {
            const bwinProfile = await fetchBwinMetaSocialProfile();
            if (bwinProfile?.socialAccounts?.facebook) {
                accounts.facebook = bwinProfile.socialAccounts.facebook;
            }
            if (bwinProfile?.socialAccounts?.instagram) {
                accounts.instagram = bwinProfile.socialAccounts.instagram;
            }
        }
        let metricPostedRows = ownerContext.accountLevelMetaOnly ? [] : recentPosted;
        const directFacebookRows = !ownerContext.accountLevelMetaOnly && accounts.facebook?.accessToken && accounts.facebook?.pageId
            ? await fetchRecentFacebookPosts(accounts.facebook, cutoffMs)
            : [];
        const directInstagramRows = !ownerContext.accountLevelMetaOnly && accounts.instagram?.accessToken && accounts.instagram?.accountId
            ? await fetchRecentInstagramMedia(accounts.instagram, cutoffMs)
            : [];
        if (!ownerContext.accountLevelMetaOnly && accounts.facebook?.accessToken && accounts.facebook?.pageId) {
            metricPostedRows = metricPostedRows.filter(post => !['facebook', 'facebook_story'].includes(post.platform));
            metricPostedRows = mergePostedRows(metricPostedRows, directFacebookRows);
        }
        if (!ownerContext.accountLevelMetaOnly && accounts.instagram?.accessToken && accounts.instagram?.accountId) {
            metricPostedRows = metricPostedRows.filter(post => !['instagram', 'instagram_reels', 'instagram_story'].includes(post.platform));
            metricPostedRows = mergePostedRows(metricPostedRows, directInstagramRows);
        }
        if (accounts.threads?.accessToken && accounts.threads?.accountId) {
            const hasThreadsRows = metricPostedRows.some(post => post.platform === 'threads');
            if (!hasThreadsRows) {
                const directRows = await fetchRecentThreadsMedia(accounts.threads, cutoffMs);
                metricPostedRows = mergePostedRows(metricPostedRows, directRows);
            }
        }
        const facebookIds = collectRemoteIds(metricPostedRows, ['facebook', 'facebook_story']);
        const instagramIds = collectRemoteIds(metricPostedRows, ['instagram', 'instagram_reels', 'instagram_story']);
        const threadsIds = collectRemoteIds(metricPostedRows, ['threads']);
        const xIds = collectRemoteIds(metricPostedRows, ['x', 'twitter']);
        const sourceRedirectClicks = {};
        const recentWebTrafficRows = pickWebTrafficRows(webTrafficCandidates);
        const webVisitors = sum(recentWebTrafficRows.map(row => toNumber(row.visitors)));
        const webInteractions = sum(recentWebTrafficRows.map(row => toNumber(row.interactions)));
        const webRedirectClicks = sum(recentWebTrafficRows.map(row => toNumber(row.redirectClicks)));
        recentWebTrafficRows.forEach(row => mergeCounterMap(sourceRedirectClicks, row.sourceRedirectClicks));
        const output = {
            generatedAt: new Date().toISOString(),
            lookbackHours,
            summary: {
                views: 0,
                interactions: 0,
                engagementRate: 0,
                conversions: Number(outbound?.conversions ?? 0),
            },
            web: {
                visitors: webVisitors,
                interactions: webInteractions,
                redirectClicks: webRedirectClicks,
                engagementRate: formatRate(webInteractions, webVisitors),
            },
            platforms: {
                facebook: {
                    ...emptyPlatformMetric(),
                    connected: Boolean(accounts.facebook?.accessToken && accounts.facebook?.pageId),
                    postsAnalyzed: facebookIds.length,
                },
                instagram: {
                    ...emptyPlatformMetric(),
                    connected: Boolean(accounts.instagram?.accessToken && accounts.instagram?.accountId),
                    postsAnalyzed: instagramIds.length,
                },
                threads: {
                    ...emptyPlatformMetric(),
                    connected: Boolean(accounts.threads?.accessToken && accounts.threads?.accountId),
                    postsAnalyzed: threadsIds.length,
                },
                x: {
                    ...emptyPlatformMetric(),
                    connected: Boolean(getTwitterCredential(accounts)),
                    postsAnalyzed: xIds.length,
                },
                web: {
                    ...emptyPlatformMetric(),
                    connected: webVisitors > 0 || webInteractions > 0 || webRedirectClicks > 0,
                    views: webVisitors,
                    interactions: webInteractions,
                    engagementRate: formatRate(webInteractions, webVisitors),
                    conversions: webRedirectClicks,
                    postsAnalyzed: webVisitors,
                },
            },
        };
        if (accounts.facebook?.accessToken && accounts.facebook?.pageId) {
            const [rows, pageMetric] = await Promise.all([
                facebookIds.length > 0
                    ? Promise.all(facebookIds.map(id => fetchFacebookMetric(id, accounts.facebook)))
                    : Promise.resolve([]),
                fetchFacebookPageMetric(accounts.facebook, cutoffMs),
            ]);
            output.platforms.facebook.views = Math.max(sum(rows.map(row => row.views)), pageMetric.views);
            output.platforms.facebook.interactions = Math.max(sum(rows.map(row => row.interactions)), pageMetric.interactions);
            output.platforms.facebook.engagementRate = formatRate(output.platforms.facebook.interactions, output.platforms.facebook.views);
        }
        if (accounts.instagram?.accessToken && accounts.instagram?.accountId) {
            const [rows, accountMetric] = await Promise.all([
                instagramIds.length > 0
                    ? Promise.all(instagramIds.map(id => fetchInstagramMetric(id, accounts.instagram?.accessToken ?? '')))
                    : Promise.resolve([]),
                fetchInstagramAccountMetric(accounts.instagram, cutoffMs),
            ]);
            output.platforms.instagram.views = Math.max(sum(rows.map(row => row.views)), accountMetric.views);
            output.platforms.instagram.interactions = Math.max(sum(rows.map(row => row.interactions)), accountMetric.interactions);
            output.platforms.instagram.engagementRate = formatRate(output.platforms.instagram.interactions, output.platforms.instagram.views);
        }
        if (accounts.threads?.accessToken && accounts.threads?.accountId) {
            const accountMetric = await fetchThreadsAccountMetric(accounts.threads, cutoffMs);
            const rows = await Promise.all(accountMetric.views > 0 || accountMetric.interactions > 0 || threadsIds.length === 0
                ? []
                : threadsIds.map(id => fetchThreadsMetric(id, accounts.threads?.accessToken ?? '')));
            output.platforms.threads.views = accountMetric.views || sum(rows.map(row => row.views));
            output.platforms.threads.interactions = accountMetric.interactions || sum(rows.map(row => row.interactions));
            output.platforms.threads.followers = accountMetric.followers;
            output.platforms.threads.engagementRate = formatRate(output.platforms.threads.interactions, output.platforms.threads.views);
        }
        const twitterCredential = getTwitterCredential(accounts);
        if (twitterCredential && xIds.length > 0) {
            const rows = await Promise.all(xIds.map(id => fetchXMetric(id, twitterCredential)));
            output.platforms.x.views = sum(rows.map(row => row.views));
            output.platforms.x.interactions = sum(rows.map(row => row.interactions));
            output.platforms.x.engagementRate = formatRate(output.platforms.x.interactions, output.platforms.x.views);
        }
        output.platforms.facebook.conversions = toNumber(sourceRedirectClicks.facebook);
        output.platforms.instagram.conversions = toNumber(sourceRedirectClicks.instagram);
        output.platforms.threads.conversions = toNumber(sourceRedirectClicks.threads);
        output.platforms.x.conversions =
            toNumber(sourceRedirectClicks.x) + toNumber(sourceRedirectClicks.twitter);
        const totalViews = sum(Object.values(output.platforms).map(platform => platform.views));
        const totalInteractions = sum(Object.values(output.platforms).map(platform => platform.interactions));
        output.summary.views = totalViews;
        output.summary.interactions = totalInteractions;
        output.summary.engagementRate = formatRate(totalInteractions, totalViews);
        if (webRedirectClicks > 0) {
            output.summary.conversions = webRedirectClicks;
        }
        liveMetricsCache.set(cacheKey, { expiresAt: now + CACHE_TTL_MS, data: output });
        return output;
    }
    catch (error) {
        console.warn('[socialLive] quota-safe fallback mode enabled', error);
        if (cached?.data) {
            return cached.data;
        }
        const outbound = await getOutboundStats(options?.scope ?? { userId });
        const webStats = await getWebTrafficStats(options?.scope ?? { userId });
        let xFallbackMetric = { ...emptyPlatformMetric() };
        if (isBwinScopeRequest(options?.scope, userId)) {
            const envTwitterCredentials = getBwinEnvTwitterCredential();
            if (envTwitterCredentials) {
                const timelineStats = await fetchOwnXTimelineMetrics(envTwitterCredentials);
                xFallbackMetric = {
                    ...emptyPlatformMetric(),
                    connected: true,
                    views: timelineStats.views,
                    interactions: timelineStats.interactions,
                    engagementRate: formatRate(timelineStats.interactions, timelineStats.views),
                    conversions: 0,
                    postsAnalyzed: timelineStats.postsAnalyzed,
                };
            }
        }
        const summaryViews = Number(webStats.visitors ?? 0) + Number(xFallbackMetric.views ?? 0);
        const summaryInteractions = Number(webStats.interactions ?? 0) + Number(xFallbackMetric.interactions ?? 0);
        const fallback = {
            generatedAt: new Date().toISOString(),
            lookbackHours,
            summary: {
                views: summaryViews,
                interactions: summaryInteractions,
                engagementRate: formatRate(summaryInteractions, summaryViews),
                conversions: Number(webStats.redirectClicks ?? 0) || Number(outbound.conversions ?? 0),
            },
            web: {
                visitors: Number(webStats.visitors ?? 0),
                interactions: Number(webStats.interactions ?? 0),
                redirectClicks: Number(webStats.redirectClicks ?? 0),
                engagementRate: Number(webStats.engagementRate ?? 0),
            },
            platforms: {
                facebook: { ...emptyPlatformMetric() },
                instagram: { ...emptyPlatformMetric() },
                threads: { ...emptyPlatformMetric() },
                x: xFallbackMetric,
                web: {
                    ...emptyPlatformMetric(),
                    connected: Number(webStats.visitors ?? 0) > 0 ||
                        Number(webStats.interactions ?? 0) > 0 ||
                        Number(webStats.redirectClicks ?? 0) > 0,
                    views: Number(webStats.visitors ?? 0),
                    interactions: Number(webStats.interactions ?? 0),
                    engagementRate: Number(webStats.engagementRate ?? 0),
                    conversions: Number(webStats.redirectClicks ?? 0),
                    postsAnalyzed: Number(webStats.visitors ?? 0),
                },
            },
        };
        liveMetricsCache.set(cacheKey, { expiresAt: now + CACHE_TTL_MS, data: fallback });
        return fallback;
    }
}
