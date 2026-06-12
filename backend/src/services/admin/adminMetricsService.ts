import admin from 'firebase-admin';
import axios from 'axios';
import https from 'https';
import { firestore } from '../../db/firestore';
import { resolveAnalyticsScopeKey } from '../analyticsScope';
import { supabaseFallbackService } from '../supabaseFallbackService';

export type AdminMetrics = {
  summary: {
    totalClients: number;
    activeSessions: number;
    newSignupsThisWeek: number;
    connectedClients: number;
  };
  signupsByDay: Array<{ date: string; count: number }>;
  connectedPlatforms: Record<string, number>;
  topActiveAccounts: Array<{ userId: string; email?: string; name?: string; posts: number }>;
  autopostSuccessRate: Record<
    string,
    { posted: number; failed: number; attempted: number; rate: number }
  >;
  weeklyPostVolume: Array<{ date: string; count: number }>;
  aiResponsesSent: number;
  companyKpis: {
    totalAiMessages: number;
    imageGenerations: number;
    crmCampaigns: number;
    leadConversions: number;
  };
  liveFeed: Array<{ id: string; type: 'login' | 'post' | 'reply'; label: string; timestamp: string }>;
  updatedAt: string;
};

const usersCollection = firestore.collection('users');
const scheduledPostsCollection = firestore.collection('scheduledPosts');
const notificationsCollection = firestore.collection('notifications');
const integrationsCollection = firestore.collection('socialIntegrations');

const knownClientIds = () => KNOWN_CONNECTED_CLIENTS.map(client => client.userId).filter(Boolean);

const toMillis = (value: any) => {
  if (!value) return 0;
  if (typeof value === 'number') return value > 1e12 ? value : value * 1000;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (typeof value.seconds === 'number') return value.seconds * 1000;
  if (typeof value._seconds === 'number') return value._seconds * 1000;
  return 0;
};

const toIso = (value: any) => {
  const ms = toMillis(value);
  if (!ms) return '';
  return new Date(ms).toISOString();
};

const isMissingIndexError = (error: unknown) => {
  const err = error as { code?: number; message?: string; details?: string };
  const message = `${err?.message ?? ''} ${err?.details ?? ''}`.toLowerCase();
  return err?.code === 9 && message.includes('index');
};

const buildDateRange = (days: number, endDate = new Date()) => {
  const result: string[] = [];
  const start = new Date(endDate.getTime());
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  for (let i = 0; i < days; i += 1) {
    const date = new Date(start.getTime());
    date.setUTCDate(start.getUTCDate() + i);
    result.push(date.toISOString().slice(0, 10));
  }
  return result;
};

const timeout = <T>(promise: Promise<T>, ms: number, label: string) =>
  Promise.race<T>([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]);

const hasConnectedAccount = (account: any) =>
  Boolean(account?.accessToken || account?.accountId || account?.pageId || account?.urn || account?.phoneId || account?.token);

const fetchAuthUserMetadata = async () => {
  const byUid = new Map<string, { createdAt?: string; lastLoginAt?: string; email?: string; name?: string }>();
  let pageToken: string | undefined;
  do {
    const page = await admin.auth().listUsers(1000, pageToken);
    page.users.forEach(user => {
      byUid.set(user.uid, {
        createdAt: user.metadata.creationTime,
        lastLoginAt: user.metadata.lastSignInTime,
        email: user.email,
        name: user.displayName,
      });
    });
    pageToken = page.pageToken;
  } while (pageToken);
  return byUid;
};

const fetchSummaryDoc = async (scopeKey: string, docId: 'engagement' | 'outbound') => {
  try {
    const snap = await firestore.collection('analytics').doc(scopeKey).collection('summaries').doc(docId).get();
    return snap.data() ?? {};
  } catch {
    return {};
  }
};

