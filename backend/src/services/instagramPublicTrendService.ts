import axios from 'axios';
import admin from 'firebase-admin';
import { firestore } from '../db/firestore';
import { TrendCandidate, TrendItem } from '../types/footballTrends';

const GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? 'v23.0';
const GRAPH_BASE_URL = `https://graph.facebook.com/${GRAPH_VERSION}`;
const MAX_HASHTAGS = 5;
const MAX_MEDIA_PER_HASHTAG = 25;
const CACHE_TTL_MS = 10 * 60 * 1000;

type InstagramTrendConfig = {
  enabled: boolean;
  hashtags: string[];
};

type CachedScan = {
  expiresAt: number;
  value: InstagramPublicTrendResult;
};

export type InstagramPublicTrendResult = {
  candidates: TrendCandidate[];
  hashtags: string[];
  account?: { id: string; username?: string };
};

type StoredSocialAccount = {
  accessToken?: string;
  userAccessToken?: string;
  accountId?: string;
  pageId?: string;
  username?: string;
  provider?: string;
};

const cache = new Map<string, CachedScan>();
const users = firestore.collection('users');

const normalizeHashtag = (value: string) =>
  value
    .trim()
    .replace(/^#+/, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '');

export const normalizeInstagramHashtags = (values: unknown): string[] => {
  const input = Array.isArray(values) ? values : typeof values === 'string' ? values.split(/[\s,]+/) : [];
  const unique: string[] = [];
  for (const value of input) {
    if (typeof value !== 'string') continue;
    const hashtag = normalizeHashtag(value);
    if (hashtag.length < 2 || hashtag.length > 64 || unique.includes(hashtag)) continue;
    unique.push(hashtag);
    if (unique.length >= MAX_HASHTAGS) break;
  }
  return unique;
};

export const getInstagramPublicTrendConfig = async (userId: string): Promise<InstagramTrendConfig> => {
  const snapshot = await users.doc(userId).get();
  const data = snapshot.data() as { instagramTrendHashtags?: unknown; instagramTrendEnabled?: unknown } | undefined;
  const hashtags = normalizeInstagramHashtags(data?.instagramTrendHashtags);
  return {
    enabled: data?.instagramTrendEnabled === true && hashtags.length > 0,
    hashtags,
  };
};

export const saveInstagramPublicTrendConfig = async (
  userId: string,
  input: { enabled?: boolean; hashtags?: unknown },
): Promise<InstagramTrendConfig> => {
  const existing = await getInstagramPublicTrendConfig(userId);
  const hashtags = input.hashtags === undefined ? existing.hashtags : normalizeInstagramHashtags(input.hashtags);
  const enabled = input.enabled === undefined ? existing.enabled : Boolean(input.enabled);
  await users.doc(userId).set(
    {
      instagramTrendHashtags: hashtags,
      instagramTrendEnabled: enabled && hashtags.length > 0,
      instagramTrendUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  return { enabled: enabled && hashtags.length > 0, hashtags };
};

const readFacebookCredentials = (socialAccounts: Record<string, unknown> | undefined) => {
  const facebook = (socialAccounts?.facebook ?? {}) as StoredSocialAccount;
  const instagram = (socialAccounts?.instagram ?? {}) as StoredSocialAccount;
  const facebookAccessToken = String(facebook.userAccessToken ?? facebook.accessToken ?? '').trim();
  const instagramAccessToken = String(instagram.accessToken ?? '').trim();
  const usesFacebookLogin = instagram.provider !== 'instagram_login';
  const accessToken = facebookAccessToken || (usesFacebookLogin ? instagramAccessToken : '');
  const pageId = String(facebook.pageId ?? '').trim();
  const fallbackInstagramId = String(instagram.accountId ?? '').trim();
  if (!accessToken || (!pageId && !fallbackInstagramId)) return null;
  return { accessToken, pageId, fallbackInstagramId };
};

const graphErrorMessage = (error: unknown) => {
  if (!axios.isAxiosError(error)) return 'Instagram public content request failed.';
  const detail = error.response?.data?.error?.message;
  const code = error.response?.data?.error?.code;
  if (code === 10 || code === 200 || code === 190) {
    return 'Instagram public trends are unavailable for this connection. Reconnect Facebook and grant Instagram basic and Page engagement permissions.';
  }
  return typeof detail === 'string' ? detail : `Instagram public content request failed (${error.response?.status ?? 'unknown'}).`;
};

const resolveInstagramAccount = async (
  credentials: { accessToken: string; pageId: string; fallbackInstagramId: string },
) => {
  if (!credentials.pageId) {
    return { id: credentials.fallbackInstagramId };
  }
  const response = await axios.get(`${GRAPH_BASE_URL}/${credentials.pageId}`, {
    params: {
      fields: 'instagram_business_account{id,username}',
      access_token: credentials.accessToken,
    },
    timeout: 12000,
  });
  const profile = response.data?.instagram_business_account;
  if (!profile?.id) {
    throw new Error('No Instagram Professional Account is linked to the connected Facebook Page.');
  }
  return { id: String(profile.id), username: profile.username ? String(profile.username) : undefined };
};

const fetchHashtagId = async (userId: string, accessToken: string, hashtag: string) => {
  const response = await axios.get(`${GRAPH_BASE_URL}/ig_hashtag_search`, {
    params: { user_id: userId, q: hashtag, access_token: accessToken },
    timeout: 12000,
  });
  const id = response.data?.data?.[0]?.id;
  return id ? String(id) : null;
};

const fetchTopMedia = async (userId: string, accessToken: string, hashtagId: string, hashtag: string) => {
  const response = await axios.get(`${GRAPH_BASE_URL}/${hashtagId}/top_media`, {
    params: {
      user_id: userId,
      fields: 'id,caption,media_type,permalink,timestamp,username,like_count,comments_count',
      limit: MAX_MEDIA_PER_HASHTAG,
      access_token: accessToken,
    },
    timeout: 12000,
  });
  const rows = Array.isArray(response.data?.data) ? response.data.data : [];
  return rows
    .map((row: Record<string, unknown>) => {
      const id = row.id ? String(row.id) : '';
      if (!id) return null;
      const caption = typeof row.caption === 'string' ? row.caption.trim() : '';
      const username = typeof row.username === 'string' ? row.username.trim() : '';
      const publishedAt = typeof row.timestamp === 'string' ? row.timestamp : undefined;
      const likes = typeof row.like_count === 'number' ? row.like_count : 0;
      const comments = typeof row.comments_count === 'number' ? row.comments_count : 0;
      const item: TrendItem = {
        title: caption || `Public Instagram post for #${hashtag}`,
        summary: username ? `Posted by @${username}` : undefined,
        link: typeof row.permalink === 'string' ? row.permalink : undefined,
        publishedAt,
        sourceId: `instagram-hashtag-${hashtag}`,
        sourceLabel: `Instagram #${hashtag}`,
      };
      return { item, score: likes + comments * 2 };
    })
    .filter(Boolean) as Array<{ item: TrendItem; score: number }>;
};

const scoreItems = (items: Array<{ item: TrendItem; score: number }>) => {
  const now = Date.now();
  return items.reduce((total, entry) => {
    const timestamp = entry.item.publishedAt ? Date.parse(entry.item.publishedAt) : NaN;
    const ageHours = Number.isNaN(timestamp) ? 72 : Math.max(0, (now - timestamp) / 3600000);
    const recency = Math.max(0, 24 - ageHours);
    return total + Math.min(entry.score / 1000, 20) + recency;
  }, 0);
};

export const scanInstagramPublicTrends = async (
  userId: string,
  requestedHashtags?: unknown,
): Promise<InstagramPublicTrendResult> => {
  const config = await getInstagramPublicTrendConfig(userId);
  const hashtags = normalizeInstagramHashtags(requestedHashtags ?? config.hashtags);
  if (!hashtags.length) return { candidates: [], hashtags: [] };

  const cacheKey = `${userId}:${hashtags.join(',')}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const snapshot = await users.doc(userId).get();
  const data = snapshot.data() as { socialAccounts?: Record<string, unknown> } | undefined;
  const credentials = readFacebookCredentials(data?.socialAccounts);
  if (!credentials) {
    const error = new Error('Connect Facebook with an Instagram Professional Account to search public Instagram trends.');
    (error as Error & { code?: string }).code = 'INSTAGRAM_PUBLIC_TRENDS_NOT_CONNECTED';
    throw error;
  }

  try {
    const account = await resolveInstagramAccount(credentials);
    const candidates: TrendCandidate[] = [];
    for (const hashtag of hashtags) {
      const hashtagId = await fetchHashtagId(account.id, credentials.accessToken, hashtag);
      if (!hashtagId) continue;
      const media = await fetchTopMedia(account.id, credentials.accessToken, hashtagId, hashtag);
      if (!media.length) continue;
      const items = media.map(entry => entry.item);
      candidates.push({
        topic: `#${hashtag}`,
        score: scoreItems(media),
        sources: [`Instagram #${hashtag}`],
        publishedAt: (() => {
          const dates = items.map(item => item.publishedAt).filter(Boolean).sort();
          return dates.length ? dates[dates.length - 1] : undefined;
        })(),
        sampleTitles: items.slice(0, 3).map(item => item.title).filter(Boolean),
        items,
      });
    }
    const result = { candidates: candidates.sort((a, b) => b.score - a.score), hashtags, account };
    cache.set(cacheKey, { value: result, expiresAt: Date.now() + CACHE_TTL_MS });
    return result;
  } catch (error) {
    const message = graphErrorMessage(error);
    const wrapped = new Error(message);
    (wrapped as Error & { code?: string }).code = 'INSTAGRAM_PUBLIC_TRENDS_API_ERROR';
    throw wrapped;
  }
};
