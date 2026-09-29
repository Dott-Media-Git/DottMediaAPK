import axios from 'axios';
import * as cheerio from 'cheerio';

export type WebSearchResult = {
  title: string;
  url: string;
  snippet: string;
};

const SEARCH_TIMEOUT_MS = 8_000;

/**
 * Lightweight public web search for research and current-information requests.
 * Results are intentionally kept small so they can be safely passed to the model.
 */
export const searchWeb = async (query: string, limit = 5): Promise<WebSearchResult[]> => {
  const trimmed = query.trim().slice(0, 240);
  if (!trimmed) return [];

  const response = await axios.get('https://html.duckduckgo.com/html/', {
    params: { q: trimmed },
    timeout: SEARCH_TIMEOUT_MS,
    headers: {
      'User-Agent': 'Dotti/1.0 (web research assistant)',
      Accept: 'text/html,application/xhtml+xml',
    },
  });

  const $ = cheerio.load(String(response.data ?? ''));
  const results: WebSearchResult[] = [];
  $('.result').each((_index, element) => {
    if (results.length >= limit) return;
    const link = $(element).find('.result__a').first();
    const title = link.text().replace(/\s+/g, ' ').trim();
    const rawUrl = link.attr('href')?.trim() ?? '';
    const url = rawUrl.startsWith('//') ? `https:${rawUrl}` : rawUrl;
    const snippet = $(element).find('.result__snippet').text().replace(/\s+/g, ' ').trim();
    if (title && url && snippet) results.push({ title, url, snippet: snippet.slice(0, 500) });
  });
  return results;
};
