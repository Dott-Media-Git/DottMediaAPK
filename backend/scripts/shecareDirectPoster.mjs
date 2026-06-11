import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import dns from 'dns';
import axios from 'axios';
import admin from 'firebase-admin';

dns.setDefaultResultOrder('ipv4first');

dotenv.config({ path: path.resolve(process.cwd(), '.env'), override: false });
dotenv.config({ path: path.resolve(process.cwd(), 'backend/.env'), override: false });
dotenv.config({ path: path.resolve(process.cwd(), '..', '.env'), override: false });

const UID = process.env.SHECARE_UID || 'tCE1FQ1cOFgdupOXP23mPUMQRAz1';
const EMAIL = process.env.SHECARE_EMAIL || 'shecaredoctor@gmail.com';
const SHECARE_PAGE_ID = process.env.SHECARE_PAGE_ID || '1114686181730831';
const ASSET_DIR =
  process.env.SHECARE_ASSET_DIR ||
  'C:\\Users\\joseph marvin\\Downloads\\SheCare Post Files';
const STATE_PATH =
  process.env.SHECARE_STATE_PATH ||
  path.resolve(process.cwd(), '..', 'exports', 'shecare-direct-poster-state.json');
const API_BASE = (process.env.SHECARE_API_BASE || 'https://dottmediaapk.onrender.com').replace(/\/$/, '');
const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v23.0';
const WHATSAPP_NUMBER = process.env.SHECARE_WHATSAPP_NUMBER || '+447463010235';
const WHATSAPP_LINK = process.env.SHECARE_WHATSAPP_LINK || 'https://wa.me/447463010235';

const FEED_CAPTIONS = [
  'Private women’s health support is available for women in the UAE. Shecare Doctor offers gentle, confidential guidance when pregnancy feels unexpected, stressful, or difficult to talk about. Message us privately when you are ready.',
  'For women in Dubai, Abu Dhabi, Sharjah, and across the UAE: you deserve care, privacy, and clear information. Shecare Doctor is here to listen with warmth and respect, without judgement.',
  'A difficult pregnancy situation can feel heavy, especially when you are far from home or unsure who to trust. Shecare Doctor offers confidential support for women in the UAE who need a calm, private conversation.',
  'No shame. No pressure. Just private support. Shecare Doctor welcomes women in the UAE who need caring guidance, respectful answers, and a safe space to ask personal health questions.',
  'Your health and peace of mind matter. If pregnancy was not planned and you feel unsure, Shecare Doctor can help you talk through your next step privately and with care.',
  'Confidential support for women across the UAE. Shecare Doctor is here with warm, respectful guidance for sensitive pregnancy concerns and private women’s health questions.',
  'You are not alone in this moment. Shecare Doctor provides private, welcoming support for women in the UAE, with gentle guidance and respect for your situation.',
];

const STORY_CAPTIONS = [
  'Private women’s health support is available in the UAE. Message Shecare Doctor when you need warm, confidential help.',
  'Dubai, Abu Dhabi, Sharjah and across the UAE: you are not alone. We are here to listen privately and guide you with care.',
  'Need someone gentle to talk to in the UAE? Send Shecare Doctor a private message.',
  "Confidential women's health support in the UAE, without judgement. We are here when you are ready.",
];

const HASHTAGS =
  '#ShecareDoctor #UAE #Dubai #MyDubai #DXB #AbuDhabi #Sharjah #DubaiLife #UAELife #Emirates #UnitedArabEmirates #DubaiWomen #UAEWomen #WomensHealth #WomenHealthUAE #DubaiHealthcare #UAEHealthcare #PregnancySupport #ConfidentialCare #PrivateCare #WellnessCare #WomenSupportingWomen';

const CONTACT_LINE = `Private WhatsApp support: ${WHATSAPP_LINK}`;
const COMMENT_TO_DM_CTA = 'Comment HELP and we will send private details in your DM.';

