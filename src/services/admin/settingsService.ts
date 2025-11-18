import { adminFetch } from './base';

export const fetchSettings = async (orgId: string) => {
  const payload = await adminFetch(`/admin/orgs/${orgId}/settings`, {}, orgId);
  return payload.settings;
};

export const updateSettings = async (orgId: string, updates: Record<string, unknown>) => {
  const payload = await adminFetch(
    `/admin/orgs/${orgId}/settings`,
    { method: 'PATCH', body: JSON.stringify(updates) },
    orgId,
  );
  return payload.settings;
};

export const connectChannel = async (orgId: string, channel: string, token: string, metadata?: Record<string, string>) => {
  await adminFetch(
    `/admin/orgs/${orgId}/channels/${channel}/connect`,
    {
      method: 'POST',
      body: JSON.stringify({ token, metadata }),
    },
    orgId,
  );
};

export const disconnectChannel = async (orgId: string, channel: string) => {
  await adminFetch(`/admin/orgs/${orgId}/channels/${channel}/disconnect`, { method: 'DELETE' }, orgId);
};
