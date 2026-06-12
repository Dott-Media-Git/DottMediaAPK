import axios from 'axios';
import { TwitterApi } from 'twitter-api-v2';
import { firestore } from '../db/firestore';
import { config } from '../config';
import { canUsePrimarySocialDefaults } from '../utils/socialAccess';
import { getOutboundStats, getWebTrafficStats } from './analyticsService';
import type { AnalyticsScope } from './analyticsScope';
import { resolveAnalyticsScopeKey } from './analyticsScope';
import { supabaseFallbackService } from './supabaseFallbackService';

const GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? 'v23.0';
const THREADS_GRAPH_VERSION = process.env.THREADS_GRAPH_VERSION ?? 'v1.0';
const THREADS_GRAPH_BASE_URL = process.env.THREADS_GRAPH_BASE_URL ?? 'https://graph.threads.net';
const MAX_POSTS_PER_PLATFORM = Math.max(Number(process.env.LIVE_SOCIAL_MAX_POSTS ?? 20), 5);
const LOOKBACK_HOURS_DEFAULT = Math.max(Number(process.env.LIVE_SOCIAL_LOOKBACK_HOURS ?? 72), 1);
const CACHE_TTL_MS = Math.max(Number(process.env.LIVE_SOCIAL_CACHE_MS ?? 120000), 10000);
const POST_METRIC_CACHE_TTL_MS = Math.max(Number(process.env.LIVE_SOCIAL_POST_CACHE_MS ?? 300000), 30000);
const liveMetricsCache = new Map<string, { expiresAt: number; data: LiveSocialMetrics }>();
const postMetricCache = new Map<string, { expiresAt: number; data: { views: number; interactions: number } }>();
const postMetricInFlight = new Map<string, Promise<{ views: number; interactions: number }>>();
const facebookPageTokenCache = new Map<string, { expiresAt: number; token: string }>();

type RawTimestamp =
  | { seconds?: number; _seconds?: number; nanoseconds?: number; _nanoseconds?: number; toDate?: () => Date }
  | null
  | undefined;

type ScheduledPost = {
  platform: string;
  status: string;
  remoteId?: string;
  postedAt?: RawTimestamp;
};

type LoggedSocialPost = {
  platform: string;
  status: string;
  remoteId?: string;
  postedAt?: RawTimestamp;
};

type UserSocialAccounts = {
  facebook?: { accessToken?: string; userAccessToken?: string; pageId?: string; pageName?: string };
  instagram?: { accessToken?: string; accountId?: string; username?: string };
  threads?: { accessToken?: string; accountId?: string };
  twitter?: {
    accessToken?: string;
    accessSecret?: string;
    appKey?: string;
    appSecret?: string;
    consumerKey?: string;
    consumerSecret?: string;
  };
  [key: string]: any;
};

type UserSocialProfile = {
  id?: string;
  email?: string | null;
  orgId?: string | null;
  socialAccounts?: UserSocialAccounts;
};

export type PlatformLiveMetric = {
  connected: boolean;
  views: number;
  interactions: number;
  engagementRate: number;
  conversions: number;
  postsAnalyzed: number;
};

export type LiveSocialMetrics = {
  generatedAt: string;
  lookbackHours: number;
  summary: {
    views: number;
    interactions: number;
    engagementRate: number;
    conversions: number;
  };
  web: {
    visitors: number;
    interactions: number;
    redirectClicks: number;
    engagementRate: number;
  };
  platforms: {
    facebook: PlatformLiveMetric;
    instagram: PlatformLiveMetric;
    threads: PlatformLiveMetric;
    x: PlatformLiveMetric;
    web: PlatformLiveMetric;
  };
};

const emptyPlatformMetric = (): PlatformLiveMetric => ({
  connected: false,
  views: 0,
  interactions: 0,
  engagementRate: 0,
  conversions: 0,
  postsAnalyzed: 0,
});

const toMillis = (value: RawTimestamp) => {
  if (!value) return 0;
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (typeof value.seconds === 'number') return value.seconds * 1000;
  if (typeof value._seconds === 'number') return value._seconds * 1000;
  return 0;
};

const parseInsightValue = (container: any, metricName: string) => {
  const items = Array.isArray(container?.data) ? container.data : [];
  const match = items.find((entry: any) => entry?.name === metricName);
  const raw = Array.isArray(match?.values) ? match.values[0]?.value : undefined;
  if (typeof raw === 'number') return raw;
  if (raw && typeof raw === 'object') {
    if (typeof raw.value === 'number') return raw.value;
    const firstNumeric = Object.values(raw).find(value => typeof value === 'number');
    if (typeof firstNumeric === 'number') return firstNumeric;
  }
  return 0;
};

const parseInsightArrayValue = (entries: any[], metricName: string) => {
  const row = entries.find(entry => entry?.name === metricName);
  const raw = Array.isArray(row?.values) ? row.values[0]?.value : undefined;
  if (typeof raw === 'number') return raw;
  if (raw && typeof raw === 'object') {
    const firstNumeric = Object.values(raw).find(value => typeof value === 'number');
    if (typeof firstNumeric === 'number') return firstNumeric;
  }
  return 0;
};

const toUniqueIds = (items: string[]) => Array.from(new Set(items.filter(Boolean)));

