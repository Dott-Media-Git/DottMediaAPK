import admin from 'firebase-admin';
import { randomUUID } from 'crypto';
import { firestore } from '../../../db/firestore';
import { Prospect, ProspectDiscoveryParams, ProspectRankingContext, ProspectSeed } from './types';
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
export async function runProspectDiscovery(params: ProspectDiscoveryParams): Promise<Prospect[]> {
  const limit = Math.min(params.limit ?? 50, 100);
  const rankingContext: ProspectRankingContext = {
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
  if (!combinedSeeds.length) return [];

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
function normalizeProspect(seed: ProspectSeed, fallbackIndustry?: string): Prospect {
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
function dedupeLocal(prospects: Prospect[]): Prospect[] {
  const seen = new Set<string>();
  return prospects.filter(prospect => {
    const key = dedupeKey(prospect);
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupeKey(prospect: Prospect): string | null {
  if (prospect.email) return `email:${prospect.email}`;
  if (prospect.profileUrl) return `profile:${prospect.profileUrl}`;
  return null;
}

/**
 * Drops prospects that were already persisted earlier based on email/profileUrl.
 */
async function filterAgainstFirestore(prospects: Prospect[]): Promise<Prospect[]> {
  const emails = Array.from(new Set(prospects.map(p => p.email).filter(Boolean) as string[]));
  const profiles = Array.from(new Set(prospects.map(p => p.profileUrl).filter(Boolean) as string[]));

  const [existingEmails, existingProfiles] = await Promise.all([
    lookupExisting('email', emails),
    lookupExisting('profileUrl', profiles),
  ]);

  const recycleConfig = getRecycleConfig();
  const now = Date.now();
  const recycledIds = new Set<string>();
  const results: Prospect[] = [];

  prospects.forEach(prospect => {
    const existing = findExisting(prospect, existingEmails, existingProfiles);
    if (!existing) {
      results.push(prospect);
      return;
    }

    if (!recycleConfig.enabled) return;
    if (!shouldRecycle(existing, recycleConfig, now)) return;
    if (recycledIds.has(existing.id)) return;

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

type ProspectField = 'email' | 'profileUrl';

type ExistingProspect = Pick<
  Prospect,
  | 'id'
  | 'email'
  | 'profileUrl'
  | 'status'
  | 'createdAt'
  | 'lastContactedAt'
  | 'lastReplyAt'
  | 'lastMessagePreview'
  | 'lastChannel'
>;

async function lookupExisting(field: ProspectField, values: string[]): Promise<Map<string, ExistingProspect>> {
  const found = new Map<string, ExistingProspect>();
  if (!values.length) return found;

  for (let index = 0; index < values.length; index += 10) {
    const slice = values.slice(index, index + 10);
    if (!slice.length) continue;
    const snap = await prospectsCollection.where(field, 'in', slice).get();
    snap.forEach(doc => {
      const data = doc.data() as Prospect;
      const value = data[field] as string | undefined;
      if (!value) return;
      const normalized = field === 'email' ? value.toLowerCase() : sanitizeUrl(value);
      if (!normalized) return;
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
async function saveProspects(prospects: Prospect[]) {
  const batch = firestore.batch();
  prospects.forEach(prospect => {
    const ref = prospectsCollection.doc(prospect.id);
    // Strip undefined fields to satisfy Firestore serializer.
    const payload = Object.fromEntries(
      Object.entries({
        ...prospect,
        createdAt: prospect.createdAt ?? Date.now(),
        status: 'new',
        lastDiscoveredAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }).filter(([, value]) => value !== undefined),
    );
    batch.set(ref, payload, { merge: true });
  });
  await batch.commit();
}

function sanitizeUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  try {
    const normalized = new URL(url);
    normalized.hash = '';
    normalized.search = '';
    return normalized.toString().replace(/\/$/, '');
  } catch {
    return url.trim();
  }
}

function buildIndustryBreakdown(prospects: Prospect[]): Record<string, number> | undefined {
  const breakdown = prospects.reduce<Record<string, number>>((acc, prospect) => {
    if (prospect.industry) {
      acc[prospect.industry] = (acc[prospect.industry] ?? 0) + 1;
    }
    return acc;
  }, {});

  return Object.keys(breakdown).length ? breakdown : undefined;
}

type RecycleConfig = {
  enabled: boolean;
  recycleAfterMs: number;
  recycleStatuses: Set<string>;
};

function getRecycleConfig(): RecycleConfig {
  const recycleDays = Number(process.env.OUTBOUND_RECYCLE_DAYS ?? 14);
  const recycleAfterMs = recycleDays > 0 ? recycleDays * 24 * 60 * 60 * 1000 : 0;
  const recycleStatuses = new Set(
    (process.env.OUTBOUND_RECYCLE_STATUSES ?? 'contacted')
      .split(',')
      .map(status => status.trim().toLowerCase())
      .filter(Boolean),
  );
  const enabled = process.env.OUTBOUND_RECYCLE_ALWAYS === 'true' || recycleAfterMs > 0;
  return { enabled, recycleAfterMs, recycleStatuses };
}

function findExisting(
  prospect: Prospect,
  existingEmails: Map<string, ExistingProspect>,
  existingProfiles: Map<string, ExistingProspect>,
) {
  if (prospect.email) {
    const existing = existingEmails.get(prospect.email.toLowerCase());
    if (existing) return existing;
  }
  if (prospect.profileUrl) {
    const existing = existingProfiles.get(sanitizeUrl(prospect.profileUrl) ?? prospect.profileUrl);
    if (existing) return existing;
  }
  return null;
}

function shouldRecycle(existing: ExistingProspect, config: RecycleConfig, nowMs: number) {
  const status = existing.status?.toString().toLowerCase();
  if (!status) return false;
  if (['converted', 'replied', 'not_interested', 'skipped'].includes(status)) return false;
  if (!config.recycleStatuses.has(status)) return false;
  if (process.env.OUTBOUND_RECYCLE_ALWAYS === 'true') return true;
  if (!config.recycleAfterMs) return false;
  const lastTouch = existing.lastContactedAt ?? existing.lastReplyAt ?? existing.createdAt;
  if (!lastTouch) return false;
  return nowMs - lastTouch >= config.recycleAfterMs;
}

export type { Prospect, ProspectDiscoveryParams } from './types';
