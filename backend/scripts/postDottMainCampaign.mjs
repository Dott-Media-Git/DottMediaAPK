import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

import axios from 'axios';
import admin from 'firebase-admin';

const DOTT_MAIN_USER_ID = process.env.DOTT_MAIN_USER_ID || 'cMPZQccGggbhZe9dbvtxFmBehP02';
const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v19.0';
const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const WORKER_TAG = 'dott_main_campaign_worker';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const campaignDir = path.resolve(__dirname, '..', 'public', 'campaign-images', 'dottmain');

const CAMPAIGN_ITEMS = [
  {
    slug: 'services-ai-workflows',
    filename: 'services-ai-workflows.jpeg',
    instagramCaption:
      "Tech. Automation. Branding.\n\nDott Media helps businesses scale with AI workflow integration, websites, apps, automation, branding, and media production.\n\nDM us to get started. Link in bio.\n\n#DottMedia #Automation #Branding #AIForBusiness #WebDevelopment #AppDevelopment #BusinessGrowth",
    facebookCaption:
      "Tech. Automation. Branding.\n\nDott Media helps businesses scale with AI workflow integration, websites, apps, automation, branding, and media production.\n\nGet started: www.dott-media.org\nMessage us for a quote.\n\n#DottMedia #Automation #Branding #AIForBusiness #WebDevelopment #AppDevelopment #BusinessGrowth",
  },
  {
    slug: 'best-ai-automation-services',
    filename: 'best-ai-automation-services.jpeg',
    instagramCaption:
      "Best AI automation services for brands that want to move faster.\n\nWe help businesses save time and grow with AI-powered tools and automation workflows.\n\nDM us for the 10% offer. Link in bio.\n\n#DottMedia #AIAutomation #MarketingAutomation #BusinessAutomation #AIServices #DigitalGrowth",
    facebookCaption:
      "Best AI automation services for brands that want to move faster.\n\nWe help businesses save time and grow with AI-powered tools and automation workflows.\n\nGet up to 10% off selected services.\nVisit: www.dott-media.org\n\n#DottMedia #AIAutomation #MarketingAutomation #BusinessAutomation #AIServices #DigitalGrowth",
  },
  {
    slug: 'best-ai-tech-services',
    filename: 'best-ai-tech-services.jpeg',
    instagramCaption:
      "Best AI and tech services for modern brands.\n\nFrom workflow integration to websites, automation, and brand identity, Dott Media builds systems that help you grow.\n\nSend us a DM for a quote.\n\n#DottMedia #TechServices #AIServices #BrandIdentity #WebAndAppDevelopment #GrowthSystems",
    facebookCaption:
      "Best AI and tech services for modern brands.\n\nFrom workflow integration to websites, automation, and brand identity, Dott Media builds systems that help you grow.\n\nSend a quote request today: www.dott-media.org\n\n#DottMedia #TechServices #AIServices #BrandIdentity #WebAndAppDevelopment #GrowthSystems",
  },
  {
    slug: 'special-deals-first-service',
    filename: 'special-deals-first-service.jpeg',
    instagramCaption:
      "Dott Media can help you grow faster with AI-powered tools, automation, branding, and content systems.\n\nSpecial deals are available on your first service.\n\nLink in bio.\n\n#DottMedia #SpecialOffer #AIForBusiness #CreativeMedia #DigitalMarketing #AutomationAgency",
    facebookCaption:
      "Dott Media can help you grow faster with AI-powered tools, automation, branding, and content systems.\n\nSpecial deals are available on your first service.\nVisit: www.dott-media.org\n\n#DottMedia #SpecialOffer #AIForBusiness #CreativeMedia #DigitalMarketing #AutomationAgency",
  },
];

