import { firestore } from '../db/firestore';
import { supabaseFallbackService } from './supabaseFallbackService';

type StoredSocialAccounts = {
  email?: string | null;
  socialAccounts: Record<string, unknown>;
};

type CacheEntry = {
  expiresAt: number;
  value: StoredSocialAccounts | null;
};

const cache = new Map<string, CacheEntry>();
const cacheTtlMs = Math.max(Number(process.env.META_COMMENT_TARGET_CACHE_MS ?? 300000), 30000);

const safeErrorCode = (error: unknown) => {
  const value = error as { code?: unknown; name?: unknown };
  const code = value?.code ?? value?.name;
  return code === undefined || code === null ? 'unknown' : String(code).slice(0, 80);
};

const put = (userId: string, value: StoredSocialAccounts | null) => {
  cache.set(userId, { expiresAt: Date.now() + cacheTtlMs, value });
  return value;
};

/**
 * Resolve social credentials for the comment pollers without issuing a
 * Firestore read on every one-minute tick. Supabase is the existing fallback
 * store and is preferred; Firestore is only consulted when no fallback row is
 * available. The in-memory cache also prevents a transient fallback miss from
 * becoming a read storm.
 */
export async function getPollSocialAccounts(userId: string): Promise<StoredSocialAccounts | null> {
  const cached = cache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  try {
    const fallback = await supabaseFallbackService.getSocialAccounts(userId);
    if (fallback?.socialAccounts && typeof fallback.socialAccounts === 'object') {
      return put(userId, {
        email: fallback.email ?? null,
        socialAccounts: fallback.socialAccounts as Record<string, unknown>,
      });
    }
  } catch (error) {
    console.warn('[social-poll] Supabase target lookup failed', { userId, code: safeErrorCode(error) });
  }

  try {
    const snap = await firestore.collection('users').doc(userId).get();
    const data = snap.data() as { email?: string | null; socialAccounts?: unknown } | undefined;
    if (data?.socialAccounts && typeof data.socialAccounts === 'object') {
      return put(userId, {
        email: data.email ?? null,
        socialAccounts: data.socialAccounts as Record<string, unknown>,
      });
    }
  } catch (error) {
    console.warn('[social-poll] Firestore target lookup failed', { userId, code: safeErrorCode(error) });
  }

  return put(userId, null);
}

export function clearPollSocialAccountsCache(userId?: string) {
  if (userId) {
    cache.delete(userId);
    return;
  }
  cache.clear();
}