const sum = (values: number[]) => values.reduce((acc, value) => acc + value, 0);

const toNumber = (value: unknown) => {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
};

const pickWebTrafficRows = (candidates: Array<{ rows: any[] }>) => {
  if (candidates.length === 0) return [];
  const withScores = candidates.map(candidate => {
    const score = candidate.rows.reduce(
      (acc, row) =>
        acc + toNumber(row.visitors) + toNumber(row.interactions) + toNumber(row.redirectClicks),
      0,
    );
    return { rows: candidate.rows, score };
  });
  withScores.sort((a, b) => b.score - a.score);
  return withScores[0]?.rows ?? [];
};

const mergeCounterMap = (target: Record<string, number>, raw: unknown) => {
  if (!raw || typeof raw !== 'object') return;
  Object.entries(raw as Record<string, unknown>).forEach(([key, value]) => {
    const counter = toNumber(value);
    if (counter <= 0) return;
    target[key] = (target[key] ?? 0) + counter;
  });
};

const formatRate = (interactions: number, views: number) =>
  views > 0 ? Number(((interactions / views) * 100).toFixed(2)) : 0;

const withPostMetricCache = async (
  cacheKey: string,
  loader: () => Promise<{ views: number; interactions: number }>,
) => {
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

const getTwitterCredential = (accounts: UserSocialAccounts) => {
  const account = accounts.twitter;
  if (!account?.accessToken || !account?.accessSecret) return null;

  const appKey =
    account.appKey ??
    account.consumerKey ??
    process.env.TWITTER_API_KEY ??
    process.env.TWITTER_CONSUMER_KEY;
  const appSecret =
    account.appSecret ??
    account.consumerSecret ??
    process.env.TWITTER_API_SECRET ??
    process.env.TWITTER_CONSUMER_SECRET;
  if (!appKey || !appSecret) return null;

  return {
    appKey,
    appSecret,
    accessToken: account.accessToken,
    accessSecret: account.accessSecret,
  };
};

const resolveBwinScopeId = () =>
  (process.env.BWIN_SCOPE_ID ?? process.env.BWIN_TRACK_OWNER_ID ?? '').trim();

const isBwinScopeRequest = (scope: AnalyticsScope | undefined, userId: string) => {
  const bwinScopeId = resolveBwinScopeId();
  if (!bwinScopeId) return false;
  const candidates = [
    scope?.scopeId,
    scope?.userId,
    userId,
  ]
    .map(value => String(value ?? '').trim())
    .filter(Boolean);
  return candidates.includes(bwinScopeId);
};

const getBwinEnvTwitterCredential = () => {
  const accessToken =
    process.env.BWIN_X_ACCESS_TOKEN ??
    process.env.BWIN_TWITTER_ACCESS_TOKEN ??
    '';
  const accessSecret =
    process.env.BWIN_X_ACCESS_SECRET ??
    process.env.BWIN_TWITTER_ACCESS_SECRET ??
    '';
  const appKey =
    process.env.BWIN_X_APP_KEY ??
    process.env.BWIN_TWITTER_APP_KEY ??
    process.env.TWITTER_API_KEY ??
    process.env.TWITTER_CONSUMER_KEY ??
    '';
  const appSecret =
    process.env.BWIN_X_APP_SECRET ??
    process.env.BWIN_TWITTER_APP_SECRET ??
    process.env.TWITTER_API_SECRET ??
    process.env.TWITTER_CONSUMER_SECRET ??
    '';
  if (!accessToken || !accessSecret || !appKey || !appSecret) return null;
  return {
    appKey,
    appSecret,
    accessToken,
    accessSecret,
  };
};

const extractTwitterViews = (data: any) => {
  const nonPublic = data?.non_public_metrics?.impression_count;
  if (typeof nonPublic === 'number') return nonPublic;
  const organic = data?.organic_metrics?.impression_count;
  if (typeof organic === 'number') return organic;
  const publicViews = data?.public_metrics?.impression_count;
  if (typeof publicViews === 'number') return publicViews;
  return 0;
};

const extractTwitterInteractions = (data: any) => {
  const publicMetrics = data?.public_metrics ?? {};
  const organic = data?.organic_metrics ?? {};
  const likes =
    typeof publicMetrics.like_count === 'number'
      ? publicMetrics.like_count
      : typeof organic.like_count === 'number'
        ? organic.like_count
        : 0;
  const replies =
    typeof publicMetrics.reply_count === 'number'
      ? publicMetrics.reply_count
      : typeof organic.reply_count === 'number'
        ? organic.reply_count
        : 0;
  const reposts =
    typeof publicMetrics.retweet_count === 'number'
      ? publicMetrics.retweet_count
      : typeof organic.retweet_count === 'number'
        ? organic.retweet_count
        : 0;
  const quotes =
    typeof publicMetrics.quote_count === 'number'
      ? publicMetrics.quote_count
      : typeof organic.quote_count === 'number'
        ? organic.quote_count
        : 0;

  return likes + replies + reposts + quotes;
};

const collectRemoteIds = (posts: ScheduledPost[], platformNames: string[]) =>
  toUniqueIds(
    posts
      .filter(post => platformNames.includes(post.platform))
      .map(post => (post.remoteId ?? '').trim())
      .filter(Boolean)
      .slice(0, MAX_POSTS_PER_PLATFORM),
  );

const mergePostedRows = (...sources: ScheduledPost[][]) => {
  const merged = new Map<string, ScheduledPost>();
  sources.flat().forEach(post => {
    const platform = String(post.platform ?? '').trim();
    const remoteId = String(post.remoteId ?? '').trim();
    const postedAtMs = toMillis(post.postedAt);
    if (!platform || !remoteId || !postedAtMs) return;
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

const resolveFacebookPageAccessToken = async (
  facebookAccount: NonNullable<UserSocialAccounts['facebook']>,
) => {
  const pageId = facebookAccount.pageId?.trim();
  const accessToken = facebookAccount.accessToken?.trim();
  if (!pageId || !accessToken) return '';

  const cacheKey = `${pageId}:${accessToken.slice(-12)}`;
  const cached = facebookPageTokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  try {
    const response = await axios.get(`https://graph.facebook.com/${GRAPH_VERSION}/me/accounts`, {
      params: {
        fields: 'id,access_token',
        access_token: accessToken,
      },
      timeout: 30000,
    });
    const page = (Array.isArray(response.data?.data) ? response.data.data : []).find(
      (entry: any) => String(entry?.id ?? '') === pageId,
    );
    const pageToken = String(page?.access_token ?? '').trim();
    if (pageToken) {
      facebookPageTokenCache.set(cacheKey, {
        expiresAt: Date.now() + POST_METRIC_CACHE_TTL_MS,
        token: pageToken,
      });
      return pageToken;
    }
  } catch {
    // If this is already a page token, /me/accounts may fail; try it directly below.
  }

  return accessToken;
};

const asPostedRow = (platform: string, remoteId: string, postedAtMs: number): ScheduledPost => ({
  platform,
  status: 'posted',
  remoteId,
  postedAt: { seconds: Math.floor(postedAtMs / 1000) },
});

const normalizeSocialLogPost = (entry: {
  platform?: unknown;
  status?: unknown;
  responseId?: unknown;
  postedAt?: RawTimestamp;
}): LoggedSocialPost | null => {
  const platform = String(entry.platform ?? '').trim();
  const status = String(entry.status ?? '').trim().toLowerCase();
  const remoteId = String(entry.responseId ?? '').trim();
  const postedAtMs = toMillis(entry.postedAt);
  if (!platform || status !== 'posted' || !remoteId || !postedAtMs) return null;
  return {
    platform,
    status: 'posted',
    remoteId,
    postedAt: entry.postedAt,
  };
};

const hasSocialAccounts = (profile?: UserSocialProfile | null) =>
  Boolean(profile?.socialAccounts && Object.keys(profile.socialAccounts).length > 0);

const isKnownLiveSocialProfile = (profile?: UserSocialProfile | null) =>
  Boolean(
    profile?.id &&
      KNOWN_LIVE_SOCIAL_PROFILES.some(
        known =>
          known.userId === profile.id ||
          (!!profile.email && known.email?.toLowerCase() === profile.email.toLowerCase()),
      ),
  );

const rootMetaToken = () =>
  (
    process.env.META_GRAPH_TOKEN ??
    process.env.CLIENT_META_USER_TOKEN ??
    process.env.INSTAGRAM_ACCESS_TOKEN ??
    process.env.FACEBOOK_PAGE_TOKEN ??
    ''
  ).trim();

const rootFacebookToken = () =>
  (
    process.env.META_GRAPH_TOKEN ??
    process.env.CLIENT_META_USER_TOKEN ??
    process.env.FACEBOOK_PAGE_TOKEN ??
    ''
  ).trim();

const rootInstagramToken = () =>
  (
    process.env.META_GRAPH_TOKEN ??
    process.env.CLIENT_META_USER_TOKEN ??
    process.env.INSTAGRAM_ACCESS_TOKEN ??
    ''
  ).trim();

const rootThreadsToken = () =>
  (
    process.env.THREADS_ACCESS_TOKEN ??
    process.env.DOTT_HR_THREADS_ACCESS_TOKEN ??
    process.env.DOTTHR_THREADS_ACCESS_TOKEN ??
    ''
  ).trim();

const knownAccountToken = (envKeys: string[], fallback: () => string) => {
  for (const key of envKeys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return fallback();
};

const KNOWN_LIVE_SOCIAL_PROFILES: Array<{
  userId: string;
  email?: string;
  facebookPageId?: string;
  instagramAccountId?: string;
  threadsAccountId?: string;
  facebookTokenEnv?: string[];
  instagramTokenEnv?: string[];
  threadsTokenEnv?: string[];
}> = [
  {
    userId: 'tCE1FQ1cOFgdupOXP23mPUMQRAz1',
    email: 'shecaredoctor@gmail.com',
    facebookPageId: '1114686181730831',
    instagramAccountId: '17841437471047291',
    facebookTokenEnv: ['SHECARE_FACEBOOK_PAGE_TOKEN', 'SHECARE_FACEBOOK_ACCESS_TOKEN'],
    instagramTokenEnv: ['SHECARE_INSTAGRAM_ACCESS_TOKEN'],
  },
  {
    userId: '80bYIeiuukNFtUvXTUobXmfC7pu1',
    email: 'kingbrasio100@gmail.com',
    facebookPageId: '1154065791120794',
    instagramAccountId: '17841426388091930',
    threadsAccountId: '27456972033906662',
    facebookTokenEnv: ['DOTT_HR_FACEBOOK_PAGE_TOKEN', 'DOTT_HR_FACEBOOK_ACCESS_TOKEN', 'DOTTHR_FACEBOOK_PAGE_TOKEN'],
    instagramTokenEnv: ['DOTT_HR_INSTAGRAM_ACCESS_TOKEN', 'DOTTHR_INSTAGRAM_ACCESS_TOKEN'],
    threadsTokenEnv: ['DOTT_HR_THREADS_ACCESS_TOKEN', 'DOTTHR_THREADS_ACCESS_TOKEN', 'DOTT_HR_THREADS_TOKEN'],
  },
  {
    userId: 'LVR7p3WzdFM51ds92Kacf6S40og2',
    facebookPageId: '1201086759745632',
    instagramAccountId: '17841433799368009',
    facebookTokenEnv: ['DOTTENERGY_FACEBOOK_PAGE_TOKEN', 'DOTTENERGY_FACEBOOK_ACCESS_TOKEN'],
    instagramTokenEnv: ['DOTTENERGY_INSTAGRAM_ACCESS_TOKEN'],
  },
  {
    userId: 'acmVetCcOiTHeGk5D7eDYieamDF3',
    facebookPageId: '1033657279841186',
    instagramAccountId: '17841414110816982',
    facebookTokenEnv: ['CARMARKETPLACE_FACEBOOK_PAGE_TOKEN', 'CARMARKETPLACE_FACEBOOK_ACCESS_TOKEN'],
    instagramTokenEnv: ['CARMARKETPLACE_INSTAGRAM_ACCESS_TOKEN'],
  },
  {
    userId: 'D1iNgjLKNRaQhH35M0NmGfw1LVD2',
    facebookPageId: '1191303874068642',
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

export const resolveKnownLiveSocialProfile = (scopeId?: string | null): UserSocialProfile | null => {
  const key = String(scopeId ?? '').trim();
  if (!key) return null;
  const known = KNOWN_LIVE_SOCIAL_PROFILES.find(
    profile => profile.userId === key || profile.email?.toLowerCase() === key.toLowerCase(),
  );
  if (!known) return null;

  const facebookToken = rootFacebookToken() || knownAccountToken(known.facebookTokenEnv ?? [], rootFacebookToken);
  const instagramToken = rootInstagramToken() || knownAccountToken(known.instagramTokenEnv ?? [], rootInstagramToken);
  const threadsToken = knownAccountToken(known.threadsTokenEnv ?? [], rootThreadsToken);
  const socialAccounts: UserSocialAccounts = {};
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

  if (!Object.keys(socialAccounts).length) return null;
  return {
    id: known.userId,
    email: known.email ?? null,
    socialAccounts,
  };
};

const mergeSocialProfiles = (profiles: Array<UserSocialProfile | null | undefined>): UserSocialProfile | undefined => {
  const mergedAccounts: UserSocialAccounts = {};
  let email: string | null | undefined;
  let orgId: string | null | undefined;
  let id: string | undefined;

  profiles.forEach(profile => {
    if (!profile) return;
    if (!id && profile.id) id = profile.id;
    if (!email && profile.email) email = profile.email;
    if (!orgId && profile.orgId) orgId = profile.orgId;
    const accounts = profile.socialAccounts ?? {};
    Object.entries(accounts).forEach(([platform, account]) => {
      const current = mergedAccounts[platform];
      if (!current || !Object.keys(current as Record<string, unknown>).length) {
        mergedAccounts[platform] = account;
        return;
      }
      mergedAccounts[platform] = {
        ...(current as Record<string, unknown>),
        ...(account as Record<string, unknown>),
      };
    });
  });

  if (!id && !email && !orgId && !Object.keys(mergedAccounts).length) return undefined;
  return { id, email, orgId, socialAccounts: mergedAccounts };
};

const fetchSupabaseSocialProfile = async (userId: string): Promise<UserSocialProfile | null> => {
  try {
    const fallback = await supabaseFallbackService.getSocialAccounts(userId);
    if (!fallback) return null;
    return {
      id: userId,
      email: fallback.email ?? null,
      socialAccounts: fallback.socialAccounts as UserSocialAccounts,
    };
  } catch (error) {
    console.warn('[socialLive] supabase social account fetch failed', { userId, error });
    return null;
  }
};

const resolveLiveMetricOwners = async (
  userId: string,
  scope?: AnalyticsScope,
): Promise<{ ownerIds: string[]; userProfile?: UserSocialProfile; accountLevelMetaOnly?: boolean }> => {
  const rawScopeId = scope?.scopeId?.trim();
  const rawEmail = scope?.email?.trim();
  const candidateIds = Array.from(new Set([rawScopeId, userId].filter(Boolean) as string[]));
  const profilesById = new Map<string, UserSocialProfile>();
  const orderedProfiles: UserSocialProfile[] = [];
  let accountLevelMetaOnly = false;

  const addProfile = (profile?: UserSocialProfile | null) => {
    if (!profile) return;
    if (isKnownLiveSocialProfile(profile)) {
      accountLevelMetaOnly = true;
    }
    const profileId = profile.id?.trim();
    if (profileId && profilesById.has(profileId)) {
      const existing = profilesById.get(profileId);
      const merged = mergeSocialProfiles([existing, profile]);
      if (!merged) return;
      profilesById.set(profileId, merged);
      const index = orderedProfiles.findIndex(entry => entry.id === profileId);
      if (index >= 0) {
        orderedProfiles[index] = merged;
      } else {
        orderedProfiles.push(merged);
      }
    } else if (profileId) {
      profilesById.set(profileId, profile);
      orderedProfiles.push(profile);
    } else if (!profileId) {
      orderedProfiles.push(profile);
    }
  };

  await Promise.all(
    candidateIds.map(async candidateId => {
      try {
        const snap = await firestore.collection('users').doc(candidateId).get();
        if (snap.exists) {
          const data = snap.data() as UserSocialProfile;
          addProfile({
            id: snap.id,
            email: data.email ?? null,
            orgId: data.orgId ?? null,
            socialAccounts: data.socialAccounts,
          });
        }
      } catch (error) {
        console.warn('[socialLive] firestore user fetch failed', { userId: candidateId, error });
      }
    }),
  );

  [...orderedProfiles].forEach(profile => {
    addProfile(resolveKnownLiveSocialProfile(profile.email));
    addProfile(resolveKnownLiveSocialProfile(profile.orgId));
  });
  addProfile(resolveKnownLiveSocialProfile(rawEmail));

  if (rawScopeId) {
    try {
      const snap = await firestore.collection('users').where('orgId', '==', rawScopeId).limit(5).get();
      snap.docs.forEach(doc => {
        const data = doc.data() as UserSocialProfile;
        addProfile({
          id: doc.id,
          email: data.email ?? null,
          orgId: data.orgId ?? null,
          socialAccounts: data.socialAccounts,
        });
      });
    } catch (error) {
      console.warn('[socialLive] firestore org owner lookup failed', { scopeId: rawScopeId, error });
    }
  }

  await Promise.all(
    candidateIds.map(async candidateId => {
      addProfile(resolveKnownLiveSocialProfile(candidateId));
      if (hasSocialAccounts(profilesById.get(candidateId))) return;
      const fallback = await fetchSupabaseSocialProfile(candidateId);
      addProfile(fallback);
      if (!hasSocialAccounts(fallback)) {
        addProfile(resolveKnownLiveSocialProfile(candidateId));
      }
    }),
  );

  const ownerIds = Array.from(
    new Set([
      ...orderedProfiles.map(profile => profile.id).filter(Boolean),
      ...candidateIds,
    ] as string[]),
  );

  return {
    ownerIds: ownerIds.length ? ownerIds : [userId],
    userProfile: mergeSocialProfiles(orderedProfiles),
    accountLevelMetaOnly,
  };
};

const buildWithDefaults = (
  userData: { email?: string | null; socialAccounts?: UserSocialAccounts } | undefined,
  userId?: string,
) => {
  const allowDefaults = canUsePrimarySocialDefaults(userData, userId);
  const merged: UserSocialAccounts = { ...(userData?.socialAccounts ?? {}) };
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

const fetchFacebookMetric = async (
  postId: string,
  facebookAccount: NonNullable<UserSocialAccounts['facebook']>,
) => {
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
      const analyticsPostId =
        typeof basic.data?.page_story_id === 'string' && basic.data.page_story_id
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
      } catch {
        // Optional insights can fail if permission is unavailable; keep base metrics.
      }

      return { views, interactions };
    } catch {
      return { views: 0, interactions: 0 };
    }
  });
};

const fetchRecentFacebookPosts = async (
  facebookAccount: NonNullable<UserSocialAccounts['facebook']>,
  cutoffMs: number,
) => {
  const pageId = facebookAccount.pageId?.trim();
  const accessToken = await resolveFacebookPageAccessToken(facebookAccount);
  if (!pageId || !accessToken) return [];
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
      .map((post: any) => {
        const remoteId = String(post?.id ?? '').trim();
        const postedAtMs = Date.parse(String(post?.created_time ?? ''));
        if (!remoteId || !Number.isFinite(postedAtMs) || postedAtMs < cutoffMs) return null;
        return asPostedRow('facebook', remoteId, postedAtMs);
      })
      .filter((post: ScheduledPost | null): post is ScheduledPost => Boolean(post));
  } catch (error) {
    console.warn('[socialLive] direct Facebook timeline fetch failed', error);
    return [];
  }
};

const fetchFacebookPageMetric = async (
  facebookAccount: NonNullable<UserSocialAccounts['facebook']>,
  cutoffMs: number,
) => {
  const pageId = facebookAccount.pageId?.trim();
  const accessToken = await resolveFacebookPageAccessToken(facebookAccount);
  if (!pageId || !accessToken) return { views: 0, interactions: 0 };
  const since = Math.floor(cutoffMs / 1000);
  const until = Math.floor(Date.now() / 1000);
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
    const metricTotal = (metric: string) =>
      rows
        .find((row: any) => row?.name === metric)
        ?.values?.reduce((acc: number, entry: any) => acc + toNumber(entry?.value), 0) ?? 0;
    return {
      views: metricTotal('page_views_total'),
      interactions: metricTotal('page_total_actions'),
    };
  } catch (error) {
    console.warn('[socialLive] direct Facebook page insights fetch failed', error);
    return { views: 0, interactions: 0 };
  }
};

const fetchInstagramAccountMetric = async (
  instagramAccount: NonNullable<UserSocialAccounts['instagram']>,
  cutoffMs: number,
) => {
  const accountId = instagramAccount.accountId?.trim();
  const accessToken = instagramAccount.accessToken?.trim();
  if (!accountId || !accessToken) return { views: 0, interactions: 0 };

  const since = Math.floor(cutoffMs / 1000);
  const until = Math.floor(Date.now() / 1000);
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
    const metricTotal = (metric: string) => {
      const row = rows.find((entry: any) => entry?.name === metric);
      const totalValue = toNumber(row?.total_value?.value);
      if (totalValue > 0) return totalValue;
      return row?.values?.reduce((acc: number, entry: any) => acc + toNumber(entry?.value), 0) ?? 0;
    };
    return {
      views: metricTotal('views') || metricTotal('reach'),
      interactions: metricTotal('total_interactions'),
    };
  } catch (error) {
    console.warn('[socialLive] direct Instagram account insights fetch failed', error);
    return { views: 0, interactions: 0 };
  }
};

const fetchInstagramMetric = async (mediaId: string, accessToken: string) => {
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
      } catch {
        // Optional insights can fail if scope is not available.
      }

      return { views, interactions };
    } catch {
      return { views: 0, interactions: 0 };
    }
  });
};

