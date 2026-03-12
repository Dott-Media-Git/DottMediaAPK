import axios from 'axios';
import { getSecret } from './secretVaultService.js';

export type HighlightlyFootballHighlight = {
  id: number;
  type: string;
  title: string;
  description?: string;
  url?: string;
  embedUrl?: string;
  imageUrl?: string;
  source?: string;
  channel?: string;
  leagueName?: string;
  homeTeam?: string;
  awayTeam?: string;
  score?: string;
  matchDate?: string;
};

type FetchHighlightlyFootballHighlightsOptions = {
  dates: string[];
  timezone: string;
  limit?: number;
  secretOwnerId?: string;
};

type HighlightlyApiEnvelope = {
  data?: any[];
};

const HIGHLIGHTLY_BASE_URL = (process.env.HIGHLIGHTLY_BASE_URL?.trim() || 'https://sports.highlightly.net').replace(/\/+$/, '');
const HIGHLIGHTLY_RAPID_HOST = 'sport-highlights-api.p.rapidapi.com';
const DEFAULT_ALLOWED_SOURCES = ['youtube', 'espn', 'dailymotion', 'vimeo'];
const BLOCKED_CHANNEL_PATTERNS = [/premier\s*league/i];

let missingApiKeyLogged = false;

const getConfiguredApiKey = () =>
  process.env.HIGHLIGHTLY_API_KEY?.trim() ||
  process.env.RAPIDAPI_KEY?.trim() ||
  process.env.RAPIDAPI_TOKEN?.trim() ||
  '';

const getApiKey = async (secretOwnerId?: string) => {
  const configured = getConfiguredApiKey();
  if (configured) return configured;
  const ownerId = String(secretOwnerId || '').trim();
  if (!ownerId) return '';
  try {
    const secret = await getSecret(ownerId, 'highlightly_api_key', { decrypt: true });
    return typeof secret?.value === 'string' ? secret.value.trim() : '';
  } catch (error) {
    console.warn('[highlightly] failed to resolve secret-backed API key', {
      ownerId,
      message: error instanceof Error ? error.message : String(error),
    });
    return '';
  }
};

const getAllowedSources = () => {
  const raw = process.env.HIGHLIGHTLY_ALLOWED_SOURCES?.trim();
  const list = raw
    ? raw
        .split(',')
        .map(value => value.trim().toLowerCase())
        .filter(Boolean)
    : DEFAULT_ALLOWED_SOURCES;
  return new Set(list);
};

const toText = (value: unknown) => {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || undefined;
};

const normalizeMatchDate = (value: unknown) => {
  const raw = toText(value);
  if (!raw) return undefined;
  const ts = Date.parse(raw);
  if (Number.isNaN(ts)) return undefined;
  return new Date(ts).toISOString();
};

const normalizeHighlight = (entry: any): HighlightlyFootballHighlight | null => {
  const id = Number.parseInt(String(entry?.id ?? ''), 10);
  const title = toText(entry?.title);
  if (!Number.isFinite(id) || !title) return null;

  return {
    id,
    type: toText(entry?.type) ?? 'UNVERIFIED',
    title,
    description: toText(entry?.description),
    url: toText(entry?.url),
    embedUrl: toText(entry?.embedUrl),
    imageUrl: toText(entry?.imgUrl),
    source: toText(entry?.source)?.toLowerCase(),
    channel: toText(entry?.channel),
    leagueName: toText(entry?.match?.league?.name),
    homeTeam: toText(entry?.match?.homeTeam?.name),
    awayTeam: toText(entry?.match?.awayTeam?.name),
    score: toText(entry?.match?.state?.score),
    matchDate: normalizeMatchDate(entry?.match?.date),
  };
};

const isAllowedHighlight = (item: HighlightlyFootballHighlight, allowedSources: Set<string>) => {
  if (item.type.toUpperCase() !== 'VERIFIED') return false;
  if (!item.source || !allowedSources.has(item.source)) return false;
  if (BLOCKED_CHANNEL_PATTERNS.some(pattern => pattern.test(item.channel || ''))) return false;
  return true;
};

export const fetchHighlightlyFootballHighlights = async (
  options: FetchHighlightlyFootballHighlightsOptions,
): Promise<HighlightlyFootballHighlight[]> => {
  const apiKey = await getApiKey(options.secretOwnerId);
  if (!apiKey) {
    if (!missingApiKeyLogged) {
      missingApiKeyLogged = true;
      console.warn('[highlightly] No HIGHLIGHTLY_API_KEY configured; skipping Highlightly football highlights.');
    }
    return [];
  }

  const allowedSources = getAllowedSources();
  const limit = Math.min(Math.max(options.limit ?? 5, 1), 5);
  const dates = Array.from(new Set(options.dates.map(value => String(value || '').trim()).filter(Boolean))).slice(0, 2);
  const headers: Record<string, string> = {
    'x-rapidapi-key': apiKey,
  };

  if (HIGHLIGHTLY_BASE_URL.includes('rapidapi.com')) {
    headers['x-rapidapi-host'] = HIGHLIGHTLY_RAPID_HOST;
  }

  const collected: HighlightlyFootballHighlight[] = [];
  for (const date of dates) {
    try {
      const response = await axios.get<HighlightlyApiEnvelope>(`${HIGHLIGHTLY_BASE_URL}/football/highlights`, {
        headers,
        params: {
          date,
          timezone: options.timezone,
          limit,
          offset: 0,
        },
        timeout: 15000,
      });
      const rows = Array.isArray(response.data?.data) ? response.data.data : [];
      for (const row of rows) {
        const normalized = normalizeHighlight(row);
        if (!normalized || !isAllowedHighlight(normalized, allowedSources)) continue;
        collected.push(normalized);
      }
    } catch (error) {
      console.warn('[highlightly] football highlights fetch failed', {
        date,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const seen = new Set<string>();
  return collected
    .filter(item => {
      const key = `${item.id}|${item.url || ''}|${item.title}`.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      const aTime = a.matchDate ? Date.parse(a.matchDate) : 0;
      const bTime = b.matchDate ? Date.parse(b.matchDate) : 0;
      return bTime - aTime;
    });
};
