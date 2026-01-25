import admin from 'firebase-admin';
import { randomUUID } from 'crypto';
import { firestore } from '../../../db/firestore.js';
import { searchLinkedInProspects } from './sources/linkedinSource.js';
import { searchInstagramProspects } from './sources/instagramSource.js';
import { searchBusinessProspects } from './sources/businessApiSource.js';
import { loadCsvProspects } from './sources/csvSource.js';
import { enrichProspects } from './enrichers/companyEnricher.js';
import { scoreProspects } from './ranker/prospectRanker.js';
import { incrementMetric } from '../../../services/analyticsService.js';
const prospectsCollection = firestore.collection('prospects');
/**
 * Orchestrates multi-channel discovery, scoring, dedupe + persistence.
 */
export async function runProspectDiscovery(params) {
    const limit = Math.min(params.limit ?? 50, 100);
    const rankingContext = {
        targetIndustry: params.industry,
        targetCountry: params.country,
    };
    const [linkedin, instagram, business, csvUpload] = await Promise.all([
        searchLinkedInProspects(params),
        searchInstagramProspects(params),
        searchBusinessProspects(params),
        loadCsvProspects(params),
    ]);
    const combinedSeeds = [...linkedin, ...instagram, ...business, ...csvUpload];
    if (!combinedSeeds.length)
        return [];
    const normalized = dedupeLocal(combinedSeeds.map(seed => normalizeProspect(seed, params.industry)));
    const enriched = await enrichProspects(normalized);
    const ranked = await scoreProspects(enriched, rankingContext);
    const sorted = ranked.sort((a, b) => b.score - a.score);
    const newProspects = await filterAgainstFirestore(sorted.slice(0, limit));
    if (!newProspects.length) {
        return [];
    }
    await saveProspects(newProspects);
    const breakdown = buildIndustryBreakdown(newProspects);
    await incrementMetric('outbound_prospects', newProspects.length, breakdown ? { industryBreakdown: breakdown } : undefined);
    return newProspects;
}
/**
 * Converts raw source payload to Prospect baseline payload.
 */
function normalizeProspect(seed, fallbackIndustry) {
    return {
        id: seed.id ?? randomUUID(),
        name: seed.name,
        company: seed.company,
        companyDomain: seed.companyDomain,
        companySize: seed.companySize,
        companySummary: seed.companySummary,
        position: seed.position,
        industry: seed.industry ?? fallbackIndustry,
        location: seed.location,
        email: seed.email?.toLowerCase(),
        phone: seed.phone,
        profileUrl: sanitizeUrl(seed.profileUrl),
        latestMediaId: seed.latestMediaId,
        channel: seed.channel,
        score: 0,
        createdAt: seed.createdAt ?? Date.now(),
        status: 'new',
        tags: seed.tags ?? [],
        notes: seed.notes,
    };
}
/**
 * Removes duplicates within the current batch based on email/profileUrl.
 */