const aggregateAnalyticsSummaries = async (scopeKeys: string[]) => {
  const uniqueKeys = Array.from(new Set(scopeKeys.map(key => key.trim()).filter(Boolean)));
  const rows = await Promise.all(
    uniqueKeys.map(async scopeKey => {
      const [engagement, outbound] = await Promise.all([
        fetchSummaryDoc(scopeKey, 'engagement'),
        fetchSummaryDoc(scopeKey, 'outbound'),
      ]);
      return { engagement, outbound };
    }),
  );
  return rows.reduce(
    (acc, row) => {
      acc.aiResponsesSent += Number(row.engagement.repliesSent ?? row.engagement.replies ?? 0);
      acc.outboundMessages += Number(row.outbound.messagesSent ?? row.outbound.prospectsFound ?? row.outbound.prospectsContacted ?? 0);
      acc.leadConversions += Number(row.outbound.conversions ?? 0) + Number(row.engagement.conversions ?? 0);
      return acc;
    },
    { aiResponsesSent: 0, outboundMessages: 0, leadConversions: 0 },
  );
};

const KNOWN_CONNECTED_CLIENTS = [
  {
    userId: process.env.BWIN_USER_ID || '1zvY9nNyXMcfxdPQEyx0bIdK7r53',
    email: 'ball_analytics',
    socialAccounts: {
      facebook: { pageId: process.env.BWIN_FACEBOOK_PAGE_ID || '' },
      instagram: { accountId: process.env.BWIN_INSTAGRAM_ACCOUNT_ID || '' },
    },
  },
  {
    userId: 'tCE1FQ1cOFgdupOXP23mPUMQRAz1',
    email: 'shecaredoctor@gmail.com',
    socialAccounts: {
      facebook: { pageId: '1114686181730831' },
      instagram: { accountId: '17841437471047291' },
    },
  },
  {
    userId: '80bYIeiuukNFtUvXTUobXmfC7pu1',
    email: 'kingbrasio100@gmail.com',
    socialAccounts: {
      facebook: { pageId: '1154065791120794' },
      instagram: { accountId: '17841426388091930' },
    },
  },
  {
    userId: 'LVR7p3WzdFM51ds92Kacf6S40og2',
    socialAccounts: {
      facebook: { pageId: '1201086759745632' },
      instagram: { accountId: '17841433799368009' },
    },
  },
  {
    userId: 'acmVetCcOiTHeGk5D7eDYieamDF3',
    socialAccounts: {
      facebook: { pageId: '1033657279841186' },
      instagram: { accountId: '17841414110816982' },
    },
  },
  {
    userId: 'D1iNgjLKNRaQhH35M0NmGfw1LVD2',
    socialAccounts: {
      facebook: { pageId: '1191303874068642' },
      instagram: { accountId: '17841448080672466' },
    },
  },
  {
    userId: 'vzdH1DnfFLVjlY8bBgC26WACmmw2',
    socialAccounts: {
      facebook: { pageId: '1121885391014110' },
      instagram: { accountId: '17841412643148539' },
    },
  },
];

type LivePostRow = {
  id: string;
  userId?: string;
  platform: string;
  status: string;
  source?: string;
  timestamp: number;
};

const GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? 'v23.0';
const allowInsecureMetaTls =
  process.env.ALLOW_INSECURE_META_TLS === 'true' ||
  process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0' ||
  (process.env.NODE_ENV !== 'production' && process.env.ALLOW_INSECURE_META_TLS !== 'false');
const metaHttpsAgent = allowInsecureMetaTls ? new https.Agent({ rejectUnauthorized: false }) : undefined;
const rootMetaToken = () =>
  (
    process.env.META_GRAPH_TOKEN ??
    process.env.CLIENT_META_USER_TOKEN ??
    process.env.INSTAGRAM_ACCESS_TOKEN ??
    process.env.FACEBOOK_PAGE_TOKEN ??
    ''
  ).trim();

