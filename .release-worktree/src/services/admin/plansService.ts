import { adminFetch } from './base';

export const fetchPlans = async () => {
  const payload = await adminFetch('/admin/plans');
  return payload.plans;
};

export const swapPlan = async (orgId: string, plan: string) => {
  const payload = await adminFetch(
    `/admin/orgs/${orgId}/plan/swap`,
    { method: 'POST', body: JSON.stringify({ plan }) },
    orgId,
  );
  return payload;
};
