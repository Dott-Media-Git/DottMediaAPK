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

async function authedMultipartFetch(path: string, body: FormData) {
  if (!API_BASE) throw new Error('Missing API URL');
  const token = await getIdToken();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers,
    body,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed with status ${response.status}`);
  }
  return response.json();
}

export const generateContent = async (payload: {
  userId?: string;
  prompt: string;
  businessType: string;
  generateVideo?: boolean;
}) => {
  const body = JSON.stringify({ ...payload });
  return authedFetch('/api/content/generate', { method: 'POST', body });
};

export type GeneratedSocialContent = {
  images: string[];
  caption_instagram: string;
  caption_linkedin: string;
  caption_x: string;
  hashtags_instagram: string;
  hashtags_generic: string;
  image_error?: string;
  video_url?: string;
  video_error?: string;
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
  generatedContent?: GeneratedSocialContent;
}) => {
  const body = JSON.stringify(payload ?? {});
  return authedFetch('/api/autopost/runNow', { method: 'POST', body });
};

export const schedulePost = async (payload: any) => {
  const body = JSON.stringify(payload);
  return authedFetch('/api/posts/schedule', { method: 'POST', body });
};

export type UploadedMediaFile = {
  name: string;
  url: string;
  kind: 'image' | 'video';
  mimeType?: string;
  size?: number;
};

export const uploadMediaFiles = async (files: File[]) => {
  const formData = new FormData();
  files.forEach(file => formData.append('files', file));
  return authedMultipartFetch('/api/media/upload', formData) as Promise<{ files: UploadedMediaFile[] }>;
};

export type SocialPost = {
  id: string;
  platform: string;
  status: string;
  caption?: string;
  scheduledFor?: { seconds: number };
  postedAt?: { seconds: number };
  errorMessage?: string;
  createdAt?: { seconds: number };
  videoUrl?: string;
  imageUrls?: string[];
};

export type SocialTodaySummary = {
  date: string;
  totalPosted: number;
  videoPosts: number;
  perPlatform: Record<string, number>;
};

export type SocialHistory = {
  posts: SocialPost[];
  summary: { perPlatform: Record<string, number>; byStatus: Record<string, number> };
  todayPosts?: SocialPost[];
  todaySummary?: SocialTodaySummary;
  daily: any[];
};

export type SocialConnectionStatus = {
  facebook: boolean;
  instagram: boolean;
  threads: boolean;
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
