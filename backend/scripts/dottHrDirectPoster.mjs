import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import dns from 'dns';
import axios from 'axios';
import admin from 'firebase-admin';
import sharp from 'sharp';
import { GoogleAuth } from 'google-auth-library';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = process.env.NODE_TLS_REJECT_UNAUTHORIZED || '0';
dns.setDefaultResultOrder('ipv4first');

dotenv.config({ path: path.resolve(process.cwd(), '.env'), override: false });
dotenv.config({ path: path.resolve(process.cwd(), 'backend/.env'), override: false });
dotenv.config({ path: path.resolve(process.cwd(), '..', '.env'), override: false });

const UID = process.env.DOTTHR_UID || '80bYIeiuukNFtUvXTUobXmfC7pu1';
const EMAIL = process.env.DOTTHR_EMAIL || 'kingbrasio100@gmail.com';
const DOTTHR_PAGE_ID = process.env.DOTTHR_PAGE_ID || '1154065791120794';
const DOTTHR_IG_ID = process.env.DOTTHR_IG_ID || '17841426388091930';
const ASSET_DIR =
  process.env.DOTTHR_ASSET_DIR ||
  'C:\\Users\\joseph marvin\\Downloads\\Dott-HR posts';
const STATE_PATH =
  process.env.DOTTHR_STATE_PATH ||
  path.resolve(process.cwd(), '..', 'exports', 'dotthr-direct-poster-state.json');
const API_BASE = (process.env.DOTTHR_API_BASE || 'https://dottmediaapk.onrender.com').replace(/\/$/, '');
const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v23.0';
const THREADS_GRAPH_BASE = process.env.THREADS_GRAPH_BASE_URL || 'https://graph.threads.net';
const THREADS_GRAPH_VERSION = process.env.THREADS_GRAPH_VERSION || 'v1.0';

const FEED_CAPTIONS = [
  'Strong teams are built with clarity, fairness, and care. Dott Human Resource helps businesses shape better people systems, smoother hiring, and workplaces where talent can grow.',
  'Hiring should feel organized, professional, and human. Dott Human Resource supports businesses with smarter recruitment, HR structure, onboarding, and staff management.',
  'Your people are the heartbeat of your business. Dott Human Resource helps you build policies, processes, and team support that keep work moving with confidence.',
  'From recruitment to employee support, Dott Human Resource helps businesses create a cleaner HR flow and a more reliable team experience.',
  'Good HR is more than paperwork. It is communication, trust, performance, and the right systems behind every growing team.',
  'Need a better HR structure for your business? Dott Human Resource helps with hiring support, staff organization, policy guidance, and people-focused workflows.',
];

const STORY_CAPTIONS = [
  'Build better teams with Dott Human Resource.',
  'Smarter hiring. Cleaner HR systems. Better people support.',
  'Your business grows better when your people systems work.',
  'Dott Human Resource helps teams hire, organize, and grow.',
];

const HASHTAGS =
  '#DottHumanResource #DottHR #HumanResources #HRSupport #Recruitment #Hiring #TalentManagement #EmployeeExperience #WorkplaceCulture #BusinessGrowth #TeamBuilding #HRConsulting #PeopleOperations #SmallBusinessSupport #UgandaBusiness #AfricanBusiness #StartupSupport #CareerGrowth';
const COMMENT_TO_DM_CTA = 'Comment GUIDE and we will send the details in your DM.';

const modeArg = process.argv.find(arg => arg.startsWith('--mode='))?.split('=')[1] || 'feed';
const mode = modeArg === 'story' ? 'story' : 'feed';
const forceQuote = process.argv.includes('--quote');

const QUOTE_TEMPLATES = [
  {
    key: 'drucker-leadership',
    quote: 'Management is doing things right; leadership is doing the right things.',
    author: 'Peter Drucker',
    caption:
      'Great teams need both structure and direction. Good management keeps work organized, while strong leadership keeps people moving toward the right goals.\n\nDott Human Resource helps businesses build better people systems, clearer workflows, and stronger teams.',
  },
  {
    key: 'clear-next-step',
    quote: 'Progress starts with one clear next step.',
    author: 'Dott Human Resource',
    caption:
      'Every strong team begins with small improvements: clearer roles, better communication, stronger hiring, and support that helps people do their best work.\n\nBuild the team. Improve the system. Keep moving.',
  },
];

function loadServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (raw?.trim()) return JSON.parse(raw);
  const filePath = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!filePath?.trim()) throw new Error('Missing FIREBASE_SERVICE_ACCOUNT');
  return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return { feedCursor: 0, storyCursor: 0, runs: [] };
  }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function mimeFor(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  return 'image/jpeg';
}

function imageFiles() {
  return fs
    .readdirSync(ASSET_DIR, { withFileTypes: true })
    .filter(entry => entry.isFile() && /\.(png|jpe?g|webp)$/i.test(entry.name))
    .map(entry => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

function captionFor(index) {
  if (mode === 'story') return STORY_CAPTIONS[index % STORY_CAPTIONS.length];
  return `${FEED_CAPTIONS[index % FEED_CAPTIONS.length]}\n\n${COMMENT_TO_DM_CTA}\n\n${HASHTAGS}`;
}

async function retryAsync(fn, attempts, label) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      console.warn(`[dotthr-direct] ${label} attempt ${attempt}/${attempts} failed`, error?.cause?.message || error?.message || String(error));
      if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, attempt * 5000));
    }
  }
  throw lastError;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function wrapWords(text, maxChars) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

async function renderQuoteImage(template, format) {
  const width = 1080;
  const height = format === 'story' ? 1920 : 1080;
  const quoteLines = wrapWords(template.quote, format === 'story' ? 21 : 30).slice(0, 5);
  const brandY = format === 'story' ? 190 : 130;
  const quoteStartY = format === 'story' ? 650 : 380;
  const quoteSize = format === 'story' ? 78 : 64;
  const lineGap = format === 'story' ? 92 : 76;
  const authorY = quoteStartY + quoteLines.length * lineGap + 70;
  const footerY = height - (format === 'story' ? 250 : 135);
  const svg = `
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#f8fafc"/>
      <stop offset="0.52" stop-color="#eef6f1"/>
      <stop offset="1" stop-color="#e9eef8"/>
    </linearGradient>
    <linearGradient id="bar" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#12355b"/>
      <stop offset="1" stop-color="#1f8a70"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)"/>
  <rect x="0" y="0" width="${width}" height="22" fill="url(#bar)"/>
  <circle cx="${width - 150}" cy="${format === 'story' ? 310 : 210}" r="${format === 'story' ? 260 : 170}" fill="#1f8a70" opacity="0.09"/>
  <circle cx="110" cy="${height - 170}" r="${format === 'story' ? 320 : 210}" fill="#12355b" opacity="0.08"/>
  <text x="86" y="${brandY}" fill="#12355b" font-family="Arial, Helvetica, sans-serif" font-size="${format === 'story' ? 48 : 34}" font-weight="800">Dott Human Resource</text>
  <text x="86" y="${brandY + (format === 'story' ? 58 : 42)}" fill="#1f8a70" font-family="Arial, Helvetica, sans-serif" font-size="${format === 'story' ? 30 : 22}" font-weight="700">People systems. Better teams.</text>
  <text x="86" y="${quoteStartY - 95}" fill="#1f8a70" font-family="Georgia, serif" font-size="${format === 'story' ? 112 : 84}" font-weight="700">"</text>
  ${quoteLines
    .map(
      (line, index) =>
        `<text x="86" y="${quoteStartY + index * lineGap}" fill="#0f172a" font-family="Georgia, 'Times New Roman', serif" font-size="${quoteSize}" font-weight="700">${escapeXml(line)}</text>`,
    )
    .join('\n  ')}
  <rect x="86" y="${authorY - 36}" width="${format === 'story' ? 520 : 430}" height="${format === 'story' ? 72 : 58}" rx="12" fill="#12355b"/>
  <text x="112" y="${authorY + (format === 'story' ? 13 : 5)}" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="${format === 'story' ? 34 : 26}" font-weight="800">${escapeXml(template.author)}</text>
  <text x="86" y="${footerY}" fill="#12355b" font-family="Arial, Helvetica, sans-serif" font-size="${format === 'story' ? 34 : 24}" font-weight="800">Management | Hiring | HR Support</text>
  <text x="86" y="${footerY + (format === 'story' ? 52 : 36)}" fill="#475569" font-family="Arial, Helvetica, sans-serif" font-size="${format === 'story' ? 28 : 20}" font-weight="600">#DottHR  #HumanResources  #TeamBuilding</text>
</svg>`;
  const outputDir = path.resolve(process.cwd(), '..', 'exports', 'dotthr-quote-cards');
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${template.key}-${format}-${Date.now()}.png`);
  await sharp(Buffer.from(svg)).png().toFile(outputPath);
  return outputPath;
}

function fromValue(value) {
  if (!value || typeof value !== 'object') return undefined;
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('timestampValue' in value) return value.timestampValue;
  if ('nullValue' in value) return null;
  if ('mapValue' in value) return fromFields(value.mapValue.fields || {});
  if ('arrayValue' in value) return Object.values(value.arrayValue.values || {}).map(fromValue);
  return undefined;
}

function fromFields(fields) {
  return Object.fromEntries(Object.entries(fields || {}).map(([key, value]) => [key, fromValue(value)]));
}

async function loadUserSocialAccounts(serviceAccount) {
  const tokenFallback = await loadMetaTokenFallback();
  const auth = new GoogleAuth({
    credentials: serviceAccount,
    scopes: ['https://www.googleapis.com/auth/datastore'],
  });
  const client = await auth.getClient();
  const token = (await client.getAccessToken()).token;
  const projectId = serviceAccount.project_id || serviceAccount.projectId;
  const docUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${UID}`;
  const response = await fetch(docUrl, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    if (tokenFallback) {
      console.warn(`Firestore user lookup failed: ${response.status}; using Dott HR Meta token fallback`);
      return tokenFallback;
    }
    throw new Error(`Firestore user lookup failed: ${response.status} ${await response.text()}`);
  }
  const doc = await response.json();
  const socialAccounts = fromFields(doc.fields || {}).socialAccounts || {};
  if (!socialAccounts.facebook?.accessToken && tokenFallback) return tokenFallback;
  return socialAccounts;
}

