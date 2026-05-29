import axios from 'axios';
import crypto from 'crypto';
import fs from 'fs';
import https from 'https';
import path from 'path';
import sharp from 'sharp';
import { saveGeneratedImageBuffer } from './generatedMediaService.js';

export type DottEnergyProduct = {
  id: string;
  title: string;
  handle: string;
  url: string;
  vendor?: string;
  productType?: string;
  priceUsd?: string;
  powerOptions: string[];
  voltageOptions: string[];
  description?: string;
  images: string[];
};

export type DottEnergyFallbackPoster = {
  key: string;
  filePath: string;
  name: string;
};

export type DottEnergyEducationTopic = {
  id: string;
  headline: string;
  body: string;
  buyerReason: string;
};

const SHOP_URL = (process.env.DOTT_ENERGY_SHOP_URL ?? 'https://dott-energy-2.myshopify.com').replace(/\/$/, '');
const PRODUCTS_URL = `${SHOP_URL}/products.json?limit=60`;
const USER_AGENT =
  process.env.DOTT_ENERGY_USER_AGENT ??
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const httpsAgent =
  process.env.DOTT_ENERGY_TLS_INSECURE === 'false' ? undefined : new https.Agent({ rejectUnauthorized: false });
const LOGO_PATH = path.resolve(
  process.env.DOTT_ENERGY_LOGO_PATH?.trim() || path.join(process.cwd(), 'assets/dott-energy/logo.png'),
);
const FALLBACK_POSTER_DIR = path.resolve(
  process.env.DOTT_ENERGY_FALLBACK_POSTER_DIR?.trim() ||
    path.join(process.cwd(), 'assets/dott-energy/fallback-posters'),
);

const EDUCATION_TOPICS: DottEnergyEducationTopic[] = [
  {
    id: 'night-output',
    headline: 'Wind can keep working after sunset.',
    body: 'Solar rests at night. A well-sited wind turbine can still generate power during evening and overnight winds.',
    buyerReason: 'That makes wind a strong partner for backup power, security lights, farms, lodges and off-grid homes.',
  },
  {
    id: 'small-footprint',
    headline: 'Wind needs less ground space.',
    body: 'A turbine uses height to reach moving air, while most of the land underneath can still be used.',
    buyerReason: 'For tight sites, farms and compounds, wind can add power without covering large roof or land areas.',
  },
  {
    id: 'rainy-season',
    headline: 'Wind often improves when weather changes.',
    body: 'Cloudy and rainy periods can reduce solar output, but those same weather shifts can bring useful wind.',
    buyerReason: 'Adding wind helps reduce dependence on one energy source when the weather is not perfect.',
  },
  {
    id: 'lower-water-dependence',
    headline: 'Wind does not need flowing water.',
    body: 'Hydro power needs a reliable water source, elevation and permits. Wind only needs a good air-flow site.',
    buyerReason: 'That opens clean power options for places far from rivers or streams.',
  },
  {
    id: 'hybrid-battery',
    headline: 'Wind can charge batteries when solar is weak.',
    body: 'A hybrid wind and solar setup can feed the same battery bank at different times of day and season.',
    buyerReason: 'That can mean fewer generator hours and better backup coverage.',
  },
  {
    id: 'low-running-cost',
    headline: 'Wind has no fuel bill.',
    body: 'Once installed, a wind turbine uses free moving air instead of diesel or petrol.',
    buyerReason: 'For sites with frequent outages, that can reduce long-term running costs.',
  },
  {
    id: 'rooftop-alternative',
    headline: 'Wind can help when roof space is limited.',
    body: 'Solar depends heavily on available unshaded panel space. Wind can be mounted on a tower or suitable structure.',
    buyerReason: 'It gives another route to clean power when roofs are crowded or shaded.',
  },
  {
    id: 'productive-at-height',
    headline: 'A few extra meters can matter.',
    body: 'Wind speed usually improves with height because there are fewer trees and buildings slowing the air.',
    buyerReason: 'Good placement can unlock more energy from the same turbine.',
  },
  {
    id: 'remote-sites',
    headline: 'Wind is useful for remote loads.',
    body: 'Small turbines can support lights, cameras, pumps, telecom equipment and battery systems in isolated places.',
    buyerReason: 'That makes wind practical for farms, sites, lodges and security points away from the grid.',
  },
  {
    id: 'complements-solar',
    headline: 'Wind is not competing with solar. It completes it.',
    body: 'Solar is strongest in bright sun. Wind can be strongest during different hours or weather conditions.',
    buyerReason: 'Together, they can create a more balanced clean-energy setup.',
  },
];


