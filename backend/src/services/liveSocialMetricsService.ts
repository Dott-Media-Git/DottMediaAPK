import axios from 'axios';
import { TwitterApi } from 'twitter-api-v2';
import { firestore } from '../db/firestore';
import { config } from '../config';
import { canUsePrimarySocialDefaults } from '../utils/socialAccess';
import { getOutboundStats, getWebTrafficStats } from './analyticsService';
import type { AnalyticsScope } from './analyticsScope';
import { resolveAnalyticsScopeKey } from './analyticsScope';

const GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? 'v23.0';
const MAX_POSTS_PER_PLATFORM = Math.max(Number(process.env.LIVE_SOCIAL_MAX_POSTS ?? 20), 5);
const LOOKBACK_HOURS_DEFAULT = Math.max(Number(process.env.LIVE_SOCIAL_LOOKBACK_HOURS ?? 72), 1);
const CACHE_TTL_MS = Math.max(Number(process.env.LIVE_SOCIAL_CACHE_MS ?? 120000), 10000);
const FACEBOOK_VIEW_FALLBACK_MULTIPLIER = Math.max(Number(process.env.FACEBOOK_VIEW_FALLBACK_MULTIPLIER ?? 18), 1);
const INSTAGRAM_VIEW_FALLBACK_MULTIPLIER = Math.max(Number(process.env.INSTAGRAM_VIEW_FALLBACK_MULTIPLIER ?? 15), 1);
const liveMetricsCache = new Map<string, { expiresAt: number; data: LiveSocialMetrics }>();

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

const estimateViewsFromInteractions = (platform: 'facebook' | 'instagram', interactions: number) => {
  if (interactions <= 0) return 0;
  const multiplier =
    platform === 'facebook' ? FACEBOOK_VIEW_FALLBACK_MULTIPLIER : INSTAGRAM_VIEW_FALLBACK_MULTIPLIER;
  return Math.max(Math.round(interactions * multiplier), interactions);
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

const buildWithDefaults = (userData: { email?: string | null; socialAccounts?: UserSocialAccounts } | undefined) => {
  const allowDefaults = canUsePrimarySocialDefaults(userData);
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
  const publishToken = facebookAccount.accessToken ?? '';
  const metricsToken = facebookAccount.userAccessToken?.trim() || publishToken;
  if (!publishToken) {
    return { views: 0, interactions: 0 };
  }
  try {
    const basicFields = postId.includes('_')
      ? 'id,likes.summary(true),comments.summary(true)'
      : 'id,likes.summary(true),comments.summary(true),page_story_id';
    const basic = await axios.get(`https://graph.facebook.com/${GRAPH_VERSION}/${postId}`, {
      params: {
        fields: basicFields,
        access_token: publishToken,
      },
      timeout: 30000,
    });

    const likes = Number(basic.data?.likes?.summary?.total_count ?? 0);
    const comments = Number(basic.data?.comments?.summary?.total_count ?? 0);
    let views = 0;
    let interactions = likes + comments;
    const analyticsPostId =
      typeof basic.data?.page_story_id === 'string' && basic.data.page_story_id
        ? basic.data.page_story_id
        : postId;

    try {
      const insights = await axios.get(`https://graph.facebook.com/${GRAPH_VERSION}/${analyticsPostId}/insights`, {
        params: {
          metric: 'post_impressions,post_impressions_unique,post_engaged_users',
          access_token: metricsToken,
        },
        timeout: 30000,
      });
      const insightBlock = insights.data;
      views =
        parseInsightValue(insightBlock, 'post_impressions') ||
        parseInsightValue(insightBlock, 'post_impressions_unique');
      const engagedUsers = parseInsightValue(insightBlock, 'post_engaged_users');
      if (engagedUsers > 0) interactions = engagedUsers;
    } catch {
      // Optional insights can fail if permission is unavailable; keep base metrics.
    }

    if (views <= 0) {
      views = estimateViewsFromInteractions('facebook', interactions);
    }
    return { views, interactions };
  } catch {
    return { views: 0, interactions: 0 };
  }
};

const fetchInstagramMetric = async (mediaId: string, accessToken: string) => {
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
          metric: 'impressions,reach,saved,shares,total_interactions',
          access_token: accessToken,
        },
        timeout: 30000,
      });
      const rows = Array.isArray(insights.data?.data) ? insights.data.data : [];
      views =
        parseInsightArrayValue(rows, 'impressions') ||
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

    if (views <= 0) {
      views = estimateViewsFromInteractions('instagram', interactions);
    }
    return { views, interactions };
  } catch {
    return { views: 0, interactions: 0 };
  }
};

const fetchXMetric = async (
  tweetId: string,
  credentials: { appKey: string; appSecret: string; accessToken: string; accessSecret: string },
) => {
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
  } catch {
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
    const [userDoc, postsSnap, outbound, webTrafficCandidates] = await Promise.all([
      firestore.collection('users').doc(userId).get(),
      firestore.collection('scheduledPosts').where('userId', '==', userId).limit(500).get(),
      getOutboundStats(options?.scope ?? { userId }),
      Promise.all(
        scopeKeys.map(async key => {
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
          return { key, rows };
        }),
      ),
    ]);

    const userData = userDoc.data() as { email?: string | null; socialAccounts?: UserSocialAccounts } | undefined;
    const accounts = buildWithDefaults(userData);

    const recentPosted = postsSnap.docs
      .map(doc => doc.data() as ScheduledPost)
      .filter(post => post.status === 'posted' && toMillis(post.postedAt) >= cutoffMs);

    const facebookIds = collectRemoteIds(recentPosted, ['facebook', 'facebook_story']);
    const instagramIds = collectRemoteIds(recentPosted, ['instagram', 'instagram_reels', 'instagram_story']);
    const threadsIds = collectRemoteIds(recentPosted, ['threads']);
    const xIds = collectRemoteIds(recentPosted, ['x', 'twitter']);
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

    if (accounts.facebook?.accessToken && facebookIds.length > 0) {
      const rows = await Promise.all(
        facebookIds.map(id => fetchFacebookMetric(id, accounts.facebook!)),
      );
      output.platforms.facebook.views = sum(rows.map(row => row.views));
      output.platforms.facebook.interactions = sum(rows.map(row => row.interactions));
      output.platforms.facebook.engagementRate = formatRate(
        output.platforms.facebook.interactions,
        output.platforms.facebook.views,
      );
    }

    if (accounts.instagram?.accessToken && instagramIds.length > 0) {
      const rows = await Promise.all(
        instagramIds.map(id => fetchInstagramMetric(id, accounts.instagram?.accessToken ?? '')),
      );
      output.platforms.instagram.views = sum(rows.map(row => row.views));
      output.platforms.instagram.interactions = sum(rows.map(row => row.interactions));
      output.platforms.instagram.engagementRate = formatRate(
        output.platforms.instagram.interactions,
        output.platforms.instagram.views,
      );
    }

    if (accounts.threads?.accessToken && threadsIds.length > 0) {
      const rows = await Promise.all(
        threadsIds.map(id => fetchInstagramMetric(id, accounts.threads?.accessToken ?? '')),
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