const fetchMetaRowsForClient = async (client: (typeof KNOWN_CONNECTED_CLIENTS)[number], weekStartMs: number) => {
  const token = rootMetaToken();
  if (!token) return [] as LivePostRow[];
  const rows: LivePostRow[] = [];
  const instagramId = String((client.socialAccounts.instagram as { accountId?: string } | undefined)?.accountId ?? '').trim();
  const pageId = String((client.socialAccounts.facebook as { pageId?: string } | undefined)?.pageId ?? '').trim();

  if (instagramId) {
    try {
      const response = await axios.get(`https://graph.facebook.com/${GRAPH_VERSION}/${instagramId}/media`, {
        ...(metaHttpsAgent ? { httpsAgent: metaHttpsAgent } : {}),
        params: {
          fields: 'id,timestamp,media_type',
          limit: 30,
          access_token: token,
        },
        timeout: 12000,
      });
      const media = (response.data?.data as Array<{ id?: string; timestamp?: string }> | undefined) ?? [];
      media.forEach(item => {
        const timestamp = toMillis(item.timestamp);
        if (!item.id || timestamp < weekStartMs) return;
        rows.push({
          id: `instagram_${item.id}`,
          userId: client.userId,
          platform: 'instagram',
          status: 'posted',
          source: 'meta_live',
          timestamp,
        });
      });
    } catch (error) {
      console.warn('[admin-metrics] live Instagram metrics failed', {
        userId: client.userId,
        error: (error as Error).message,
      });
    }
  }

  if (pageId) {
    try {
      const response = await axios.get(`https://graph.facebook.com/${GRAPH_VERSION}/${pageId}/posts`, {
        ...(metaHttpsAgent ? { httpsAgent: metaHttpsAgent } : {}),
        params: {
          fields: 'id,created_time',
          limit: 30,
          access_token: token,
        },
        timeout: 12000,
      });
      const posts = (response.data?.data as Array<{ id?: string; created_time?: string }> | undefined) ?? [];
      posts.forEach(item => {
        const timestamp = toMillis(item.created_time);
        if (!item.id || timestamp < weekStartMs) return;
        rows.push({
          id: `facebook_${item.id}`,
          userId: client.userId,
          platform: 'facebook',
          status: 'posted',
          source: 'meta_live',
          timestamp,
        });
      });
    } catch (error) {
      console.warn('[admin-metrics] live Facebook metrics failed', {
        userId: client.userId,
        error: (error as Error).message,
      });
    }
  }

  return rows;
};

const fetchLiveMetaPostRows = async (weekStartMs: number) => {
  const token = rootMetaToken();
  if (!token) return [] as LivePostRow[];
  const batches = await Promise.all(
    KNOWN_CONNECTED_CLIENTS.map(client =>
      timeout(fetchMetaRowsForClient(client, weekStartMs), 16000, `live Meta metrics ${client.userId}`).catch(error => {
        console.warn('[admin-metrics] live Meta client timeout', {
          userId: client.userId,
          error: (error as Error).message,
        });
        return [] as LivePostRow[];
      }),
    ),
  );
  return batches.flat();
};