type ShopifyProduct = {
  id?: number;
  title?: string;
  handle?: string;
  body_html?: string;
  vendor?: string;
  product_type?: string;
  variants?: Array<{ price?: string; option1?: string; option2?: string; option3?: string; available?: boolean }>;
  images?: Array<{ src?: string }>;
};

const cleanText = (value?: string | null) =>
  String(value ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const escapeSvg = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const unique = (items: string[]) => {
  const seen = new Set<string>();
  return items.filter(item => {
    const normalized = item.trim();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
};

const wrapWords = (value: string, maxChars: number, maxLines: number) => {
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
      if (lines.length >= maxLines) break;
    } else {
      current = next;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines;
};

const formatUsd = (value?: string) => {
  const numeric = Number(String(value ?? '').replace(/[^\d.]/g, ''));
  if (!Number.isFinite(numeric) || numeric <= 0) return '';
  return `$${numeric.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
};

const getStartingPrice = (product: ShopifyProduct) => {
  const prices = (product.variants ?? [])
    .map(variant => Number(String(variant.price ?? '').replace(/[^\d.]/g, '')))
    .filter(value => Number.isFinite(value) && value > 0);
  if (!prices.length) return undefined;
  return Math.min(...prices).toFixed(2);
};

const extractOptions = (product: ShopifyProduct, pattern: RegExp) =>
  unique(
    (product.variants ?? [])
      .flatMap(variant => [variant.option1, variant.option2, variant.option3])
      .map(value => String(value ?? '').match(pattern)?.[0]?.toUpperCase() ?? '')
      .filter(Boolean),
  );

const normalizeProduct = (product: ShopifyProduct): DottEnergyProduct | null => {
  const id = String(product.id ?? '').trim();
  const title = cleanText(product.title);
  const handle = String(product.handle ?? '').trim();
  const images = unique((product.images ?? []).map(image => image.src ?? '').filter(Boolean));
  if (!id || !title || !handle || !images.length) return null;

  return {
    id,
    title,
    handle,
    url: `${SHOP_URL}/products/${handle}`,
    vendor: cleanText(product.vendor),
    productType: cleanText(product.product_type),
    priceUsd: getStartingPrice(product),
    powerOptions: extractOptions(product, /\b\d+(?:\.\d+)?\s*(?:KW|W)\b/i),
    voltageOptions: extractOptions(product, /\b\d+\s*V\b/i),
    description: cleanText(product.body_html),
    images,
  };
};

async function fetchImageBuffer(url: string) {
  const response = await axios.get<ArrayBuffer>(url, {
    responseType: 'arraybuffer',
    headers: { 'User-Agent': USER_AGENT, Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' },
    httpsAgent,
    timeout: 30000,
    maxContentLength: 20 * 1024 * 1024,
  });
  const type = String(response.headers['content-type'] ?? '');
  if (!type.startsWith('image/')) {
    throw new Error(`Dott Energy image source is not an image: ${type || 'unknown'}`);
  }
  return Buffer.from(response.data);
}

async function uploadDottEnergyImage(buffer: Buffer, folder = 'covers') {
  const supabaseUrl = (process.env.SUPABASE_URL ?? '').trim().replace(/\/$/, '');
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  const bucket = process.env.CLIENT_CAMPAIGN_BUCKET?.trim() || 'dott-campaign';
  if (supabaseUrl && serviceRoleKey) {
    try {
      const safeFolder = folder.replace(/[^a-z0-9_-]/gi, '') || 'covers';
      const objectPath = `client-autopost/dott-energy/${safeFolder}/${new Date().toISOString().slice(0, 10)}/${Date.now()}-${crypto.randomUUID()}.jpg`;
      await axios.post(`${supabaseUrl}/storage/v1/object/${bucket}/${objectPath}`, buffer, {
        headers: {
          Authorization: `Bearer ${serviceRoleKey}`,
          apikey: serviceRoleKey,
          'Content-Type': 'image/jpeg',
          'x-upsert': 'true',
        },
        maxBodyLength: Infinity,
        httpsAgent,
        timeout: 30000,
      });
      return `${supabaseUrl}/storage/v1/object/public/${bucket}/${objectPath}`;
    } catch (error) {
      console.warn('[dott-energy] Supabase image upload failed; using generated media fallback', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return saveGeneratedImageBuffer(buffer, 'jpg');
}

const logoOverlay = async (width: number, height: number) => {
  if (!fs.existsSync(LOGO_PATH)) return null;
  const logoWidth = Math.round(width * 0.34);
  const logoHeight = Math.round(height * 0.085);
  const { data, info } = await sharp(LOGO_PATH)
    .resize(logoWidth, logoHeight, { fit: 'cover', position: 'center' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let index = 0; index < data.length; index += info.channels) {
    const red = data[index] ?? 0;
    const green = data[index + 1] ?? 0;
    const blue = data[index + 2] ?? 0;
    const alphaIndex = index + 3;
    if (red < 34 && green < 38 && blue < 38) {
      data[alphaIndex] = 0;
    } else if (red < 58 && green < 64 && blue < 64) {
      data[alphaIndex] = Math.min(data[alphaIndex] ?? 255, 90);
    }
  }
  return sharp(data, { raw: info })
    .png({ compressionLevel: 9 })
    .toBuffer();
};

const buildFallbackLogoSvg = (width: number, height: number) => `
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${width}" height="${height}" rx="26" fill="#07120f" opacity="0.88"/>
  <circle cx="52" cy="${height / 2}" r="30" fill="#7ed957"/>
  <path d="M52 18 L64 ${height / 2} L52 ${height - 18} L40 ${height / 2} Z" fill="#0097d7" opacity="0.9"/>
  <text x="96" y="${height / 2 + 9}" font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="900" fill="#eef7f0">DOTT-ENERGY</text>
</svg>`;

const buildOverlaySvg = (product: DottEnergyProduct, format: 'feed' | 'story', width: number, height: number) => {
  const isStory = format === 'story';
  return `
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="top" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#06100d" stop-opacity="${isStory ? 0.24 : 0.16}"/>
      <stop offset="1" stop-color="#06100d" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="bottom" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#06100d" stop-opacity="0"/>
      <stop offset="1" stop-color="#06100d" stop-opacity="${isStory ? 0.18 : 0.12}"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${Math.round(height * 0.18)}" fill="url(#top)"/>
  <rect y="${Math.round(height * 0.72)}" width="${width}" height="${Math.round(height * 0.28)}" fill="url(#bottom)"/>
</svg>`;
};

export const dottEnergyProductHistoryKey = (product: DottEnergyProduct) => `dott-energy-product:${product.handle || product.id}`;
export const dottEnergyFallbackPosterHistoryKey = (poster: DottEnergyFallbackPoster) => `dott-energy-poster:${poster.name}`;
export const dottEnergyEducationHistoryKey = (topic: DottEnergyEducationTopic) => `dott-energy-education:${topic.id}`;

export async function fetchDottEnergyProducts() {
  const response = await axios.get(PRODUCTS_URL, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    httpsAgent,
    timeout: 30000,
  });
  const products = (response.data?.products as ShopifyProduct[] | undefined) ?? [];
  return products.map(normalizeProduct).filter((product): product is DottEnergyProduct => Boolean(product));
}

export async function pickDottEnergyProduct(options: { recentKeys?: Set<string> } = {}) {
  const products = await fetchDottEnergyProducts();
  if (!products.length) throw new Error('No Dott Energy Shopify products found');
  const recent = options.recentKeys ?? new Set<string>();
  const fresh = products.filter(product => !recent.has(dottEnergyProductHistoryKey(product).toLowerCase()));
  const candidates = fresh.length ? fresh : products;
  return candidates[Math.floor(Date.now() / (60 * 60 * 1000)) % candidates.length];
}

export function listDottEnergyFallbackPosters() {
  if (!fs.existsSync(FALLBACK_POSTER_DIR)) return [];
  return fs
    .readdirSync(FALLBACK_POSTER_DIR)
    .filter(name => /\.(?:png|jpe?g|webp)$/i.test(name))
    .sort((left, right) => left.localeCompare(right))
    .map(name => ({
      key: `dott-energy-poster:${name}`,
      filePath: path.join(FALLBACK_POSTER_DIR, name),
      name,
    }));
}

export function pickDottEnergyFallbackPoster(options: { recentKeys?: Set<string> } = {}) {
  const posters = listDottEnergyFallbackPosters();
  if (!posters.length) return null;
  const recent = options.recentKeys ?? new Set<string>();
  const fresh = posters.filter(poster => !recent.has(dottEnergyFallbackPosterHistoryKey(poster).toLowerCase()));
  const candidates = fresh.length ? fresh : posters;
  return candidates[Math.floor(Date.now() / (60 * 60 * 1000)) % candidates.length];
}

export function shouldUseDottEnergyFallbackPoster(date = new Date()) {
  return date.getUTCHours() % 4 === 1;
}

export function buildDottEnergyFallbackCaption() {
  return [
    'Dott Energy clean power solutions',
    '',
    'Explore wind turbines, generators and controllers for homes, farms, lodges and off-grid businesses.',
    '',
    `Shop Dott Energy: ${SHOP_URL}`,
    'DM Dott Energy with your site, location and power needs so we can recommend the right setup.',
    '',
    '#DottEnergy #WindPower #CleanEnergy #RenewableEnergy #OffGridPower #UgandaBusiness',
  ].join('\n');
}

export function pickDottEnergyEducationTopic(options: { recentKeys?: Set<string> } = {}) {
  const recent = options.recentKeys ?? new Set<string>();
  const fresh = EDUCATION_TOPICS.filter(topic => !recent.has(dottEnergyEducationHistoryKey(topic).toLowerCase()));
  const candidates = fresh.length ? fresh : EDUCATION_TOPICS;
  return candidates[Math.floor(Date.now() / (60 * 60 * 1000)) % candidates.length];
}

export function buildDottEnergyEducationCaption(topic: DottEnergyEducationTopic) {
  return [
    `Did you know? ${topic.headline}`,
    '',
    topic.body,
    '',
    topic.buyerReason,
    '',
    `Shop Dott Energy: ${SHOP_URL}`,
    'DM Dott Energy with your site, location and power needs so we can recommend the right wind setup.',
    '',
    '#DottEnergy #WindPower #CleanEnergy #RenewableEnergy #OffGridPower #UgandaBusiness',
  ].join('\n');
}

const buildEducationCardSvg = (topic: DottEnergyEducationTopic, width: number, height: number) => {
  const headlineLines = wrapWords(topic.headline, 20, 3);
  const bodyLines = wrapWords(topic.body, 38, 4);
  const reasonLines = wrapWords(topic.buyerReason, 38, 4);
  return `
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#eaf7ee"/>
      <stop offset="0.5" stop-color="#d8f2e4"/>
      <stop offset="1" stop-color="#d9f3fb"/>
    </linearGradient>
    <linearGradient id="panel" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#06140f"/>
      <stop offset="1" stop-color="#0b2a23"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)"/>
  <circle cx="950" cy="140" r="250" fill="#7ed957" opacity="0.20"/>
  <circle cx="140" cy="940" r="270" fill="#0097d7" opacity="0.16"/>
  <path d="M760 125 C920 220 1005 420 930 610 C850 810 650 910 470 840 C630 740 705 610 695 450 C688 335 715 220 760 125Z" fill="#7ed957" opacity="0.18"/>
  <rect x="70" y="175" width="940" height="820" rx="42" fill="url(#panel)"/>
  <rect x="70" y="175" width="18" height="820" rx="9" fill="#7ed957"/>
  <text x="120" y="290" fill="#7ed957" font-family="Arial Black, Arial, Helvetica, sans-serif" font-size="58" font-weight="900">DID YOU KNOW?</text>
  ${headlineLines
    .map(
      (line, index) =>
        `<text x="120" y="${410 + index * 72}" fill="#ffffff" font-family="Arial Black, Arial, Helvetica, sans-serif" font-size="58" font-weight="900">${escapeSvg(line)}</text>`,
    )
    .join('')}
  ${bodyLines
    .map(
      (line, index) =>
        `<text x="120" y="${650 + index * 46}" fill="#dff8e7" font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="700">${escapeSvg(line)}</text>`,
    )
    .join('')}
  <rect x="120" y="800" width="820" height="150" rx="28" fill="#e9fff0" opacity="0.96"/>
  ${reasonLines
    .slice(0, 3)
    .map(
      (line, index) =>
        `<text x="155" y="${842 + index * 38}" fill="#082019" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="800">${escapeSvg(line)}</text>`,
    )
    .join('')}
  <text x="120" y="1018" fill="#0b352b" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="800">${escapeSvg(SHOP_URL.replace(/^https?:\/\//, ''))}</text>
</svg>`;
};

export async function renderDottEnergyEducationCard(topic: DottEnergyEducationTopic) {
  const width = 1080;
  const height = 1080;
  const base = Buffer.from(buildEducationCardSvg(topic, width, height));
  const logo = await logoOverlay(width, height);
  const logoWidth = Math.round(width * 0.34);
  const logoHeight = Math.round(height * 0.085);
  const composites: sharp.OverlayOptions[] = [{ input: base, top: 0, left: 0 }];
  if (logo) {
    composites.push({ input: logo, top: 44, left: 62 });
  } else {
    composites.push({ input: Buffer.from(buildFallbackLogoSvg(logoWidth, logoHeight)), top: 44, left: 62 });
  }
  const buffer = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 232, g: 247, b: 238 },
    },
  })
    .composite(composites)
    .jpeg({ quality: 92, mozjpeg: true })
    .toBuffer();
  return uploadDottEnergyImage(buffer, 'education');
}

export function buildDottEnergyProductCaption(product: DottEnergyProduct) {
  const price = formatUsd(product.priceUsd);
  const power = product.powerOptions.length ? product.powerOptions.slice(0, 4).join(', ') : 'multiple power options';
  const voltage = product.voltageOptions.length ? product.voltageOptions.slice(0, 3).join(', ') : '12V / 24V options';
  const lines = [
    `${product.title}`,
    '',
    `Clean wind power for homes, farms, lodges and off-grid sites that need reliable backup energy.`,
    '',
    `Power options: ${power}`,
    `Voltage: ${voltage}`,
    price ? `Starting from: ${price}` : null,
    '',
    `Shop Dott Energy: ${SHOP_URL}`,
    'DM Dott Energy with your site, location and power needs so we can help you choose the right turbine, generator or controller.',
    '',
    '#DottEnergy #WindPower #CleanEnergy #RenewableEnergy #OffGridPower #UgandaBusiness',
  ].filter((line): line is string => line !== null);
  return lines.join('\n');
}

export async function renderDottEnergyProductImage(
  product: DottEnergyProduct,
  imageUrl = product.images[0],
  format: 'feed' | 'story' = 'feed',
) {
  const width = 1080;
  const height = format === 'story' ? 1920 : 1080;
  const productBuffer = await fetchImageBuffer(imageUrl);
  const productLayer = await sharp(productBuffer)
    .resize(Math.round(width * 0.96), Math.round(height * (format === 'story' ? 0.74 : 0.82)), {
      fit: 'contain',
      background: { r: 236, g: 246, b: 239, alpha: 0 },
    })
    .toBuffer();
  const overlay = Buffer.from(buildOverlaySvg(product, format, width, height));
  const logo = await logoOverlay(width, height);
  const logoWidth = Math.round(width * 0.34);
  const logoHeight = Math.round(height * 0.085);

  const composites: sharp.OverlayOptions[] = [
    {
      input: productLayer,
      top: format === 'story' ? 210 : 128,
      left: Math.round(width * 0.02),
    },
    { input: overlay, top: 0, left: 0 },
  ];

  if (logo) {
    composites.push({ input: logo, top: format === 'story' ? 58 : 34, left: format === 'story' ? 64 : 52 });
  } else {
    composites.push({
      input: Buffer.from(buildFallbackLogoSvg(logoWidth, logoHeight)),
      top: format === 'story' ? 58 : 34,
      left: format === 'story' ? 64 : 52,
    });
  }

  const buffer = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 230, g: 243, b: 234 },
    },
  })
    .composite(composites)
    .jpeg({ quality: 91, mozjpeg: true })
    .toBuffer();

  return uploadDottEnergyImage(buffer, format === 'story' ? 'stories' : 'covers');
}

export async function renderDottEnergyFallbackPoster(
  poster: DottEnergyFallbackPoster,
  format: 'feed' | 'story' = 'feed',
) {
  const width = 1080;
  const height = format === 'story' ? 1920 : 1080;
  const posterBuffer = await sharp(poster.filePath)
    .resize(width, height, {
      fit: 'cover',
      position: 'center',
    })
    .jpeg({ quality: 91, mozjpeg: true })
    .toBuffer();
  return uploadDottEnergyImage(posterBuffer, format === 'story' ? 'poster-stories' : 'posters');
}
