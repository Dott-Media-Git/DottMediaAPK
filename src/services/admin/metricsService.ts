import { adminFetch } from './base';
import { getIdToken } from '@services/firebase';

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

export const fetchAdminMetrics = async (): Promise<AdminMetrics> => {
  const payload = await adminFetch('/admin/metrics');
  const metrics = payload.metrics as AdminMetrics;
  if (!shouldUseLocalAdminMetricsFallback(metrics)) return metrics;
  return (await fetchLocalAdminMetricsFallback()) ?? metrics;
};

const isEmptyAdminMetrics = (metrics: AdminMetrics) =>
  metrics.summary.totalClients === 0 &&
  metrics.summary.connectedClients === 0 &&
  metrics.weeklyPostVolume.every(point => point.count === 0) &&
  metrics.topActiveAccounts.length === 0 &&
  metrics.liveFeed.length === 0;

const shouldUseLocalAdminMetricsFallback = (metrics: AdminMetrics) => {
  if (!isEmptyAdminMetrics(metrics)) return false;
  if (typeof window === 'undefined') return false;
  const hostname = window.location?.hostname ?? '';
  return hostname === 'localhost' || hostname === '127.0.0.1';
};

const fetchLocalAdminMetricsFallback = async () => {
  try {
    const token = await getIdToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch('http://localhost:4000/admin/metrics', { headers });
    if (!response.ok) return null;
    const payload = await response.json();
    return payload.metrics as AdminMetrics;
  } catch (error) {
    console.warn('Local admin metrics fallback failed', error);
    return null;
  }
};
