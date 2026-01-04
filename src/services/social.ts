import { env } from '@services/env';
import { getIdToken, isFirebaseEnabled, realtimeDb } from '@services/firebase';
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  type Unsubscribe,
  where
} from 'firebase/firestore';

const API_BASE = env.apiUrl?.replace(/\/$/, '') ?? '';

async function authedFetch(path: string, options: RequestInit = {}) {
  if (!API_BASE) throw new Error('Missing API URL');
  const token = await getIdToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed with status ${response.status}`);
  }
  return response.json();
}

export const generateContent = async (payload: { prompt: string; businessType: string }) => {
  const body = JSON.stringify({ ...payload });
  return authedFetch('/api/content/generate', { method: 'POST', body });
};

export const runAutoPostNow = async (payload: {
  prompt?: string;
  businessType?: string;
  platforms?: string[];
  videoUrl?: string;
  videoUrls?: string[];
  videoTitle?: string;
  youtubePrivacyStatus?: 'private' | 'public' | 'unlisted';
  youtubeVideoUrl?: string;
  youtubeVideoUrls?: string[];
  tiktokVideoUrl?: string;
  tiktokVideoUrls?: string[];
  instagramReelsVideoUrl?: string;
  instagramReelsVideoUrls?: string[];
  reelsIntervalHours?: number;
}) => {
  const body = JSON.stringify(payload ?? {});
  return authedFetch('/api/autopost/runNow', { method: 'POST', body });
};

export const schedulePost = async (payload: any) => {
  const body = JSON.stringify(payload);
  return authedFetch('/api/posts/schedule', { method: 'POST', body });
};

export type SocialPost = {
  id: string;
  platform: string;
  status: string;
  scheduledFor?: { seconds: number };
  postedAt?: { seconds: number };
  errorMessage?: string;
  createdAt?: { seconds: number };
};

export type SocialHistory = {
  posts: SocialPost[];
  summary: { perPlatform: Record<string, number>; byStatus: Record<string, number> };
  daily: any[];
};

export type SocialConnectionStatus = {
  facebook: boolean;
  instagram: boolean;
  linkedin: boolean;
  twitter: boolean;
  tiktok: boolean;
  youtube: boolean;
};

export const fetchSocialHistory = async (options?: {
  userId?: string;
  noCache?: boolean;
}): Promise<SocialHistory & { userId?: string }> => {
  const params = new URLSearchParams();
  if (options?.userId) params.set('userId', options.userId);
  if (options?.noCache) params.set('ts', Date.now().toString());
  const query = params.toString();
  return authedFetch(`/api/social/history${query ? `?${query}` : ''}`, {
    cache: options?.noCache ? 'no-store' : 'default',
    headers: options?.noCache ? { 'Cache-Control': 'no-cache' } : undefined,
  });
};

export const fetchSocialStatus = async (): Promise<{ status: SocialConnectionStatus }> => {
  return authedFetch('/api/social/status');
};

export const saveSocialCredentials = async (userId: string, credentials: any) => {
  const body = JSON.stringify({ userId, credentials });
  return authedFetch('/api/social/credentials', { method: 'POST', body });
};

const toSeconds = (timestamp: any): number | undefined => {
  if (!timestamp) return undefined;
  if (typeof timestamp.seconds === 'number') return timestamp.seconds;
  if (typeof timestamp._seconds === 'number') return timestamp._seconds;
  if (typeof timestamp.toDate === 'function') return Math.floor(timestamp.toDate().getTime() / 1000);
  return undefined;
};

export const subscribeSocialHistory = (
  userId: string,
  onData: (history: SocialHistory) => void,
  onError?: (err: unknown) => void
): Unsubscribe | null => {
  if (!isFirebaseEnabled || !realtimeDb || !userId) return null;

  const historyQuery = query(
    collection(realtimeDb, 'scheduledPosts'),
    where('userId', '==', userId),
    orderBy('createdAt', 'desc'),
    limit(120)
  );

  return onSnapshot(
    historyQuery,
    snap => {
      const posts: SocialPost[] = snap.docs.map(doc => {
        const data = doc.data() as any;
        const scheduledSeconds = toSeconds(data.scheduledFor);
        const postedSeconds = toSeconds(data.postedAt);
        const createdSeconds = toSeconds(data.createdAt);
        return {
          id: doc.id,
          platform: (data.platform as string) ?? 'unknown',
          status: (data.status as string) ?? 'pending',
          scheduledFor: scheduledSeconds ? { seconds: scheduledSeconds } : undefined,
          postedAt: postedSeconds ? { seconds: postedSeconds } : undefined,
          createdAt: createdSeconds ? { seconds: createdSeconds } : undefined,
          errorMessage: (data.errorMessage as string | undefined) ?? undefined
        };
      });

      const summary = posts.reduce(
        (acc, post) => {
          acc.perPlatform[post.platform] = (acc.perPlatform[post.platform] ?? 0) + 1;
          acc.byStatus[post.status] = (acc.byStatus[post.status] ?? 0) + 1;
          return acc;
        },
        { perPlatform: {} as Record<string, number>, byStatus: {} as Record<string, number> }
      );

      onData({ posts, summary, daily: [] });
    },
    err => onError?.(err)
  );
};
