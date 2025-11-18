import createHttpError from 'http-errors';
import { firestore } from '../lib/firebase';
import { roleAllowed } from '../utils/rbac';
const orgUsersCollection = firestore.collection('orgUsers');
export async function withOrgContext(req, _res, next) {
    const authed = req;
    if (!authed.authUser)
        return next(createHttpError(401, 'Authentication required'));
    const orgId = (req.header('x-org-id') || authed.authUser?.orgId)?.trim();
    if (!orgId)
        return next(createHttpError(400, 'Missing org context'));
    try {
        const membershipId = `${orgId}_${authed.authUser.uid}`;
        const doc = await orgUsersCollection.doc(membershipId).get();
        if (!doc.exists)
            return next(createHttpError(403, 'Not a member of this org'));
        authed.orgId = orgId;
        authed.orgUser = doc.data();
        return next();
    }
    catch (error) {
        return next(createHttpError(500, 'Failed to resolve org membership'));
    }
}
export const requireRole = (roles) => (req, _res, next) => {
    const orgReq = req;
    if (!orgReq.orgUser)
        return next(createHttpError(401, 'Missing org context'));
    if (!roleAllowed(orgReq.orgUser.role, roles)) {
        return next(createHttpError(403, 'Insufficient role'));
    }
    return next();
};
