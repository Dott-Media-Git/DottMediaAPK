import crypto from 'crypto';

import axios from 'axios';
import admin from 'firebase-admin';

const DOTT_MAIN_USER_ID = process.env.DOTT_MAIN_USER_ID || 'cMPZQccGggbhZe9dbvtxFmBehP02';
const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v19.0';
const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const WORKER_TAG = 'dott_main_story_worker';
const FORCED_SLUG = (process.env.DOTT_STORY_FORCE_SLUG || '').trim();
const BYPASS_DEDUPE = /^(1|true|yes)$/i.test((process.env.DOTT_STORY_BYPASS_DEDUPE || '').trim());
const WORKER_CONFIG_BUCKET = 'worker-config';
const WORKER_CONFIG_OBJECT = 'dott-main-meta-accounts.json';
const LOCAL_STATE_MODE = /^(1|true|yes)$/i.test((process.env.DOTT_STORY_LOCAL_STATE || '').trim());
const ASSET_BASE_URL = (
  process.env.DOTT_STORY_ASSET_BASE_URL ||
  'https://mhvonxlnytyvsisdhxyf.supabase.co/storage/v1/object/public/dott-campaign'
).replace(/\/$/, '');
const READY_ATTEMPTS = Math.max(Number(process.env.INSTAGRAM_MEDIA_READY_ATTEMPTS ?? 20), 5);
const READY_DELAY_MS = Math.max(Number(process.env.INSTAGRAM_MEDIA_READY_DELAY_MS ?? 3000), 1000);
const PUBLISH_RETRIES = Math.max(Number(process.env.INSTAGRAM_PUBLISH_RETRIES ?? 3), 1);
const PUBLISH_RETRY_DELAY_MS = Math.max(Number(process.env.INSTAGRAM_PUBLISH_RETRY_DELAY_MS ?? 4000), 1000);

const STORY_SET_EMOTION = [
  { slug: 'ai-business-growth-family', filename: 'ai-business-growth-family.png' },
  { slug: 'family-time-ai-assistance', filename: 'family-time-ai-assistance.png' },
  { slug: 'father-son-sunset-jog', filename: 'father-son-sunset-jog.png' },
  { slug: 'riding-sunset-with-mom', filename: 'riding-sunset-with-mom.png' },
  { slug: 'riding-sunset-with-mom-2', filename: 'riding-sunset-with-mom-2.png' },
  { slug: 'spend-more-time-with-family', filename: 'spend-more-time-with-family.png' },
];

const STORY_SET_AI = [
  { slug: 'services-ai-workflows', filename: 'services-ai-workflows.jpeg' },
  { slug: 'best-ai-automation-services', filename: 'best-ai-automation-services.jpeg' },
  { slug: 'best-ai-tech-services', filename: 'best-ai-tech-services.jpeg' },
  { slug: 'social-ai-connectivity', filename: 'social-ai-connectivity.jpeg' },
  { slug: 'ai-drive-business-growth', filename: 'ai-drive-business-growth.png' },
  { slug: 'increase-business-efficiency-speed', filename: 'increase-business-efficiency-speed.png' },
  { slug: 'boost-sales-ai-sales-agent', filename: 'boost-sales-ai-sales-agent.png' },
  { slug: 'bot-efficiency-reduced-workload', filename: 'bot-efficiency-reduced-workload.png' },
  { slug: 'ai-sales-agent-team', filename: 'ai-sales-agent-team.png' },
  { slug: 'ai-sales-agent-close-faster', filename: 'ai-sales-agent-close-faster.png' },
  { slug: 'meet-your-new-ai-sales-agent', filename: 'meet-your-new-ai-sales-agent.png' },
  { slug: 'ai-automates-sales-tasks', filename: 'ai-automates-sales-tasks.png' },
  { slug: 'ai-automates-sales-tasks-2', filename: 'ai-automates-sales-tasks-2.png' },
  { slug: 'ai-handles-heavy-lifting', filename: 'ai-handles-heavy-lifting.png' },
  { slug: 'ai-sales-team-transformation', filename: 'ai-sales-team-transformation.png' },
  { slug: 'empowering-sales-ai-innovation', filename: 'empowering-sales-ai-innovation.png' },
  { slug: 'revolutionize-sales-ai-power', filename: 'revolutionize-sales-ai-power.png' },
  { slug: 'revolutionize-your-sales-ai', filename: 'revolutionize-your-sales-ai.png' },
  { slug: 'revolutionize-your-sales-ai-2', filename: 'revolutionize-your-sales-ai-2.png' },
];