function dedupeLocal(prospects) {
    const seen = new Set();
    return prospects.filter(prospect => {
        const key = dedupeKey(prospect);
        if (!key)
            return true;
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
}
function dedupeKey(prospect) {
    if (prospect.email)
        return `email:${prospect.email}`;
    if (prospect.profileUrl)
        return `profile:${prospect.profileUrl}`;
    return null;
}
/**
 * Drops prospects that were already persisted earlier based on email/profileUrl.
 */
async function filterAgainstFirestore(prospects) {
    const emails = Array.from(new Set(prospects.map(p => p.email).filter(Boolean)));
    const profiles = Array.from(new Set(prospects.map(p => p.profileUrl).filter(Boolean)));
    const [existingEmails, existingProfiles] = await Promise.all([
        lookupExisting('email', emails),
        lookupExisting('profileUrl', profiles),
    ]);
    const recycleConfig = getRecycleConfig();
    const now = Date.now();
    const recycledIds = new Set();
    const results = [];
    prospects.forEach(prospect => {
        const existing = findExisting(prospect, existingEmails, existingProfiles);
        if (!existing) {
            results.push(prospect);
            return;
        }
        if (!recycleConfig.enabled)
            return;
        if (!shouldRecycle(existing, recycleConfig, now))
            return;
        if (recycledIds.has(existing.id))
            return;
        recycledIds.add(existing.id);
        results.push({
            ...prospect,
            id: existing.id,
            status: 'new',
            createdAt: existing.createdAt ?? prospect.createdAt,
            lastContactedAt: existing.lastContactedAt,
            lastReplyAt: existing.lastReplyAt,
            lastMessagePreview: existing.lastMessagePreview,
            lastChannel: existing.lastChannel,
        });
    });
    return results;
}
async function lookupExisting(field, values) {
    const found = new Map();
    if (!values.length)
        return found;
    for (let index = 0; index < values.length; index += 10) {
        const slice = values.slice(index, index + 10);
        if (!slice.length)
            continue;
        const snap = await prospectsCollection.where(field, 'in', slice).get();
        snap.forEach(doc => {
            const data = doc.data();
            const value = data[field];
            if (!value)
                return;
            const normalized = field === 'email' ? value.toLowerCase() : sanitizeUrl(value);
            if (!normalized)
                return;
            found.set(normalized, {
                id: doc.id,
                email: data.email,
                profileUrl: data.profileUrl,
                status: data.status,
                createdAt: data.createdAt,
                lastContactedAt: data.lastContactedAt,
                lastReplyAt: data.lastReplyAt,
                lastMessagePreview: data.lastMessagePreview,
                lastChannel: data.lastChannel,
            });
        });
    }
    return found;
}
/**
 * Persists newly discovered prospects as "new".
 */
async function saveProspects(prospects) {
    const batch = firestore.batch();
    prospects.forEach(prospect => {
        const ref = prospectsCollection.doc(prospect.id);
        // Strip undefined fields to satisfy Firestore serializer.
        const payload = Object.fromEntries(Object.entries({
            ...prospect,
            createdAt: prospect.createdAt ?? Date.now(),
            status: 'new',
            lastDiscoveredAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }).filter(([, value]) => value !== undefined));
        batch.set(ref, payload, { merge: true });
    });
    await batch.commit();
}
function sanitizeUrl(url) {
    if (!url)
        return undefined;
    try {
        const normalized = new URL(url);
        normalized.hash = '';
        normalized.search = '';
        return normalized.toString().replace(/\/$/, '');
    }
    catch {
        return url.trim();
    }
}
function buildIndustryBreakdown(prospects) {
    const breakdown = prospects.reduce((acc, prospect) => {
        if (prospect.industry) {
            acc[prospect.industry] = (acc[prospect.industry] ?? 0) + 1;
        }
        return acc;
    }, {});
    return Object.keys(breakdown).length ? breakdown : undefined;
}
function getRecycleConfig() {
    const recycleDays = Number(process.env.OUTBOUND_RECYCLE_DAYS ?? 14);
    const recycleAfterMs = recycleDays > 0 ? recycleDays * 24 * 60 * 60 * 1000 : 0;
    const recycleStatuses = new Set((process.env.OUTBOUND_RECYCLE_STATUSES ?? 'contacted')
        .split(',')
        .map(status => status.trim().toLowerCase())
        .filter(Boolean));
    const enabled = process.env.OUTBOUND_RECYCLE_ALWAYS === 'true' || recycleAfterMs > 0;
    return { enabled, recycleAfterMs, recycleStatuses };
}
function findExisting(prospect, existingEmails, existingProfiles) {
    if (prospect.email) {
        const existing = existingEmails.get(prospect.email.toLowerCase());
        if (existing)
            return existing;
    }
    if (prospect.profileUrl) {
        const existing = existingProfiles.get(sanitizeUrl(prospect.profileUrl) ?? prospect.profileUrl);
        if (existing)
            return existing;
    }
    return null;
}
function shouldRecycle(existing, config, nowMs) {
    const status = existing.status?.toString().toLowerCase();
    if (!status)
        return false;
    if (['converted', 'replied', 'not_interested', 'skipped'].includes(status))
        return false;
    if (!config.recycleStatuses.has(status))
        return false;
    if (process.env.OUTBOUND_RECYCLE_ALWAYS === 'true')
        return true;
    if (!config.recycleAfterMs)
        return false;
    const lastTouch = existing.lastContactedAt ?? existing.lastReplyAt ?? existing.createdAt;
    if (!lastTouch)
        return false;
    return nowMs - lastTouch >= config.recycleAfterMs;
}
