import { env } from '@services/env';
import { getIdToken } from '@services/firebase';

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

export type MetaAdAccount = {
  id: string;
  name?: string;
  account_status?: number;
  currency?: string;
  timezone_name?: string;
  amount_spent?: string;
  balance?: string;
};

export type BoostRule = {
  userId?: string;
  enabled?: boolean;
  mode?: 'manual' | 'auto';
  adAccountId?: string | null;
  pageId?: string | null;
  instagramActorId?: string | null;
  whatsappNumber?: string | null;
  whatsappLink?: string | null;
  dailyBudgetUsd?: number;
  dailyBudgetMinor?: number;
  durationHours?: number;
  currency?: string | null;
  statusOnCreate?: 'PAUSED' | 'ACTIVE';
  audience?: {
    countries?: string[];
    ageMin?: number;
    ageMax?: number;
  };
};

export const fetchMetaAdAccounts = async () =>
  authedFetch('/api/meta-ads/ad-accounts') as Promise<{ accounts: MetaAdAccount[] }>;

export const fetchBoostRule = async () =>
  authedFetch('/api/meta-ads/boost-rule') as Promise<{ rule: BoostRule }>;

export const saveBoostRule = async (rule: BoostRule) =>
  authedFetch('/api/meta-ads/boost-rule', {
    method: 'POST',
    body: JSON.stringify(rule),
  }) as Promise<{ ok: boolean; rule: BoostRule }>;

export const boostMetaPost = async (payload: {
  platform?: string;
  postId: string;
  caption?: string;
  imageUrl?: string;
  adAccountId?: string | null;
  dailyBudgetUsd?: number;
  dailyBudgetMinor?: number;
  durationHours?: number;
  whatsappNumber?: string | null;
}) =>
  authedFetch('/api/meta-ads/boost-post', {
    method: 'POST',
    body: JSON.stringify(payload),
  }) as Promise<{ ok: boolean; run: any }>;

export const fetchAdRuns = async (limit = 25) =>
  authedFetch(`/api/meta-ads/runs?limit=${limit}`) as Promise<{ runs: any[] }>;
