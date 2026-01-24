import admin from 'firebase-admin';
import { firestore } from '../../db/firestore';
import { resolveAnalyticsScopeKey } from '../analyticsScope';

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

const buildDateRange = (days: number) => {
  const result: string[] = [];
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  for (let i = 0; i < days; i += 1) {
    const date = new Date(start.getTime());
    date.setDate(start.getDate() + i);
    result.push(date.toISOString().slice(0, 10));
  }
  return result;
};

export async function getAdminMetrics(): Promise<AdminMetrics> {
  const now = new Date();
  const last24h = Date.now() - 24 * 60 * 60 * 1000;
  const weekDates = buildDateRange(7);
  const weekStart = new Date();
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - 6);
  const weekStartTimestamp = admin.firestore.Timestamp.fromDate(weekStart);

  const usersSnap = await usersCollection.get();
  const users = usersSnap.docs.map(doc => {
    const data = doc.data() as Record<string, any>;
    return {
      id: doc.id,
      uid: data.uid ?? doc.id,
      email: data.email as string | undefined,
      name: data.name as string | undefined,
      socialAccounts: (data.socialAccounts ?? {}) as Record<string, any>,
      createdAt: data.createdAt,
      lastLoginAt: data.lastLoginAt,
    };
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

  const weeklyCounts = new Map<string, number>();
  weekDates.forEach(date => weeklyCounts.set(date, 0));
  postedPosts.forEach(post => {
    const dateKey = new Date(toMillis(post.postedAt || post.createdAt)).toISOString().slice(0, 10);
    if (weeklyCounts.has(dateKey)) {
      weeklyCounts.set(dateKey, (weeklyCounts.get(dateKey) ?? 0) + 1);
    }
  });

  const weeklyPostVolume = weekDates.map(date => ({
    date,
    count: weeklyCounts.get(date) ?? 0,
  }));

  const userPostCounts = new Map<string, number>();
  postedPosts.forEach(post => {
    const userId = post.userId as string | undefined;
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

  const scopeKey = resolveAnalyticsScopeKey();
  const summaries = firestore.collection('analytics').doc(scopeKey).collection('summaries');
  const [engagementDoc, outboundDoc] = await Promise.all([
    summaries.doc('engagement').get(),
    summaries.doc('outbound').get(),
  ]);

  const engagement = engagementDoc.data() ?? {};
  const outbound = outboundDoc.data() ?? {};
  const aiResponsesSent = Number(engagement.repliesSent ?? engagement.replies ?? 0);
  const outboundMessages = Number(outbound.messagesSent ?? outbound.prospectsFound ?? 0);
  const leadConversions = Number(outbound.conversions ?? 0) + Number(engagement.conversions ?? 0);
  const totalAiMessages = outboundMessages + aiResponsesSent;

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

  const livePosts = postedPosts
    .map(post => ({
      id: `post_${post.id}`,
      type: 'post' as const,
      label: `${post.platform ?? 'social'} post published`,
      timestamp: toIso(post.postedAt),
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
      totalClients: usersSnap.size,
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
      imageGenerations: 0,
      crmCampaigns: 0,
      leadConversions,
    },
    liveFeed,
    updatedAt: now.toISOString(),
  };
}
