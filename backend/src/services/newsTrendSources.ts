import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';
import { TrendCandidate, TrendItem, TrendSource } from '../types/footballTrends';

type TrendScanOptions = {
  maxCandidates?: number;
  maxAgeHours?: number;
  sources?: TrendSource[];
  sourceMode?: 'merge' | 'replace';
};

const STOP_WORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'but',
  'for',
  'to',
  'from',
  'in',
  'on',
  'of',
  'with',
  'at',
  'by',
  'as',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'it',
  'its',
  'this',
  'that',
  'these',
  'those',
  'after',
  'before',
  'over',
  'under',
  'vs',
  'v',
]);

const DEFAULT_SOURCES: TrendSource[] = [
  {
    id: 'bbc-world',
    label: 'BBC News World',
    url: 'https://feeds.bbci.co.uk/news/world/rss.xml',
    type: 'rss',
    trusted: true,
    region: 'global',
  },
  {
    id: 'guardian-world',
    label: 'The Guardian World',
    url: 'https://www.theguardian.com/world/rss',
    type: 'rss',
    trusted: true,
    region: 'global',
  },
  {
    id: 'aljazeera',
    label: 'Al Jazeera',
    url: 'https://www.aljazeera.com/xml/rss/all.xml',
    type: 'rss',
    trusted: true,
    region: 'global',
  },
  {
    id: 'cnn-top',
    label: 'CNN Top Stories',
    url: 'https://rss.cnn.com/rss/edition.rss',
    type: 'rss',
    trusted: true,
    region: 'global',
  },
  {
    id: 'nyt-world',
    label: 'NYTimes World',
    url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml',
    type: 'rss',
    trusted: true,
    region: 'global',
  },
];

const DEFAULT_MAX_AGE_HOURS = 48;

const getSourcesFromEnv = (): TrendSource[] | null => {
  const raw = process.env.NEWS_TREND_SOURCES_JSON?.trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as TrendSource[];
    return null;
  } catch (error) {
    console.warn('[news-trends] Failed to parse NEWS_TREND_SOURCES_JSON', error);
    return null;
  }
};

const getSourcesFromFile = (): TrendSource[] | null => {
  const filePath = process.env.NEWS_TREND_SOURCES_FILE?.trim();
  if (!filePath) return null;
  try {
    const resolved = path.resolve(filePath);
    const raw = fs.readFileSync(resolved, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as TrendSource[];
    return null;
  } catch (error) {
    console.warn('[news-trends] Failed to load NEWS_TREND_SOURCES_FILE', error);
    return null;
  }
};

const resolveSources = () => {
  return getSourcesFromEnv() ?? getSourcesFromFile() ?? DEFAULT_SOURCES;
};

const parseDate = (value?: string): string | undefined => {
  if (!value) return undefined;
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) return undefined;
  return new Date(ts).toISOString();
};

const tokenize = (title: string): string[] => {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map(token => token.trim())
    .filter(token => token.length > 2 && !STOP_WORDS.has(token));
};

const similarity = (a: string[], b: string[]) => {
  if (!a.length || !b.length) return 0;
  const aSet = new Set(a);
  const bSet = new Set(b);
  let intersection = 0;
  aSet.forEach(token => {
    if (bSet.has(token)) intersection += 1;
  });
  const union = new Set([...aSet, ...bSet]).size;
  return union === 0 ? 0 : intersection / union;
};

const scoreCandidate = (items: TrendItem[]) => {
  const sources = new Set(items.map(item => item.sourceId));
  const mostRecent = items
    .map(item => item.publishedAt)
    .filter(Boolean)
    .map(value => Date.parse(value as string))
    .filter(value => !Number.isNaN(value))
    .sort((a, b) => b - a)[0];
  const now = Date.now();
  const ageHours = mostRecent ? (now - mostRecent) / 3600000 : DEFAULT_MAX_AGE_HOURS;
  const recencyScore = Math.max(0, 36 - ageHours);
  const densityScore = Math.min(items.length, 4);
  return sources.size * 3 + recencyScore + densityScore;
};

const groupItems = (items: TrendItem[]) => {
  const groups: Array<{ topic: string; tokens: string[]; items: TrendItem[] }> = [];
  for (const item of items) {
    const tokens = tokenize(item.title);
    let bestIndex = -1;
    let bestScore = 0;
    groups.forEach((group, index) => {
      const score = similarity(tokens, group.tokens);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });
    if (bestIndex >= 0 && bestScore >= 0.55) {
      groups[bestIndex].items.push(item);
    } else {
      groups.push({ topic: item.title, tokens, items: [item] });
    }
  }
  return groups;
};

