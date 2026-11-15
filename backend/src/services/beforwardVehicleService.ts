import axios from 'axios';
import * as cheerio from 'cheerio';
import crypto from 'crypto';
import https from 'https';
import sharp from 'sharp';
import { saveGeneratedImageBuffer } from './generatedMediaService.js';
import {
  isEligibleCarmarketVehicle,
  isHighValueCarmarketVehicle,
  isPreferredCarmarketModel,
  hasRecentCarmarketStock,
  CARMARKET_AUTOPOST_SOURCES,
} from './carmarketVehicleSelection.js';

export type BeforwardVehicle = {
  title: string;
  stockNo: string;
  priceUsd?: string;
  priceUgx?: number;
  source?: string;
  url: string;
  images: string[];
  summary: Record<string, string>;
  description?: string;
  ugxConversion?: { amount: number; updatedAt: string };
};

const BASE_URL = 'https://www.beforward.jp';
const CARMARKET_PUBLIC_URL = (process.env.CARMARKET_PUBLIC_URL || 'https://cmp.dott-media.org').trim().replace(/\/$/, '');
const CARMARKET_APP_URL = (process.env.CARMARKET_APP_URL || 'https://app.dott-media.org').trim().replace(/\/$/, '');
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

const escapeSvg = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const decodeHtmlText = (value: string) =>
  value
    .replace(/&#8211;/g, '-')
    .replace(/&#038;/g, '&')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function extractVehicleDescription(html: string, source: string): string {
  const $ = cheerio.load(html);
  if (source === 'CarMarketplace') {
    const heading = $('h1,h2,h3').filter((_, el) => $(el).text().trim().toLowerCase() === 'about this vehicle').first();
    const description = heading.parent().find('p.whitespace-pre-line').first().text().trim();
    if (description) return description;
  }
  for (const element of $('script[type="application/ld+json"]').toArray()) {
    try {
      const data = JSON.parse($(element).text());
      const entries = Array.isArray(data) ? data : data['@graph'] || [data];
      for (const entry of entries) {
        const type = Array.isArray(entry?.['@type']) ? entry['@type'] : [entry?.['@type']];
        if (type.some((value: unknown) => /^(vehicle|car|product)$/i.test(String(value))) && typeof entry.description === 'string' && entry.description.trim()) return entry.description.trim();
      }
    } catch { /* Ignore unrelated JSON-LD. */ }
  }
  return $('.stm-car-listing-data-single .listing-description, .listing-description, .vehicle-description').first().text().trim()
    || $('meta[property="og:description"]').attr('content')?.trim()
    || $('meta[name="description"]').attr('content')?.trim()
    || '';
}

async function fetchHtml(url: string) {
  const response = await axios.get(url, {
    headers: { 'User-Agent': USER_AGENT },
    httpsAgent,
    timeout: 30000,
  });
  return String(response.data ?? '');
}

const absoluteUrl = (value: string, baseUrl: string) => {
  try {
    return new URL(value, `${baseUrl}/`).toString();
  } catch {
    return '';
  }
};

const fetchImageBuffer = async (url: string) => {
  const response = await axios.get<ArrayBuffer>(url, {
    responseType: 'arraybuffer',
    headers: { 'User-Agent': USER_AGENT },
    httpsAgent,
    timeout: 30000,
  });
  return Buffer.from(response.data);
};

export function formatCarmarketCoverPrice(value?: number) {
  if (!value || !Number.isFinite(value) || value <= 0) return 'Price on request';
  if (value >= 1_000_000) {
    return `Only ${Number((value / 1_000_000).toFixed(6))}M`;
  }
  return `Only UGX ${Math.round(value).toLocaleString('en-US')}`;
}

let ugxRateCache: { rate: number; updatedAt: string; fetchedAt: number } | undefined;
let ugxRateRequest: Promise<{ rate: number; updatedAt: string; fetchedAt: number }> | undefined;

export function parseUsdUgxRate(data: any, now = Date.now()) {
  const rate = Number(data?.rates?.UGX);
  const updated = Number(data?.time_last_update_unix) * 1000;
  if (data?.result !== 'success' || data?.base_code !== 'USD' || !Number.isFinite(rate) || rate <= 0 ||
      !Number.isFinite(updated) || updated > now + 300_000 || now - updated > 72 * 60 * 60 * 1000) {
    throw new Error('USD to UGX rate unavailable or stale');
  }
  return { rate, updatedAt: new Date(updated).toISOString(), fetchedAt: now };
}

async function getUsdUgxRate() {
  if (ugxRateCache && Date.now() - ugxRateCache.fetchedAt < 60 * 60 * 1000) return ugxRateCache;
  if (!ugxRateRequest) {
    ugxRateRequest = axios.get('https://open.er-api.com/v6/latest/USD', { timeout: 10000 })
      .then(response => { ugxRateCache = parseUsdUgxRate(response.data); return ugxRateCache; })
      .finally(() => { ugxRateRequest = undefined; });
  }
  return ugxRateRequest;
}

export function extractCarmarketListingPrice(text: string) {
  const ugx = text.match(/\blisted\s+(?:for sale|for rent)\s+at\s+UGX\s*([\d,]+(?:\.\d+)?)/i)?.[1];
  const usd = text.match(/\blisted\s+(?:for sale|for rent)\s+at\s+\$\s*([\d,]+(?:\.\d+)?)/i)?.[1];
  return { priceUgx: ugx ? Number(ugx.replace(/,/g, '')) : undefined, priceUsd: usd?.replace(/,/g, '') };
}

const estimateUgxFromUsd = (priceUsd?: string) => {
  const numeric = Number(String(priceUsd ?? '').replace(/[^\d.]/g, ''));
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
  const rate = Number(process.env.CARMARKET_USD_TO_UGX || 3800);
  return Math.round(numeric * rate);
};

async function uploadCarmarketImage(buffer: Buffer, folder = 'covers') {
  const supabaseUrl = (process.env.SUPABASE_URL ?? '').trim().replace(/\/$/, '');
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  const bucket = process.env.CLIENT_CAMPAIGN_BUCKET?.trim() || 'dott-campaign';
  if (supabaseUrl && serviceRoleKey) {
    try {
      const safeFolder = folder.replace(/[^a-z0-9_-]/gi, '') || 'covers';
      const objectPath = `client-autopost/carmarket/${safeFolder}/${new Date().toISOString().slice(0, 10)}/${Date.now()}-${crypto.randomUUID()}.jpg`;
      await axios.post(`${supabaseUrl}/storage/v1/object/${bucket}/${objectPath}`, buffer, {
        headers: {
          Authorization: `Bearer ${serviceRoleKey}`,
          apikey: serviceRoleKey,
          'Content-Type': 'image/jpeg',
          'x-upsert': 'true',
        },
        maxBodyLength: Infinity,
        timeout: 30000,
      });
      return `${supabaseUrl}/storage/v1/object/public/${bucket}/${objectPath}`;
    } catch (error) {
      console.warn('[carmarket] Supabase cover upload failed; using generated media fallback', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return saveGeneratedImageBuffer(buffer, 'jpg');
}

const extractCarbarnEmbeddedImages = (html: string, title: string) => {
  const escapedTitle = escapeRegExp(title).replace(/\s+/g, '\\s+');
  const block = html.match(
    new RegExp(`\\\\\"title\\\\\":\\\\\"${escapedTitle}\\\\\"[\\s\\S]{0,14000}?\\\\\"exteriorPhoto\\\\\":\\[(.*?)\\]`, 'i'),
  )?.[1];
  if (!block) return [];
  return unique(
    Array.from(block.matchAll(/\\\"(https?:[^\\\"]+?\.(?:jpg|jpeg|png|webp))\\\"/gi)).map(match =>
      match[1].replace(/\\\//g, '/'),
    ),
  );
};

const parseCarbarnEmbeddedVehicles = (html: string): BeforwardVehicle[] => {
  const vehicles: BeforwardVehicle[] = [];
  const vehiclePattern =
    /\\"title\\":\\"([^\\"]+)\\"[\s\S]{0,1600}?\\"slug\\":\\"([^\\"]+)\\"[\s\S]{0,1600}?\\"stockNo\\":\\"([^\\"]+)\\"[\s\S]{0,10000}?\\"exteriorPhoto\\":\[(.*?)\][\s\S]{0,8000}?\\"UG\\":\{(.*?)\}/gi;
  for (const match of html.matchAll(vehiclePattern)) {
    const [, rawTitle, rawSlug, rawStockNo, photoBlock, priceBlock] = match;
    const images = unique(
      Array.from(photoBlock.matchAll(/\\"(https?:[^\\"]+?\.(?:jpg|jpeg|png|webp))\\"/gi)).map(imageMatch =>
        imageMatch[1].replace(/\\\//g, '/'),
      ),
    );
    if (!images.length) continue;
    const priceUgx = Number(priceBlock.match(/\\"salePrice\\":(\d+)/i)?.[1]);
    const priceUsd = priceBlock.match(/\\"salePriceInUSD\\":(\d+)/i)?.[1];
    vehicles.push({
      title: rawTitle.replace(/\\"/g, '"').trim(),
      stockNo: `CARBARN-${rawStockNo.trim()}`,
      priceUsd: priceUsd || undefined,
      priceUgx: Number.isFinite(priceUgx) ? priceUgx : undefined,
      source: 'Carbarn Uganda',
      url: `https://www.carbarn.ug/vehicles/${rawSlug.trim()}`,
      images: images.slice(0, 10),
      summary: {},
    });
  }
  return vehicles;
};

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
    priceUgx: estimateUgxFromUsd(priceUsd),
    source: 'BE FORWARD',
    url: vehicleUrl,
    images,
    summary: {},
  };
}

async function pickCarbarnVehicle(options: { recentStockNos?: Set<string> } = {}): Promise<BeforwardVehicle> {
  const html = await fetchHtml('https://www.carbarn.ug/cars');
  let fallback: BeforwardVehicle | null = null;
  for (const vehicle of parseCarbarnEmbeddedVehicles(html)) {
    if (hasRecentCarmarketStock(vehicle.stockNo, options.recentStockNos)) continue;
    if (vehicle.images.length > 0 && isEligibleCarmarketVehicle(vehicle)) {
      if (isHighValueCarmarketVehicle(vehicle)) return vehicle;
      fallback ??= vehicle;
    }
  }
  if (fallback) return fallback;
  const $ = cheerio.load(html);
  const scripts = $('script[type="application/ld+json"]')
    .toArray()
    .map(element => $(element).text())
    .filter(Boolean);
  for (const script of scripts) {
    try {
      const json = JSON.parse(script);
      const items = json?.mainEntity?.itemListElement;
      if (!Array.isArray(items)) continue;
      for (const entry of items) {
        const item = entry?.item;
        const title = String(item?.name ?? '');
        if (!isEligibleCarmarketVehicle({ title, summary: {}, priceUgx: Number(item?.offers?.price) })) continue;
        const url = String(item?.url ?? '').trim();
        const stockNo = url.match(/-(\d+)$/)?.[1] || url.split('/').pop() || '';
        if (hasRecentCarmarketStock(`CARBARN-${stockNo}`, options.recentStockNos)) continue;
        const image = normalizeUrl(String(item?.image ?? '').trim());
        if (!url || !image) continue;
        const embeddedImages = extractCarbarnEmbeddedImages(html, String(item?.name ?? '').trim());
        const priceUgx = Number(item?.offers?.price);
        const vehicle = {
          title: title.trim() || 'Carbarn vehicle',
          stockNo: `CARBARN-${stockNo}`,
          priceUsd: item?.offers?.price ? undefined : undefined,
          priceUgx: Number.isFinite(priceUgx) ? priceUgx : undefined,
          source: 'Carbarn Uganda',
          url,
          images: embeddedImages.length ? embeddedImages.slice(0, 10) : [image],
          summary: {
            fuel: String(item?.vehicleEngine?.fuelType ?? item?.vehicleConfiguration ?? '').trim(),
            mileage: String(item?.mileageFromOdometer?.value ?? '').trim(),
            transmission: String(item?.vehicleTransmission ?? '').trim(),
            color: String(item?.color ?? '').trim(),
          },
        };
        if (isHighValueCarmarketVehicle(vehicle)) return vehicle;
        fallback ??= vehicle;
      }
    } catch {
      // Try the next structured data block.
    }
  }
  if (fallback) return fallback;
  throw new Error('No usable Carbarn vehicle listing found');
}

async function fetchMileleVehicle(url: string): Promise<BeforwardVehicle> {
  const vehicleUrl = normalizeUrl(url);
  const html = await fetchHtml(vehicleUrl);
  const $ = cheerio.load(html);
  const title = decodeHtmlText(
    $('.stm-listing-single-price-title h1').first().text() ||
      $('h1').first().text() ||
      $('title').text().replace(/\s*-\s*Milele Motors.*$/i, '') ||
      'Milele vehicle',
  );
  const images = unique(
    [
      ...Array.from(html.matchAll(/data-src-img=["']([^"']+?\.(?:jpg|jpeg|png|webp)(?:\?[^"']*)?)["']/gi)).map(
        match => match[1],
      ),
      ...Array.from(html.matchAll(/https?:\/\/milele\.com\/wp-content\/uploads\/[^"'\s<>]+?\.(?:jpg|jpeg|png|webp)/gi)).map(
        match => match[0],
      ),
    ].map(url => normalizeUrl(url)),
  ).slice(0, 10);
  if (!images.length) throw new Error('No Milele vehicle gallery images found');
  const slug = vehicleUrl.replace(/\/+$/, '').split('/').pop() || crypto.randomUUID();
  const priceText = /PRICE\s+AS\s+REQUEST/i.test(html) ? undefined : $('body').text().match(/\$\s*[\d,]+/)?.[0];
  return {
    title,
    stockNo: `MILELE-${slug.toUpperCase().replace(/[^A-Z0-9]+/g, '-').slice(0, 42)}`,
    priceUsd: priceText?.replace(/[^\d.]/g, ''),
    priceUgx: estimateUgxFromUsd(priceText),
    source: 'Milele',
    url: vehicleUrl,
    images,
    description: extractVehicleDescription(html, 'Milele'),
    summary: {},
  };
}

async function pickMileleVehicle(options: { recentStockNos?: Set<string> } = {}): Promise<BeforwardVehicle> {
  const html = await fetchHtml('https://milele.com/inventory/');
  const links = unique(
    Array.from(html.matchAll(/https:\/\/milele\.com\/listings\/[^"'\s<>]+?\//gi)).map(match => match[0]),
  );
  const preferred = [
    ...links.filter(link => /\/rhd-/i.test(link)),
    ...links.filter(link => !/\/rhd-/i.test(link) && /toyota|lexus|nissan|mercedes|mitsubishi|suzuki/i.test(link)),
    ...links,
  ];
  let fallback: BeforwardVehicle | null = null;
  for (const link of unique(preferred)) {
    const stockKey = `MILELE-${link.replace(/\/+$/, '').split('/').pop()?.toUpperCase().replace(/[^A-Z0-9]+/g, '-').slice(0, 42)}`;
    if (hasRecentCarmarketStock(stockKey, options.recentStockNos)) continue;
    try {
      const vehicle = await fetchMileleVehicle(link);
      if (vehicle.images.length > 0 && isEligibleCarmarketVehicle(vehicle)) {
        if (isHighValueCarmarketVehicle(vehicle)) return vehicle;
        fallback ??= vehicle;
      }
    } catch {
      // Try the next Milele listing.
    }
  }
  if (fallback) return fallback;
  throw new Error('No usable Milele vehicle listing found');
}

/**
 * Read the public CarMarketplace app inventory. The app exposes its current
 * listings in server-rendered HTML, while each detail page contains the full
 * gallery and vehicle facts needed for an autopost.
 */
export async function fetchCarmarketAppVehicle(url: string): Promise<BeforwardVehicle> {
  const vehicleUrl = absoluteUrl(url, CARMARKET_APP_URL);
  if (!vehicleUrl) throw new Error('Invalid CarMarketplace vehicle URL');
  const html = await fetchHtml(vehicleUrl);
  const $ = cheerio.load(html);
  const body = $('body').clone();
  body.find('script, style, noscript').remove();
  const bodyText = decodeHtmlText(body.text());
  const title = decodeHtmlText(
    $('meta[property="og:title"]').attr('content')?.replace(/\s*[—-]\s*\$[\d,]+.*$/i, '') ||
      $('h1').first().text() ||
      $('title').text().replace(/\s*[—-]\s*\$[\d,]+.*$/i, '') ||
      'CarMarketplace vehicle',
  );
  const id = new URL(vehicleUrl).searchParams.get('id')?.trim() || '';
  const imagePattern = id
    ? new RegExp(`https://[^\\s"'<>]+/vehicles/${escapeRegExp(id)}/\\d+\\.(?:jpg|jpeg|png|webp)`, 'gi')
    : /https:\/\/[^\s"'<>]+\/vehicles\/[^\s"'<>]+\/\d+\.(?:jpg|jpeg|png|webp)/gi;
  const images = unique(Array.from(html.matchAll(imagePattern), match => match[0].replace(/&amp;/g, '&'))).slice(0, 10);
  if (!images.length) throw new Error('CarMarketplace listing has no usable gallery');
  const year = bodyText.match(/\b(?:19|20)\d{2}\b/)?.[0] || title.match(/\b(?:19|20)\d{2}\b/)?.[0] || '';
  const { priceUsd, priceUgx } = extractCarmarketListingPrice(bodyText);
  const mileage = bodyText.match(/([\d,]+)\s*mi\b/i)?.[1]?.replace(/,/g, '') || '';
  return {
    title,
    stockNo: id ? `CARMARKET-${id}` : `CARMARKET-${crypto.createHash('sha1').update(vehicleUrl).digest('hex').slice(0, 12)}`,
    priceUsd,
    priceUgx,
    source: 'CarMarketplace',
    url: vehicleUrl,
    images,
    description: extractVehicleDescription(html, 'CarMarketplace'),
    summary: { year, mileage },
  };
}

async function pickCarmarketAppVehicle(options: { recentStockNos?: Set<string> } = {}): Promise<BeforwardVehicle> {
  const html = await fetchHtml(`${CARMARKET_APP_URL}/homepage`);
  const $ = cheerio.load(html);
  const links = unique(
    $('a[href*="/vehicle-detail?id="]')
      .toArray()
      .map(element => absoluteUrl($(element).attr('href') || '', CARMARKET_APP_URL)),
  );
  if (!links.length) throw new Error('No public CarMarketplace listings found');
  const start = Math.floor(Math.random() * links.length);
  const ordered = links.slice(start).concat(links.slice(0, start));
  const errors: string[] = [];
  let fallback: BeforwardVehicle | null = null;
  for (const link of ordered.slice(0, 12)) {
    try {
      const vehicle = await fetchCarmarketAppVehicle(link);
      if (hasRecentCarmarketStock(vehicle.stockNo, options.recentStockNos)) continue;
      if (isEligibleCarmarketVehicle(vehicle)) {
        if (isHighValueCarmarketVehicle(vehicle)) return vehicle;
        fallback ??= vehicle;
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (fallback) return fallback;
  throw new Error(`No eligible CarMarketplace listing found: ${errors.join('; ')}`);
}

export async function pickBeforwardVehicle(options: {
  searchUrl?: string;
  recentStockNos?: Set<string>;
} = {}) {
  const searchUrl = options.searchUrl || `${BASE_URL}/stocklist/year_from=2016/sortkey=n/`;
  const html = await fetchHtml(searchUrl);
  const links = unique(
    Array.from(html.matchAll(/href="(\/[a-z0-9-]+\/[a-z0-9-]+\/[a-z]{2}\d{6}\/id\/\d+\/)"/gi)).map(match =>
      normalizeUrl(match[1]),
    ),
  );
  let fallback: BeforwardVehicle | null = null;
  for (const link of links) {
    // Model names are available in listing URLs; avoid fetching economy cars.
    const modelTitle = link.replace(BASE_URL, '').split('/').slice(1, 3).join(' ').replace(/-/g, ' ');
    if (!isPreferredCarmarketModel(modelTitle)) continue;
    const stockNo = link.match(/\/([a-z]{2}\d{6})\//i)?.[1]?.toUpperCase();
    if (stockNo && options.recentStockNos?.has(stockNo)) continue;
    try {
      const vehicle = await fetchBeforwardVehicle(link);
      if (vehicle.images.length > 1 && isEligibleCarmarketVehicle(vehicle)) {
        if (isHighValueCarmarketVehicle(vehicle)) return vehicle;
        fallback ??= vehicle;
      }
    } catch {
      // Try the next listing.
    }
  }
  if (fallback) return fallback;
  throw new Error('No usable BE FORWARD vehicle listing found');
}

export function getCarmarketSourceKey(vehicle: Pick<BeforwardVehicle, 'source'>): string {
  const source = String(vehicle.source ?? '').toLowerCase();
  if (source.includes('carbarn')) return 'carbarn';
  if (source.includes('milele')) return 'milele';
  if (source.includes('forward')) return 'beforward';
  if (source.includes('carmarket')) return 'carmarketplace';
  return 'carmarketplace';
}

export async function pickCarmarketVehicle(options: {
  recentStockNos?: Set<string>;
  recentSourceKeys?: string[];
} = {}) {
  const allSources = [
    { key: CARMARKET_AUTOPOST_SOURCES[0], pick: pickCarmarketAppVehicle },
    { key: CARMARKET_AUTOPOST_SOURCES[1], pick: pickCarbarnVehicle },
    { key: CARMARKET_AUTOPOST_SOURCES[2], pick: pickMileleVehicle },
  ];
  const priority = (process.env.CARMARKET_SOURCE_PRIORITY ?? '').trim().toLowerCase();
  const configured = priority
    ? [...allSources.filter(source => source.key === priority), ...allSources.filter(source => source.key !== priority)]
    : allSources;
  const lastSource = options.recentSourceKeys?.find(key => allSources.some(source => source.key === key));
  const start = lastSource
    ? (allSources.findIndex(source => source.key === lastSource) + 1) % allSources.length
    : priority
      ? 0
      : Math.floor(Math.random() * allSources.length);
  const sources = lastSource
    ? allSources.slice(start).concat(allSources.slice(0, start))
    : configured;
  const errors: string[] = [];
  for (let index = 0; index < sources.length; index += 1) {
    const source = sources[index];
    try {
      const vehicle = await source.pick(options);
      if (source.key === 'carbarn') {
        const detailHtml = await fetchHtml(vehicle.url);
        vehicle.description = extractVehicleDescription(detailHtml, 'Carbarn Uganda');
      }
      return vehicle;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error(`No usable Carmarket vehicle listing found: ${errors.join('; ')}`);
}

export async function renderCarmarketCoverImage(vehicle: BeforwardVehicle) {
  const sourceImageUrl = vehicle.images[0];
  if (!sourceImageUrl) return null;
  const source = await fetchImageBuffer(sourceImageUrl);
  const width = 1080;
  const height = 1080;
  // Milele and BE FORWARD populate priceUgx from an older estimate, not a seller quote.
  const quotedUgx = vehicle.source === 'Milele' || vehicle.source === 'BE FORWARD' ? undefined : vehicle.priceUgx;
  vehicle.ugxConversion = undefined;
  const usd = Number(String(vehicle.priceUsd ?? '').replace(/,/g, ''));
  if (!quotedUgx && Number.isFinite(usd) && usd > 0) {
    try {
      const exchange = await getUsdUgxRate();
      vehicle.ugxConversion = { amount: Math.round(usd * exchange.rate), updatedAt: exchange.updatedAt };
    } catch (error) {
      console.warn('[carmarket] Live USD to UGX rate unavailable; omitting converted price');
    }
  }
  const coverAmount = quotedUgx || vehicle.ugxConversion?.amount;
  const priceText = vehicle.ugxConversion ? formatCarmarketCoverPrice(Math.round(coverAmount! / 100_000) * 100_000) : formatCarmarketCoverPrice(coverAmount);
  const priceFontSize = priceText.length > 12 ? 34 : 48;
  const title = vehicle.title.replace(/\s+/g, ' ').trim();
  const headline = title.length > 34 ? `${title.slice(0, 31).trim()}...` : title;
  const base = await sharp(source)
    .rotate()
    .resize(width, height, { fit: 'cover', position: 'attention' })
    .sharpen()
    .jpeg({ quality: 92, mozjpeg: true, chromaSubsampling: '4:4:4' })
    .toBuffer();
  const svg = `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#05070a" stop-opacity="0.04"/>
          <stop offset="0.55" stop-color="#05070a" stop-opacity="0.02"/>
          <stop offset="1" stop-color="#05070a" stop-opacity="0.82"/>
        </linearGradient>
      </defs>
      <rect width="${width}" height="${height}" fill="url(#shade)"/>
      <rect x="58" y="58" width="318" height="54" rx="27" fill="#05070a" opacity="0.74"/>
      <text x="86" y="94" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="900">CarMarketPlace</text>
      <rect x="58" y="792" width="420" height="104" rx="34" fill="#facc15"/>
      <text x="92" y="860" fill="#111827" font-family="Arial Black, Arial, Helvetica, sans-serif" font-size="${priceFontSize}" font-weight="900">${escapeSvg(priceText)}</text>
      ${vehicle.ugxConversion ? '<text x="92" y="884" fill="#111827" font-family="Arial, Helvetica, sans-serif" font-size="17">Approx. UGX · ExchangeRate-API</text>' : ''}
      <rect x="58" y="912" width="${width - 116}" height="88" rx="28" fill="#05070a" opacity="0.70"/>
      <text x="88" y="968" fill="#ffffff" font-family="Arial Black, Arial, Helvetica, sans-serif" font-size="36" font-weight="900">${escapeSvg(headline)}</text>
    </svg>
  `;
  const buffer = await sharp(base)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .jpeg({ quality: 93, mozjpeg: true, chromaSubsampling: '4:4:4' })
    .toBuffer();
  return uploadCarmarketImage(buffer, 'covers');
}

export async function renderCarmarketListingImage(source: Buffer) {
  const logo = Buffer.from(`
    <svg width="1080" height="1080" xmlns="http://www.w3.org/2000/svg">
      <rect x="58" y="58" width="318" height="54" rx="27" fill="#05070a" opacity="0.74"/>
      <text x="86" y="94" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="900">CarMarketPlace</text>
    </svg>
  `);
  return sharp(source)
    .rotate()
    .resize(1080, 1080, { fit: 'cover', position: 'attention' })
    .sharpen()
    .composite([{ input: logo, top: 0, left: 0 }])
    .jpeg({ quality: 92, mozjpeg: true, chromaSubsampling: '4:4:4' })
    .toBuffer();
}

export async function prepareCarmarketVehicleImage(imageUrl: string) {
  const source = await fetchImageBuffer(imageUrl);
  const buffer = await renderCarmarketListingImage(source);
  return uploadCarmarketImage(buffer, 'listing');
}

export function buildCarmarketVehicleCaption(vehicle: BeforwardVehicle) {
  const conversionNote = vehicle.ugxConversion
    ? `\n\nUGX amount on image is approximate; the seller lists this vehicle in USD. Rates by Exchange Rate API: https://www.exchangerate-api.com (updated ${vehicle.ugxConversion.updatedAt.slice(0, 10)}). Confirm the final price with the seller.`
    : '';
  if (vehicle.description?.trim()) {
    const usd = vehicle.priceUsd ? `$${Number(vehicle.priceUsd.replace(/,/g, '')).toLocaleString('en-US')}` : '';
    const amount = vehicle.source === 'Milele' ? usd : vehicle.priceUgx ? `UGX ${vehicle.priceUgx.toLocaleString('en-US')}` : usd;
    return (amount && !vehicle.description.includes(amount) ? `${vehicle.description.trim()}\n\nListed price: ${amount}. See the listing for any additional fees.\n${vehicle.url}` : vehicle.description.trim()) + conversionNote;
  }
  const priceUsd = vehicle.priceUsd ? `Listed price: $${vehicle.priceUsd}` : '';
  const lines = [
    `${vehicle.title}`,
    vehicle.source ? `Source: ${vehicle.source}` : '',
    vehicle.stockNo ? `Stock: ${vehicle.stockNo}` : '',
    priceUsd,
    '',
    vehicle.url,
  ];
  return lines.filter((line, index) => line || lines[index - 1]).join('\n') + conversionNote;
}
