const DEFAULT_PRIMARY_SOCIAL_EMAILS = ['brasioxirin@gmail.com'];
const DEFAULT_PRIMARY_SOCIAL_USER_IDS = ['cMPZQccGggbhZe9dbvtxFmBehP02'];

const normalizeEmail = (value?: string | null) => value?.trim().toLowerCase() ?? '';
const normalizeId = (value?: string | null) => value?.trim() ?? '';

const resolvePrimarySocialEmails = () => {
  const fromEnv = (process.env.PRIMARY_SOCIAL_EMAILS ?? '')
    .split(',')
    .map(entry => normalizeEmail(entry))
    .filter(Boolean);
  return new Set([...DEFAULT_PRIMARY_SOCIAL_EMAILS.map(normalizeEmail), ...fromEnv]);
};

const resolvePrimarySocialUserIds = () => {
  const fromEnv = (process.env.PRIMARY_SOCIAL_USER_IDS ?? '')
    .split(',')
    .map(entry => normalizeId(entry))
    .filter(Boolean);
  return new Set([...DEFAULT_PRIMARY_SOCIAL_USER_IDS.map(normalizeId), ...fromEnv]);
};

export const isPrimarySocialEmail = (email?: string | null) => {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  return resolvePrimarySocialEmails().has(normalized);
};

export const isPrimarySocialUserId = (userId?: string | null) => {
  const normalized = normalizeId(userId);
  if (!normalized) return false;
  return resolvePrimarySocialUserIds().has(normalized);
};

export const canUsePrimarySocialDefaults = (
  user?: { email?: string | null },
  userId?: string | null,
) => isPrimarySocialEmail(user?.email) || isPrimarySocialUserId(userId);