const parseRssItems = (body: string, source: TrendSource): TrendItem[] => {
  const $ = cheerio.load(body, { xmlMode: true });
  const rssItems = $('item');
  const entries = rssItems.length ? rssItems.toArray() : $('entry').toArray();
  return entries
    .map(entry => {
      const title = $(entry).find('title').first().text().trim();
      const linkEl = $(entry).find('link').first();
      const link = linkEl.attr('href')?.trim() || linkEl.text().trim();
      const summary =
        $(entry).find('description').first().text().trim() ||
        $(entry).find('summary').first().text().trim() ||
        undefined;
      const publishedRaw =
        $(entry).find('pubDate').first().text().trim() ||
        $(entry).find('published').first().text().trim() ||
        $(entry).find('updated').first().text().trim();
      const publishedAt = parseDate(publishedRaw);
      if (!title) return null;
      return {
        title,
        link: link || undefined,
        summary,
        publishedAt,
        sourceId: source.id,
        sourceLabel: source.label,
      };
    })
    .filter(Boolean) as TrendItem[];
};

const parseHtmlItems = (body: string, source: TrendSource): TrendItem[] => {
  const selectors = source.selectors;
  if (!selectors?.item || !selectors?.title) return [];
  const $ = cheerio.load(body);
  const items: TrendItem[] = [];
  $(selectors.item).each((_, element) => {
    const title = $(element).find(selectors.title as string).first().text().trim();
    if (!title) return;
    const link = selectors.link ? $(element).find(selectors.link).first().attr('href')?.trim() : undefined;
    const summary = selectors.summary ? $(element).find(selectors.summary).first().text().trim() : undefined;
    const publishedRaw = selectors.published
      ? $(element).find(selectors.published).first().text().trim()
      : undefined;
    const publishedAt = parseDate(publishedRaw);
    items.push({
      title,
      link,
      summary,
      publishedAt,
      sourceId: source.id,
      sourceLabel: source.label,
    });
  });
  return items;
};

const fetchSourceItems = async (source: TrendSource): Promise<TrendItem[]> => {
  try {
    const response = await axios.get(source.url, { timeout: 12000 });
    const body = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
    if (source.type === 'html') {
      return parseHtmlItems(body, source);
    }
    return parseRssItems(body, source);
  } catch (error) {
    console.warn(`[news-trends] Failed to fetch ${source.label}`, error);
    return [];
  }
};

const mergeSources = (base: TrendSource[], custom?: TrendSource[]) => {
  const merged = [...(custom ?? []), ...base];
  const seen = new Set<string>();
  const unique: TrendSource[] = [];
  for (const source of merged) {
    const key = source.url.toLowerCase().trim();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(source);
  }
  return unique;
};

export const getNewsTrendingCandidates = async (options: TrendScanOptions = {}): Promise<TrendCandidate[]> => {
  const baseSources = resolveSources();
  const sources =
    options.sourceMode === 'replace' && options.sources?.length
      ? options.sources
      : mergeSources(baseSources, options.sources);
  const maxCandidates = Math.min(Math.max(options.maxCandidates ?? 6, 1), 20);
  const maxAgeHours = Math.min(Math.max(options.maxAgeHours ?? DEFAULT_MAX_AGE_HOURS, 6), 168);
  const items = (await Promise.all(sources.map(source => fetchSourceItems(source)))).flat();
  const cutoff = Date.now() - maxAgeHours * 3600000;
  const recentItems = items.filter(item => {
    if (!item.publishedAt) return true;
    const ts = Date.parse(item.publishedAt);
    if (Number.isNaN(ts)) return true;
    return ts >= cutoff;
  });

  const groups = groupItems(recentItems);
  const candidates = groups.map(group => {
    const score = scoreCandidate(group.items);
    const sourcesUsed = Array.from(new Set(group.items.map(item => item.sourceLabel)));
    const publishedAt = group.items
      .map(item => item.publishedAt)
      .filter(Boolean)
      .sort((a, b) => String(b).localeCompare(String(a)))[0];
    return {
      topic: group.topic,
      score,
      sources: sourcesUsed,
      publishedAt: publishedAt || undefined,
      sampleTitles: group.items.map(item => item.title).slice(0, 3),
      items: group.items,
    } as TrendCandidate;
  });

  return candidates.sort((a, b) => b.score - a.score).slice(0, maxCandidates);
};
