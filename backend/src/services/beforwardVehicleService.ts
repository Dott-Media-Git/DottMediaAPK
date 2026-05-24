import axios from 'axios';
import * as cheerio from 'cheerio';
import crypto from 'crypto';
import https from 'https';
import sharp from 'sharp';
import { saveGeneratedImageBuffer } from './generatedMediaService.js';

export type BeforwardVehicle = {
  title: string;
  stockNo: string;
  priceUsd?: string;
  priceUgx?: number;
  source?: string;
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

async function fetchHtml(url: string) {
  const response = await axios.get(url, {
    headers: { 'User-Agent': USER_AGENT },
    httpsAgent,
    timeout: 30000,
  });
  return String(response.data ?? '');
}

const fetchImageBuffer = async (url: string) => {
  const response = await axios.get<ArrayBuffer>(url, {
    responseType: 'arraybuffer',
    headers: { 'User-Agent': USER_AGENT },
    httpsAgent,
    timeout: 30000,
  });
  return Buffer.from(response.data);
};

const formatUgxMillions = (value?: number) => {
  if (!value || !Number.isFinite(value) || value <= 0) return '';
  const millions = value / 1_000_000;
  const rounded = millions >= 100 ? Math.round(millions) : Math.round(millions * 10) / 10;
  return `Only ${String(rounded).replace(/\.0$/, '')}M`;
};

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
  for (const vehicle of parseCarbarnEmbeddedVehicles(html)) {
    if (vehicle.stockNo && options.recentStockNos?.has(vehicle.stockNo)) continue;
    if (vehicle.images.length > 1) return vehicle;
  }
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
        const url = String(item?.url ?? '').trim();
        const stockNo = url.match(/-(\d+)$/)?.[1] || url.split('/').pop() || '';
        if (stockNo && options.recentStockNos?.has(`CARBARN-${stockNo}`)) continue;
        const image = normalizeUrl(String(item?.image ?? '').trim());
        if (!url || !image) continue;
        const embeddedImages = extractCarbarnEmbeddedImages(html, String(item?.name ?? '').trim());
        const priceUgx = Number(item?.offers?.price);
        return {
          title: String(item?.name ?? 'Carbarn vehicle').trim(),
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
      }
    } catch {
      // Try the next structured data block.
    }
  }
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
  if (images.length < 2) throw new Error('No Milele vehicle gallery images found');
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
  for (const link of unique(preferred)) {
    const stockKey = `MILELE-${link.replace(/\/+$/, '').split('/').pop()?.toUpperCase().replace(/[^A-Z0-9]+/g, '-').slice(0, 42)}`;
    if (stockKey && options.recentStockNos?.has(stockKey)) continue;
    try {
      const vehicle = await fetchMileleVehicle(link);
      if (vehicle.images.length > 1) return vehicle;
    } catch {
      // Try the next Milele listing.
    }
  }
  throw new Error('No usable Milele vehicle listing found');
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

export async function pickCarmarketVehicle(options: { recentStockNos?: Set<string> } = {}) {
  const allSources = [
    { key: 'carbarn', pick: pickCarbarnVehicle },
    { key: 'milele', pick: pickMileleVehicle },
    { key: 'beforward', pick: pickBeforwardVehicle },
  ];
  const priority = (process.env.CARMARKET_SOURCE_PRIORITY ?? '').trim().toLowerCase();
  const sources = priority
    ? [...allSources.filter(source => source.key === priority), ...allSources.filter(source => source.key !== priority)]
    : allSources;
  const start = Math.floor(Math.random() * sources.length);
  const errors: string[] = [];
  for (let index = 0; index < sources.length; index += 1) {
    const source = priority ? sources[index] : sources[(start + index) % sources.length];
    try {
      return await source.pick(options);
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
  const priceText = formatUgxMillions(vehicle.priceUgx ?? estimateUgxFromUsd(vehicle.priceUsd));
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
      ${
        priceText
          ? `<rect x="58" y="792" width="420" height="104" rx="34" fill="#facc15"/>
      <text x="92" y="860" fill="#111827" font-family="Arial Black, Arial, Helvetica, sans-serif" font-size="54" font-weight="900">${priceText}</text>`
          : ''
      }
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

export async function prepareCarmarketVehicleImage(imageUrl: string) {
  const source = await fetchImageBuffer(imageUrl);
  const buffer = await sharp(source)
    .rotate()
    .resize(1080, 1080, { fit: 'cover', position: 'attention' })
    .sharpen()
    .jpeg({ quality: 92, mozjpeg: true, chromaSubsampling: '4:4:4' })
    .toBuffer();
  return uploadCarmarketImage(buffer, 'listing');
}

export function buildCarmarketVehicleCaption(vehicle: BeforwardVehicle) {
  const priceUsd = vehicle.priceUsd ? `FOB price on listing: $${vehicle.priceUsd}` : '';
  const lines = [
    `${vehicle.title}`,
    vehicle.source ? `Source: ${vehicle.source}` : '',
    vehicle.stockNo ? `Stock: ${vehicle.stockNo}` : '',
    priceUsd,
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
