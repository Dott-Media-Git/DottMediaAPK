import { adminFetch } from './base';

export const getOrgProfile = async (orgId: string) => {
  const payload = await adminFetch(`/admin/orgs/${orgId}`, {}, orgId);
  return payload.org;
};

export const updateOrgProfile = async (orgId: string, data: Record<string, unknown>) => {
  const payload = await adminFetch(
    `/admin/orgs/${orgId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(data),
    },
    orgId,
  );
  return payload.org;
};
