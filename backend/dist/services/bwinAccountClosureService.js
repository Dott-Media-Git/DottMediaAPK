import admin from 'firebase-admin';
import { firestore } from '../db/firestore.js';
import { isBwinScopeUser } from './bwinContentGuard.js';
const BWIN_USER_ID = (process.env.BWIN_USER_ID || '1zvY9nNyXMcfxdPQEyx0bIdK7r53').trim();
const DEFAULT_SHUTDOWN_AT = (process.env.BWIN_ACCOUNT_CLOSURE_AT || '2026-05-08T08:00:00+03:00').trim();
const DEFAULT_CLOSURE_ENABLED = /^true$/i.test(String(process.env.BWIN_ACCOUNT_CLOSURE_ENABLED ?? '').trim());
const DEFAULT_MESSAGE = 'All Bwin social posting, reels, stories, and automated replies will pause at Friday, May 8, 2026 8:00 AM Africa/Kampala unless reopened.';
const CACHE_TTL_MS = Math.max(Number(process.env.BWIN_ACCOUNT_CLOSURE_CACHE_MS ?? 60000), 5000);
let cachedState = null;
const parseDate = (value) => {
    const parsed = new Date(String(value ?? '').trim() || DEFAULT_SHUTDOWN_AT);
    return Number.isFinite(parsed.getTime()) ? parsed : new Date(DEFAULT_SHUTDOWN_AT);
};
const toIso = (value) => parseDate(value).toISOString();
const buildState = (raw, now = new Date()) => {
    const enabled = typeof raw?.enabled === 'boolean' ? raw.enabled : DEFAULT_CLOSURE_ENABLED;
    const visibleToClient = raw?.visibleToClient !== false;
    const shutdownAt = toIso(raw?.shutdownAt);
    const scheduledAt = raw?.scheduledAt ? toIso(raw.scheduledAt) : now.toISOString();
    const message = raw?.message?.trim() || DEFAULT_MESSAGE;
    const status = !enabled ? 'disabled' : now.getTime() >= parseDate(shutdownAt).getTime() ? 'closed' : 'scheduled';
    return {
        enabled,
        visibleToClient,
        shutdownAt,
        scheduledAt,
        message,
        brandId: 'bwinbetug',
        status,
    };
};
export const getDefaultBwinAccountClosureState = (now = new Date()) => buildState(undefined, now);
export async function getBwinAccountClosureState(userId, options) {
    if (userId && !isBwinScopeUser(userId)) {
        return null;
    }
    const now = options?.now ?? new Date();
    if (!options?.force && cachedState && now.getTime() - cachedState.fetchedAt < CACHE_TTL_MS) {
        return buildState(cachedState.value, now);
    }
    try {
        const snap = await firestore.collection('users').doc(BWIN_USER_ID).get();
        const raw = (snap.data()?.accountClosure ?? null);
        const value = buildState(raw, now);
        cachedState = { value, fetchedAt: now.getTime() };
        return value;
    }
    catch (error) {
        console.warn('[bwin-account-closure] failed to load state, using default', error);
        const value = getDefaultBwinAccountClosureState(now);
        cachedState = { value, fetchedAt: now.getTime() };
        return value;
    }
}
export async function isBwinAccountClosureActive(userId, now = new Date()) {
    const state = await getBwinAccountClosureState(userId, { now });
    return Boolean(state?.enabled && parseDate(state.shutdownAt).getTime() <= now.getTime());
}
export async function ensureBwinAccountClosureState(overrides = {}, now = new Date()) {
    const next = buildState({
        ...getDefaultBwinAccountClosureState(now),
        ...overrides,
        scheduledAt: overrides.scheduledAt ?? now.toISOString(),
    }, now);
    await firestore.collection('users').doc(BWIN_USER_ID).set({
        accountClosure: {
            ...next,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
    }, { merge: true });
    cachedState = { value: next, fetchedAt: now.getTime() };
    return next;
}
export function getBwinAccountClosureMessage(state) {
    const shutdownAt = state?.shutdownAt ? parseDate(state.shutdownAt) : parseDate(DEFAULT_SHUTDOWN_AT);
    return `Bwin automation is paused from ${shutdownAt.toISOString()}.`;
}