const fetchThreadsMetric = async (mediaId: string, accessToken: string) => {
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
      const interactions =
        parseInsightArrayValue(rows, 'likes') +
        parseInsightArrayValue(rows, 'replies') +
        parseInsightArrayValue(rows, 'reposts') +
        parseInsightArrayValue(rows, 'quotes');
      return { views, interactions };
    } catch {
      return { views: 0, interactions: 0 };
    }
  });
};

const fetchRecentInstagramMedia = async (
  instagramAccount: NonNullable<UserSocialAccounts['instagram']>,
  cutoffMs: number,
) => {
  const accountId = instagramAccount.accountId?.trim();
  const accessToken = instagramAccount.accessToken?.trim();
  if (!accountId || !accessToken) return [];
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
      .map((media: any) => {
        const remoteId = String(media?.id ?? '').trim();
        const postedAtMs = Date.parse(String(media?.timestamp ?? ''));
        if (!remoteId || !Number.isFinite(postedAtMs) || postedAtMs < cutoffMs) return null;
        const product = String(media?.media_product_type ?? '').toLowerCase();
        const platform = product.includes('story')
          ? 'instagram_story'
          : product.includes('reels')
            ? 'instagram_reels'
            : 'instagram';
        return asPostedRow(platform, remoteId, postedAtMs);
      })
      .filter((post: ScheduledPost | null): post is ScheduledPost => Boolean(post));
  } catch (error) {
    console.warn('[socialLive] direct Instagram media fetch failed', error);
    return [];
  }
};

