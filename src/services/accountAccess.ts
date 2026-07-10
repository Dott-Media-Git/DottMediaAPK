const MAIN_DOTT_MEDIA_EMAILS = new Set(['brasioxirin@gmail.com']);
const MAIN_DOTT_MEDIA_USER_IDS = new Set(['cMPZQccGggbhZe9dbvtxFmBehP02']);

const normalizeLower = (value: unknown) => String(value ?? '').trim().toLowerCase();

export const isMainDottMediaAccount = (user: unknown) => {
  const candidate = user as { uid?: unknown; email?: unknown } | null | undefined;
  const uid = String(candidate?.uid ?? '').trim();
  const email = normalizeLower(candidate?.email);
  return MAIN_DOTT_MEDIA_USER_IDS.has(uid) || MAIN_DOTT_MEDIA_EMAILS.has(email);
};
