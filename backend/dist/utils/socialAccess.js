const DEFAULT_PRIMARY_SOCIAL_EMAILS = ['brasioxirin@gmail.com'];
const normalizeEmail = (value) => value?.trim().toLowerCase() ?? '';
const resolvePrimarySocialEmails = () => {
    const fromEnv = (process.env.PRIMARY_SOCIAL_EMAILS ?? '')
        .split(',')
        .map(entry => normalizeEmail(entry))
        .filter(Boolean);
    return new Set([...DEFAULT_PRIMARY_SOCIAL_EMAILS.map(normalizeEmail), ...fromEnv]);
};
export const isPrimarySocialEmail = (email) => {
    const normalized = normalizeEmail(email);
    if (!normalized)
        return false;
    return resolvePrimarySocialEmails().has(normalized);
};
export const canUsePrimarySocialDefaults = (user) => isPrimarySocialEmail(user?.email);
