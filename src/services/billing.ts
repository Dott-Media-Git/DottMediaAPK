import { env } from '@services/env';
import { getIdToken } from '@services/firebase';

const API_BASE = env.apiUrl?.replace(/\/$/, '') ?? '';

export type BillingPlan = {
  id: string;
  name: string;
  description: string;
  priceMonthlyCents: number | null;
  limits: Record<string, number | boolean | null>;
  stripeConfigured: boolean;
};

export type BillingOverview = {
  plan: BillingPlan;
  month: string;
  usage: Record<string, number>;
  credits: Record<string, number>;
};

export type FinancialAllocation = {
  id: string;
  planName: string;
  currency: string;
  grossRevenueCents: number;
  directCostReserveCents: number;
  grossProfitCents: number;
  operatingReserveCents: number;
  netProfitCents: number;
  providerCostReserveCents?: Record<string, number>;
};

async function billingFetch(path: string, options: RequestInit = {}) {
  if (!API_BASE) throw new Error('Missing API URL');
  const token = await getIdToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(payload.message || payload.error || `Request failed with status ${response.status}`);
  }
  return payload;
}

export const fetchBillingPlans = async (): Promise<BillingPlan[]> => {
  const payload = await billingFetch('/api/billing/plans');
  return payload.plans ?? [];
};

export const fetchBillingOverview = async (): Promise<BillingOverview> => {
  return billingFetch('/api/billing/overview');
};

export const startPlanCheckout = async (plan: string): Promise<{ checkoutUrl?: string }> => {
  return billingFetch('/api/billing/checkout', {
    method: 'POST',
    body: JSON.stringify({
      plan,
      successUrl: typeof window !== 'undefined' ? `${window.location.origin}/subscription?checkout=success` : undefined,
      cancelUrl: typeof window !== 'undefined' ? `${window.location.origin}/subscription?checkout=cancel` : undefined,
    }),
  });
};

export const fetchFinancialLedger = async (): Promise<FinancialAllocation[]> => {
  const payload = await billingFetch('/api/billing/financial-ledger');
  return payload.allocations ?? [];
};
