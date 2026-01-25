import { adminFetch } from './base';

export type OrgUser = {
  uid: string;
  role: 'Owner' | 'Admin' | 'Agent' | 'Viewer';
  invitedBy?: string;
};

export const listOrgUsers = async (orgId: string): Promise<OrgUser[]> => {
  const payload = await adminFetch(`/admin/orgs/${orgId}/users`, {}, orgId);
  return payload.users;
};

export const inviteOrgUser = async (orgId: string, data: { uid: string; role: OrgUser['role'] }) => {
  await adminFetch(
    `/admin/orgs/${orgId}/users/invite`,
    { method: 'POST', body: JSON.stringify(data) },
    orgId,
  );
};

export const updateOrgUser = async (orgId: string, uid: string, role: OrgUser['role']) => {
  await adminFetch(
    `/admin/orgs/${orgId}/users/${uid}`,
    { method: 'PATCH', body: JSON.stringify({ role }) },
    orgId,
  );
};

export const removeOrgUser = async (orgId: string, uid: string) => {
  await adminFetch(`/admin/orgs/${orgId}/users/${uid}`, { method: 'DELETE' }, orgId);
};