async function getFirestoreAdminMetrics(): Promise<AdminMetrics> {
  const now = new Date();
  const last24h = Date.now() - 24 * 60 * 60 * 1000;
  let weekDates = buildDateRange(7);
  const weekStart = new Date();
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - 6);
  const weekStartTimestamp = admin.firestore.Timestamp.fromDate(weekStart);

  const [usersSnap, authMetadata] = await Promise.all([
    usersCollection.get(),
    fetchAuthUserMetadata().catch(error => {
      console.warn('[admin-metrics] Firebase Auth metadata unavailable', (error as Error).message);
      return new Map<string, { createdAt?: string; lastLoginAt?: string; email?: string; name?: string }>();
    }),
  ]);
  const users = usersSnap.docs.map(doc => {
    const data = doc.data() as Record<string, any>;
    const authData = authMetadata.get(doc.id) ?? authMetadata.get(data.uid ?? '');
    return {
      id: doc.id,
      uid: data.uid ?? doc.id,
      email: (data.email as string | undefined) ?? authData?.email,
      name: (data.name as string | undefined) ?? authData?.name,
      socialAccounts: (data.socialAccounts ?? {}) as Record<string, any>,
      createdAt: data.createdAt ?? authData?.createdAt,
      lastLoginAt: data.lastLoginAt ?? authData?.lastLoginAt,
    };
  });
  authMetadata.forEach((authData, uid) => {
    if (users.some(user => user.uid === uid || user.id === uid)) return;
    users.push({
      id: uid,
      uid,
      email: authData.email,
      name: authData.name,
      socialAccounts: {},
      createdAt: authData.createdAt,
      lastLoginAt: authData.lastLoginAt,
    });
  });

  const connectedPlatforms: Record<string, number> = {
    facebook: 0,
    instagram: 0,
    linkedin: 0,
    twitter: 0,
    whatsapp: 0,
    tiktok: 0,
    youtube: 0,
  };
  const connectedClients = new Set<string>();

  const signupsByDay = new Map<string, number>();
  weekDates.forEach(date => signupsByDay.set(date, 0));

  let activeSessions = 0;
  users.forEach(user => {
    const lastLogin = toMillis(user.lastLoginAt);
    if (lastLogin >= last24h) activeSessions += 1;

    const createdAtMs = toMillis(user.createdAt);
    if (createdAtMs) {
      const dateKey = new Date(createdAtMs).toISOString().slice(0, 10);
      if (signupsByDay.has(dateKey)) {
        signupsByDay.set(dateKey, (signupsByDay.get(dateKey) ?? 0) + 1);
      }
    }

    const accounts = user.socialAccounts ?? {};
    const facebookConnected = Boolean(accounts.facebook?.accessToken && accounts.facebook?.pageId);
    const instagramConnected = Boolean(accounts.instagram?.accessToken && accounts.instagram?.accountId);
    const linkedinConnected = Boolean(accounts.linkedin?.accessToken && accounts.linkedin?.urn);
    const twitterConnected = Boolean(accounts.twitter?.accessToken && accounts.twitter?.accessSecret);
    const whatsappConnected = Boolean(accounts.whatsapp?.accessToken || accounts.whatsapp?.token || accounts.whatsapp?.phoneId);

    if (facebookConnected) connectedPlatforms.facebook += 1;
    if (instagramConnected) connectedPlatforms.instagram += 1;
    if (linkedinConnected) connectedPlatforms.linkedin += 1;
    if (twitterConnected) connectedPlatforms.twitter += 1;
    if (whatsappConnected) connectedPlatforms.whatsapp += 1;
    if (facebookConnected || instagramConnected || linkedinConnected || twitterConnected || whatsappConnected) {
      connectedClients.add(user.uid);
    }
  });

  const integrationsSnap = await integrationsCollection.get();
  integrationsSnap.docs.forEach(doc => {
    const data = doc.data() as Record<string, any>;
    if (data.provider === 'tiktok' && data.accessTokenEncrypted) {
      connectedPlatforms.tiktok += 1;
      if (data.userId) connectedClients.add(data.userId as string);
    }
    if (data.provider === 'youtube' && data.refreshTokenEncrypted) {
      connectedPlatforms.youtube += 1;
      if (data.userId) connectedClients.add(data.userId as string);
    }
  });

  let postsSnap: FirebaseFirestore.QuerySnapshot<FirebaseFirestore.DocumentData>;
  try {
    postsSnap = await scheduledPostsCollection.where('postedAt', '>=', weekStartTimestamp).get();
  } catch (error) {
    if (!isMissingIndexError(error)) throw error;
    postsSnap = await scheduledPostsCollection.orderBy('createdAt', 'desc').limit(500).get();
  }

  const recentPosts: Array<Record<string, any> & { id: string }> = postsSnap.docs.map(doc => ({
    id: doc.id,
    ...(doc.data() as Record<string, any>),
  }));
  const postedPosts = recentPosts.filter(post => post.status === 'posted');
  const liveMetaPostRows = await timeout(fetchLiveMetaPostRows(weekStart.getTime()), 22000, 'admin live Meta posts').catch(error => {
    console.warn('[admin-metrics] live Meta posts unavailable', (error as Error).message);
    return [] as LivePostRow[];
  });

  const weeklyCounts = new Map<string, number>();
  weekDates.forEach(date => weeklyCounts.set(date, 0));
  const postLikeRows: LivePostRow[] = [
    ...postedPosts.map(post => ({
      id: post.id,
      userId: post.userId as string | undefined,
      platform: String(post.platform ?? 'social'),
      status: String(post.status ?? 'posted'),
      source: String(post.source ?? ''),
      timestamp: toMillis(post.postedAt || post.createdAt),
    })),
    ...liveMetaPostRows,
  ];
  const uniquePostLikeRows = Array.from(
    postLikeRows
      .filter(row => row.status === 'posted' && row.timestamp >= weekStart.getTime())
      .reduce((map, row) => map.set(row.id, row), new Map<string, LivePostRow>())
      .values(),
  );

  uniquePostLikeRows.forEach(post => {
    const dateKey = new Date(post.timestamp).toISOString().slice(0, 10);
    if (weeklyCounts.has(dateKey)) {
      weeklyCounts.set(dateKey, (weeklyCounts.get(dateKey) ?? 0) + 1);
    }
  });

  const weeklyPostVolume = weekDates.map(date => ({
    date,
    count: weeklyCounts.get(date) ?? 0,
  }));

  const userPostCounts = new Map<string, number>();
  uniquePostLikeRows.forEach(post => {
    const userId = post.userId;
    if (!userId) return;
    userPostCounts.set(userId, (userPostCounts.get(userId) ?? 0) + 1);
  });

  const userLookup = new Map<string, { email?: string; name?: string }>(
    users.map(user => [user.uid, { email: user.email, name: user.name }]),
  );

  const topActiveAccounts = Array.from(userPostCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([userId, posts]) => ({
      userId,
      posts,
      email: userLookup.get(userId)?.email,
      name: userLookup.get(userId)?.name,
    }));

  let autopostSnap: FirebaseFirestore.QuerySnapshot<FirebaseFirestore.DocumentData>;
  try {
    autopostSnap = await scheduledPostsCollection.where('createdAt', '>=', weekStartTimestamp).get();
  } catch (error) {
    if (!isMissingIndexError(error)) throw error;
    autopostSnap = await scheduledPostsCollection.orderBy('createdAt', 'desc').limit(500).get();
  }

  const autopostEntries: Array<Record<string, any>> = autopostSnap.docs
    .map(doc => doc.data() as Record<string, any>)
    .filter(entry => entry.source === 'autopost');

  const autopostPlatforms = ['instagram', 'instagram_story', 'facebook', 'facebook_story', 'linkedin'];
  const autopostSuccessRate: AdminMetrics['autopostSuccessRate'] = {};

  autopostPlatforms.forEach(platform => {
    const relevant = autopostEntries.filter(entry => entry.platform === platform);
    const posted = relevant.filter(entry => entry.status === 'posted').length;
    const failed = relevant.filter(entry => entry.status === 'failed' || entry.status === 'skipped_limit').length;
    const attempted = posted + failed;
    const rate = attempted ? Number((posted / attempted).toFixed(2)) : 0;
    autopostSuccessRate[platform] = { posted, failed, attempted, rate };
  });

  const scopeKeys = [resolveAnalyticsScopeKey(), ...users.map(user => user.uid), ...knownClientIds()];
  const summaryTotals = await aggregateAnalyticsSummaries(scopeKeys);
  const aiResponsesSent = summaryTotals.aiResponsesSent;
  const outboundMessages = summaryTotals.outboundMessages;
  const leadConversions = summaryTotals.leadConversions;
  const totalAiMessages = outboundMessages + aiResponsesSent;

  const [outboundRunsSnap, leadsSnap] = await Promise.all([
    firestore.collection('logs').doc('outbound').collection('runs').limit(500).get().catch(() => null),
    firestore.collection('leads').limit(1000).get().catch(() => null),
  ]);
  const crmCampaigns = outboundRunsSnap?.size ?? 0;
  const leadCount = leadsSnap?.size ?? 0;
  const imageGenerations = uniquePostLikeRows.filter(row => ['instagram', 'facebook', 'instagram_story', 'facebook_story'].includes(row.platform)).length;

  const liveLogins = users
    .map(user => ({
      id: `login_${user.uid}`,
      type: 'login' as const,
      label: `${user.email ?? user.name ?? 'Client'} logged in`,
      timestamp: toIso(user.lastLoginAt),
    }))
    .filter(item => item.timestamp)
    .sort((a, b) => (b.timestamp > a.timestamp ? 1 : -1))
    .slice(0, 8);

  const livePosts = uniquePostLikeRows
    .map(post => ({
      id: `post_${post.id}`,
      type: 'post' as const,
      label: `${post.platform ?? 'social'} post published`,
      timestamp: new Date(post.timestamp).toISOString(),
    }))
    .filter(item => item.timestamp)
    .sort((a, b) => (b.timestamp > a.timestamp ? 1 : -1))
    .slice(0, 8);

  let notificationsSnap: FirebaseFirestore.QuerySnapshot<FirebaseFirestore.DocumentData>;
  try {
    notificationsSnap = await notificationsCollection.orderBy('createdAt', 'desc').limit(20).get();
  } catch (error) {
    if (!isMissingIndexError(error)) throw error;
    notificationsSnap = await notificationsCollection.limit(20).get();
  }

  const liveReplies = notificationsSnap.docs
    .map(doc => ({ id: doc.id, ...(doc.data() as Record<string, any>) }) as Record<string, any> & { id: string })
    .filter(entry => entry.type === 'channel_message')
    .map(entry => ({
      id: `reply_${entry.id}`,
      type: 'reply' as const,
      label: `Reply sent on ${entry.channel ?? 'social'}`,
      timestamp: toIso(entry.sentAt ?? entry.createdAt),
    }))
    .filter(item => item.timestamp)
    .sort((a, b) => (b.timestamp > a.timestamp ? 1 : -1))
    .slice(0, 8);

  const liveFeed = [...liveLogins, ...livePosts, ...liveReplies]
    .sort((a, b) => (b.timestamp > a.timestamp ? 1 : -1))
    .slice(0, 12);

  return {
    summary: {
      totalClients: users.length,
      activeSessions,
      newSignupsThisWeek: weekDates.reduce((sum, date) => sum + (signupsByDay.get(date) ?? 0), 0),
      connectedClients: connectedClients.size,
    },
    signupsByDay: weekDates.map(date => ({ date, count: signupsByDay.get(date) ?? 0 })),
    connectedPlatforms,
    topActiveAccounts,
    autopostSuccessRate,
    weeklyPostVolume,
    aiResponsesSent,
    companyKpis: {
      totalAiMessages,
      imageGenerations,
      crmCampaigns,
      leadConversions: leadConversions || leadCount,
    },
    liveFeed,
    updatedAt: now.toISOString(),
  };
}

