import { Client } from 'pg';
import { request as httpsRequest } from 'node:https';
import sharp from 'sharp';

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v23.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
const SUPABASE_DATABASE_URL = (process.env.SUPABASE_DATABASE_URL || '').trim();
const PHYTO_USER_ID = process.env.PHYTO_SCIENCE_USER_ID || '7NXnsNmSRsh84gaQ1hi6OZWmXhB3';
const PHYTO_EMAIL = process.env.PHYTO_SCIENCE_EMAIL || 'dottmedia5@gmail.com';
const parsedLimit = Number(readArg('limit') || process.env.PHYTO_POST_LIMIT || 3);
const POST_LIMIT = Number.isFinite(parsedLimit) ? Math.max(parsedLimit, 1) : 3;
const DRY_RUN = process.argv.includes('--dry-run');
const POST_ALL = process.argv.includes('--all');

const SOURCES = [
  'https://iphyto.com/page?p-crystal-cell',
  'https://iphyto.com/page?p-double-stemcell',
  'https://iphyto.com/page?p-snowphyll',
  'https://iphyto.com/page?p-actual-plus',
  'https://iphyto.com/page?p-iiQ-plus',
  'https://iphyto.com/page?p-triple-stemcell-h2o-moisturizer',
  'https://iphyto.com/page?p-triple-stemcell-miracle-intense-essence',
];

function readArg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] || '' : '';
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function decodeHtml(value = '') {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&rsquo;/g, "'")
    .replace(/&trade;/g, 'TM')
    .replace(/&reg;/g, '(R)')
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function absoluteUrl(raw, pageUrl) {
  try {
    return new URL(raw, pageUrl).toString();
  } catch {
    return '';
  }
}

function extractMeta(html, key) {
  const pattern = new RegExp(`<meta[^>]+(?:name|property)=["']${key}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i');
  return decodeHtml(html.match(pattern)?.[1] || '');
}

function extractTitle(html, pageUrl) {
  const title = decodeHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
  return title
    .replace(/\s*-\s*Phyto Science.*$/i, '')
    .replace(/\s*-\s*Hydratation.*$/i, '')
    .trim() || new URL(pageUrl).search.replace(/^.*p-/, '').replace(/-/g, ' ');
}

function extractImages(html, pageUrl, slug) {
  const values = [
    ...Array.from(html.matchAll(/<img[^>]+(?:src|data-src)=["']([^"']+)["'][^>]*>/gi)).map(match => match[1]),
    ...Array.from(html.matchAll(/url\(["']?([^)"']+)["']?\)/gi)).map(match => match[1]),
  ]
    .map(src => absoluteUrl(decodeHtml(src), pageUrl))
    .filter(Boolean)
    .filter(url => /\.(?:jpg|jpeg|png|webp)(?:[?#].*)?$/i.test(url));

  const blocked = /logo|flag|payment|pdf|award|gmp|inverse|default|mibelle|super-brand|swiss-quality/i;
  const slugTokens = slug.toLowerCase().split('-').filter(token => token.length > 2);
  return [...new Set(values)]
    .map(url => {
      const lower = url.toLowerCase();
      let score = 0;
      if (/\/packaging\//i.test(url)) score += 60;
      if (/\/products\//i.test(url)) score += 35;
      for (const token of slugTokens) {
        if (lower.includes(token)) score += 12;
      }
      if (/banner/i.test(url)) score -= 15;
      if (blocked.test(url)) score -= 100;
      return { url, score };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(item => item.url);
}

async function scrapeProduct(url) {
  const html = await fetchSourceHtml(url);
  const slug = new URL(url).search.replace(/^\?p-/, '');
  const title = extractTitle(html, url);
  const description = extractMeta(html, 'description');
  const images = extractImages(html, url, slug);
  if (!images.length) throw new Error(`no product images found for ${url}`);
  return { url, slug, title, description, imageUrl: images[0], images };
}

async function fetchSourceHtml(url) {
  const headers = {
    'user-agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36',
  };
  try {
    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error(`source fetch failed ${response.status}`);
    return await response.text();
  } catch (error) {
    if (!String(error?.cause?.code || error?.message || '').includes('UNABLE_TO_VERIFY')) {
      throw error;
    }
  }

  return new Promise((resolve, reject) => {
    const request = httpsRequest(url, { headers, rejectUnauthorized: false }, response => {
      if ((response.statusCode || 0) >= 300 && (response.statusCode || 0) < 400 && response.headers.location) {
        fetchSourceHtml(new URL(response.headers.location, url).toString()).then(resolve, reject);
        response.resume();
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`source fetch failed ${response.statusCode}`));
        return;
      }
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        body += chunk;
      });
      response.on('end', () => resolve(body));
    });
    request.on('error', reject);
    request.end();
  });
}

function buildCaption(product) {
  const intro = [
    `Meet ${product.title}: a Phyto Science favourite made for people who want a cleaner wellness routine.`,
    `${product.title} is in focus today from Phyto Science.`,
    `Fresh product spotlight: ${product.title}.`,
  ];
  const selectedIntro = intro[Math.abs(hash(product.slug)) % intro.length];
  const description = product.description
    ? `${product.description.slice(0, 210)}${product.description.length > 210 ? '...' : ''}`
    : 'Explore the product details, ingredients, and usage notes through the official Phyto Science source.';
  return [
    selectedIntro,
    '',
    description,
    '',
    'Want details or availability? Send a message and ask for this product by name.',
    '',
    product.url,
    '',
    '#PhytoScience #PhytoWellnessHub #WellnessProducts #HealthyLifestyle #ProductSpotlight',
  ].join('\n');
}

function hash(value) {
  return [...String(value)].reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

async function connectDb() {
  if (!SUPABASE_DATABASE_URL) throw new Error('SUPABASE_DATABASE_URL is required');
  const client = new Client({ connectionString: SUPABASE_DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  return client;
}

async function loadPhytoAccount(client) {
  const result = await client.query(
    `select user_id, email, accounts
       from public.dott_social_accounts
      where user_id = $1 or lower(email) = lower($2)
      order by updated_at desc nulls last
      limit 1`,
    [PHYTO_USER_ID, PHYTO_EMAIL],
  );
  const row = result.rows[0];
  const facebook = row?.accounts?.facebook;
  if (!row || !facebook?.pageId || !facebook?.accessToken) {
    throw new Error(`Phyto Science Facebook account is not connected for ${PHYTO_EMAIL}`);
  }
  return {
    userId: row.user_id || PHYTO_USER_ID,
    email: row.email || PHYTO_EMAIL,
    facebook,
  };
}

async function loadRecentSourceUrls(client, userId) {
  const result = await client.query(
    `select scheduled_post_id
       from public.dott_social_logs
      where user_id = $1
        and scheduled_post_id like 'phyto:%'
        and status = 'posted'
      order by posted_at desc
      limit 100`,
    [userId],
  );
  return new Set(result.rows.map(row => String(row.scheduled_post_id || '').replace(/^phyto:/, '')));
}

async function publishFacebookPhoto(account, product) {
  const caption = buildCaption(product);
  if (DRY_RUN) {
    return { id: `dry-run-${product.slug}`, caption };
  }
  const imageBuffer = await prepareImageBuffer(await fetchSourceBuffer(product.imageUrl));
  const body = new FormData();
  body.set('caption', caption);
  body.set('access_token', account.facebook.accessToken);
  body.set('source', new Blob([imageBuffer], { type: 'image/jpeg' }), `${product.slug}.jpg`);
  const response = await fetch(`${GRAPH_BASE}/${account.facebook.pageId}/photos`, {
    method: 'POST',
    body,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || `Facebook publish failed ${response.status}`);
  }
  return { ...payload, caption };
}

async function prepareImageBuffer(buffer) {
  try {
    return await sharp(buffer)
      .rotate()
      .resize({ width: 1400, height: 1400, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 84, mozjpeg: true })
      .toBuffer();
  } catch {
    return buffer;
  }
}

async function fetchSourceBuffer(url) {
  if (new URL(url).hostname.endsWith('iphyto.com')) {
    return fetchSourceBufferWithRelaxedTls(url);
  }
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`image fetch failed ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  } catch (error) {
    if (!String(error?.cause?.code || error?.message || '').includes('UNABLE_TO_VERIFY')) {
      throw error;
    }
  }

  return fetchSourceBufferWithRelaxedTls(url);
}