async function loadMetaTokenFallback() {
  const token = (
    process.env.DOTTHR_META_USER_TOKEN ||
    process.env.META_GRAPH_TOKEN ||
    process.env.CLIENT_META_USER_TOKEN ||
    ''
  ).trim();
  if (!token) return null;
  try {
    const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${DOTTHR_PAGE_ID}`);
    url.searchParams.set('fields', 'id,name,access_token,instagram_business_account{id,username,name}');
    url.searchParams.set('access_token', token);
    const response = await retryAsync(
      () => fetch(url, { signal: AbortSignal.timeout(60000) }),
      4,
      'Dott HR page token lookup',
    );
    if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
    const page = await response.json();
    if (!page?.access_token) return null;
    return {
      facebook: {
        pageId: String(page.id || DOTTHR_PAGE_ID),
        pageName: page.name || 'Dott Human Resource',
        accessToken: page.access_token,
      },
      instagram: {
        accountId: String(page.instagram_business_account?.id || DOTTHR_IG_ID),
        username: page.instagram_business_account?.username || 'dott_human_resource',
        accessToken: page.access_token,
      },
    };
  } catch (error) {
    console.warn('Dott HR Meta token fallback failed', error?.message || String(error));
    return null;
  }
}

async function getIdToken(uid) {
  const apiKey = process.env.EXPO_PUBLIC_FIREBASE_API_KEY;
  if (!apiKey) throw new Error('Missing EXPO_PUBLIC_FIREBASE_API_KEY');
  const customToken = await admin.auth().createCustomToken(uid);
  const response = await retryAsync(
    () =>
      fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: customToken, returnSecureToken: true }),
        signal: AbortSignal.timeout(45000),
      }),
    4,
    'Firebase ID token exchange',
  );
  if (!response.ok) throw new Error(`custom token sign-in failed: ${response.status} ${await response.text()}`);
  return (await response.json()).idToken;
}

async function uploadForRemoteUse(filePath, fileName, idToken) {
  const form = new FormData();
  form.append('files', new Blob([fs.readFileSync(filePath)], { type: mimeFor(fileName) }), fileName);
  const response = await retryAsync(
    () =>
      fetch(`${API_BASE}/api/media/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
        body: form,
        signal: AbortSignal.timeout(90000),
      }),
    4,
    'media upload',
  );
  if (!response.ok) throw new Error(`media upload failed: ${response.status} ${await response.text()}`);
  const json = await response.json();
  const url = json.files?.[0]?.url;
  if (!url) throw new Error('media upload response missing URL');
  return url;
}

