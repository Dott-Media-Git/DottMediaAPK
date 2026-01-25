import { env } from '@services/env';
import { getIdToken } from '@services/firebase';

export type TrendCandidate = {
  topic: string;
  score?: number;
  sources: string[];
  publishedAt?: string;
  sampleTitles?: string[];
};

export type TrendSourceInput = {
  url: string;
  label?: string;
  type?: 'rss' | 'atom' | 'html';
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