function fetchSourceBufferWithRelaxedTls(url) {
  return new Promise((resolve, reject) => {
    const request = httpsRequest(url, { rejectUnauthorized: false }, response => {
      if ((response.statusCode || 0) >= 300 && (response.statusCode || 0) < 400 && response.headers.location) {
        fetchSourceBuffer(new URL(response.headers.location, url).toString()).then(resolve, reject);
        response.resume();
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`image fetch failed ${response.statusCode}`));
        return;
      }
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks)));
    });
    request.on('error', reject);
    request.end();
  });
}

function imageExtension(url) {
  const extension = new URL(url).pathname.split('.').pop()?.toLowerCase();
  return ['jpg', 'jpeg', 'png', 'webp'].includes(extension || '') ? extension : 'jpg';
}

function errorMessage(error) {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause;
  const causeCode = cause && typeof cause === 'object' && 'code' in cause ? cause.code : '';
  const causeMessage = cause && typeof cause === 'object' && 'message' in cause ? cause.message : '';
  return [error.message, causeCode, causeMessage].filter(Boolean).join(' - ');
}

async function writeLog(client, account, product, result, status = 'posted', error = null) {
  await client.query(
    `insert into public.dott_social_logs
      (user_id, platform, scheduled_post_id, status, response_id, error, posted_at)
     values ($1, $2, $3, $4, $5, $6, now())`,
    [
      account.userId,
      'facebook',
      `phyto:${product.url}`,
      status,
      result?.id ? String(result.id) : null,
      error,
    ],
  );
}

async function run() {
  const client = await connectDb();
  try {
    const account = await loadPhytoAccount(client);
    const recent = POST_ALL ? new Set() : await loadRecentSourceUrls(client, account.userId);
    const products = [];
    for (const source of SOURCES) {
      if (recent.has(source)) continue;
      products.push(await scrapeProduct(source));
    }
    const selected = products.slice(0, POST_ALL ? products.length : POST_LIMIT);
    if (!selected.length) {
      console.log('No fresh Phyto Science product sources to post.');
      return;
    }
    for (const product of selected) {
      try {
        const result = await publishFacebookPhoto(account, product);
        if (!DRY_RUN) {
          await writeLog(client, account, product, result, 'posted');
        }
        console.log(
          JSON.stringify({
            ok: true,
            product: product.title,
            source: product.url,
            imageUrl: product.imageUrl,
            remoteId: result.id,
            captionPreview: result.caption.slice(0, 140),
          }),
        );
      } catch (error) {
        const message = errorMessage(error);
        await writeLog(client, account, product, null, 'failed', message).catch(() => undefined);
        console.warn(JSON.stringify({ ok: false, product: product.title, source: product.url, error: message }));
      }
      await sleep(4000);
    }
  } finally {
    await client.end();
  }
}

run().catch(error => {
  console.error('phyto-science-product-poster failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
