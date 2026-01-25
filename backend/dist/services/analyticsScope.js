const sanitizeScopeId = (value) => {
    if (!value)
        return '';
    return value.trim().replace(/[\\/]/g, '_');
};
export const resolveAnalyticsScopeKey = (scope) => {
    const envOrg = sanitizeScopeId(process.env.ANALYTICS_ORG_ID);
    const envUser = sanitizeScopeId(process.env.ANALYTICS_USER_ID);
    const provided = sanitizeScopeId(scope?.orgId ?? scope?.scopeId ?? scope?.userId);
    return provided || envOrg || envUser || 'global';
};
export const scopedDocId = (base, scope) => {
    const key = resolveAnalyticsScopeKey(scope);
    return key === 'global' ? base : `${base}_${key}`;
};
export const scopedCollectionId = (base, scope) => {
    const key = resolveAnalyticsScopeKey(scope);
    return key === 'global' ? base : `${base}_${key}`;
};
