import crypto from 'crypto';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

import axios from 'axios';
import { load } from 'cheerio';
import admin from 'firebase-admin';

const BWIN_USER_ID = process.env.BWIN_USER_ID || '1zvY9nNyXMcfxdPQEyx0bIdK7r53';
const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v19.0';
const WORKER_TAG = 'bwin_news_worker';
const RSS_FEEDS = [
  'https://feeds.bbci.co.uk/sport/football/rss.xml',
  'https://www.espn.com/espn/rss/soccer/news',
];

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');
const posterRendererPath = path.join(__dirname, 'render_bwin_news_poster_refined.py');

const todayDate = () => new Date().toISOString().slice(0, 10);

function requireEnv(name, value) {
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function loadServiceAccount() {
  const raw = requireEnv('FIREBASE_SERVICE_ACCOUNT_JSON', process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  return JSON.parse(raw);
}

function initFirebase() {
  if (admin.apps.length) return admin.app();
  const parsed = loadServiceAccount();
  return admin.initializeApp({ credential: admin.credential.cert(parsed) });
}

async function getBwinAccounts() {
  initFirebase();
  const snap = await admin.firestore().collection('users').doc(BWIN_USER_ID).get();
  const data = snap.data() || {};
  const facebook = data.socialAccounts?.facebook || {};
  const instagram = data.socialAccounts?.instagram || {};
  if (!facebook.pageId || !facebook.accessToken) {
    throw new Error('Bwin Facebook credentials missing in Firestore');
  }
  if (!instagram.accountId || !instagram.accessToken) {
    throw new Error('Bwin Instagram credentials missing in Firestore');
  }
  return { facebook, instagram };
}

async function fetchFeedItems(feedUrl) {
  const response = await axios.get(feedUrl, {
    timeout: 30000,
    headers: {
      'User-Agent': 'DottMedia-BwinNewsWorker/1.0',
      Accept: 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
    },
  });
  const $ = load(response.data, { xmlMode: true });
  return $('item')
    .toArray()
    .map(item => {
      const node = $(item);
      return {
        title: node.find('title').first().text().trim(),
        link: node.find('link').first().text().trim(),
        pubDate: node.find('pubDate').first().text().trim(),
        description: node.find('description').first().text().trim(),
        image:
          node.find('media\\:thumbnail, thumbnail').attr('url') ||
          node.find('media\\:content, content').attr('url') ||
          '',
      };
    })
    .filter(item => item.title && item.link);
}

function normalizeNewsImageUrl(rawUrl) {
  const url = String(rawUrl || '').trim();
  if (!url) return '';
  if (/bbc\.co\.uk|bbci\.co\.uk/i.test(url)) {
    return url
      .replace(/\/\d+\/cpsprodpb\//i, '/1024/cpsprodpb/')
      .replace(/\/\d+\/\w+\//i, '/1024/')
      .replace(/\/240\//g, '/1024/')
      .replace(/\/320\//g, '/1024/')
      .replace(/\/480\//g, '/1024/');
  }
  return url.replace(/([?&])w=\d+/gi, '$1w=1600').replace(/([?&])h=\d+/gi, '$1h=900');
}

async function extractArticleImage(articleUrl) {
  const response = await axios.get(articleUrl, {
    timeout: 30000,
    headers: {
      'User-Agent': 'DottMedia-BwinNewsWorker/1.0',
      Accept: 'text/html,application/xhtml+xml',
    },
  });
  const $ = load(response.data);
  const candidates = [
    $('meta[property="og:image"]').attr('content'),
    $('meta[name="twitter:image"]').attr('content'),
    $('meta[property="og:image:url"]').attr('content'),
  ]
    .map(normalizeNewsImageUrl)
    .filter(Boolean);
  return candidates[0] || '';
}

function buildContentKey(candidate) {
  const raw = `${candidate.link}|${candidate.title}`.toLowerCase().trim();
  return crypto.createHash('sha1').update(raw).digest('hex');
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function supabaseHeaders() {
  return {
    apikey: requireEnv('SUPABASE_SERVICE_ROLE_KEY', SUPABASE_SERVICE_ROLE_KEY),
    Authorization: `Bearer ${requireEnv('SUPABASE_SERVICE_ROLE_KEY', SUPABASE_SERVICE_ROLE_KEY)}`,
    'Content-Type': 'application/json',
  };
}

async function hasProcessedContent(contentKey) {
  requireEnv('SUPABASE_URL', SUPABASE_URL);
  const response = await axios.get(`${SUPABASE_URL}/rest/v1/dott_social_logs`, {
    headers: supabaseHeaders(),
    params: {
      select: 'id',
      scheduled_post_id: `eq.external:${contentKey}`,
      limit: 1,
    },
    timeout: 30000,
  });
  return Array.isArray(response.data) && response.data.length > 0;
}

async function addSocialLogs(entries) {
  requireEnv('SUPABASE_URL', SUPABASE_URL);
  if (!entries.length) return;
  await axios.post(`${SUPABASE_URL}/rest/v1/dott_social_logs`, entries, {
    headers: {
      ...supabaseHeaders(),
      Prefer: 'return=minimal',
    },
    timeout: 30000,
  });
}

async function incrementSocialDaily(postedCountByPlatform) {
  requireEnv('SUPABASE_URL', SUPABASE_URL);
  const date = todayDate();
  const id = `${BWIN_USER_ID}_${date}`;
  const existingResponse = await axios.get(`${SUPABASE_URL}/rest/v1/dott_social_daily`, {
    headers: supabaseHeaders(),
    params: {
      select: '*',
      id: `eq.${id}`,
      limit: 1,
    },
    timeout: 30000,
  });
  const existing = Array.isArray(existingResponse.data) && existingResponse.data.length ? existingResponse.data[0] : null;
  const currentPerPlatform = existing?.per_platform && typeof existing.per_platform === 'object' ? existing.per_platform : {};
  const nextPerPlatform = { ...currentPerPlatform };
  let incrementTotal = 0;
  for (const [platform, count] of Object.entries(postedCountByPlatform)) {
    nextPerPlatform[platform] = Number(nextPerPlatform[platform] || 0) + count;
    incrementTotal += count;
  }
  if (!incrementTotal) return;

  if (!existing) {
    await axios.post(
      `${SUPABASE_URL}/rest/v1/dott_social_daily`,
      [
        {
          id,
          user_id: BWIN_USER_ID,
          date,
          posts_attempted: incrementTotal,
          posts_posted: incrementTotal,
          posts_failed: 0,
          posts_skipped: 0,
          per_platform: nextPerPlatform,
          updated_at: new Date().toISOString(),
        },
      ],
      {
        headers: {
          ...supabaseHeaders(),
          Prefer: 'return=minimal',
        },
        timeout: 30000,
      },
    );
    return;
  }

  await axios.patch(
    `${SUPABASE_URL}/rest/v1/dott_social_daily`,
    {
      posts_attempted: Number(existing.posts_attempted || 0) + incrementTotal,
      posts_posted: Number(existing.posts_posted || 0) + incrementTotal,
      per_platform: nextPerPlatform,
      updated_at: new Date().toISOString(),
    },
    {
      headers: {
        ...supabaseHeaders(),
        Prefer: 'return=minimal',
      },
      params: { id: `eq.${id}` },
      timeout: 30000,
    },
  );
}

async function brandImageToTemp(sourceUrl, title) {
  const tempFile = path.join(os.tmpdir(), `bwin-news-${crypto.randomUUID()}.jpg`);
  await new Promise((resolve, reject) => {
    const child = spawn(
      'python',
      [
        posterRendererPath,
        '--out',
        tempFile,
        '--title',
        title,
        '--image-url',
        sourceUrl,
      ],
      {
        cwd: repoRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stderr = '';
    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Poster renderer failed with code ${code}: ${stderr.trim()}`));
    });
  });
  const buffer = await fs.readFile(tempFile);
  return { tempFile, buffer };
}

async function uploadToSupabaseStorage(fileBuffer) {
  requireEnv('SUPABASE_URL', SUPABASE_URL);
  requireEnv('SUPABASE_SERVICE_ROLE_KEY', SUPABASE_SERVICE_ROLE_KEY);
  const bucket = 'bwin-news';
  const objectPath = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.jpg`;
  await axios.post(`${SUPABASE_URL}/storage/v1/object/${bucket}/${objectPath}`, fileBuffer, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'image/jpeg',
      'x-upsert': 'true',
    },
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    timeout: 60000,
  });
  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${objectPath}`;
}

async function publishToInstagram({ accountId, accessToken, imageUrl, caption }) {
  const baseUrl = `https://graph.facebook.com/${GRAPH_VERSION}/${accountId}`;
  const create = await axios.post(
    `${baseUrl}/media`,
    new URLSearchParams({
      image_url: imageUrl,
      caption,
      access_token: accessToken,
    }),
    { timeout: 60000 },
  );
  const creationId = create.data?.id;
  if (!creationId) throw new Error('Instagram container creation failed');

  for (let attempt = 0; attempt < 15; attempt += 1) {
    const status = await axios.get(`https://graph.facebook.com/${GRAPH_VERSION}/${creationId}`, {
      params: {
        fields: 'status_code',
        access_token: accessToken,
      },
      timeout: 30000,
    });
    const code = status.data?.status_code;
    if (code === 'FINISHED') break;
    if (code === 'ERROR') throw new Error('Instagram media container returned ERROR');
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  const publish = await axios.post(
    `${baseUrl}/media_publish`,
    new URLSearchParams({
      creation_id: creationId,
      access_token: accessToken,
    }),
    { timeout: 60000 },
  );
  const mediaId = publish.data?.id;
  if (!mediaId) throw new Error('Instagram publish failed');

  const meta = await axios.get(`https://graph.facebook.com/${GRAPH_VERSION}/${mediaId}`, {
    params: {
      fields: 'id,permalink',
      access_token: accessToken,
    },
    timeout: 30000,
  });
  return {
    id: mediaId,
    permalink: meta.data?.permalink || null,
  };
}

async function publishToFacebook({ pageId, accessToken, imageUrl, caption }) {
  const response = await axios.post(
    `https://graph.facebook.com/${GRAPH_VERSION}/${pageId}/photos`,
    new URLSearchParams({
      url: imageUrl,
      message: caption,
      access_token: accessToken,
    }),
    { timeout: 60000 },
  );
  const remoteId = response.data?.post_id || response.data?.id;
  if (!remoteId) throw new Error('Facebook publish failed');
  return { id: remoteId };
}

function cleanTitle(title) {
  return title.replace(/\s+/g, ' ').trim();
}

function buildCaptions(title) {
  const clean = cleanTitle(title);
  return {
    instagram: `${clean}\n\nStay updated with Bwinbet Uganda.\nMore info: link in bio.`,
    facebook: `${clean}\n\nStay updated with Bwinbet Uganda.\nMore info: www.bwinbetug.info\nBet now: https://bwinbetug.com`,
  };
}

async function chooseCandidate() {
  const allItems = [];
  for (const feedUrl of RSS_FEEDS) {
    try {
      const items = await fetchFeedItems(feedUrl);
      allItems.push(...items);
    } catch (error) {
      console.warn('[bwin-news-worker] feed failed', feedUrl, error instanceof Error ? error.message : String(error));
    }
  }

  const dated = allItems
    .map(item => ({
      ...item,
      image: normalizeNewsImageUrl(item.image),
      publishedAt: item.pubDate ? new Date(item.pubDate) : new Date(0),
    }))
    .filter(item => item.title && item.link)
    .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());

  for (const item of dated.slice(0, 15)) {
    const contentKey = buildContentKey(item);
    if (await hasProcessedContent(contentKey)) continue;
    let imageUrl = item.image;
    if (!imageUrl) {
      try {
        imageUrl = await extractArticleImage(item.link);
      } catch (error) {
        console.warn('[bwin-news-worker] article image extraction failed', item.link, error instanceof Error ? error.message : String(error));
        continue;
      }
    }
    if (!imageUrl) continue;
    try {
      await axios.get(imageUrl, {
        timeout: 20000,
        responseType: 'arraybuffer',
        headers: { 'User-Agent': 'DottMedia-BwinNewsWorker/1.0' },
      });
    } catch {
      continue;
    }
    return {
      ...item,
      imageUrl,
      contentKey,
    };
  }

  return null;
}

async function main() {
  const accounts = await getBwinAccounts();
  const candidate = await chooseCandidate();
  if (!candidate) {
    console.log('[bwin-news-worker] no fresh candidate found');
    return;
  }

  const branded = await brandImageToTemp(candidate.imageUrl, candidate.title);
  let publicImageUrl = '';
  try {
    publicImageUrl = await uploadToSupabaseStorage(branded.buffer);
    const captions = buildCaptions(candidate.title);

    const [instagramResult, facebookResult] = await Promise.all([
      publishToInstagram({
        accountId: accounts.instagram.accountId,
        accessToken: accounts.instagram.accessToken,
        imageUrl: publicImageUrl,
        caption: captions.instagram,
      }),
      publishToFacebook({
        pageId: accounts.facebook.pageId,
        accessToken: accounts.facebook.accessToken,
        imageUrl: publicImageUrl,
        caption: captions.facebook,
      }),
    ]);

    const payload = {
      worker: WORKER_TAG,
      contentType: 'news',
      title: cleanTitle(candidate.title),
      sourceUrl: candidate.link,
      sourceImageUrl: candidate.imageUrl,
      brandedImageUrl: publicImageUrl,
      instagram: instagramResult,
      facebook: facebookResult,
      publishedAt: new Date().toISOString(),
    };

    await addSocialLogs([
      {
        user_id: BWIN_USER_ID,
        platform: WORKER_TAG,
        scheduled_post_id: `external:${candidate.contentKey}`,
        status: 'posted',
        response_id: [instagramResult.id, facebookResult.id].filter(Boolean).join('|'),
        error: null,
        posted_at: new Date().toISOString(),
        payload,
      },
      {
        user_id: BWIN_USER_ID,
        platform: 'instagram',
        scheduled_post_id: `external:${candidate.contentKey}`,
        status: 'posted',
        response_id: instagramResult.id,
        error: null,
        posted_at: new Date().toISOString(),
        payload: { ...payload, platform: 'instagram' },
      },
      {
        user_id: BWIN_USER_ID,
        platform: 'facebook',
        scheduled_post_id: `external:${candidate.contentKey}`,
        status: 'posted',
        response_id: facebookResult.id,
        error: null,
        posted_at: new Date().toISOString(),
        payload: { ...payload, platform: 'facebook' },
      },
    ]);

    await incrementSocialDaily({ instagram: 1, facebook: 1 });

    console.log(
      JSON.stringify({
        ok: true,
        title: cleanTitle(candidate.title),
        contentKey: candidate.contentKey,
        instagram: instagramResult,
        facebook: facebookResult,
        brandedImageUrl: publicImageUrl,
      }),
    );
  } finally {
    await fs.unlink(branded.tempFile).catch(() => {});
  }
}

main().catch(error => {
  console.error('[bwin-news-worker] failed', error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