const STORY_SETS = [STORY_SET_EMOTION, STORY_SET_AI];
const STORY_ITEMS = STORY_SETS.flat();

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

function storyBucketKey() {
  const now = new Date();
  const bucketHour = Math.floor(now.getUTCHours() / 4) * 4;
  return `${now.toISOString().slice(0, 10)}T${String(bucketHour).padStart(2, '0')}`;
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
        '[dott-main-story] supabase credential config unavailable',
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
  if (LOCAL_STATE_MODE) {
    return { storage: 'memory', ref: null, row: null, data: {} };
  }

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
        '[dott-main-story] supabase state lookup failed',
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
  if (state.storage === 'memory') {
    return;
  }

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
  return `${ASSET_BASE_URL}/backend/public/campaign-images/dottmain/${encodeURIComponent(item.filename)}`;
}

function describeError(error) {
  return error?.response?.data?.error?.message || error?.message || String(error);
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

async function publishToInstagramStory({ accountId, accessToken, imageUrl }) {
  const baseUrl = `https://graph.facebook.com/${GRAPH_VERSION}/${accountId}`;
  const create = await axios.post(
    `${baseUrl}/media`,
    {
      media_type: 'STORIES',
      image_url: imageUrl,
      access_token: accessToken,
    },
    { timeout: 60000 },
  );
  const creationId = create.data?.id;
  if (!creationId) throw new Error('Instagram story container creation failed');
  const ready = await waitForInstagramMediaReady(creationId, accessToken);
  if (!ready) {
    throw new Error('Instagram story container not ready for publishing');
  }
  const mediaId = await publishInstagramContainer(baseUrl, creationId, accessToken);
  if (!mediaId) throw new Error('Instagram story publish failed');
  return { id: mediaId };
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
  if (!remoteId) throw new Error('Facebook story publish failed');
  return { id: remoteId };
}

function chooseStoryItem(cursor) {
  const normalizedCursor = Number.isFinite(cursor) ? cursor : 0;
  const setIndex = ((normalizedCursor % STORY_SETS.length) + STORY_SETS.length) % STORY_SETS.length;
  const set = STORY_SETS[setIndex];
  const itemIndex = Math.floor(Math.abs(normalizedCursor) / STORY_SETS.length) % set.length;
  return set[itemIndex];
}

async function chooseItem() {
  const state = await getCampaignState();
  const { data } = state;
  const enabled = data.dottStoryCampaignEnabled !== false;
  if (!enabled) {
    throw new Error('Dott main story campaign is disabled');
  }
  if (FORCED_SLUG) {
    const forcedItem = STORY_ITEMS.find(entry => entry.slug === FORCED_SLUG);
    if (!forcedItem) {
      throw new Error(`Unknown forced story slug: ${FORCED_SLUG}`);
    }
    return {
      state,
      data,
      cursor: Number.isFinite(data.dottStoryCampaignCursor) ? Number(data.dottStoryCampaignCursor) : 0,
      item: forcedItem,
      forced: true,
    };
  }
  const cursor = Number.isFinite(data.dottStoryCampaignCursor) ? Number(data.dottStoryCampaignCursor) : 0;
  return { state, data, cursor, item: chooseStoryItem(cursor), forced: false };
}

function getPendingRun(data, contentKey) {
  const pending = data?.dottStoryCampaignPendingRun;
  if (!pending || typeof pending !== 'object') return null;
  if (pending.contentKey !== contentKey) return null;
  return {
    contentKey,
    slug: typeof pending.slug === 'string' ? pending.slug : '',
    filename: typeof pending.filename === 'string' ? pending.filename : '',
    hostedUrl: typeof pending.hostedUrl === 'string' ? pending.hostedUrl : '',
    startedAt: typeof pending.startedAt === 'string' ? pending.startedAt : new Date().toISOString(),
    instagramResult: pending.instagramResult && typeof pending.instagramResult === 'object' ? pending.instagramResult : null,
  };
}

async function persistPendingRun(state, previousData, pendingRun) {
  await updateCampaignState(state, previousData, {
    dottStoryCampaignPendingRun: pendingRun,
    dottStoryCampaignPendingRunAt: pendingRun?.startedAt || null,
  });
}

async function main() {
  const { facebook, instagram } = await getMainAccounts();
  const { state, data, cursor, item, forced } = await chooseItem();
  let stateData = data;
  const bucketKey = storyBucketKey();
  const contentKey = crypto.createHash('sha1').update(`${item.slug}|${bucketKey}`).digest('hex');
  const existingPendingRun = getPendingRun(stateData, contentKey);

  if (!BYPASS_DEDUPE && (await hasProcessedContent(contentKey))) {
    await updateCampaignState(state, stateData, {
      dottStoryCampaignEnabled: true,
      dottStoryCampaignCursor: forced ? cursor : cursor + 1,
      dottStoryCampaignLastRunAt: new Date().toISOString(),
      dottStoryCampaignPendingRun: null,
      dottStoryCampaignPendingRunAt: null,
    });
    console.log(JSON.stringify({ ok: true, skipped: true, reason: 'already_posted_this_story_window', contentKey, slug: item.slug }));
    return;
  }

  const hostedUrl = buildAssetUrl(item);
  let pendingRun = existingPendingRun;
  if (!pendingRun) {
    pendingRun = {
      contentKey,
      slug: item.slug,
      filename: item.filename,
      hostedUrl,
      startedAt: new Date().toISOString(),
      instagramResult: null,
      facebookResult: null,
    };
    await persistPendingRun(state, stateData, pendingRun);
    stateData = {
      ...(stateData && typeof stateData === 'object' ? stateData : {}),
      dottStoryCampaignPendingRun: pendingRun,
      dottStoryCampaignPendingRunAt: pendingRun.startedAt,
    };
  }

  let instagramResult = pendingRun.instagramResult;
  if (!instagramResult) {
    instagramResult = await publishToInstagramStory({
      accountId: instagram.accountId,
      accessToken: instagram.accessToken,
      imageUrl: hostedUrl,
    });
    pendingRun = { ...pendingRun, instagramResult };
    await persistPendingRun(state, stateData, pendingRun);
    stateData = {
      ...(stateData && typeof stateData === 'object' ? stateData : {}),
      dottStoryCampaignPendingRun: pendingRun,
      dottStoryCampaignPendingRunAt: pendingRun.startedAt,
    };
  }

  let facebookResult = pendingRun.facebookResult;
  let facebookError = null;
  if (!facebookResult) {
    try {
      facebookResult = await publishToFacebookStory({
        pageId: facebook.pageId,
        accessToken: facebook.accessToken,
        imageUrl: hostedUrl,
      });
      pendingRun = { ...pendingRun, facebookResult };
      await persistPendingRun(state, stateData, pendingRun);
      stateData = {
        ...(stateData && typeof stateData === 'object' ? stateData : {}),
        dottStoryCampaignPendingRun: pendingRun,
        dottStoryCampaignPendingRunAt: pendingRun.startedAt,
      };
    } catch (error) {
      facebookError = describeError(error);
      console.warn('[dott-main-story] facebook story publish failed', facebookError);
    }
  }

  const postedAt = new Date().toISOString();
  const logEntries = [
    {
      user_id: DOTT_MAIN_USER_ID,
      platform: WORKER_TAG,
      scheduled_post_id: `external:${contentKey}`,
      status: 'posted',
      response_id: facebookResult?.id ? `${instagramResult.id}|${facebookResult.id}` : instagramResult.id,
      error: null,
      posted_at: postedAt,
      payload: {
        slug: item.slug,
        filename: item.filename,
        worker: WORKER_TAG,
        contentType: 'campaign_story',
        imageUrl: hostedUrl,
        instagram: instagramResult,
        ...(facebookResult ? { facebook: facebookResult } : {}),
        ...(facebookError ? { facebookError } : {}),
      },
    },
    {
      user_id: DOTT_MAIN_USER_ID,
      platform: 'instagram_story',
      scheduled_post_id: `external:${contentKey}`,
      status: 'posted',
      response_id: instagramResult.id,
      error: null,
      posted_at: postedAt,
      payload: {
        slug: item.slug,
        filename: item.filename,
        worker: WORKER_TAG,
        contentType: 'campaign_story',
        imageUrl: hostedUrl,
        instagram: instagramResult,
      },
    },
  ];
  if (facebookResult) {
    logEntries.push({
      user_id: DOTT_MAIN_USER_ID,
      platform: 'facebook_story',
      scheduled_post_id: `external:${contentKey}`,
      status: 'posted',
      response_id: facebookResult.id,
      error: null,
      posted_at: postedAt,
      payload: {
        slug: item.slug,
        filename: item.filename,
        worker: WORKER_TAG,
        contentType: 'campaign_story',
        imageUrl: hostedUrl,
        facebook: facebookResult,
      },
    });
  } else if (facebookError) {
    logEntries.push({
      user_id: DOTT_MAIN_USER_ID,
      platform: 'facebook_story',
      scheduled_post_id: `external:${contentKey}`,
      status: 'failed',
      response_id: null,
      error: facebookError,
      posted_at: postedAt,
      payload: {
        slug: item.slug,
        filename: item.filename,
        worker: WORKER_TAG,
        contentType: 'campaign_story',
        imageUrl: hostedUrl,
      },
    });
  }
  await addSocialLogs(logEntries);
  await incrementSocialDaily(facebookResult ? { instagram_story: 1, facebook_story: 1 } : { instagram_story: 1 });

  await updateCampaignState(state, stateData, {
    dottStoryCampaignEnabled: true,
    dottStoryCampaignCursor: forced ? cursor : cursor + 1,
    dottStoryCampaignItems: STORY_ITEMS.map(entry => entry.filename),
    dottStoryCampaignLastRunAt: postedAt,
    dottStoryCampaignPendingRun: null,
    dottStoryCampaignPendingRunAt: null,
    dottStoryCampaignLastResult: facebookResult
      ? [
          { platform: 'instagram_story', status: 'posted', remoteId: instagramResult.id },
          { platform: 'facebook_story', status: 'posted', remoteId: facebookResult.id },
        ]
      : [
          { platform: 'instagram_story', status: 'posted', remoteId: instagramResult.id },
          { platform: 'facebook_story', status: 'failed', error: facebookError || 'facebook_story_publish_failed' },
        ],
  });

  console.log(
    JSON.stringify({
      ok: true,
      contentKey,
      slug: item.slug,
      mediaType: 'story_image',
      imageUrl: hostedUrl,
      instagram: instagramResult,
      ...(facebookResult ? { facebook: facebookResult } : {}),
      ...(facebookError ? { facebookError } : {}),
    }),
  );
}

main().catch(error => {
  console.error('[dott-main-story] failed', error);
  process.exit(1);
});
