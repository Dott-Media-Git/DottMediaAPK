import { env } from '@services/env';
import { getIdToken } from '@services/firebase';

const API_BASE = env.apiUrl?.replace(/\/$/, '') ?? '';

async function authedFetch(path: string, options: RequestInit = {}) {
  if (!API_BASE) throw new Error('Missing API URL');
  const token = await getIdToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache',
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
  autoBoostPlatforms?: string[];
  autoBoostStrategy?: 'latest' | 'best_performing';
  performanceWindowHours?: number;
  minCandidateAgeMinutes?: number;
  autoBoostCooldownHours?: number;
  audience?: {
    countries?: string[];
    ageMin?: number;
    ageMax?: number;
  };
};

export type AdPerformanceRow = {
  id: string;
  adId?: string | null;
  platform?: string | null;
  sourcePostId?: string | null;
  status?: string | null;
  effectiveStatus?: string | null;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  inlineLinkClicks: number;
  messages: number;
  leads: number;
  ctr: number;
  cpc: number;
  cpm: number;
  createdAt?: string | null;
  updatedAt?: string | null;
  errorMessage?: string | null;
};

export type AdPerformance = {
  generatedAt: string;
  lookbackDays: number;
  currency: string;
  summary: {
    spend: number;
    impressions: number;
    reach: number;
    clicks: number;
    inlineLinkClicks: number;
    messages: number;
    leads: number;
    active: number;
    paused: number;
    failed: number;
    other: number;
    ctr: number;
  };
  rows: AdPerformanceRow[];
};

export type MetaAdsConnection = {
  endpoint: string;
  mcpConnected: boolean;
  mcpError?: string | null;
  graphConnected: boolean;
  accountCount: number;
  selectedAdAccountId?: string | null;
  provider: 'meta_mcp' | 'meta_graph' | 'none';
};

export type MetaAdsPolicy = {
  dailySpendLimitUsd: number;
  perActionLimitUsd: number;
  requireApproval: boolean;
  allowActivation: boolean;
  allowBudgetChanges: boolean;
};

export type MetaAdsApproval = {
  id: string;
  action: 'create_campaign_draft' | 'activate_ad' | 'pause_ad' | 'update_budget' | 'mcp_tool';
  payload: Record<string, any>;
  source: string;
  status: string;
  createdAt?: string | null;
  errorMessage?: string;
};

export type MetaAdsAuditEntry = {
  id: string;
  action: string;
  status: string;
  details?: Record<string, any>;
  createdAt?: string | null;
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

export const fetchAdPerformance = async (limit = 12) =>
  authedFetch(`/api/meta-ads/performance?limit=${limit}`) as Promise<{ performance: AdPerformance }>;

export const fetchMetaAdsConnection = async () =>
  authedFetch('/api/meta-ads/connection') as Promise<{ connection: MetaAdsConnection }>;

export const fetchMetaAdsMcpTools = async () =>
  authedFetch('/api/meta-ads/mcp/tools') as Promise<{ connected: boolean; tools: Array<{ name: string; description?: string; inputSchema?: Record<string, any> }>; message?: string }>;

export const saveMetaAdsConnection = async (payload: { accessToken?: string; selectedAdAccountId?: string }) =>
  authedFetch('/api/meta-ads/connection', { method: 'POST', body: JSON.stringify(payload) }) as Promise<{ ok: boolean; connection: MetaAdsConnection }>;

export const fetchMetaAdsPolicy = async () =>
  authedFetch('/api/meta-ads/policy') as Promise<{ policy: MetaAdsPolicy }>;

export const saveMetaAdsPolicy = async (policy: Partial<MetaAdsPolicy>) =>
  authedFetch('/api/meta-ads/policy', { method: 'POST', body: JSON.stringify(policy) }) as Promise<{ ok: boolean; policy: MetaAdsPolicy }>;

export const requestMetaAdsAction = async (action: MetaAdsApproval['action'], payload: Record<string, any>, source = 'ads_manager') =>
  authedFetch('/api/meta-ads/actions', { method: 'POST', body: JSON.stringify({ action, payload, source }) }) as Promise<{ ok: boolean; approval: MetaAdsApproval }>;

export const fetchMetaAdsApprovals = async (limit = 30) =>
  authedFetch(`/api/meta-ads/approvals?limit=${limit}`) as Promise<{ approvals: MetaAdsApproval[] }>;

export const decideMetaAdsApproval = async (id: string, decision: 'approve' | 'reject') =>
  authedFetch(`/api/meta-ads/approvals/${encodeURIComponent(id)}/${decision}`, { method: 'POST' }) as Promise<{ ok: boolean; approval: MetaAdsApproval }>;

export const fetchMetaAdsAudit = async (limit = 50) =>
  authedFetch(`/api/meta-ads/audit?limit=${limit}`) as Promise<{ audit: MetaAdsAuditEntry[] }>;
