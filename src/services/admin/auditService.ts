import { adminFetch } from './base';

export const fetchAuditEvents = async (orgId: string, limit = 100) => {
  const payload = await adminFetch(`/admin/orgs/${orgId}/audit?limit=${limit}`, {}, orgId);
  return payload.events;
};