async function publishFacebookFeed(facebook, imageUrl, message) {
  if (!facebook?.pageId || !facebook?.accessToken) throw new Error('Facebook credentials missing');
  const response = await axios.post(`https://graph.facebook.com/${GRAPH_VERSION}/${facebook.pageId}/photos`, null, {
    params: {
      url: imageUrl,
      message,
      access_token: facebook.accessToken,
    },
    timeout: 90000,
    validateStatus: () => true,
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`facebook feed failed: ${response.status} ${JSON.stringify(response.data)}`);
  }
  return response.data;
}

async function publishFacebookStory(facebook, filePath, fileName) {
  if (!facebook?.pageId || !facebook?.accessToken) throw new Error('Facebook credentials missing');
  const form = new FormData();
  form.append('source', new Blob([fs.readFileSync(filePath)], { type: mimeFor(fileName) }), fileName);
  form.append('published', 'false');
  form.append('access_token', facebook.accessToken);
  const photoResponse = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${facebook.pageId}/photos`, {
    method: 'POST',
    body: form,
  });
  const photoText = await photoResponse.text();
  if (!photoResponse.ok) throw new Error(`facebook story upload failed: ${photoResponse.status} ${photoText}`);
  const photo = JSON.parse(photoText);
  const story = await axios.post(`https://graph.facebook.com/${GRAPH_VERSION}/${facebook.pageId}/photo_stories`, null, {
    params: { photo_id: photo.id, access_token: facebook.accessToken },
    timeout: 60000,
  });
  return story.data;
}

async function waitForInstagramReady(creationId, accessToken) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const status = await axios.get(`https://graph.facebook.com/${GRAPH_VERSION}/${creationId}`, {
      params: { fields: 'status_code,status', access_token: accessToken },
      timeout: 20000,
    });
    if (status.data?.status_code === 'FINISHED') return;
    if (status.data?.status_code === 'ERROR') throw new Error(`instagram media error: ${JSON.stringify(status.data)}`);
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  throw new Error('instagram media was not ready in time');
}

async function publishInstagramFeed(instagram, imageUrl, caption) {
  if (!instagram?.accountId || !instagram?.accessToken) throw new Error('Instagram credentials missing');
  const base = `https://graph.facebook.com/${GRAPH_VERSION}/${instagram.accountId}`;
  const create = await axios.post(base + '/media', null, {
    params: { image_url: imageUrl, caption, access_token: instagram.accessToken },
    timeout: 60000,
  });
  await waitForInstagramReady(create.data.id, instagram.accessToken);
  const publish = await axios.post(base + '/media_publish', null, {
    params: { creation_id: create.data.id, access_token: instagram.accessToken },
    timeout: 60000,
  });
  return publish.data;
}

async function publishInstagramStory(instagram, imageUrl) {
  if (!instagram?.accountId || !instagram?.accessToken) throw new Error('Instagram credentials missing');
  const base = `https://graph.facebook.com/${GRAPH_VERSION}/${instagram.accountId}`;
  const create = await axios.post(base + '/media', null, {
    params: { media_type: 'STORIES', image_url: imageUrl, access_token: instagram.accessToken },
    timeout: 60000,
  });
  await waitForInstagramReady(create.data.id, instagram.accessToken);
  const publish = await axios.post(base + '/media_publish', null, {
    params: { creation_id: create.data.id, access_token: instagram.accessToken },
    timeout: 60000,
  });
  return publish.data;
}

async function waitForThreadsReady(containerId, accessToken) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const status = await retryAsync(
      () =>
        axios.get(`${THREADS_GRAPH_BASE}/${THREADS_GRAPH_VERSION}/${containerId}`, {
          params: { fields: 'status,error_message', access_token: accessToken },
          timeout: 30000,
        }),
      3,
      'Threads media status',
    );
    if (status.data?.status === 'FINISHED') return;
    if (status.data?.status === 'ERROR') throw new Error(status.data?.error_message || 'threads media error');
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  throw new Error('threads media was not ready in time');
}

