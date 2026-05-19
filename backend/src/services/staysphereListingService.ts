import axios from 'axios';
import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import https from 'https';

export type StaysphereListing = {
  source: 'Aderok Estates' | 'Simba Properties' | 'Jiji Uganda';
  title: string;
  url: string;
  location?: string;
  price?: string;
  bedrooms?: string;
  bathrooms?: string;
  propertyType?: string;
  summary?: string;
  amenities: string[];
  images: string[];
};

const USER_AGENT =
  process.env.STAYSPHERE_SOURCE_USER_AGENT ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const httpsAgent =
  process.env.STAYSPHERE_SOURCE_TLS_INSECURE === 'false' ? undefined : new https.Agent({ rejectUnauthorized: false });

const ADEROK_SEARCH_URLS = [
  'https://aderokestates.com/?s=furnished+rentals',
  'https://aderokestates.com/property-type/furnished/',
  'https://aderokestates.com/property-type/apartment/',
];

const ADEROK_SEED_URLS = [
  'https://aderokestates.com/properties/cozy-furnished-rentals-in-kololo-kampala/',
  'https://aderokestates.com/properties/1bhk-furnished-apartments-in-kisaasi-2/',
];

const SIMBA_INDEX_URLS = [
  'https://simbaproperties.co.ug/properties/',
  'https://simbaproperties.co.ug/properties-list-standard/',
];

const SIMBA_SEED_URLS = [
  'https://simbaproperties.co.ug/properties/bukoto-ii/',
  'https://simbaproperties.co.ug/properties/sydney-villas/',
  'https://simbaproperties.co.ug/properties/moyo-close-apartments/',
  'https://simbaproperties.co.ug/properties/elizabeth-royal-apartments/',
];

const JIJI_INDEX_URLS = [
  'https://jiji.ug/kampala/temporary-and-vacation-rentals',
  'https://jiji.ug/temporary-and-vacation-rentals',
];