process.on('unhandledRejection', error => {
  console.error('shecare-direct failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});

process.on('uncaughtException', error => {
  console.error('shecare-direct failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});

const modeArg = process.argv.find(arg => arg.startsWith('--mode='))?.split('=')[1] || 'feed';
const mode = modeArg === 'story' ? 'story' : 'feed';

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
    .filter(entry => entry.isFile() && /\.(?:jpe?g|png|webp)$/i.test(entry.name))
    .map(entry => {
      const filePath = path.join(ASSET_DIR, entry.name);
      const stat = fs.statSync(filePath);
      return { name: entry.name, mtimeMs: stat.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs || a.name.localeCompare(b.name))
    .map(entry => entry.name);
}

function captionFor(index) {
  if (mode === 'story') return STORY_CAPTIONS[index % STORY_CAPTIONS.length];
  return `${FEED_CAPTIONS[index % FEED_CAPTIONS.length]}\n\n${COMMENT_TO_DM_CTA}\n\n${CONTACT_LINE}\n\n${HASHTAGS}`;
}

async function retryAsync(fn, attempts, label) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      console.warn(`[shecare-direct] ${label} attempt ${attempt}/${attempts} failed`, error?.cause?.message || error?.message || String(error));
      if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, attempt * 5000));
    }
  }
  throw lastError;
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

async function uploadForInstagram(filePath, fileName, idToken) {
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

async function resolveShecareCredentials() {
  const userAccessToken = (
    process.env.META_GRAPH_TOKEN ||
    process.env.INSTAGRAM_ACCESS_TOKEN ||
    process.env.FACEBOOK_PAGE_TOKEN ||
    ''
  ).trim();
  if (!userAccessToken) throw new Error('Missing Meta token');
  const pageResponse = await retryAsync(
    () =>
      axios.get(`https://graph.facebook.com/${GRAPH_VERSION}/${SHECARE_PAGE_ID}`, {
        params: {
          fields: 'id,name,access_token,instagram_business_account{id,username}',
          access_token: userAccessToken,
        },
        timeout: 45000,
      }),
    4,
    'SheCare page lookup',
  );
  const page = pageResponse.data;
  if (!page?.id || !page.access_token) throw new Error('Shecare Facebook Page token not found');
  const instagram = page.instagram_business_account;
  if (!instagram?.id) throw new Error('Shecare Instagram account not found');
  return {
    page,
    instagram,
    userAccessToken,
  };
}

async function publishFacebookFeed(page, imageUrl, message) {
  const response = await axios.post(`https://graph.facebook.com/${GRAPH_VERSION}/${page.id}/photos`, null, {
    params: {
      url: imageUrl,
      message,
      access_token: page.access_token,
    },
    timeout: 90000,
    validateStatus: () => true,
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`facebook feed failed: ${response.status} ${JSON.stringify(response.data)}`);
  }
  return response.data;
}

async function hasUpcomingFacebookSchedule(page) {
  if (process.env.SHECARE_IGNORE_FB_NATIVE_SCHEDULE === 'true') return false;
  const windowHours = Math.max(Number(process.env.SHECARE_FB_SCHEDULE_WINDOW_HOURS || 3.5), 1);
  try {
    const response = await axios.get(`https://graph.facebook.com/${GRAPH_VERSION}/${page.id}/scheduled_posts`, {
      params: {
        fields: 'id,scheduled_publish_time',
        limit: 25,
        access_token: page.access_token,
      },
      timeout: 30000,
    });
    const nowSeconds = Math.floor(Date.now() / 1000);
    const latestAllowed = nowSeconds + Math.floor(windowHours * 60 * 60);
    return ((response.data?.data || [])).some(post => {
      const scheduled = Number(post.scheduled_publish_time || 0);
      return scheduled >= nowSeconds - 300 && scheduled <= latestAllowed;
    });
  } catch (error) {
    console.warn('Failed to inspect Facebook native schedule; posting fallback will continue.', error.message);
    return false;
  }
}

async function publishFacebookStory(page, filePath) {
  const form = new FormData();
  form.append('source', new Blob([fs.readFileSync(filePath)], { type: mimeFor(filePath) }), path.basename(filePath));
  form.append('published', 'false');
  form.append('access_token', page.access_token);
  const photoResponse = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${page.id}/photos`, {
    method: 'POST',
    body: form,
  });
  const photoText = await photoResponse.text();
  if (!photoResponse.ok) throw new Error(`facebook story upload failed: ${photoResponse.status} ${photoText}`);
  const photo = JSON.parse(photoText);
  const story = await axios.post(`https://graph.facebook.com/${GRAPH_VERSION}/${page.id}/photo_stories`, null, {
    params: { photo_id: photo.id, access_token: page.access_token },
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

async function publishInstagramFeed(instagram, accessToken, imageUrl, caption) {
  const base = `https://graph.facebook.com/${GRAPH_VERSION}/${instagram.id}`;
  const create = await axios.post(base + '/media', null, {
    params: { image_url: imageUrl, caption, access_token: accessToken },
    timeout: 60000,
  });
  await waitForInstagramReady(create.data.id, accessToken);
  const publish = await axios.post(base + '/media_publish', null, {
    params: { creation_id: create.data.id, access_token: accessToken },
    timeout: 60000,
  });
  return publish.data;
}

async function publishInstagramStory(instagram, accessToken, imageUrl) {
  const base = `https://graph.facebook.com/${GRAPH_VERSION}/${instagram.id}`;
  const create = await axios.post(base + '/media', null, {
    params: { media_type: 'STORIES', image_url: imageUrl, access_token: accessToken },
    timeout: 60000,
  });
  await waitForInstagramReady(create.data.id, accessToken);
  const publish = await axios.post(base + '/media_publish', null, {
    params: { creation_id: create.data.id, access_token: accessToken },
    timeout: 60000,
  });
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
const index = Number(state[cursorKey] || 0) % files.length;
const forcedFile = process.env.SHECARE_FORCE_FILE?.trim();
const forcedIndex = forcedFile ? files.findIndex(file => file.toLowerCase() === forcedFile.toLowerCase()) : -1;
const selectedIndex = forcedIndex >= 0 ? forcedIndex : index;
const fileName = files[selectedIndex];
const filePath = path.join(ASSET_DIR, fileName);
const caption = captionFor(selectedIndex);
const idToken = await getIdToken(UID);
const uploadedUrl = await uploadForInstagram(filePath, fileName, idToken);
const { page, instagram } = await resolveShecareCredentials();
const instagramAccessToken = page.access_token;

const results = [];
if (mode === 'story') {
  try {
    const result = await publishFacebookStory(page, filePath);
    results.push({ platform: 'facebook_story', status: 'posted', remoteId: result.post_id || result.id || null });
  } catch (error) {
    results.push({ platform: 'facebook_story', status: 'failed', error: error.message });
  }
  try {
    const result = await publishInstagramStory(instagram, instagramAccessToken, uploadedUrl);
    results.push({ platform: 'instagram_story', status: 'posted', remoteId: result.id || null });
  } catch (error) {
    results.push({ platform: 'instagram_story', status: 'failed', error: error.message });
  }
} else {
  try {
    if (await hasUpcomingFacebookSchedule(page)) {
      results.push({ platform: 'facebook', status: 'skipped_native_scheduled', remoteId: null });
    } else {
      const result = await publishFacebookFeed(page, uploadedUrl, caption);
      results.push({ platform: 'facebook', status: 'posted', remoteId: result.post_id || result.id || null });
    }
  } catch (error) {
    results.push({ platform: 'facebook', status: 'failed', error: error.message });
  }
  try {
    const result = await publishInstagramFeed(instagram, instagramAccessToken, uploadedUrl, caption);
    results.push({ platform: 'instagram', status: 'posted', remoteId: result.id || null });
  } catch (error) {
    results.push({ platform: 'instagram', status: 'failed', error: error.message });
  }
}

state[cursorKey] = (selectedIndex + 1) % files.length;
state.runs = [
  {
    at: new Date().toISOString(),
    mode,
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