async function getSupabaseAdminMetrics(): Promise<AdminMetrics> {
  const now = new Date();
  let weekDates = buildDateRange(7);
  const weekStart = new Date();
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - 6);
  const weekStartMs = weekStart.getTime();

  const [socialRows, posts, socialLogs, engagement, outbound] = await Promise.all([
    timeout(supabaseFallbackService.getAllSocialAccounts(1000), 12000, 'admin social accounts fallback').catch(() => []),
    timeout(supabaseFallbackService.getRecentScheduledPosts(1000), 12000, 'admin scheduled posts fallback').catch(() => []),
    timeout(supabaseFallbackService.getRecentSocialLogs(1000), 12000, 'admin social logs fallback').catch(() => []),
    timeout(supabaseFallbackService.getMetricSummary('engagement'), 8000, 'admin engagement fallback').catch(() => null),
    timeout(supabaseFallbackService.getMetricSummary('outbound'), 8000, 'admin outbound fallback').catch(() => null),
  ]);

  const connectedPlatforms: Record<string, number> = {
    facebook: 0,
    instagram: 0,
    linkedin: 0,
    twitter: 0,
    whatsapp: 0,
    tiktok: 0,
    youtube: 0,
  };
  const connectedClients = new Set<string>();
  const clientEmails = new Map<string, string | undefined>();

  const accountRows = socialRows.length ? socialRows : KNOWN_CONNECTED_CLIENTS;

  accountRows.forEach(row => {
    if (!row.userId) return;
    clientEmails.set(row.userId, row.email ?? undefined);
    const accounts = row.socialAccounts ?? {};
    Object.entries(connectedPlatforms).forEach(([platform]) => {
      if (hasConnectedAccount((accounts as Record<string, unknown>)[platform])) {
        connectedPlatforms[platform] += 1;
        connectedClients.add(row.userId);
      }
    });
  });

  const allKnownClients = new Set<string>(accountRows.map(row => row.userId).filter(Boolean));
  posts.forEach(post => {
    if (post.userId) allKnownClients.add(post.userId);
  });
  socialLogs.forEach(log => {
    if (log.userId) allKnownClients.add(log.userId);
  });

  const postedPosts = posts.filter(post => {
    const postedAt = toMillis(post.postedAt ?? post.createdAt);
    return post.status === 'posted' && postedAt >= weekStartMs;
  });
  const recentLogs = socialLogs.filter(log => toMillis(log.postedAt) >= weekStartMs);
  let postLikeRows: LivePostRow[] = postedPosts.length
    ? postedPosts.map(post => ({
        id: post.id,
        userId: post.userId,
        platform: post.platform,
        status: post.status,
        source: post.source,
        timestamp: toMillis(post.postedAt ?? post.createdAt),
      }))
    : recentLogs.map(log => ({
        id: log.scheduledPostId,
        userId: log.userId,
        platform: log.platform,
        status: log.status,
        source: 'autopost',
        timestamp: toMillis(log.postedAt),
      }));
  if (!postLikeRows.length) {
    postLikeRows = await timeout(fetchLiveMetaPostRows(weekStartMs), 22000, 'admin live Meta fallback').catch(error => {
      console.warn('[admin-metrics] live Meta fallback unavailable', (error as Error).message);
      return [] as LivePostRow[];
    });
  }
  const latestPostMs = Math.max(0, ...postLikeRows.map(row => row.timestamp).filter(Boolean));
  if (latestPostMs) {
    const latestDateKey = new Date(latestPostMs).toISOString().slice(0, 10);
    if (!weekDates.includes(latestDateKey)) {
      weekDates = buildDateRange(7, new Date(latestPostMs));
    }
  }

  const weeklyCounts = new Map<string, number>();
  weekDates.forEach(date => weeklyCounts.set(date, 0));
  postLikeRows
    .filter(row => row.status === 'posted')
    .forEach(row => {
      const dateKey = new Date(row.timestamp).toISOString().slice(0, 10);
      if (weeklyCounts.has(dateKey)) {
        weeklyCounts.set(dateKey, (weeklyCounts.get(dateKey) ?? 0) + 1);
      }
    });

  const userPostCounts = new Map<string, number>();
  postLikeRows
    .filter(row => row.status === 'posted')
    .forEach(row => {
      if (!row.userId) return;
      userPostCounts.set(row.userId, (userPostCounts.get(row.userId) ?? 0) + 1);
    });

  const topActiveAccounts = Array.from(userPostCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([userId, posts]) => ({
      userId,
      posts,
      email: clientEmails.get(userId),
    }));

  const autopostPlatforms = ['instagram', 'instagram_story', 'facebook', 'facebook_story', 'linkedin'];
  const autopostSuccessRate: AdminMetrics['autopostSuccessRate'] = {};
  autopostPlatforms.forEach(platform => {
    const relevant = postLikeRows.filter(row => row.platform === platform);
    const posted = relevant.filter(row => row.status === 'posted').length;
    const failed = relevant.filter(row => row.status === 'failed' || row.status === 'skipped_limit').length;
    const attempted = posted + failed;
    autopostSuccessRate[platform] = {
      posted,
      failed,
      attempted,
      rate: attempted ? Number((posted / attempted).toFixed(2)) : 0,
    };
  });

  const engagementCounters = (engagement ?? {}) as Record<string, any>;
  const outboundCounters = (outbound ?? {}) as Record<string, any>;
  const aiResponsesSent = Number(engagementCounters.repliesSent ?? engagementCounters.replies ?? 0);
  const outboundMessages = Number(outboundCounters.messagesSent ?? outboundCounters.prospectsFound ?? 0);
  const leadConversions = Number(outboundCounters.conversions ?? 0) + Number(engagementCounters.conversions ?? 0);
  const totalAiMessages = outboundMessages + aiResponsesSent;
  const liveActiveClients = new Set(
    postLikeRows
      .filter(row => row.userId && Date.now() - row.timestamp <= 24 * 60 * 60 * 1000)
      .map(row => row.userId as string),
  );

  const liveFeed = postLikeRows
    .filter(row => row.timestamp)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 12)
    .map(row => ({
      id: `post_${row.id}`,
      type: 'post' as const,
      label: `${row.platform ?? 'social'} ${row.status === 'posted' ? 'post published' : 'post attempted'}`,
      timestamp: new Date(row.timestamp).toISOString(),
    }));

  return {
    summary: {
      totalClients: allKnownClients.size,
      activeSessions: liveActiveClients.size,
      newSignupsThisWeek: 0,
      connectedClients: connectedClients.size,
    },
    signupsByDay: weekDates.map(date => ({ date, count: 0 })),
    connectedPlatforms,
    topActiveAccounts,
    autopostSuccessRate,
    weeklyPostVolume: weekDates.map(date => ({ date, count: weeklyCounts.get(date) ?? 0 })),
    aiResponsesSent,
    companyKpis: {
      totalAiMessages,
      imageGenerations: 0,
      crmCampaigns: 0,
      leadConversions,
    },
    liveFeed,
    updatedAt: now.toISOString(),
  };
}

export async function getAdminMetrics(): Promise<AdminMetrics> {
  try {
    const metrics = await timeout(
      getFirestoreAdminMetrics(),
      Number(process.env.ADMIN_METRICS_FIRESTORE_TIMEOUT_MS ?? 10000),
      'admin Firestore metrics',
    );
    if (
      (metrics.summary.totalClients === 0 &&
        metrics.summary.connectedClients === 0 &&
        Object.values(metrics.connectedPlatforms).every(value => value === 0)) ||
      (metrics.weeklyPostVolume.every(item => item.count === 0) &&
        metrics.topActiveAccounts.length === 0 &&
        metrics.liveFeed.length === 0)
    ) {
      console.warn('[admin-metrics] Firestore metrics returned empty admin activity; using fallback');
      return getSupabaseAdminMetrics();
    }
    return metrics;
  } catch (error) {
    console.warn('[admin-metrics] Firestore metrics unavailable; using fallback', (error as Error).message);
    return getSupabaseAdminMetrics();
  }
}
