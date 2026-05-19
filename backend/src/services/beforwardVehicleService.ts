import axios from 'axios';
import * as cheerio from 'cheerio';
import https from 'https';

export type BeforwardVehicle = {
  title: string;
  stockNo: string;
  priceUsd?: string;
  url: string;
  images: string[];
  summary: Record<string, string>;
};

const BASE_URL = 'https://www.beforward.jp';
const USER_AGENT =
  process.env.BEFORWARD_USER_AGENT ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const httpsAgent =
  process.env.BEFORWARD_TLS_INSECURE === 'false' ? undefined : new https.Agent({ rejectUnauthorized: false });

const normalizeUrl = (value: string) => {
  const trimmed = value.trim().replace(/&amp;/g, '&');
  if (!trimmed) return '';
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  if (trimmed.startsWith('/')) return `${BASE_URL}${trimmed}`;
  return trimmed;
};

const unique = (items: string[]) => {
  const seen = new Set<string>();
  return items.filter(item => {
    const normalized = item.trim();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
};

async function fetchHtml(url: string) {
  const response = await axios.get(url, {
    headers: { 'User-Agent': USER_AGENT },
    httpsAgent,
    timeout: 30000,
  });
  return String(response.data ?? '');
}

export async function fetchBeforwardVehicle(url: string): Promise<BeforwardVehicle> {
  const vehicleUrl = normalizeUrl(url);
  const html = await fetchHtml(vehicleUrl);
  const $ = cheerio.load(html);
  const title =
    $('meta[property="og:title"]').attr('content')?.replace(/^BE FORWARD\s*:\s*/i, '').trim() ||
    $('title').text().replace(/\s*-\s*BE FORWARD.*$/i, '').trim() ||
    'BE FORWARD vehicle';
  const stockNo =
    $('script[type="application/ld+json"]')
      .text()
      .match(/"sku"\s*:\s*"([^"]+)"/i)?.[1]
      ?.trim() ||
    $('meta[property="og:description"]').attr('content')?.match(/^([^,\s]+)/)?.[1]?.trim() ||
    vehicleUrl.match(/\/([a-z]{2}\d{6})\//i)?.[1]?.toUpperCase() ||
    '';
  const priceUsd =
    $('script[type="application/ld+json"]')
      .text()
      .match(/"price"\s*:\s*"([^"]+)"/i)?.[1]
      ?.trim() ||
    $('meta[property="og:description"]').attr('content')?.match(/\$[\d,]+/)?.[0]?.replace(/^\$/, '').trim();
  const images = unique(
    [
      ...Array.from(html.matchAll(/https?:\/\/image-cdn\.beforward\.jp\/large\/[^"'\s<>]+/gi)).map(match => match[0]),
      ...Array.from(html.matchAll(/\/\/image-cdn\.beforward\.jp\/large\/[^"'\s<>]+/gi)).map(match =>
        normalizeUrl(match[0]),
      ),
      normalizeUrl($('meta[property="og:image"]').attr('content') || ''),
    ].map(url => url.replace(/\?w=\d+$/i, '')),
  ).slice(0, 10);
  if (!images.length) {
    throw new Error('No BE FORWARD vehicle images found');
  }

  return {
    title,
    stockNo,
    priceUsd,
    url: vehicleUrl,
    images,
    summary: {},
  };
}

export async function pickBeforwardVehicle(options: {
  searchUrl?: string;
  recentStockNos?: Set<string>;
} = {}) {
  const searchUrl = options.searchUrl || `${BASE_URL}/stocklist/make=1/sortkey=n/`;
  const html = await fetchHtml(searchUrl);
  const links = unique(
    Array.from(html.matchAll(/href="(\/[a-z0-9-]+\/[a-z0-9-]+\/[a-z]{2}\d{6}\/id\/\d+\/)"/gi)).map(match =>
      normalizeUrl(match[1]),
    ),
  );
  for (const link of links) {
    const stockNo = link.match(/\/([a-z]{2}\d{6})\//i)?.[1]?.toUpperCase();
    if (stockNo && options.recentStockNos?.has(stockNo)) continue;
    try {
      const vehicle = await fetchBeforwardVehicle(link);
      if (vehicle.images.length > 1) return vehicle;
    } catch {
      // Try the next listing.
    }
  }
  throw new Error('No usable BE FORWARD vehicle listing found');
}

export function buildCarmarketVehicleCaption(vehicle: BeforwardVehicle) {
  const lines = [
    `${vehicle.title}`,
    vehicle.stockNo ? `Stock: ${vehicle.stockNo}` : '',
    vehicle.priceUsd ? `FOB price on listing: $${vehicle.priceUsd}` : '',
    '',
    'Actual vehicle photos from the listing. Swipe through the exterior and interior views, then message Carmarketug with your budget or preferred car type.',
    '',
    'Imported vehicle options are subject to availability, shipping, taxes, clearing, inspection, and local registration costs.',
    '',
    vehicle.url,
    '',
    '#Carmarketug #CarMarketUg #UgandaCars #ToyotaUganda #CarImportUganda #KampalaCars',
  ];
  return lines.filter((line, index) => line || lines[index - 1]).join('\n');
}