const fetchRecentThreadsMedia = async (
  threadsAccount: NonNullable<UserSocialAccounts['threads']>,
  cutoffMs: number,
) => {
  const accountId = threadsAccount.accountId?.trim();
  const accessToken = threadsAccount.accessToken?.trim();
  if (!accountId || !accessToken) return [];
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
      .map((thread: any) => {
        const remoteId = String(thread?.id ?? '').trim();
        const postedAtMs = Date.parse(String(thread?.timestamp ?? ''));
        if (!remoteId || !Number.isFinite(postedAtMs) || postedAtMs < cutoffMs) return null;
        return asPostedRow('threads', remoteId, postedAtMs);
      })
      .filter((post: ScheduledPost | null): post is ScheduledPost => Boolean(post));
  } catch (error) {
    console.warn('[socialLive] direct Threads timeline fetch failed', error);
    return [];
  }
};

const fetchXMetric = async (
  tweetId: string,
  credentials: { appKey: string; appSecret: string; accessToken: string; accessSecret: string },
) => {
  return withPostMetricCache(`x:${tweetId}`, async () => {
    const client = new TwitterApi(credentials).readWrite;
    try {
      const full = await client.v2.singleTweet(tweetId, {
        'tweet.fields': ['public_metrics', 'non_public_metrics', 'organic_metrics'],
      });
      const data = (full as any)?.data;
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
        const data = (fallback as any)?.data;
        return {
          views: extractTwitterViews(data),
          interactions: extractTwitterInteractions(data),
        };
      } catch {
        return { views: 0, interactions: 0 };
      }
    }
  });
};