function requireEnv(name, value) {
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function initFirebase() {
  if (admin.apps.length) return admin.app();
  const raw = requireEnv('FIREBASE_SERVICE_ACCOUNT_JSON', process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  return admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
}

function supabaseHeaders() {
  return {
    apikey: requireEnv('SUPABASE_SERVICE_ROLE_KEY', SUPABASE_SERVICE_ROLE_KEY),
    Authorization: `Bearer ${requireEnv('SUPABASE_SERVICE_ROLE_KEY', SUPABASE_SERVICE_ROLE_KEY)}`,
    'Content-Type': 'application/json',
  };
}

function hourBucket() {
  return new Date().toISOString().slice(0, 13);
}

async function getMainAccounts() {
  initFirebase();
  const snap = await admin.firestore().collection('users').doc(DOTT_MAIN_USER_ID).get();
  const data = snap.data() || {};
  const facebook = data.socialAccounts?.facebook || {};
  const instagram = data.socialAccounts?.instagram || {};
  if (!facebook.pageId || !facebook.accessToken) {
    throw new Error('Dott main Facebook credentials missing in Firestore');
  }
  if (!instagram.accountId || !instagram.accessToken) {
    throw new Error('Dott main Instagram credentials missing in Firestore');
  }
  return { facebook, instagram };
}

async function getCampaignState() {
  initFirebase();
  const ref = admin.firestore().collection('autopostJobs').doc(DOTT_MAIN_USER_ID);
  const snap = await ref.get();
  return { ref, data: snap.data() || {} };
}

async function updateCampaignState(ref, updates) {
  await ref.set(
    {
      ...updates,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

async function hasProcessedContent(contentKey) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return false;
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
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !entries.length) return;
  await axios.post(`${SUPABASE_URL}/rest/v1/dott_social_logs`, entries, {
    headers: {
      ...supabaseHeaders(),
      Prefer: 'return=minimal',
    },
    timeout: 30000,
  });
}

async function incrementSocialDaily(postedCountByPlatform) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return;
  const date = new Date().toISOString().slice(0, 10);
  const id = `${DOTT_MAIN_USER_ID}_${date}`;
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
          user_id: DOTT_MAIN_USER_ID,
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

async function uploadToCatbox(fileBuffer, filename) {
  const form = new FormData();
  form.set('reqtype', 'fileupload');
  form.set('fileToUpload', new Blob([fileBuffer], { type: 'image/jpeg' }), filename);
  const response = await fetch('https://catbox.moe/user/api.php', {
    method: 'POST',
    body: form,
  });
  const text = (await response.text()).trim();
  if (!response.ok || !/^https?:\/\//i.test(text)) {
    throw new Error(`Catbox upload failed: ${text || response.status}`);
  }
  return text;
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
  return { id: mediaId, permalink: meta.data?.permalink || null };
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

async function chooseItem() {
  const { ref, data } = await getCampaignState();
  const enabled = data.dottCampaignEnabled !== false;
  if (!enabled) {
    throw new Error('Dott main campaign is disabled');
  }
  const cursor = Number.isFinite(data.dottCampaignCursor) ? Number(data.dottCampaignCursor) : 0;
  const item = CAMPAIGN_ITEMS[((cursor % CAMPAIGN_ITEMS.length) + CAMPAIGN_ITEMS.length) % CAMPAIGN_ITEMS.length];
  return { ref, data, cursor, item };
}

async function main() {
  const { facebook, instagram } = await getMainAccounts();
  const { ref, cursor, item } = await chooseItem();
  const contentKey = crypto.createHash('sha1').update(`${item.slug}|${hourBucket()}`).digest('hex');
  if (await hasProcessedContent(contentKey)) {
    console.log(JSON.stringify({ ok: true, skipped: true, reason: 'already_posted_this_hour', contentKey, slug: item.slug }));
    return;
  }

  const localPath = path.join(campaignDir, item.filename);
  const fileBuffer = await fs.readFile(localPath);
  const hostedUrl = await uploadToCatbox(fileBuffer, item.filename);

  const instagramResult = await publishToInstagram({
    accountId: instagram.accountId,
    accessToken: instagram.accessToken,
    imageUrl: hostedUrl,
    caption: item.instagramCaption,
  });
  const facebookResult = await publishToFacebook({
    pageId: facebook.pageId,
    accessToken: facebook.accessToken,
    imageUrl: hostedUrl,
    caption: item.facebookCaption,
  });

  const postedAt = new Date().toISOString();
  await addSocialLogs([
    {
      user_id: DOTT_MAIN_USER_ID,
      platform: WORKER_TAG,
      scheduled_post_id: `external:${contentKey}`,
      status: 'posted',
      response_id: `${instagramResult.id}|${facebookResult.id}`,
      posted_at: postedAt,
      payload: {
        slug: item.slug,
        filename: item.filename,
        worker: WORKER_TAG,
        contentType: 'campaign_image',
        imageUrl: hostedUrl,
        instagram: instagramResult,
        facebook: facebookResult,
      },
    },
    {
      user_id: DOTT_MAIN_USER_ID,
      platform: 'instagram',
      scheduled_post_id: `external:${contentKey}`,
      status: 'posted',
      response_id: instagramResult.id,
      posted_at: postedAt,
      payload: {
        slug: item.slug,
        filename: item.filename,
        worker: WORKER_TAG,
        contentType: 'campaign_image',
        imageUrl: hostedUrl,
        instagram: instagramResult,
      },
    },
    {
      user_id: DOTT_MAIN_USER_ID,
      platform: 'facebook',
      scheduled_post_id: `external:${contentKey}`,
      status: 'posted',
      response_id: facebookResult.id,
      posted_at: postedAt,
      payload: {
        slug: item.slug,
        filename: item.filename,
        worker: WORKER_TAG,
        contentType: 'campaign_image',
        imageUrl: hostedUrl,
        facebook: facebookResult,
      },
    },
  ]);
  await incrementSocialDaily({ instagram: 1, facebook: 1 });

  await updateCampaignState(ref, {
    dottCampaignEnabled: true,
    dottCampaignCursor: (cursor + 1) % CAMPAIGN_ITEMS.length,
    dottCampaignItems: CAMPAIGN_ITEMS.map(entry => entry.filename),
    dottCampaignLastRunAt: admin.firestore.FieldValue.serverTimestamp(),
    dottCampaignLastResult: [
      { platform: 'instagram', status: 'posted', remoteId: instagramResult.id },
      { platform: 'facebook', status: 'posted', remoteId: facebookResult.id },
    ],
  });

  console.log(
    JSON.stringify({
      ok: true,
      contentKey,
      slug: item.slug,
      imageUrl: hostedUrl,
      instagram: instagramResult,
      facebook: facebookResult,
    }),
  );
}

main().catch(error => {
  console.error('[dott-main-campaign] failed', error);
  process.exit(1);
});
