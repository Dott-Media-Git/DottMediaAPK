import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

import axios from 'axios';
import admin from 'firebase-admin';

const DOTT_MAIN_USER_ID = process.env.DOTT_MAIN_USER_ID || 'cMPZQccGggbhZe9dbvtxFmBehP02';
const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v19.0';
const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const WORKER_TAG = 'dott_main_campaign_worker';
const FORCED_SLUG = (process.env.DOTT_CAMPAIGN_FORCE_SLUG || '').trim();
const BYPASS_DEDUPE = /^(1|true|yes)$/i.test((process.env.DOTT_CAMPAIGN_BYPASS_DEDUPE || '').trim());
const WORKER_CONFIG_BUCKET = 'worker-config';
const WORKER_CONFIG_OBJECT = 'dott-main-meta-accounts.json';
const ASSET_BASE_URL =
  (process.env.DOTT_CAMPAIGN_ASSET_BASE_URL || 'https://raw.githubusercontent.com/Dott-Media-Git/DottMediaAPK/main').replace(/\/$/, '');
const READY_ATTEMPTS = Math.max(Number(process.env.INSTAGRAM_MEDIA_READY_ATTEMPTS ?? 20), 5);
const READY_DELAY_MS = Math.max(Number(process.env.INSTAGRAM_MEDIA_READY_DELAY_MS ?? 3000), 1000);
const PUBLISH_RETRIES = Math.max(Number(process.env.INSTAGRAM_PUBLISH_RETRIES ?? 3), 1);
const PUBLISH_RETRY_DELAY_MS = Math.max(Number(process.env.INSTAGRAM_PUBLISH_RETRY_DELAY_MS ?? 4000), 1000);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CAMPAIGN_ITEMS = [
  {
    type: 'image',
    slug: 'services-ai-workflows',
    filename: 'services-ai-workflows.jpeg',
    instagramCaption:
      "Tech. Automation. Branding.\n\nDott Media helps businesses scale with AI workflow integration, websites, apps, automation, branding, and media production.\n\nDM us to get started. Link in bio.\n\n#DottMedia #Automation #Branding #AIForBusiness #WebDevelopment #AppDevelopment #BusinessGrowth",
    facebookCaption:
      "Tech. Automation. Branding.\n\nDott Media helps businesses scale with AI workflow integration, websites, apps, automation, branding, and media production.\n\nGet started: www.dott-media.org\nMessage us for a quote.\n\n#DottMedia #Automation #Branding #AIForBusiness #WebDevelopment #AppDevelopment #BusinessGrowth",
  },
  {
    type: 'image',
    slug: 'best-ai-automation-services',
    filename: 'best-ai-automation-services.jpeg',
    instagramCaption:
      "Best AI automation services for brands that want to move faster.\n\nWe help businesses save time and grow with AI-powered tools and automation workflows.\n\nDM us for the 10% offer. Link in bio.\n\n#DottMedia #AIAutomation #MarketingAutomation #BusinessAutomation #AIServices #DigitalGrowth",
    facebookCaption:
      "Best AI automation services for brands that want to move faster.\n\nWe help businesses save time and grow with AI-powered tools and automation workflows.\n\nGet up to 10% off selected services.\nVisit: www.dott-media.org\n\n#DottMedia #AIAutomation #MarketingAutomation #BusinessAutomation #AIServices #DigitalGrowth",
  },
  {
    type: 'image',
    slug: 'best-ai-tech-services',
    filename: 'best-ai-tech-services.jpeg',
    instagramCaption:
      "Best AI and tech services for modern brands.\n\nFrom workflow integration to websites, automation, and brand identity, Dott Media builds systems that help you grow.\n\nSend us a DM for a quote.\n\n#DottMedia #TechServices #AIServices #BrandIdentity #WebAndAppDevelopment #GrowthSystems",
    facebookCaption:
      "Best AI and tech services for modern brands.\n\nFrom workflow integration to websites, automation, and brand identity, Dott Media builds systems that help you grow.\n\nSend a quote request today: www.dott-media.org\n\n#DottMedia #TechServices #AIServices #BrandIdentity #WebAndAppDevelopment #GrowthSystems",
  },
  {
    type: 'image',
    slug: 'special-deals-first-service',
    filename: 'special-deals-first-service.jpeg',
    instagramCaption:
      "Dott Media can help you grow faster with AI-powered tools, automation, branding, and content systems.\n\nSpecial deals are available on your first service.\n\nLink in bio.\n\n#DottMedia #SpecialOffer #AIForBusiness #CreativeMedia #DigitalMarketing #AutomationAgency",
    facebookCaption:
      "Dott Media can help you grow faster with AI-powered tools, automation, branding, and content systems.\n\nSpecial deals are available on your first service.\nVisit: www.dott-media.org\n\n#DottMedia #SpecialOffer #AIForBusiness #CreativeMedia #DigitalMarketing #AutomationAgency",
  },
  {
    type: 'image',
    slug: 'social-ai-connectivity',
    filename: 'social-ai-connectivity.jpeg',
    instagramCaption:
      "One AI system can connect your socials, automate your workflows, and keep your brand moving around the clock.\n\nDott Media builds growth systems for modern businesses.\n\nDM us to set yours up.\n\n#DottMedia #AIForBusiness #Automation #SocialMediaSystems #GrowthSystems #DigitalStrategy",
    facebookCaption:
      "One AI system can connect your socials, automate your workflows, and keep your brand moving around the clock.\n\nDott Media builds growth systems for modern businesses.\n\nVisit: www.dott-media.org\nMessage us to get started.\n\n#DottMedia #AIForBusiness #Automation #SocialMediaSystems #GrowthSystems #DigitalStrategy",
  },
  {
    type: 'image',
    slug: 'ai-drive-business-growth',
    filename: 'ai-drive-business-growth.png',
    instagramCaption:
      "Let AI drive your business growth.\n\nDott Media builds AI sales agents that help you speed up sales, automate repetitive work, and drive growth while you stay focused on closing bigger opportunities.\n\nDM us to get started. Link in bio.\n\n#DottMedia #AISalesAgent #BusinessGrowth #SalesAutomation #AIForBusiness #GrowthSystems",
    facebookCaption:
      "Let AI drive your business growth.\n\nDott Media builds AI sales agents that help you speed up sales, automate repetitive work, and drive growth while you stay focused on bigger opportunities.\n\nLearn more: www.dott-media.org\nMessage us to get started.\n\n#DottMedia #AISalesAgent #BusinessGrowth #SalesAutomation #AIForBusiness #GrowthSystems",
  },
  {
    type: 'image',
    slug: 'increase-business-efficiency-speed',
    filename: 'increase-business-efficiency-speed.png',
    instagramCaption:
      "Increase business efficiency and speed with an AI sales agent.\n\nLet AI handle follow-up, qualification, and repetitive sales tasks so your team can move faster and close more.\n\nDM us for a walkthrough. Link in bio.\n\n#DottMedia #AISalesAgent #BusinessEfficiency #SalesGrowth #Automation #AIForBusiness",
    facebookCaption:
      "Increase business efficiency and speed with an AI sales agent.\n\nLet AI handle follow-up, qualification, and repetitive sales tasks so your team can move faster and close more.\n\nVisit: www.dott-media.org\nMessage us for a walkthrough.\n\n#DottMedia #AISalesAgent #BusinessEfficiency #SalesGrowth #Automation #AIForBusiness",
  },
  {
    type: 'image',
    slug: 'boost-sales-ai-sales-agent',
    filename: 'boost-sales-ai-sales-agent.png',
    instagramCaption:
      "Boost your sales with an AI sales agent.\n\nMore leads. More sales. More revenue.\n\nDott Media helps brands automate conversations, qualification, and follow-up so conversions can keep moving around the clock.\n\nDM us to set yours up.\n\n#DottMedia #AISalesAgent #LeadGeneration #SalesGrowth #RevenueGrowth #Automation",
    facebookCaption:
      "Boost your sales with an AI sales agent.\n\nMore leads. More sales. More revenue.\n\nDott Media helps brands automate conversations, qualification, and follow-up so conversions keep moving around the clock.\n\nVisit: www.dott-media.org\nMessage us to set yours up.\n\n#DottMedia #AISalesAgent #LeadGeneration #SalesGrowth #RevenueGrowth #Automation",
  },
  {
    type: 'image',
    slug: 'bot-efficiency-reduced-workload',
    filename: 'bot-efficiency-reduced-workload.png',
    instagramCaption:
      "Bot efficiency. Reduced workload.\n\nOur AI sales agents take care of time-consuming tasks so your team can focus on strategy, service, and closing deals.\n\nDM us to see how it fits your business.\n\n#DottMedia #AISalesAgent #Productivity #WorkflowAutomation #BusinessSystems #AIForBusiness",
    facebookCaption:
      "Bot efficiency. Reduced workload.\n\nOur AI sales agents take care of time-consuming tasks so your team can focus on strategy, service, and closing deals.\n\nVisit: www.dott-media.org\nMessage us to see how it fits your business.\n\n#DottMedia #AISalesAgent #Productivity #WorkflowAutomation #BusinessSystems #AIForBusiness",
  },
  {
    type: 'image',
    slug: 'ai-sales-agent-team',
    filename: 'ai-sales-agent-team.png',
    instagramCaption:
      "AI sales agent. Sell smarter. Close faster. 24/7.\n\nEngage, qualify, and close deals with a system that keeps working even when your team is offline.\n\nDM us for a demo. Link in bio.\n\n#DottMedia #AISalesAgent #CloseFaster #SalesSystems #AIForBusiness #DigitalGrowth",
    facebookCaption:
      "AI sales agent. Sell smarter. Close faster. 24/7.\n\nEngage, qualify, and close deals with a system that keeps working even when your team is offline.\n\nLearn more: www.dott-media.org\nMessage us for a demo.\n\n#DottMedia #AISalesAgent #CloseFaster #SalesSystems #AIForBusiness #DigitalGrowth",
  },
  {
    type: 'image',
    slug: 'ai-sales-agent-close-faster',
    filename: 'ai-sales-agent-close-faster.png',
    instagramCaption:
      "AI sales agent for brands that want to sell smarter and close faster.\n\nDott Media helps you engage leads instantly, qualify opportunities, and keep conversations active 24/7.\n\nDM us to build yours.\n\n#DottMedia #AISalesAgent #SalesAutomation #LeadQualification #AlwaysOnSales #BusinessGrowth",
    facebookCaption:
      "AI sales agent for brands that want to sell smarter and close faster.\n\nDott Media helps you engage leads instantly, qualify opportunities, and keep conversations active 24/7.\n\nVisit: www.dott-media.org\nMessage us to build yours.\n\n#DottMedia #AISalesAgent #SalesAutomation #LeadQualification #AlwaysOnSales #BusinessGrowth",
  },
  {
    type: 'image',
    slug: 'meet-your-new-ai-sales-agent',
    filename: 'meet-your-new-ai-sales-agent.png',
    instagramCaption:
      "Meet your new AI sales agent.\n\nNever miss a lead. Close more deals. Book meetings faster.\n\nDott Media builds sales systems that qualify prospects, answer objections, and keep your pipeline moving 24/7.\n\nDM us to get started.\n\n#DottMedia #AISalesAgent #CloseMoreDeals #LeadConversion #SalesSystems #Automation",
    facebookCaption:
      "Meet your new AI sales agent.\n\nNever miss a lead. Close more deals. Book meetings faster.\n\nDott Media builds sales systems that qualify prospects, answer objections, and keep your pipeline moving 24/7.\n\nVisit: www.dott-media.org\nMessage us to get started.\n\n#DottMedia #AISalesAgent #CloseMoreDeals #LeadConversion #SalesSystems #Automation",
  },
  {
    type: 'video',
    slug: 'dott-main-showcase-video',
    filename: 'dott-main-showcase-video.mp4',
    instagramCaption:
      "Dott Media in motion.\n\nAI-powered systems, smarter marketing, stronger branding, and business automation that keeps working for you.\n\nDM us for a walkthrough.\n\n#DottMedia #AIAutomation #BusinessGrowth #BrandSystems #DigitalMedia #MarketingAutomation",
    facebookCaption:
      "Dott Media in motion.\n\nAI-powered systems, smarter marketing, stronger branding, and business automation that keeps working for you.\n\nVisit: www.dott-media.org\nMessage us for a walkthrough.\n\n#DottMedia #AIAutomation #BusinessGrowth #BrandSystems #DigitalMedia #MarketingAutomation",
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

function hasSupabaseConfig() {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

function hourBucket() {
  return new Date().toISOString().slice(0, 13);
}

async function getMainAccounts() {
  const envFacebook = {
    pageId: (process.env.DOTT_MAIN_FACEBOOK_PAGE_ID || '').trim(),
    pageName: (process.env.DOTT_MAIN_FACEBOOK_PAGE_NAME || '').trim() || undefined,
    accessToken: (process.env.DOTT_MAIN_FACEBOOK_ACCESS_TOKEN || '').trim(),
  };
  const envInstagram = {
    accountId: (process.env.DOTT_MAIN_INSTAGRAM_ACCOUNT_ID || '').trim(),
    username: (process.env.DOTT_MAIN_INSTAGRAM_USERNAME || '').trim() || undefined,
    accessToken: (process.env.DOTT_MAIN_INSTAGRAM_ACCESS_TOKEN || '').trim(),
  };
  if (envFacebook.pageId && envFacebook.accessToken && envInstagram.accountId && envInstagram.accessToken) {
    return { facebook: envFacebook, instagram: envInstagram };
  }

  if (hasSupabaseConfig()) {
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
        '[dott-main-campaign] supabase credential config unavailable',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

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
  if (hasSupabaseConfig()) {
    try {
      const response = await axios.get(`${SUPABASE_URL}/rest/v1/dott_autopost_jobs`, {
        headers: supabaseHeaders(),
        params: {
          select: '*',
          user_id: `eq.${DOTT_MAIN_USER_ID}`,
          limit: 1,
        },
        timeout: 30000,
      });
      const row = Array.isArray(response.data) && response.data.length ? response.data[0] : null;
      if (row) {
        return {
          storage: 'supabase',
          ref: null,
          row,
          data: typeof row.data === 'object' && row.data ? row.data : {},
        };
      }
    } catch (error) {
      console.warn(
        '[dott-main-campaign] supabase state lookup failed',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  initFirebase();
  const ref = admin.firestore().collection('autopostJobs').doc(DOTT_MAIN_USER_ID);
  const snap = await ref.get();
  return { storage: 'firestore', ref, row: null, data: snap.data() || {} };
}

async function updateCampaignState(state, previousData, updates) {
  if (state.storage === 'supabase') {
    const merged = {
      ...(previousData && typeof previousData === 'object' ? previousData : {}),
      ...updates,
    };
    await axios.patch(
      `${SUPABASE_URL}/rest/v1/dott_autopost_jobs`,
      {
        active: merged.active !== false,
        next_run: merged.nextRun ?? null,
        reels_next_run: merged.reelsNextRun ?? null,
        story_next_run: merged.storyNextRun ?? null,
        trend_next_run: merged.trendNextRun ?? null,
        data: merged,
        updated_at: new Date().toISOString(),
      },
      {
        headers: {
          ...supabaseHeaders(),
          Prefer: 'return=minimal',
        },
        params: {
          user_id: `eq.${DOTT_MAIN_USER_ID}`,
        },
        timeout: 30000,
      },
    );
    return;
  }

  await state.ref.set(
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

function buildAssetUrl(item) {
  const segment = item.type === 'video' ? 'campaign-videos' : 'campaign-images';
  return `${ASSET_BASE_URL}/backend/public/${segment}/dottmain/${encodeURIComponent(item.filename)}`;
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

async function waitForInstagramMediaReady(creationId, accessToken) {
  for (let attempt = 0; attempt < READY_ATTEMPTS; attempt += 1) {
    const status = await axios.get(`https://graph.facebook.com/${GRAPH_VERSION}/${creationId}`, {
      params: {
        fields: 'status_code,status',
        access_token: accessToken,
      },
      timeout: 30000,
    });
    const code = status.data?.status_code;
    if (code === 'FINISHED') return true;
    if (code === 'ERROR') {
      throw new Error(`Instagram media container error: ${JSON.stringify(status.data?.status ?? {})}`);
    }
    await new Promise(resolve => setTimeout(resolve, READY_DELAY_MS));
  }
  return false;
}

async function publishInstagramContainer(baseUrl, creationId, accessToken) {
  let lastError;
  for (let attempt = 0; attempt < PUBLISH_RETRIES; attempt += 1) {
    try {
      const publish = await axios.post(
        `${baseUrl}/media_publish`,
        new URLSearchParams({
          creation_id: creationId,
          access_token: accessToken,
        }),
        { timeout: 60000 },
      );
      return publish.data?.id;
    } catch (error) {
      lastError = error;
      if (attempt < PUBLISH_RETRIES - 1) {
        await new Promise(resolve => setTimeout(resolve, PUBLISH_RETRY_DELAY_MS));
      }
    }
  }
  throw lastError;
}

async function publishToInstagramReel({ accountId, accessToken, videoUrl, caption }) {
  const baseUrl = `https://graph.facebook.com/${GRAPH_VERSION}/${accountId}`;
  const create = await axios.post(
    `${baseUrl}/media`,
    new URLSearchParams({
      media_type: 'REELS',
      video_url: videoUrl,
      caption,
      access_token: accessToken,
    }),
    { timeout: 60000 },
  );
  const creationId = create.data?.id;
  if (!creationId) throw new Error('Instagram reels container creation failed');
  const ready = await waitForInstagramMediaReady(creationId, accessToken);
  if (!ready) {
    throw new Error('Instagram reel container not ready for publishing');
  }
  const mediaId = await publishInstagramContainer(baseUrl, creationId, accessToken);
  if (!mediaId) throw new Error('Instagram reel publish failed');
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

async function publishToFacebookVideo({ pageId, accessToken, videoUrl, caption }) {
  const response = await axios.post(
    `https://graph.facebook.com/${GRAPH_VERSION}/${pageId}/videos`,
    new URLSearchParams({
      file_url: videoUrl,
      description: caption,
      access_token: accessToken,
    }),
    { timeout: 60000 },
  );
  const remoteId = response.data?.post_id || response.data?.id;
  if (!remoteId) throw new Error('Facebook video publish failed');
  return { id: remoteId };
}

async function chooseItem() {
  const state = await getCampaignState();
  const { data } = state;
  const enabled = data.dottCampaignEnabled !== false;
  if (!enabled) {
    throw new Error('Dott main campaign is disabled');
  }
  if (FORCED_SLUG) {
    const forcedItem = CAMPAIGN_ITEMS.find(entry => entry.slug === FORCED_SLUG);
    if (!forcedItem) {
      throw new Error(`Unknown forced campaign slug: ${FORCED_SLUG}`);
    }
    return {
      state,
      data,
      cursor: Number.isFinite(data.dottCampaignCursor) ? Number(data.dottCampaignCursor) : 0,
      item: forcedItem,
      forced: true,
    };
  }
  const cursor = Number.isFinite(data.dottCampaignCursor) ? Number(data.dottCampaignCursor) : 0;
  const item = CAMPAIGN_ITEMS[((cursor % CAMPAIGN_ITEMS.length) + CAMPAIGN_ITEMS.length) % CAMPAIGN_ITEMS.length];
  return { state, data, cursor, item, forced: false };
}

async function main() {
  const { facebook, instagram } = await getMainAccounts();
  const { state, data, cursor, item, forced } = await chooseItem();
  const contentKey = crypto.createHash('sha1').update(`${item.slug}|${hourBucket()}`).digest('hex');
  if (!BYPASS_DEDUPE && (await hasProcessedContent(contentKey))) {
    console.log(JSON.stringify({ ok: true, skipped: true, reason: 'already_posted_this_hour', contentKey, slug: item.slug }));
    return;
  }

  const hostedUrl = buildAssetUrl(item);

  const instagramResult =
    item.type === 'video'
      ? await publishToInstagramReel({
          accountId: instagram.accountId,
          accessToken: instagram.accessToken,
          videoUrl: hostedUrl,
          caption: item.instagramCaption,
        })
      : await publishToInstagram({
          accountId: instagram.accountId,
          accessToken: instagram.accessToken,
          imageUrl: hostedUrl,
          caption: item.instagramCaption,
        });
  const facebookResult =
    item.type === 'video'
      ? await publishToFacebookVideo({
          pageId: facebook.pageId,
          accessToken: facebook.accessToken,
          videoUrl: hostedUrl,
          caption: item.facebookCaption,
        })
      : await publishToFacebook({
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
        contentType: item.type === 'video' ? 'campaign_video' : 'campaign_image',
        ...(item.type === 'video' ? { videoUrl: hostedUrl } : { imageUrl: hostedUrl }),
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
        contentType: item.type === 'video' ? 'campaign_video' : 'campaign_image',
        ...(item.type === 'video' ? { videoUrl: hostedUrl } : { imageUrl: hostedUrl }),
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
        contentType: item.type === 'video' ? 'campaign_video' : 'campaign_image',
        ...(item.type === 'video' ? { videoUrl: hostedUrl } : { imageUrl: hostedUrl }),
        facebook: facebookResult,
      },
    },
  ]);
  await incrementSocialDaily(item.type === 'video' ? { instagram_reels: 1, facebook: 1 } : { instagram: 1, facebook: 1 });

  await updateCampaignState(state, data, {
    dottCampaignEnabled: true,
    dottCampaignCursor: forced ? cursor : (cursor + 1) % CAMPAIGN_ITEMS.length,
    dottCampaignItems: CAMPAIGN_ITEMS.map(entry => entry.filename),
    dottCampaignLastRunAt: postedAt,
    dottCampaignLastResult: [
      { platform: item.type === 'video' ? 'instagram_reels' : 'instagram', status: 'posted', remoteId: instagramResult.id },
      { platform: 'facebook', status: 'posted', remoteId: facebookResult.id },
    ],
  });

  console.log(
    JSON.stringify({
      ok: true,
      contentKey,
      slug: item.slug,
      mediaType: item.type,
      ...(item.type === 'video' ? { videoUrl: hostedUrl } : { imageUrl: hostedUrl }),
      instagram: instagramResult,
      facebook: facebookResult,
    }),
  );
}

main().catch(error => {
  console.error('[dott-main-campaign] failed', error);
  process.exit(1);
});
