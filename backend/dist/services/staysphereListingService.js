import axios from 'axios';
import * as cheerio from 'cheerio';
import crypto from 'crypto';
import https from 'https';
import sharp from 'sharp';
import { saveGeneratedImageBuffer } from './generatedMediaService.js';
const USER_AGENT = process.env.STAYSPHERE_SOURCE_USER_AGENT ||
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const httpsAgent = process.env.STAYSPHERE_SOURCE_TLS_INSECURE === 'false' ? undefined : new https.Agent({ rejectUnauthorized: false });
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
const decodeHtml = (value) => value
    .replace(/&amp;/g, '&')
    .replace(/&#038;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\\\//g, '/')
    .replace(/\\u002F/g, '/');
const cleanText = (value) => decodeHtml(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
const normalizeUrl = (value, baseUrl) => {
    const trimmed = decodeHtml(value).trim();
    if (!trimmed || trimmed.startsWith('data:'))
        return '';
    if (trimmed.startsWith('//'))
        return `https:${trimmed}`;
    if (trimmed.startsWith('/'))
        return new URL(trimmed, baseUrl).toString();
    return trimmed;
};
const unique = (items) => {
    const seen = new Set();
    return items.filter(item => {
        const normalized = item.trim();
        if (!normalized || seen.has(normalized))
            return false;
        seen.add(normalized);
        return true;
    });
};
const escapeSvg = (value) => value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
const titleCase = (value) => value
    .toLowerCase()
    .replace(/\b([a-z])/g, match => match.toUpperCase())
    .replace(/\bAirbnb\b/i, 'Airbnb')
    .replace(/\bBhk\b/g, 'BHK');
const wrapWords = (value, maxChars, maxLines) => {
    const words = value.split(/\s+/).filter(Boolean);
    const lines = [];
    let current = '';
    for (const word of words) {
        const next = current ? `${current} ${word}` : word;
        if (next.length > maxChars && current) {
            lines.push(current);
            current = word;
            if (lines.length >= maxLines)
                break;
        }
        else {
            current = next;
        }
    }
    if (current && lines.length < maxLines)
        lines.push(current);
    return lines;
};
const listingKey = (url) => `staysphere-listing:${url.replace(/\/+$/, '').toLowerCase()}`;
async function fetchHtml(url) {
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
async function fetchImageBuffer(url) {
    const response = await axios.get(url, {
        responseType: 'arraybuffer',
        headers: { 'User-Agent': USER_AGENT, Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' },
        httpsAgent,
        timeout: 30000,
        maxContentLength: 20 * 1024 * 1024,
    });
    const contentType = String(response.headers['content-type'] ?? '');
    if (!contentType.startsWith('image/')) {
        throw new Error(`Staysphere cover source is not an image: ${contentType || 'unknown'}`);
    }
    return Buffer.from(response.data);
}
const imageScore = (url) => {
    const lowered = url.toLowerCase();
    if (lowered.includes('","') || lowered.includes('has_price') || lowered.includes('/properties/'))
        return 0;
    if (/logo|icon|avatar|profile|placeholder|sprite|captcha|cropped-simba|aderok-logo/.test(lowered))
        return 0;
    if (!/\.(jpe?g|png|webp)(\?|$)/i.test(url))
        return 0;
    if (/wp-content\/uploads|jiji\.ng|pictures\.jiji/.test(lowered))
        return 2;
    return 1;
};
const normalizeImage = (url, baseUrl) => {
    const normalized = normalizeUrl(url, baseUrl)
        .replace(/-\d+x\d+(?=\.(?:jpe?g|png|webp))/i, '')
        .replace(/([?&](?:resize|fit)=\d+%2C\d+)(?=&|$)/i, '')
        .replace(/[?&]w=\d+(?=&|$)/i, '')
        .replace(/(\.(?:jpe?g|png|webp))&/i, '$1?')
        .replace(/\?&/g, '?');
    return normalized;
};
const normalizeListingUrl = (value, baseUrl) => {
    try {
        const url = new URL(normalizeUrl(value, baseUrl));
        url.hash = '';
        url.search = '';
        if (!/^\/properties\/[^/]+\/?$/i.test(url.pathname))
            return '';
        return url.toString();
    }
    catch {
        return '';
    }
};
const isStayListingText = (value) => /(furnished|short.?term|short stay|rental|rentals|apartment|apartments|villa|villas|hotel|guest house|lodge|stay)/i.test(value) && !/(granite|acre|acres|plot|plots|land for sale|for sale|coffee plantation|factory|warehouse)/i.test(value);
const extractImages = (html, $, pageUrl) => unique([
    ...Array.from(html.matchAll(/https?:\\?\/\\?\/[^"'\s<>]+?\.(?:jpe?g|png|webp)(?:\?[^"'\s<>]*)?/gi)).map(match => match[0]),
    ...Array.from(html.matchAll(/(?:data-src|src|href|content)=["']([^"']+\.(?:jpe?g|png|webp)(?:\?[^"']*)?)["']/gi)).map(match => match[1]),
    $('meta[property="og:image"]').attr('content') || '',
]
    .map(url => normalizeImage(url, pageUrl))
    .filter(url => imageScore(url) > 0)).slice(0, 10);
const extractAderokEstateJson = (html) => {
    const match = html.match(/:estate="({&quot;[\s\S]*?})"/);
    if (!match)
        return null;
    try {
        return JSON.parse(decodeHtml(match[1]));
    }
    catch {
        return null;
    }
};
const valuesFromAttribute = (estate, slug) => {
    const attr = (estate?.attributes ?? []).find(item => item?.slug === slug);
    return (attr?.values ?? []).map(value => cleanText(value?.value || value?.name)).filter(Boolean);
};
export async function fetchAderokListing(url) {
    const pageUrl = normalizeUrl(url, 'https://aderokestates.com/');
    const html = await fetchHtml(pageUrl);
    const $ = cheerio.load(html);
    const estate = extractAderokEstateJson(html);
    const title = cleanText(estate?.name) ||
        cleanText($('meta[property="og:title"]').attr('content')) ||
        cleanText($('title').text()).replace(/\s+-\s+Aderok.*$/i, '');
    const price = cleanText(estate?.price?.[0]?.price);
    const location = cleanText(estate?.address) || valuesFromAttribute(estate, 'area').concat(valuesFromAttribute(estate, 'location')).join(', ');
    const amenities = valuesFromAttribute(estate, 'features').slice(0, 8);
    const relevanceText = [
        title,
        cleanText(estate?.excerpt),
        valuesFromAttribute(estate, 'property-type').join(' '),
        valuesFromAttribute(estate, 'offer-type').join(' '),
        cleanText($('meta[property="og:description"]').attr('content')),
    ].join(' ');
    if (!isStayListingText(relevanceText)) {
        throw new Error('Aderok listing is not a stay/rental listing');
    }
    const galleryImages = (estate?.gallery ?? [])
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
export async function fetchSimbaListing(url) {
    const pageUrl = normalizeUrl(url, 'https://simbaproperties.co.ug/');
    const html = await fetchHtml(pageUrl);
    const $ = cheerio.load(html);
    const title = cleanText($('h1.entry-title').first().text()) ||
        cleanText($('meta[property="og:title"]').attr('content')) ||
        cleanText($('title').text()).replace(/\s+-\s+Simba.*$/i, '');
    const price = cleanText(html.match(/"default_price"\s*:\s*"([^"]+)"/)?.[1]) ||
        cleanText($('.price_area').first().text()) ||
        cleanText(html.match(/\$\s?\d{2,4}/)?.[0]);
    const location = cleanText($('.property_categs .property_location').first().text()) ||
        cleanText(html.match(/"property_city_front":"([^"]+)"/)?.[1]);
    const images = extractImages(html, $, pageUrl);
    const amenities = unique(Array.from(html.matchAll(/<div[^>]+listing_detail[^>]*>\s*([^<]+)\s*<\/div>/gi))
        .map(match => cleanText(match[1]))
        .filter(Boolean)).slice(0, 8);
    const summary = cleanText($('meta[property="og:description"]').attr('content')) ||
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
export async function fetchJijiListings() {
    const listings = [];
    for (const indexUrl of JIJI_INDEX_URLS) {
        try {
            const html = await fetchHtml(indexUrl);
            if (/Just a moment|challenge-platform|cf_chl/i.test(html))
                continue;
            const links = unique(Array.from(html.matchAll(/href=["']([^"']*temporary-and-vacation-rentals\/[^"']+)["']/gi)).map(match => normalizeUrl(match[1], indexUrl))).slice(0, 8);
            for (const url of links) {
                try {
                    const listingHtml = await fetchHtml(url);
                    const $ = cheerio.load(listingHtml);
                    const images = extractImages(listingHtml, $, url);
                    const title = cleanText($('meta[property="og:title"]').attr('content')) ||
                        cleanText($('h1').first().text()) ||
                        'Short stay listing in Uganda';
                    if (images.length < 2)
                        continue;
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
                }
                catch {
                    // Try the next Jiji listing.
                }
            }
        }
        catch {
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
            urls.push(...Array.from(html.matchAll(/https:\/\/aderokestates\.com\/properties\/[^"'\s<>#?]+\/?/gi)).map(match => match[0]));
        }
        catch {
            // Use the seed list when discovery fails.
        }
    }
    return unique(urls.map(url => normalizeListingUrl(url, 'https://aderokestates.com/')).filter(Boolean)).slice(0, 40);
}
async function discoverSimbaUrls() {
    const urls = [...SIMBA_SEED_URLS];
    for (const indexUrl of SIMBA_INDEX_URLS) {
        try {
            const html = await fetchHtml(indexUrl);
            urls.push(...Array.from(html.matchAll(/https:\/\/simbaproperties\.co\.ug\/properties\/[^"'\s<>]+\/?/gi)).map(match => match[0]));
        }
        catch {
            // Use the seed list when discovery fails.
        }
    }
    return unique(urls).slice(0, 40);
}
export async function pickStaysphereListing(options = {}) {
    const recent = options.recentListingKeys ?? new Set();
    const candidates = [];
    for (const url of await discoverAderokUrls()) {
        if (recent.has(listingKey(url)))
            continue;
        try {
            candidates.push(await fetchAderokListing(url));
        }
        catch {
            // Try the next source listing.
        }
        if (candidates.length >= 4)
            break;
    }
    for (const url of await discoverSimbaUrls()) {
        if (recent.has(listingKey(url)))
            continue;
        try {
            candidates.push(await fetchSimbaListing(url));
        }
        catch {
            // Try the next source listing.
        }
        if (candidates.length >= 8)
            break;
    }
    if (candidates.length < 3) {
        candidates.push(...(await fetchJijiListings()));
    }
    const fresh = candidates.find(listing => !recent.has(listingKey(listing.url)));
    if (!fresh)
        throw new Error('No fresh Staysphere Uganda listing found');
    return fresh;
}
export function buildStaysphereListingCaption(listing) {
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
export function staysphereListingHistoryKey(listing) {
    return listingKey(listing.url);
}
export function buildStaysphereCoverText(listing) {
    const area = listing.title.match(/\b(?:in|at)\s+([A-Za-z][A-Za-z\s-]{2,32})$/i)?.[1]?.trim() ||
        listing.location?.split(',')[0]?.trim() ||
        '';
    const title = titleCase(listing.title
        .replace(/\s+[-|].*$/g, '')
        .replace(/\b(Cozy|Beautiful|Modern|Fully Furnished)\b\s*/gi, '')
        .replace(/\s+/g, ' ')
        .trim());
    const headline = title || (area ? `Stay In ${titleCase(area)}` : 'Fresh Stay Spot');
    const subline = area ? `Comfortable short stay in ${titleCase(area)}` : 'Comfortable short stay ready for your dates';
    return { headline, subline };
}
async function uploadStaysphereCover(buffer) {
    const supabaseUrl = (process.env.SUPABASE_URL ?? '').trim().replace(/\/$/, '');
    const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
    const bucket = process.env.CLIENT_CAMPAIGN_BUCKET?.trim() || 'dott-campaign';
    if (supabaseUrl && serviceRoleKey) {
        const objectPath = `client-autopost/staysphere/covers/${new Date().toISOString().slice(0, 10)}/${Date.now()}-${crypto.randomUUID()}.jpg`;
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
    }
    return saveGeneratedImageBuffer(buffer, 'jpg');
}
export async function renderStaysphereCoverImage(listing, sourceImageUrl = listing.images[0], format = 'feed') {
    if (!sourceImageUrl)
        return null;
    const width = 1080;
    const height = format === 'story' ? 1920 : 1080;
    const source = await fetchImageBuffer(sourceImageUrl);
    const base = await sharp(source)
        .rotate()
        .resize(width, height, { fit: 'cover', position: 'attention' })
        .sharpen()
        .jpeg({ quality: 92, mozjpeg: true, chromaSubsampling: '4:4:4' })
        .toBuffer();
    const { headline, subline } = buildStaysphereCoverText(listing);
    const headlineLines = wrapWords(headline, format === 'story' ? 17 : 18, 3);
    const headlineSize = format === 'story' ? 96 : 74;
    const headlineY = format === 'story' ? height - 520 : height - 328;
    const sublineY = headlineY + headlineLines.length * (headlineSize + 12) + 54;
    const svg = `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#06130f" stop-opacity="0"/>
          <stop offset="0.46" stop-color="#06130f" stop-opacity="0.10"/>
          <stop offset="1" stop-color="#06130f" stop-opacity="0.92"/>
        </linearGradient>
      </defs>
      <rect width="${width}" height="${height}" fill="url(#shade)"/>
      <rect x="56" y="${headlineY - 118}" width="${width - 112}" height="${format === 'story' ? 480 : 318}" rx="42" fill="#07140f" opacity="0.70"/>
      <rect x="80" y="${headlineY - 88}" width="252" height="54" rx="27" fill="#34d399"/>
      <text x="106" y="${headlineY - 52}" fill="#062016" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="900">STAY SPOTLIGHT</text>
      ${headlineLines
        .map((line, index) => `<text x="82" y="${headlineY + index * (headlineSize + 12)}" fill="#ffffff" font-family="Arial Black, Arial, Helvetica, sans-serif" font-size="${headlineSize}" font-weight="900">${escapeSvg(line)}</text>`)
        .join('\n')}
      <text x="84" y="${sublineY}" fill="#d8fff0" font-family="Arial, Helvetica, sans-serif" font-size="${format === 'story' ? 42 : 32}" font-weight="700">${escapeSvg(subline)}</text>
      <text x="84" y="${sublineY + (format === 'story' ? 58 : 46)}" fill="#ffffff" opacity="0.76" font-family="Arial, Helvetica, sans-serif" font-size="${format === 'story' ? 34 : 25}">Swipe for actual room and property photos</text>
    </svg>
  `;
    const buffer = await sharp(base)
        .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
        .jpeg({ quality: 93, mozjpeg: true, chromaSubsampling: '4:4:4' })
        .toBuffer();
    return uploadStaysphereCover(buffer);
}
