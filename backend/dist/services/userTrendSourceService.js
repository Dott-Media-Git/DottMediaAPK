import admin from 'firebase-admin';
import { firestore } from '../db/firestore.js';
const MAX_SOURCES = 20;
const userCollection = firestore.collection('users');
const normalizeUrl = (value) => value.trim();
const buildSourceId = (url) => {
    const compact = url.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const slug = compact.length ? compact.slice(0, 32) : `source-${Date.now()}`;
    return `custom-${slug}`;
};
const normalizeSource = (source) => {
    const url = normalizeUrl(source.url);
    let label = source.label?.trim();
    if (!label) {
        try {
            const host = new URL(url).hostname.replace(/^www\./, '');
            label = host || 'Custom source';
        }
        catch (error) {
            label = 'Custom source';
        }
    }
    const type = source.type ?? 'rss';
    const safeType = type === 'html' && !source.selectors?.item ? 'rss' : type;
    return {
        id: buildSourceId(url),
        label,
        url,
        type: safeType,
        trusted: true,
        region: 'global',
        ...(safeType === 'html' && source.selectors ? { selectors: source.selectors } : {}),
    };
};
const dedupeSources = (sources) => {
    const seen = new Set();
    const unique = [];
    for (const source of sources) {
        const key = source.url.toLowerCase().trim();
        if (!key || seen.has(key))
            continue;
        seen.add(key);
        unique.push(source);
    }
    return unique;
};
export const getUserTrendSources = async (userId) => {
    const doc = await userCollection.doc(userId).get();
    const data = doc.data();
    if (!data?.trendSources || !Array.isArray(data.trendSources))
        return [];
    return data.trendSources.filter(source => source && typeof source.url === 'string');
};
export const saveUserTrendSources = async (userId, sources) => {
    const normalized = sources
        .filter(source => source && typeof source.url === 'string')
        .map(normalizeSource)
        .slice(0, MAX_SOURCES);
    const unique = dedupeSources(normalized);
    await userCollection.doc(userId).set({
        trendSources: unique,
        trendSourcesUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    return unique;
};
