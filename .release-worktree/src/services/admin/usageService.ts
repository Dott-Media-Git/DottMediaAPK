import { adminFetch } from './base';

export const fetchUsage = async (orgId: string, params?: { from?: string; to?: string }) => {
  const search = new URLSearchParams();
  if (params?.from) search.append('from', params.from);
  if (params?.to) search.append('to', params.to);
  const payload = await adminFetch(`/admin/orgs/${orgId}/usage?${search.toString()}`, {}, orgId);
  return payload.usage;
};
