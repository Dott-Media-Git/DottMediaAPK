import { OrgRole } from '../types/org';

export const roleAllowed = (role: OrgRole, allowed: OrgRole[]) => allowed.includes(role);
