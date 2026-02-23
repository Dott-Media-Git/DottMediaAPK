import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';
import { TrendCandidate, TrendItem, TrendSource } from '../types/footballTrends';

type TrendScanOptions = {
  maxCandidates?: number;
  maxAgeHours?: number;
  sources?: TrendSource[];
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
  'fc',
  'club',
]);

const DEFAULT_SOURCES: TrendSource[] = [
  {
    id: 'bbc-football',
    label: 'BBC Sport Football',
    url: 'https://feeds.bbci.co.uk/sport/football/rss.xml',
    type: 'rss',
    trusted: true,
    region: 'global',
  },
  {
    id: 'sky-sports-football',
    label: 'Sky Sports Football',
    url: 'https://www.skysports.com/rss/12040',
    type: 'rss',
    trusted: true,
    region: 'global',
  },
  {
    id: 'guardian-football',
    label: 'The Guardian Football',
    url: 'https://www.theguardian.com/football/rss',
    type: 'rss',
    trusted: true,
    region: 'global',
  },
  {
    id: 'espn-soccer',
    label: 'ESPN Soccer',
    url: 'https://www.espn.com/espn/rss/soccer/news',
    type: 'rss',
    trusted: true,
    region: 'global',
  },
];

const DEFAULT_MAX_AGE_HOURS = 48;

const getSourcesFromEnv = (): TrendSource[] | null => {
  const raw = process.env.FOOTBALL_TREND_SOURCES_JSON?.trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as TrendSource[];
    return null;
  } catch (error) {
    console.warn('[football-trends] Failed to parse FOOTBALL_TREND_SOURCES_JSON', error);
    return null;
  }
};

