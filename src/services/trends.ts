import { env } from '@services/env';
import { getIdToken } from '@services/firebase';

export type TrendCandidate = {
  topic: string;
  score?: number;
  sources: string[];
  publishedAt?: string;
  sampleTitles?: string[];
  items?: Array<{
    title: string;
    link?: string;
    summary?: string;
    publishedAt?: string;
    sourceLabel?: string;
  }>;
};

export type TrendSourceInput = {
  url: string;
  label?: string;
  type?: 'rss' | 'atom' | 'html';
};

export type InstagramTrendConfig = {
  enabled: boolean;
  hashtags: string[];
};

export type InstagramTrendResponse = {
  candidates: TrendCandidate[];
  hashtags: string[];
  account?: { id: string; username?: string };
};

type TrendScanResponse = {
  scope: 'global' | 'football';
  candidates: TrendCandidate[];
  sources: TrendSourceInput[];
};

const buildApiUrl = (path: string) => {
  const base = env.apiUrl?.replace(/\/$/, '') ?? '';
  if (!base) return '';
  return `${base}${path.startsWith('/') ? '' : '/'}${path}`;
};

const authHeader = async (userId: string) => {
  const token = await getIdToken();
  if (token) return `Bearer ${token}`;
  if (userId) return `Bearer mock-${userId}`;
  return null;
};

export const fetchTrendingNews = async (
  userId: string,
  options?: { maxCandidates?: number; maxAgeHours?: number },
): Promise<TrendScanResponse> => {
  const endpoint = buildApiUrl('/api/trends/scan');
  if (!endpoint) {
    return { scope: 'global', candidates: [], sources: [] };
  }
  const authorization = await authHeader(userId);
  if (!authorization) {
    throw new Error('Missing auth token for trends');
  }
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authorization,
    },
    body: JSON.stringify(options ?? {}),
  });
  if (!response.ok) {
    throw new Error(`Trends API failed with status ${response.status}`);
  }
  return response.json();
};

export const fetchTrendSources = async (userId: string): Promise<{ sources: TrendSourceInput[] }> => {
  const endpoint = buildApiUrl('/api/trends/sources');
  if (!endpoint) {
    return { sources: [] };
  }
  const authorization = await authHeader(userId);
  if (!authorization) {
    throw new Error('Missing auth token for sources');
  }
  const response = await fetch(endpoint, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authorization,
    },
  });
  if (!response.ok) {
    throw new Error(`Sources API failed with status ${response.status}`);
  }
  return response.json();
};

export const saveTrendSources = async (userId: string, sources: TrendSourceInput[]) => {
  const endpoint = buildApiUrl('/api/trends/sources');
  if (!endpoint) {
    return { sources: [] };
  }
  const authorization = await authHeader(userId);
  if (!authorization) {
    throw new Error('Missing auth token for sources');
  }
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authorization,
    },
    body: JSON.stringify({ sources }),
  });
  if (!response.ok) {
    throw new Error(`Sources API failed with status ${response.status}`);
  }
  return response.json();
};

export const fetchInstagramTrendConfig = async (userId: string): Promise<InstagramTrendConfig> => {
  const endpoint = buildApiUrl('/api/trends/instagram/config');
  if (!endpoint) return { enabled: false, hashtags: [] };
  const authorization = await authHeader(userId);
  if (!authorization) throw new Error('Missing auth token for Instagram trends');
  const response = await fetch(endpoint, { headers: { Authorization: authorization } });
  if (!response.ok) throw new Error(`Instagram trend config failed with status ${response.status}`);
  return response.json();
};

export const saveInstagramTrendConfig = async (
  userId: string,
  config: { enabled?: boolean; hashtags: string[] },
): Promise<InstagramTrendConfig> => {
  const endpoint = buildApiUrl('/api/trends/instagram/config');
  if (!endpoint) return { enabled: false, hashtags: [] };
  const authorization = await authHeader(userId);
  if (!authorization) throw new Error('Missing auth token for Instagram trends');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authorization },
    body: JSON.stringify(config),
  });
  if (!response.ok) throw new Error(`Instagram trend config failed with status ${response.status}`);
  return response.json();
};

export const scanInstagramTrends = async (
  userId: string,
  hashtags?: string[],
): Promise<InstagramTrendResponse> => {
  const endpoint = buildApiUrl('/api/trends/instagram/scan');
  if (!endpoint) return { candidates: [], hashtags: [] };
  const authorization = await authHeader(userId);
  if (!authorization) throw new Error('Missing auth token for Instagram trends');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authorization },
    body: JSON.stringify(hashtags?.length ? { hashtags } : {}),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.message ?? `Instagram trends failed with status ${response.status}`);
  }
  return response.json();
};
