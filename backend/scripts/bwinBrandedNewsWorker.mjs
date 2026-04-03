import crypto from 'crypto';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

import axios from 'axios';
import { load } from 'cheerio';
import admin from 'firebase-admin';
import sharp from 'sharp';

const BWIN_USER_ID = process.env.BWIN_USER_ID || '1zvY9nNyXMcfxdPQEyx0bIdK7r53';
const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v19.0';
const WORKER_TARGET = (process.env.BWIN_NEWS_TARGET || 'feed').trim().toLowerCase();
const IS_STORY_TARGET = WORKER_TARGET === 'stories' || WORKER_TARGET === 'story';
const WORKER_TAG = IS_STORY_TARGET ? 'bwin_news_story_worker' : 'bwin_news_worker';
const WORKER_CONFIG_BUCKET = 'worker-config';
const WORKER_CONFIG_OBJECT = 'bwin-meta-accounts.json';
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
  if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const response = await axios.get(
        `${SUPABASE_URL}/storage/v1/object/authenticated/${WORKER_CONFIG_BUCKET}/${WORKER_CONFIG_OBJECT}`,
        {
          headers: {
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
          timeout: 30000,
        },
      );
      const payload = response.data || {};
      const facebook = payload.facebook || {};
      const instagram = payload.instagram || {};
      if (facebook.pageId && facebook.accessToken && instagram.accountId && instagram.accessToken) {
        return { facebook, instagram };
      }
    } catch (error) {
      console.warn(
        '[bwin-news-worker] supabase credential config unavailable',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

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

function extractPlainText(value) {
  const html = String(value || '').trim();
  if (!html) return '';
  const $ = load(`<div>${html}</div>`);
  return $('div').text().replace(/\s+/g, ' ').trim();
}

function normalizeStoryParagraph(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .trim();
}

function isUsefulStoryParagraph(value) {
  const text = normalizeStoryParagraph(value);
  if (!text || text.length < 40) return false;
  if (/^[-•]/.test(text)) return false;
  if (/^(advertisement|related topics|listen to the latest|copyright|all rights reserved)/i.test(text)) return false;
  if (/cookies|privacy policy|sign up|newsletter|follow us/i.test(text)) return false;
  return true;
}

function trimTextAtBoundary(value, maxChars) {
  const text = normalizeStoryParagraph(value);
  if (text.length <= maxChars) return text;
  const slice = text.slice(0, maxChars);
  const sentenceEnd = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('! '), slice.lastIndexOf('? '));
  if (sentenceEnd > 140) return slice.slice(0, sentenceEnd + 1).trim();
  const commaBreak = Math.max(slice.lastIndexOf(', '), slice.lastIndexOf('; '), slice.lastIndexOf(': '));
  if (commaBreak > 140) return slice.slice(0, commaBreak).trim() + '...';
  const wordBreak = slice.lastIndexOf(' ');
  return (wordBreak > 100 ? slice.slice(0, wordBreak) : slice).trimEnd() + '...';
}

function limitParagraphSentences(value, maxSentences = 3) {
  const text = normalizeStoryParagraph(value);
  if (!text) return '';
  const sentences = text.match(/[^.!?]+[.!?]?/g)?.map(part => part.trim()).filter(Boolean) ?? [text];
  const limited = sentences.slice(0, maxSentences).join(' ');
  return normalizeStoryParagraph(limited);
}

function buildStoryText(paragraphs, maxChars = 950, maxParagraphs = 4) {
  const unique = [];
  const seen = new Set();
  for (const paragraph of paragraphs) {
    const text = limitParagraphSentences(paragraph);
    const key = text.toLowerCase();
    if (!isUsefulStoryParagraph(text) || seen.has(key)) continue;
    seen.add(key);
    unique.push(text);
  }

  let out = '';
  let paragraphCount = 0;
  for (const paragraph of unique) {
    if (paragraphCount >= maxParagraphs) break;
    const next = out ? `${out}\n\n${paragraph}` : paragraph;
    if (next.length > maxChars) {
      if (!out) {
        return trimTextAtBoundary(paragraph, Math.max(320, maxChars - 3));
      }
      break;
    }
    out = next;
    paragraphCount += 1;
  }
  return trimTextAtBoundary(out.trim(), maxChars);
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

async function extractArticleStory(articleUrl, feedDescription = '') {
  const feedText = extractPlainText(feedDescription);
  try {
    const response = await axios.get(articleUrl, {
      timeout: 30000,
      headers: {
        'User-Agent': 'DottMedia-BwinNewsWorker/1.0',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    const $ = load(response.data);
    const metaDescription = [
      $('meta[property="og:description"]').attr('content'),
      $('meta[name="description"]').attr('content'),
      $('meta[name="twitter:description"]').attr('content'),
    ]
      .map(value => normalizeStoryParagraph(value))
      .filter(Boolean);

    const selectors = [
      'article p',
      'main p',
      '[data-testid=\"article-body\"] p',
      '[data-component=\"text-block\"] p',
      '.article-body p',
      '.story-body p',
      '.main-content p',
      'section p',
    ];
    const paragraphs = selectors.flatMap(selector =>
      $(selector)
        .toArray()
        .map(node => $(node).text()),
    );

    const story = buildStoryText([...paragraphs, ...metaDescription, feedText]);
    if (story) return story;
  } catch (error) {
    console.warn(
      '[bwin-news-worker] article story extraction failed',
      articleUrl,
      error instanceof Error ? error.message : String(error),
    );
  }
  return buildStoryText([feedText]);
}

function buildContentKey(candidate) {
  const raw = `${candidate.link}|${candidate.title}`.toLowerCase().trim();
  return crypto.createHash('sha1').update(raw).digest('hex');
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
  const externalKey = `external:${IS_STORY_TARGET ? 'story' : 'feed'}:${contentKey}`;
  const response = await axios.get(`${SUPABASE_URL}/rest/v1/dott_social_logs`, {
    headers: supabaseHeaders(),
    params: {
      select: 'id',
      scheduled_post_id: `eq.${externalKey}`,
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

async function buildStoryImageBuffer(posterBuffer) {
  const width = 1080;
  const height = 1920;
  const framedWidth = 950;
  const framedHeight = 950;
  const background = await sharp(posterBuffer)
    .resize(width, height, { fit: 'cover', position: 'centre' })
    .modulate({ brightness: 0.55, saturation: 0.95 })
    .blur(22)
    .jpeg({ quality: 92 })
    .toBuffer();

  const card = await sharp(posterBuffer)
    .resize(framedWidth, framedHeight, { fit: 'cover', position: 'centre' })
    .png()
    .toBuffer();

  const shadowSvg = Buffer.from(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="shadow" x="-20%" y="-20%" width="140%" height="160%">
          <feGaussianBlur in="SourceAlpha" stdDeviation="28"/>
        </filter>
      </defs>
      <rect x="65" y="455" width="${framedWidth}" height="${framedHeight}" rx="34" ry="34" fill="rgba(0,0,0,0.38)" filter="url(#shadow)"/>
    </svg>
  `);

  const frameSvg = Buffer.from(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect x="64" y="454" width="${framedWidth + 2}" height="${framedHeight + 2}" rx="36" ry="36" fill="none" stroke="rgba(255,255,255,0.14)" stroke-width="2"/>
    </svg>
  `);

  return sharp(background)
    .composite([
      { input: shadowSvg, top: 0, left: 0 },
      { input: card, top: 456, left: 65 },
      { input: frameSvg, top: 0, left: 0 },
    ])
    .jpeg({ quality: 94 })
    .toBuffer();
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

async function waitForMediaReady(creationId, accessToken, maxAttempts = 15, delayMs = 2000) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const statusResp = await axios.get(`https://graph.facebook.com/${GRAPH_VERSION}/${creationId}`, {
      params: {
        fields: 'status_code,status',
        access_token: accessToken,
      },
      timeout: 30000,
    });
    const status = statusResp.data?.status_code;
    if (status === 'FINISHED') return true;
    if (status === 'ERROR') {
      const detail =
        typeof statusResp.data?.status === 'object'
          ? JSON.stringify(statusResp.data?.status)
          : String(statusResp.data?.status || '');
      throw new Error(detail ? `Instagram media container error: ${detail}` : 'Instagram media container returned ERROR');
    }
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  return false;
}

async function publishWithRetry({ baseUrl, creationId, accessToken, retries = 2, retryDelayMs = 3000 }) {
  let lastError = null;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const publish = await axios.post(
        `${baseUrl}/media_publish`,
        new URLSearchParams({
          creation_id: creationId,
          access_token: accessToken,
        }),
        { timeout: 60000 },
      );
      if (publish.data?.id) return publish.data.id;
      throw new Error('No ID returned from Instagram publish');
    } catch (error) {
      lastError = error;
      const message = error?.response?.data?.error?.message ?? error?.message ?? '';
      if (String(message).toLowerCase().includes('media id is not available') && attempt < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, retryDelayMs));
        continue;
      }
      throw error;
    }
  }
  if (lastError) throw lastError;
  return null;
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

    const isReady = await waitForMediaReady(creationId, accessToken);
    if (!isReady) throw new Error('Instagram media container not ready for publishing');
    const mediaId = await publishWithRetry({ baseUrl, creationId, accessToken });
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

async function publishToInstagramStory({ accountId, accessToken, imageUrl }) {
  const baseUrl = `https://graph.facebook.com/${GRAPH_VERSION}/${accountId}`;

  const create = await axios.post(
    `${baseUrl}/media`,
    new URLSearchParams({
      media_type: 'STORIES',
      image_url: imageUrl,
      access_token: accessToken,
    }),
    { timeout: 60000 },
  );
  const creationId = create.data?.id;
  if (!creationId) throw new Error('Instagram Story container creation failed');

  const isReady = await waitForMediaReady(creationId, accessToken);
  if (!isReady) throw new Error('Instagram Story container not ready for publishing');

  const mediaId = await publishWithRetry({ baseUrl, creationId, accessToken });
  if (!mediaId) throw new Error('Instagram Story publish failed');
  return { id: mediaId };
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

async function publishToFacebookStory({ pageId, accessToken, imageUrl }) {
  const response = await axios.post(
    `https://graph.facebook.com/${GRAPH_VERSION}/${pageId}/stories`,
    new URLSearchParams({
      image_url: imageUrl,
      access_token: accessToken,
    }),
    { timeout: 60000 },
  );
  const remoteId = response.data?.id;
  if (!remoteId) throw new Error('Facebook Story publish failed');
  return { id: remoteId };
}

function cleanTitle(title) {
  return title.replace(/\s+/g, ' ').trim();
}

function buildCaptionHashtags(title, storyText = '') {
  const normalized = `${title} ${storyText}`.toLowerCase();
  const tags = ['#BwinbetUganda', '#FootballNews', '#FootballUpdates', '#BettingTips'];
  if (/transfer|rumou?r|sign|deal|contract|bid/.test(normalized)) tags.push('#TransferNews');
  if (/premier league|liverpool|manchester|arsenal|chelsea|tottenham|newcastle/.test(normalized)) tags.push('#PremierLeague');
  if (/champions league|ucl/.test(normalized)) tags.push('#ChampionsLeague');
  if (/world cup/.test(normalized)) tags.push('#WorldCup');
  if (/la liga|real madrid|barcelona|atletico/.test(normalized)) tags.push('#LaLiga');
  if (/serie a|inter|juventus|milan|napoli|roma/.test(normalized)) tags.push('#SerieA');
  return Array.from(new Set(tags)).join(' ');
}

function buildCaptions(title, storyText = '') {
  const clean = cleanTitle(title);
  const story = String(storyText || '').trim();
  const hashtags = buildCaptionHashtags(clean, story);
  const instagramParts = [clean];
  if (story) instagramParts.push(story);
  instagramParts.push('Stay updated with Bwinbet Uganda.');
  instagramParts.push('More info: link in bio.');
  instagramParts.push('Bet now: link in bio.');
  instagramParts.push(hashtags);

  const facebookParts = [clean];
  if (story) facebookParts.push(story);
  facebookParts.push('Stay updated with Bwinbet Uganda.');
  facebookParts.push('More info: www.bwinbetug.info');
  facebookParts.push('Bet now: https://bwinbetug.com');
  facebookParts.push(hashtags);

  return {
    instagram: instagramParts.filter(Boolean).join('\n\n'),
    facebook: facebookParts.filter(Boolean).join('\n\n'),
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
    const storyText = await extractArticleStory(item.link, item.description);
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
      storyText,
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
    const storyBuffer = IS_STORY_TARGET ? await buildStoryImageBuffer(branded.buffer) : null;
    publicImageUrl = await uploadToSupabaseStorage(storyBuffer || branded.buffer);
    const captions = buildCaptions(candidate.title, candidate.storyText);

    let instagramResult = null;
    let facebookResult = null;
    const failures = [];

    if (IS_STORY_TARGET) {
      try {
        instagramResult = await publishToInstagramStory({
          accountId: accounts.instagram.accountId,
          accessToken: accounts.instagram.accessToken,
          imageUrl: publicImageUrl,
        });
      } catch (error) {
        failures.push({
          platform: 'instagram_story',
          message: error instanceof Error ? error.message : String(error),
        });
      }
      try {
        facebookResult = await publishToFacebookStory({
          pageId: accounts.facebook.pageId,
          accessToken: accounts.facebook.accessToken,
          imageUrl: publicImageUrl,
        });
      } catch (error) {
        failures.push({
          platform: 'facebook_story',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    } else {
      [instagramResult, facebookResult] = await Promise.all([
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
    }

    if (!instagramResult && !facebookResult) {
      const detail = failures.map(entry => `${entry.platform}: ${entry.message}`).join(' | ');
      throw new Error(detail || 'No social story platforms published successfully');
    }

    const payload = {
      worker: WORKER_TAG,
      contentType: IS_STORY_TARGET ? 'news_story' : 'news',
      target: IS_STORY_TARGET ? 'stories' : 'feed',
      title: cleanTitle(candidate.title),
      storyText: candidate.storyText || '',
      sourceUrl: candidate.link,
      sourceImageUrl: candidate.imageUrl,
      brandedImageUrl: publicImageUrl,
      instagram: instagramResult,
      facebook: facebookResult,
      failures,
      publishedAt: new Date().toISOString(),
    };

    const scheduledPostId = `external:${IS_STORY_TARGET ? 'story' : 'feed'}:${candidate.contentKey}`;
    const logEntries = [
      {
        user_id: BWIN_USER_ID,
        platform: WORKER_TAG,
        scheduled_post_id: scheduledPostId,
        status: failures.length ? 'partial' : 'posted',
        response_id: [instagramResult?.id, facebookResult?.id].filter(Boolean).join('|'),
        error: failures.length ? failures.map(entry => `${entry.platform}: ${entry.message}`).join(' | ') : null,
        posted_at: new Date().toISOString(),
        payload,
      },
    ];
    const dailyCounts = {};

    if (instagramResult?.id) {
      logEntries.push({
        user_id: BWIN_USER_ID,
        platform: IS_STORY_TARGET ? 'instagram_story' : 'instagram',
        scheduled_post_id: scheduledPostId,
        status: 'posted',
        response_id: instagramResult.id,
        error: null,
        posted_at: new Date().toISOString(),
        payload: { ...payload, platform: 'instagram' },
      });
      dailyCounts[IS_STORY_TARGET ? 'instagram_story' : 'instagram'] = 1;
    } else if (IS_STORY_TARGET) {
      const failure = failures.find(entry => entry.platform === 'instagram_story');
      if (failure) {
        logEntries.push({
          user_id: BWIN_USER_ID,
          platform: 'instagram_story',
          scheduled_post_id: scheduledPostId,
          status: 'failed',
          response_id: null,
          error: failure.message,
          posted_at: new Date().toISOString(),
          payload: { ...payload, platform: 'instagram' },
        });
      }
    }

    if (facebookResult?.id) {
      logEntries.push({
        user_id: BWIN_USER_ID,
        platform: IS_STORY_TARGET ? 'facebook_story' : 'facebook',
        scheduled_post_id: scheduledPostId,
        status: 'posted',
        response_id: facebookResult.id,
        error: null,
        posted_at: new Date().toISOString(),
        payload: { ...payload, platform: 'facebook' },
      });
      dailyCounts[IS_STORY_TARGET ? 'facebook_story' : 'facebook'] = 1;
    } else if (IS_STORY_TARGET) {
      const failure = failures.find(entry => entry.platform === 'facebook_story');
      if (failure) {
        logEntries.push({
          user_id: BWIN_USER_ID,
          platform: 'facebook_story',
          scheduled_post_id: scheduledPostId,
          status: 'failed',
          response_id: null,
          error: failure.message,
          posted_at: new Date().toISOString(),
          payload: { ...payload, platform: 'facebook' },
        });
      }
    }

    await addSocialLogs(logEntries);

    if (Object.keys(dailyCounts).length) {
      await incrementSocialDaily(dailyCounts);
    }

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