const getSourcesFromFile = (): TrendSource[] | null => {
  const filePath = process.env.FOOTBALL_TREND_SOURCES_FILE?.trim();
  if (!filePath) return null;
  try {
    const resolved = path.resolve(filePath);
    const raw = fs.readFileSync(resolved, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as TrendSource[];
    return null;
  } catch (error) {
    console.warn('[football-trends] Failed to load FOOTBALL_TREND_SOURCES_FILE', error);
    return null;
  }
};

const resolveSources = () => {
  return getSourcesFromEnv() ?? getSourcesFromFile() ?? DEFAULT_SOURCES;
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

const parseDate = (value?: string): string | undefined => {
  if (!value) return undefined;
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) return undefined;
  return new Date(ts).toISOString();
};

const normalizeText = (value?: string) => {
  if (!value) return undefined;
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized || undefined;
};

const stripHtml = (value?: string) => {
  if (!value) return undefined;
  const text = cheerio.load(`<root>${value}</root>`)('root').text();
  return normalizeText(text);
};

const toAbsoluteUrl = (url?: string, baseUrl?: string) => {
  if (!url) return undefined;
  const trimmed = url.trim();
  if (!trimmed) return undefined;
  try {
    return new URL(trimmed, baseUrl).toString();
  } catch (error) {
    return undefined;
  }
};

const extractImageFromHtmlFragment = (value: string, baseUrl?: string) => {
  try {
    const $ = cheerio.load(value);
    const src = $('img').first().attr('src')?.trim();
    return toAbsoluteUrl(src, baseUrl);
  } catch (error) {
    return undefined;
  }
};

const extractVideoFromHtmlFragment = (value: string, baseUrl?: string) => {
  try {
    const $ = cheerio.load(value);
    const sourceSrc = $('video source').first().attr('src')?.trim();
    if (sourceSrc) return toAbsoluteUrl(sourceSrc, baseUrl);
    const videoSrc = $('video').first().attr('src')?.trim();
    return toAbsoluteUrl(videoSrc, baseUrl);
  } catch (error) {
    return undefined;
  }
};

const extractRssImage = ($: cheerio.CheerioAPI, entry: any, source: TrendSource) => {
  const mediaContent =
    $(entry).find('media\\:content').first().attr('url')?.trim() ||
    $(entry).find('content').first().attr('url')?.trim();
  if (mediaContent) return toAbsoluteUrl(mediaContent, source.url);

  const mediaThumbnail =
    $(entry).find('media\\:thumbnail').first().attr('url')?.trim() ||
    $(entry).find('thumbnail').first().attr('url')?.trim();
  if (mediaThumbnail) return toAbsoluteUrl(mediaThumbnail, source.url);

  const enclosureUrl = $(entry)
    .find('enclosure')
    .toArray()
    .map(node => {
      const type = ($(node).attr('type') || '').toLowerCase();
      if (type.startsWith('image/')) return $(node).attr('url')?.trim();
      return undefined;
    })
    .find(Boolean);
  if (enclosureUrl) return toAbsoluteUrl(enclosureUrl, source.url);

  const atomEnclosure = $(entry)
    .find('link')
    .toArray()
    .map(node => {
      const rel = ($(node).attr('rel') || '').toLowerCase();
      const type = ($(node).attr('type') || '').toLowerCase();
      if (rel === 'enclosure' && type.startsWith('image/')) {
        return $(node).attr('href')?.trim();
      }
      return undefined;
    })
    .find(Boolean);
  if (atomEnclosure) return toAbsoluteUrl(atomEnclosure, source.url);

  const descriptionRaw = $(entry).find('description').first().text().trim();
  const descriptionImage = descriptionRaw ? extractImageFromHtmlFragment(descriptionRaw, source.url) : undefined;
  if (descriptionImage) return descriptionImage;

  const contentRaw = $(entry).find('content\\:encoded').first().text().trim();
  const contentImage = contentRaw ? extractImageFromHtmlFragment(contentRaw, source.url) : undefined;
  if (contentImage) return contentImage;

  return undefined;
};

const extractRssVideo = ($: cheerio.CheerioAPI, entry: any, source: TrendSource) => {
  const mediaVideo = $(entry)
    .find('media\\:content')
    .toArray()
    .map(node => {
      const medium = ($(node).attr('medium') || '').toLowerCase();
      const type = ($(node).attr('type') || '').toLowerCase();
      if (medium === 'video' || type.startsWith('video/')) {
        return $(node).attr('url')?.trim();
      }
      return undefined;
    })
    .find(Boolean);
  if (mediaVideo) return toAbsoluteUrl(mediaVideo, source.url);

  const enclosureVideo = $(entry)
    .find('enclosure')
    .toArray()
    .map(node => {
      const type = ($(node).attr('type') || '').toLowerCase();
      if (type.startsWith('video/')) return $(node).attr('url')?.trim();
      return undefined;
    })
    .find(Boolean);
  if (enclosureVideo) return toAbsoluteUrl(enclosureVideo, source.url);

  const atomVideo = $(entry)
    .find('link')
    .toArray()
    .map(node => {
      const rel = ($(node).attr('rel') || '').toLowerCase();
      const type = ($(node).attr('type') || '').toLowerCase();
      if (rel === 'enclosure' && type.startsWith('video/')) {
        return $(node).attr('href')?.trim();
      }
      return undefined;
    })
    .find(Boolean);
  if (atomVideo) return toAbsoluteUrl(atomVideo, source.url);

  const descriptionRaw = $(entry).find('description').first().text().trim();
  const descriptionVideo = descriptionRaw ? extractVideoFromHtmlFragment(descriptionRaw, source.url) : undefined;
  if (descriptionVideo) return descriptionVideo;

  const contentRaw = $(entry).find('content\\:encoded').first().text().trim();
  const contentVideo = contentRaw ? extractVideoFromHtmlFragment(contentRaw, source.url) : undefined;
  if (contentVideo) return contentVideo;

  return undefined;
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
      const descriptionRaw = $(entry).find('description').first().text().trim();
      const summaryRaw = descriptionRaw || $(entry).find('summary').first().text().trim();
      const summary = stripHtml(summaryRaw) || normalizeText(summaryRaw);
      const publishedRaw =
        $(entry).find('pubDate').first().text().trim() ||
        $(entry).find('published').first().text().trim() ||
        $(entry).find('updated').first().text().trim();
      const publishedAt = parseDate(publishedRaw);
      const imageUrl = extractRssImage($, entry, source);
      const videoUrl = extractRssVideo($, entry, source);
      if (!title) return null;
      return {
        title,
        link: toAbsoluteUrl(link, source.url) || link || undefined,
        summary,
        imageUrl,
        videoUrl,
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
    const summaryRaw = selectors.summary ? $(element).find(selectors.summary).first().text().trim() : undefined;
    const imageRaw = $(element).find('img').first().attr('src')?.trim();
    const videoRaw = $(element).find('video source').first().attr('src')?.trim() || $(element).find('video').first().attr('src')?.trim();
    const publishedRaw = selectors.published
      ? $(element).find(selectors.published).first().text().trim()
      : undefined;
    const publishedAt = parseDate(publishedRaw);
    items.push({
      title,
      link: toAbsoluteUrl(link, source.url) || link,
      summary: normalizeText(summaryRaw),
      imageUrl: toAbsoluteUrl(imageRaw, source.url) || imageRaw,
      videoUrl: toAbsoluteUrl(videoRaw, source.url) || videoRaw,
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
    console.warn(`[football-trends] Failed to fetch ${source.label}`, error);
    return [];
  }
};

export const getTrendingCandidates = async (options: TrendScanOptions = {}): Promise<TrendCandidate[]> => {
  const sources = mergeSources(resolveSources(), options.sources);
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