const fetchOwnXTimelineMetrics = async (credentials: {
  appKey: string;
  appSecret: string;
  accessToken: string;
  accessSecret: string;
}) => {
  const client = new TwitterApi(credentials).readWrite;
  try {
    const me = await client.v2.me();
    const meId = String(me?.data?.id ?? '').trim();
    if (!meId) return { views: 0, interactions: 0, postsAnalyzed: 0 };
    const timeline = await client.v2.userTimeline(meId, {
      max_results: 10,
      exclude: ['replies', 'retweets'],
      'tweet.fields': ['public_metrics', 'non_public_metrics', 'organic_metrics'],
    } as any);
    const tweets = Array.isArray((timeline as any)?.data?.data)
      ? ((timeline as any).data.data as any[])
      : Array.isArray((timeline as any)?.tweets)
        ? ((timeline as any).tweets as any[])
        : [];
    const views = sum(tweets.map(tweet => extractTwitterViews(tweet)));
    const interactions = sum(tweets.map(tweet => extractTwitterInteractions(tweet)));
    return {
      views,
      interactions,
      postsAnalyzed: tweets.length,
    };
  } catch {
    return { views: 0, interactions: 0, postsAnalyzed: 0 };
  }
};

export async function getLiveSocialMetrics(
  userId: string,
  options?: { lookbackHours?: number; scope?: AnalyticsScope },
): Promise<LiveSocialMetrics> {
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
        const scheduledRows: ScheduledPost[] = [];
        await Promise.all(
          ownerIds.map(async ownerId => {
            try {
              const postsSnap = await firestore.collection('scheduledPosts').where('userId', '==', ownerId).limit(500).get();
              scheduledRows.push(
                ...postsSnap.docs
                .map(doc => doc.data() as ScheduledPost)
                .filter(post => post.status === 'posted' && toMillis(post.postedAt) >= cutoffMs),
              );
            } catch (error) {
              console.warn('[socialLive] firestore scheduled posts fetch failed', { userId: ownerId, error });
            }
          }),
        );

        let fallbackRows: ScheduledPost[] = [];
        await Promise.all(
          ownerIds.map(async ownerId => {
            try {
              const fallbackPosts = await supabaseFallbackService.getPostsByUser(ownerId, 500);
              fallbackRows.push(
                ...fallbackPosts
                .map(post => post as ScheduledPost)
                .filter(post => post.status === 'posted' && toMillis(post.postedAt) >= cutoffMs),
              );
            } catch (error) {
              console.warn('[socialLive] supabase scheduled posts fetch failed', { userId: ownerId, error });
            }
          }),
        );

        let fallbackLogRows: LoggedSocialPost[] = [];
        await Promise.all(
          ownerIds.map(async ownerId => {
            try {
              fallbackLogRows.push(
                ...(await supabaseFallbackService.getSocialLogsByUser(ownerId, 500))
                  .map(entry =>
                    normalizeSocialLogPost({
                      platform: entry.platform,
                      status: entry.status,
                      responseId: entry.responseId,
                      postedAt: entry.postedAt as RawTimestamp,
                    }),
                  )
                  .filter((post): post is LoggedSocialPost => Boolean(post))
                  .filter(post => toMillis(post.postedAt) >= cutoffMs),
              );
            } catch (error) {
              console.warn('[socialLive] supabase social log fetch failed', { userId: ownerId, error });
            }
          }),
        );

        return mergePostedRows(scheduledRows, fallbackRows, fallbackLogRows);
      })(),
      getOutboundStats(options?.scope ?? { userId }),
      Promise.all(
        scopeKeys.map(async key => {
          try {
            const snap = await firestore
              .collection('analytics')
              .doc(key)
              .collection('webTrafficDaily')
              .orderBy('date', 'desc')
              .limit(lookbackDays)
              .get();
            const rows = snap.docs
              .map(doc => doc.data() as any)
              .filter(row => {
                const date = typeof row.date === 'string' ? row.date : '';
                return date && date >= minDate;
              });
            if (rows.length) {
              return { key, rows };
            }
          } catch (error) {
            console.warn('[socialLive] firestore web traffic daily fetch failed', error);
          }

          try {
            const fallbackRows = await supabaseFallbackService.getMetricDailyRows(
              'webTraffic',
              { scopeId: key },
              lookbackDays,
              minDate,
            );
            const rows = fallbackRows.map(row => ({
              date: row.date,
              visitors: toNumber((row.counters as any)?.visitors),
              interactions: toNumber((row.counters as any)?.interactions),
              redirectClicks: toNumber((row.counters as any)?.redirectClicks),
              sourceRedirectClicks: (row.counters as any)?.sourceRedirectClicks ?? {},
            }));
            return { key, rows };
          } catch (error) {
            console.warn('[socialLive] supabase web traffic fetch failed', { scopeId: key, error });
            return { key, rows: [] };
          }
        }),
      ),
    ]);

    const userData = ownerContext.userProfile;
    const primaryOwnerId = userData?.id ?? ownerIds[0] ?? userId;
    const accounts = buildWithDefaults(userData, primaryOwnerId);
    const knownRuntimeProfile =
      resolveKnownLiveSocialProfile(options?.scope?.scopeId) ||
      resolveKnownLiveSocialProfile(userId) ||
      resolveKnownLiveSocialProfile(options?.scope?.email) ||
      resolveKnownLiveSocialProfile(userData?.email);
    if (knownRuntimeProfile?.socialAccounts) {
      Object.assign(accounts, knownRuntimeProfile.socialAccounts);
    }
    if (isBwinScopeRequest(options?.scope, userId)) {
      if (!accounts.facebook?.accessToken && process.env.BWIN_FACEBOOK_PAGE_TOKEN && process.env.BWIN_FACEBOOK_PAGE_ID) {
        accounts.facebook = {
          accessToken: process.env.BWIN_FACEBOOK_PAGE_TOKEN,
          pageId: process.env.BWIN_FACEBOOK_PAGE_ID,
        };
      }
      if (
        !accounts.instagram?.accessToken &&
        process.env.BWIN_INSTAGRAM_ACCESS_TOKEN &&
        process.env.BWIN_INSTAGRAM_ACCOUNT_ID
      ) {
        accounts.instagram = {
          accessToken: process.env.BWIN_INSTAGRAM_ACCESS_TOKEN,
          accountId: process.env.BWIN_INSTAGRAM_ACCOUNT_ID,
        };
      }
    }

    let metricPostedRows = ownerContext.accountLevelMetaOnly ? [] : recentPosted;
    const directFacebookRows =
      !ownerContext.accountLevelMetaOnly && accounts.facebook?.accessToken && accounts.facebook?.pageId
        ? await fetchRecentFacebookPosts(accounts.facebook, cutoffMs)
        : [];
    const directInstagramRows =
      !ownerContext.accountLevelMetaOnly && accounts.instagram?.accessToken && accounts.instagram?.accountId
        ? await fetchRecentInstagramMedia(accounts.instagram, cutoffMs)
        : [];

    if (!ownerContext.accountLevelMetaOnly && accounts.facebook?.accessToken && accounts.facebook?.pageId) {
      metricPostedRows = metricPostedRows.filter(post => !['facebook', 'facebook_story'].includes(post.platform));
      metricPostedRows = mergePostedRows(metricPostedRows, directFacebookRows);
    }
    if (!ownerContext.accountLevelMetaOnly && accounts.instagram?.accessToken && accounts.instagram?.accountId) {
      metricPostedRows = metricPostedRows.filter(
        post => !['instagram', 'instagram_reels', 'instagram_story'].includes(post.platform),
      );
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
    const sourceRedirectClicks: Record<string, number> = {};
    const recentWebTrafficRows = pickWebTrafficRows(webTrafficCandidates);
    const webVisitors = sum(recentWebTrafficRows.map(row => toNumber(row.visitors)));
    const webInteractions = sum(recentWebTrafficRows.map(row => toNumber(row.interactions)));
    const webRedirectClicks = sum(recentWebTrafficRows.map(row => toNumber(row.redirectClicks)));
    recentWebTrafficRows.forEach(row => mergeCounterMap(sourceRedirectClicks, row.sourceRedirectClicks));

    const output: LiveSocialMetrics = {
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
          ? Promise.all(facebookIds.map(id => fetchFacebookMetric(id, accounts.facebook!)))
          : Promise.resolve([]),
        fetchFacebookPageMetric(accounts.facebook, cutoffMs),
      ]);
      output.platforms.facebook.views = Math.max(sum(rows.map(row => row.views)), pageMetric.views);
      output.platforms.facebook.interactions = Math.max(
        sum(rows.map(row => row.interactions)),
        pageMetric.interactions,
      );
      output.platforms.facebook.engagementRate = formatRate(
        output.platforms.facebook.interactions,
        output.platforms.facebook.views,
      );
    }

    if (accounts.instagram?.accessToken && accounts.instagram?.accountId) {
      const [rows, accountMetric] = await Promise.all([
        instagramIds.length > 0
          ? Promise.all(instagramIds.map(id => fetchInstagramMetric(id, accounts.instagram?.accessToken ?? '')))
          : Promise.resolve([]),
        fetchInstagramAccountMetric(accounts.instagram, cutoffMs),
      ]);
      output.platforms.instagram.views = Math.max(sum(rows.map(row => row.views)), accountMetric.views);
      output.platforms.instagram.interactions = Math.max(
        sum(rows.map(row => row.interactions)),
        accountMetric.interactions,
      );
      output.platforms.instagram.engagementRate = formatRate(
        output.platforms.instagram.interactions,
        output.platforms.instagram.views,
      );
    }

    if (accounts.threads?.accessToken && threadsIds.length > 0) {
      const rows = await Promise.all(
        threadsIds.map(id => fetchThreadsMetric(id, accounts.threads?.accessToken ?? '')),
      );
      output.platforms.threads.views = sum(rows.map(row => row.views));
      output.platforms.threads.interactions = sum(rows.map(row => row.interactions));
      output.platforms.threads.engagementRate = formatRate(
        output.platforms.threads.interactions,
        output.platforms.threads.views,
      );
    }

    const twitterCredential = getTwitterCredential(accounts);
    if (twitterCredential && xIds.length > 0) {
      const rows = await Promise.all(xIds.map(id => fetchXMetric(id, twitterCredential)));
      output.platforms.x.views = sum(rows.map(row => row.views));
      output.platforms.x.interactions = sum(rows.map(row => row.interactions));
      output.platforms.x.engagementRate = formatRate(
        output.platforms.x.interactions,
        output.platforms.x.views,
      );
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
  } catch (error) {
    console.warn('[socialLive] quota-safe fallback mode enabled', error);
    if (cached?.data) {
      return cached.data;
    }
    const outbound = await getOutboundStats(options?.scope ?? { userId });
    const webStats = await getWebTrafficStats(options?.scope ?? { userId });
    let xFallbackMetric: PlatformLiveMetric = { ...emptyPlatformMetric() };
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
    const summaryInteractions =
      Number(webStats.interactions ?? 0) + Number(xFallbackMetric.interactions ?? 0);
    const fallback: LiveSocialMetrics = {
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
          connected:
            Number(webStats.visitors ?? 0) > 0 ||
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
