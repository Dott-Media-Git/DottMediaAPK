import admin from 'firebase-admin';
import { randomUUID } from 'crypto';
import { firestore } from '../../../lib/firebase';
import { searchLinkedInProspects } from './sources/linkedinSource';
import { searchInstagramProspects } from './sources/instagramSource';
import { searchBusinessProspects } from './sources/businessApiSource';
import { loadCsvProspects } from './sources/csvSource';
import { enrichProspects } from './enrichers/companyEnricher';
import { scoreProspects } from './ranker/prospectRanker';
import { incrementMetric } from '../../../services/analyticsService';
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
    const [existingEmails, existingProfiles] = await Promise.all([lookupExisting('email', emails), lookupExisting('profileUrl', profiles)]);
    return prospects.filter(prospect => {
        if (prospect.email && existingEmails.has(prospect.email))
            return false;
        if (prospect.profileUrl && existingProfiles.has(prospect.profileUrl))
            return false;
        return true;
    });
}
async function lookupExisting(field, values) {
    const found = new Set();
    if (!values.length)
        return found;
    for (let index = 0; index < values.length; index += 10) {
        const slice = values.slice(index, index + 10);
        if (!slice.length)
            continue;
        const snap = await prospectsCollection.where(field, 'in', slice).get();
        snap.forEach(doc => {
            const value = doc.data()[field];
            if (value) {
                const normalized = field === 'email' ? value.toLowerCase() : sanitizeUrl(value);
                if (normalized) {
                    found.add(normalized);
                }
            }
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
        batch.set(ref, {
            ...prospect,
            createdAt: prospect.createdAt ?? Date.now(),
            status: 'new',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
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
