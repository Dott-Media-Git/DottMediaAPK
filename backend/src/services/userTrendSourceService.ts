import admin from 'firebase-admin';
import { firestore } from '../db/firestore';
import { TrendSource, TrendSourceSelectors, TrendSourceType } from '../types/footballTrends';

type TrendSourceInput = {
  url: string;
  label?: string;
  type?: TrendSourceType;
  selectors?: TrendSourceSelectors;
};

export type TrendSourceMode = 'merge' | 'replace';

const MAX_SOURCES = 20;
const userCollection = firestore.collection('users');

const normalizeUrl = (value: string) => value.trim();

const buildSourceId = (url: string) => {
  const compact = url.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const slug = compact.length ? compact.slice(0, 32) : `source-${Date.now()}`;
  return `custom-${slug}`;
};

const normalizeSource = (source: TrendSourceInput): TrendSource => {
  const url = normalizeUrl(source.url);
  let label = source.label?.trim();
  if (!label) {
    try {
      const host = new URL(url).hostname.replace(/^www\./, '');
      label = host || 'Custom source';
    } catch (error) {
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

const dedupeSources = (sources: TrendSource[]) => {
  const seen = new Set<string>();
  const unique: TrendSource[] = [];
  for (const source of sources) {
    const key = source.url.toLowerCase().trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(source);
  }
  return unique;
};

export const getUserTrendConfig = async (
  userId: string,
): Promise<{ sources: TrendSource[]; mode: TrendSourceMode }> => {
  const doc = await userCollection.doc(userId).get();
  const data = doc.data() as { trendSources?: TrendSource[]; trendSourcesMode?: TrendSourceMode } | undefined;
  const sources = Array.isArray(data?.trendSources)
    ? data!.trendSources.filter(source => source && typeof source.url === 'string')
    : [];
  const mode: TrendSourceMode = data?.trendSourcesMode === 'replace' ? 'replace' : 'merge';
  return { sources, mode };
};

export const getUserTrendSources = async (userId: string): Promise<TrendSource[]> => {
  const config = await getUserTrendConfig(userId);
  return config.sources;
};

export const saveUserTrendSources = async (userId: string, sources: TrendSourceInput[]): Promise<TrendSource[]> => {
  const normalized = sources
    .filter(source => source && typeof source.url === 'string')
    .map(normalizeSource)
    .slice(0, MAX_SOURCES);
  const unique = dedupeSources(normalized);
  await userCollection.doc(userId).set(
    {
      trendSources: unique,
      trendSourcesUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  return unique;
};