const decodeHtml = (value: string) =>
  value
    .replace(/&amp;/g, '&')
    .replace(/&#038;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\\\//g, '/')
    .replace(/\\u002F/g, '/');

const cleanText = (value?: string | null) =>
  decodeHtml(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();

const normalizeUrl = (value: string, baseUrl: string) => {
  const trimmed = decodeHtml(value).trim();
  if (!trimmed || trimmed.startsWith('data:')) return '';
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  if (trimmed.startsWith('/')) return new URL(trimmed, baseUrl).toString();
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

const listingKey = (url: string) => `staysphere-listing:${url.replace(/\/+$/, '').toLowerCase()}`;

async function fetchHtml(url: string) {
  const response = await axios.get(url, {
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'User-Agent': USER_AGENT,
    },
    httpsAgent,
    timeout: 30000,
  });
  return String(response.data ?? '');
}

const imageScore = (url: string) => {
  const lowered = url.toLowerCase();
  if (lowered.includes('","') || lowered.includes('has_price') || lowered.includes('/properties/')) return 0;
  if (/logo|icon|avatar|profile|placeholder|sprite|captcha|cropped-simba|aderok-logo/.test(lowered)) return 0;
  if (!/\.(jpe?g|png|webp)(\?|$)/i.test(url)) return 0;
  if (/wp-content\/uploads|jiji\.ng|pictures\.jiji/.test(lowered)) return 2;
  return 1;
};

const normalizeImage = (url: string, baseUrl: string) => {
  const normalized = normalizeUrl(url, baseUrl)
    .replace(/-\d+x\d+(?=\.(?:jpe?g|png|webp))/i, '')
    .replace(/([?&](?:resize|fit)=\d+%2C\d+)(?=&|$)/i, '')
    .replace(/[?&]w=\d+(?=&|$)/i, '')
    .replace(/(\.(?:jpe?g|png|webp))&/i, '$1?')
    .replace(/\?&/g, '?');
  return normalized;
};

const extractImages = (html: string, $: CheerioAPI, pageUrl: string) =>
  unique(
    [
      ...Array.from(html.matchAll(/https?:\\?\/\\?\/[^"'\s<>]+?\.(?:jpe?g|png|webp)(?:\?[^"'\s<>]*)?/gi)).map(
        match => match[0],
      ),
      ...Array.from(html.matchAll(/(?:data-src|src|href|content)=["']([^"']+\.(?:jpe?g|png|webp)(?:\?[^"']*)?)["']/gi)).map(
        match => match[1],
      ),
      $('meta[property="og:image"]').attr('content') || '',
    ]
      .map(url => normalizeImage(url, pageUrl))
      .filter(url => imageScore(url) > 0),
  ).slice(0, 10);

const extractAderokEstateJson = (html: string) => {
  const match = html.match(/:estate="({&quot;[\s\S]*?})"/);
  if (!match) return null;
  try {
    return JSON.parse(decodeHtml(match[1]));
  } catch {
    return null;
  }
};

const valuesFromAttribute = (estate: any, slug: string) => {
  const attr = ((estate?.attributes as any[]) ?? []).find(item => item?.slug === slug);
  return ((attr?.values as any[]) ?? []).map(value => cleanText(value?.value || value?.name)).filter(Boolean);
};

export async function fetchAderokListing(url: string): Promise<StaysphereListing> {
  const pageUrl = normalizeUrl(url, 'https://aderokestates.com/');
  const html = await fetchHtml(pageUrl);
  const $ = cheerio.load(html);
  const estate = extractAderokEstateJson(html);
  const title =
    cleanText(estate?.name) ||
    cleanText($('meta[property="og:title"]').attr('content')) ||
    cleanText($('title').text()).replace(/\s+-\s+Aderok.*$/i, '');
  const price = cleanText(estate?.price?.[0]?.price);
  const location = cleanText(estate?.address) || valuesFromAttribute(estate, 'area').concat(valuesFromAttribute(estate, 'location')).join(', ');
  const amenities = valuesFromAttribute(estate, 'features').slice(0, 8);
  const galleryImages = ((estate?.gallery as any[]) ?? [])
    .map(item => normalizeImage(String(item?.image ?? ''), pageUrl))
    .filter(Boolean);
  const images = unique([...galleryImages, ...extractImages(html, $, pageUrl)]).slice(0, 10);

  if (!title || images.length < 2) {
    throw new Error('No usable Aderok listing found');
  }

  return {
    source: 'Aderok Estates',
    title,
    url: pageUrl,
    location,
    price,
    bedrooms: valuesFromAttribute(estate, 'bedrooms')[0],
    bathrooms: valuesFromAttribute(estate, 'bathrooms')[0],
    propertyType: valuesFromAttribute(estate, 'property-type')[0],
    summary: cleanText($('meta[property="og:description"]').attr('content')),
    amenities,
    images,
  };
}

export async function fetchSimbaListing(url: string): Promise<StaysphereListing> {
  const pageUrl = normalizeUrl(url, 'https://simbaproperties.co.ug/');
  const html = await fetchHtml(pageUrl);
  const $ = cheerio.load(html);
  const title =
    cleanText($('h1.entry-title').first().text()) ||
    cleanText($('meta[property="og:title"]').attr('content')) ||
    cleanText($('title').text()).replace(/\s+-\s+Simba.*$/i, '');
  const price =
    cleanText(html.match(/"default_price"\s*:\s*"([^"]+)"/)?.[1]) ||
    cleanText($('.price_area').first().text()) ||
    cleanText(html.match(/\$\s?\d{2,4}/)?.[0]);
  const location =
    cleanText($('.property_categs .property_location').first().text()) ||
    cleanText(html.match(/"property_city_front":"([^"]+)"/)?.[1]);
  const images = extractImages(html, $, pageUrl);
  const amenities = unique(
    Array.from(html.matchAll(/<div[^>]+listing_detail[^>]*>\s*([^<]+)\s*<\/div>/gi))
      .map(match => cleanText(match[1]))
      .filter(Boolean),
  ).slice(0, 8);
  const summary =
    cleanText($('meta[property="og:description"]').attr('content')) ||
    cleanText($('#listing_description').text()).slice(0, 220);

  if (!title || images.length < 2) {
    throw new Error('No usable Simba listing found');
  }

  return {
    source: 'Simba Properties',
    title,
    url: pageUrl,
    location,
    price: price ? `$${price.replace(/^\$/, '').trim()}` : undefined,
    summary,
    amenities,
    images,
  };
}

export async function fetchJijiListings(): Promise<StaysphereListing[]> {
  const listings: StaysphereListing[] = [];
  for (const indexUrl of JIJI_INDEX_URLS) {
    try {
      const html = await fetchHtml(indexUrl);
      if (/Just a moment|challenge-platform|cf_chl/i.test(html)) continue;
      const links = unique(
        Array.from(html.matchAll(/href=["']([^"']*temporary-and-vacation-rentals\/[^"']+)["']/gi)).map(match =>
          normalizeUrl(match[1], indexUrl),
        ),
      ).slice(0, 8);
      for (const url of links) {
        try {
          const listingHtml = await fetchHtml(url);
          const $ = cheerio.load(listingHtml);
          const images = extractImages(listingHtml, $, url);
          const title =
            cleanText($('meta[property="og:title"]').attr('content')) ||
            cleanText($('h1').first().text()) ||
            'Short stay listing in Uganda';
          if (images.length < 2) continue;
          listings.push({
            source: 'Jiji Uganda',
            title,
            url,
            location: cleanText($('[itemprop="address"], .qa-advert-location').first().text()),
            price: cleanText($('[itemprop="price"], .qa-advert-price').first().text()),
            summary: cleanText($('meta[property="og:description"]').attr('content')),
            amenities: [],
            images,
          });
        } catch {
          // Try the next Jiji listing.
        }
      }
    } catch {
      // Jiji commonly blocks automated access; keep it best-effort.
    }
  }
  return listings;
}

async function discoverAderokUrls() {
  const urls = [...ADEROK_SEED_URLS];
  for (const searchUrl of ADEROK_SEARCH_URLS) {
    try {
      const html = await fetchHtml(searchUrl);
      urls.push(
        ...Array.from(html.matchAll(/https:\/\/aderokestates\.com\/properties\/[^"'\s<>]+\/?/gi)).map(match => match[0]),
      );
    } catch {
      // Use the seed list when discovery fails.
    }
  }
  return unique(urls).slice(0, 40);
}

async function discoverSimbaUrls() {
  const urls = [...SIMBA_SEED_URLS];
  for (const indexUrl of SIMBA_INDEX_URLS) {
    try {
      const html = await fetchHtml(indexUrl);
      urls.push(
        ...Array.from(html.matchAll(/https:\/\/simbaproperties\.co\.ug\/properties\/[^"'\s<>]+\/?/gi)).map(
          match => match[0],
        ),
      );
    } catch {
      // Use the seed list when discovery fails.
    }
  }
  return unique(urls).slice(0, 40);
}

export async function pickStaysphereListing(options: { recentListingKeys?: Set<string> } = {}) {
  const recent = options.recentListingKeys ?? new Set<string>();
  const candidates: StaysphereListing[] = [];

  for (const url of await discoverAderokUrls()) {
    if (recent.has(listingKey(url))) continue;
    try {
      candidates.push(await fetchAderokListing(url));
    } catch {
      // Try the next source listing.
    }
    if (candidates.length >= 4) break;
  }

  for (const url of await discoverSimbaUrls()) {
    if (recent.has(listingKey(url))) continue;
    try {
      candidates.push(await fetchSimbaListing(url));
    } catch {
      // Try the next source listing.
    }
    if (candidates.length >= 8) break;
  }

  if (candidates.length < 3) {
    candidates.push(...(await fetchJijiListings()));
  }

  const fresh = candidates.find(listing => !recent.has(listingKey(listing.url)));
  if (!fresh) throw new Error('No fresh Staysphere Uganda listing found');
  return fresh;
}

export function buildStaysphereListingCaption(listing: StaysphereListing) {
  const details = [
    listing.location ? `Location: ${listing.location}` : '',
    listing.price ? `Rate shown on listing: ${listing.price}` : '',
    listing.propertyType ? `Type: ${listing.propertyType}` : '',
    listing.bedrooms ? `Bedrooms: ${listing.bedrooms}` : '',
    listing.bathrooms ? `Bathrooms: ${listing.bathrooms}` : '',
  ].filter(Boolean);
  const amenities = listing.amenities.length ? `Highlights: ${listing.amenities.slice(0, 5).join(', ')}` : '';
  const lines = [
    `${listing.title}`,
    ...details,
    amenities,
    '',
    listing.summary
      ? `${listing.summary.slice(0, 260)}${listing.summary.length > 260 ? '...' : ''}`
      : 'Actual stay photos from a Uganda accommodation listing. Swipe through the room and property views, then message Staysphere with your dates, budget, and preferred area.',
    '',
    'Message Staysphere for availability, current rates, and booking guidance before making any payment.',
    '',
    listing.url,
    '',
    '#StaySphere93 #UgandaStaycation #KampalaStays #ShortStayUganda #AirbnbUganda #UgandaHotels',
  ];
  return lines.filter((line, index) => line || lines[index - 1]).join('\n');
}

export function staysphereListingHistoryKey(listing: Pick<StaysphereListing, 'url'>) {
  return listingKey(listing.url);
}
