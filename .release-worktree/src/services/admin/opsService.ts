import { adminFetch } from './base';

export const testWebhook = async (orgId: string, body: Record<string, unknown>) => {
  await adminFetch(
    `/admin/orgs/${orgId}/test/webhook`,
    { method: 'POST', body: JSON.stringify(body) },
    orgId,
  );
};

export const runJob = async (orgId: string, type: string) => {
  const payload = await adminFetch(
    `/admin/orgs/${orgId}/jobs/run`,
    { method: 'POST', body: JSON.stringify({ type }) },
    orgId,
  );
  return payload;
};