async function publishThreadsFeed(threads, imageUrl, text) {
  if (!threads?.accountId || !threads?.accessToken) throw new Error('Threads credentials missing');
  const base = `${THREADS_GRAPH_BASE}/${THREADS_GRAPH_VERSION}/${threads.accountId}`;
  const create = await retryAsync(
    () =>
      axios.post(base + '/threads', null, {
        params: {
          media_type: 'IMAGE',
          image_url: imageUrl,
          text,
          access_token: threads.accessToken,
        },
        timeout: 90000,
      }),
    4,
    'Threads media create',
  );
  await waitForThreadsReady(create.data.id, threads.accessToken);
  const publish = await retryAsync(
    () =>
      axios.post(base + '/threads_publish', null, {
        params: { creation_id: create.data.id, access_token: threads.accessToken },
        timeout: 90000,
      }),
    4,
    'Threads publish',
  );
  return publish.data;
}

const credentials = loadServiceAccount();
admin.initializeApp({
  credential: admin.credential.cert(credentials),
  projectId: credentials.project_id || credentials.projectId,
});

const state = loadState();
const files = imageFiles();
if (!files.length) throw new Error(`No images found in ${ASSET_DIR}`);

const cursorKey = mode === 'story' ? 'storyCursor' : 'feedCursor';
const runCountKey = mode === 'story' ? 'storyRunCount' : 'feedRunCount';
const runCount = Number(state[runCountKey] || 0);
const shouldPostQuote = forceQuote || runCount % 3 === 2;
const quoteTemplate = QUOTE_TEMPLATES[runCount % QUOTE_TEMPLATES.length];
const index = Number(state[cursorKey] || 0) % files.length;
const filePath = shouldPostQuote ? await renderQuoteImage(quoteTemplate, mode) : path.join(ASSET_DIR, files[index]);
const fileName = path.basename(filePath);
const caption = shouldPostQuote
  ? `${quoteTemplate.caption}\n\n${COMMENT_TO_DM_CTA}\n\n${HASHTAGS}`
  : captionFor(index);
const idToken = await getIdToken(UID);
const uploadedUrl = await uploadForRemoteUse(filePath, fileName, idToken);
const socialAccounts = await loadUserSocialAccounts(credentials);

const results = [];
if (mode === 'story') {
  try {
    const result = await publishFacebookStory(socialAccounts.facebook, filePath, fileName);
    results.push({ platform: 'facebook_story', status: 'posted', remoteId: result.post_id || result.id || null });
  } catch (error) {
    results.push({ platform: 'facebook_story', status: 'failed', error: error.message });
  }
  try {
    const result = await publishInstagramStory(socialAccounts.instagram, uploadedUrl);
    results.push({ platform: 'instagram_story', status: 'posted', remoteId: result.id || null });
  } catch (error) {
    results.push({ platform: 'instagram_story', status: 'failed', error: error.message });
  }
} else {
  try {
    const result = await publishFacebookFeed(socialAccounts.facebook, uploadedUrl, caption);
    results.push({ platform: 'facebook', status: 'posted', remoteId: result.post_id || result.id || null });
  } catch (error) {
    results.push({ platform: 'facebook', status: 'failed', error: error.message });
  }
  try {
    const result = await publishInstagramFeed(socialAccounts.instagram, uploadedUrl, caption);
    results.push({ platform: 'instagram', status: 'posted', remoteId: result.id || null });
  } catch (error) {
    results.push({ platform: 'instagram', status: 'failed', error: error.message });
  }
  try {
    const result = await publishThreadsFeed(socialAccounts.threads, uploadedUrl, caption);
    results.push({ platform: 'threads', status: 'posted', remoteId: result.id || null });
  } catch (error) {
    results.push({ platform: 'threads', status: 'failed', error: error.message });
  }
}

if (!shouldPostQuote) {
  state[cursorKey] = (index + 1) % files.length;
}
state[runCountKey] = runCount + 1;
state.runs = [
  {
    at: new Date().toISOString(),
    mode,
    contentType: shouldPostQuote ? 'quote' : 'folder_image',
    quoteKey: shouldPostQuote ? quoteTemplate.key : null,
    uid: UID,
    email: EMAIL,
    fileName,
    imageUrl: uploadedUrl,
    results,
  },
  ...(Array.isArray(state.runs) ? state.runs : []),
].slice(0, 100);
saveState(state);

console.log(JSON.stringify(state.runs[0], null, 2));
