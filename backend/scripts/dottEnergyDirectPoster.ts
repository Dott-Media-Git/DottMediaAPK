import '../src/config.js';
import axios from 'axios';
import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';
import { firestore } from '../src/db/firestore.js';
import type { SocialAccounts } from '../src/packages/services/socialPostingService.js';
import { publishToThreads } from '../src/packages/services/socialPlatforms/threadsPublisher.js';
import {
  buildDottEnergyFallbackCaption,
  buildDottEnergyProductCaption,
  dottEnergyFallbackPosterHistoryKey,
  dottEnergyProductHistoryKey,
  pickDottEnergyFallbackPoster,
  pickDottEnergyProduct,
  renderDottEnergyFallbackPoster,
} from '../src/services/dottEnergyProductService.js';
import { supabaseFallbackService } from '../src/services/supabaseFallbackService.js';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = process.env.NODE_TLS_REJECT_UNAUTHORIZED || '0';

const DOTT_ENERGY_USER_ID = 'LVR7p3WzdFM51ds92Kacf6S40og2';
const DOTT_ENERGY_PAGE_ID = '1201086759745632';
const DOTT_ENERGY_IG_ID = '17841433799368009';
const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v23.0';
const API_BASE = (process.env.DOTT_ENERGY_API_BASE || process.env.EXPO_PUBLIC_API_URL || 'https://dottmediaapk.onrender.com').replace(/\/$/, '');
const FIREBASE_WEB_API_KEY =
  process.env.EXPO_PUBLIC_FIREBASE_API_KEY || process.env.FIREBASE_WEB_API_KEY || 'AIzaSyASp5Mj66UqgJH1Yp8MnFbdcCOiwnzuEm8';
const modeArg = process.argv.find(arg => arg.startsWith('--mode='))?.split('=')[1] || 'product';
const mode = modeArg === 'poster' ? 'poster' : 'product';
const platformArg = process.argv.find(arg => arg.startsWith('--platform='))?.split('=')[1]?.toLowerCase();
type DottEnergyPlatform = 'facebook' | 'instagram' | 'threads';
const targetPlatforms: DottEnergyPlatform[] =
  platformArg === 'facebook' || platformArg === 'instagram' || platformArg === 'threads'
    ? [platformArg]
    : ['facebook', 'instagram', 'threads'];
const POSTER_DOMINANCE_CHECK_LIMIT = Number(process.env.DOTT_ENERGY_POSTER_DOMINANCE_CHECK_LIMIT ?? 6);
const POSTER_DOMINANCE_TOP_WINDOW = Number(process.env.DOTT_ENERGY_POSTER_DOMINANCE_TOP_WINDOW ?? 3);
const POSTER_DOMINANCE_MAX_TOP_POSTERS = Number(process.env.DOTT_ENERGY_POSTER_DOMINANCE_MAX_TOP_POSTERS ?? 0);

function isPosterCaption(caption: unknown) {
  const normalized = String(caption ?? '').toLowerCase();
  return (
    normalized.includes('dott energy clean power solutions') ||
    normalized.includes('explore wind turbines, generators and controllers') ||
    normalized.includes('dott-energy-poster:')
  );
}

function isProductCaption(caption: unknown) {
  const normalized = String(caption ?? '').toLowerCase();
  if (isPosterCaption(normalized)) return false;
  return (
    normalized.includes('dott energy is working in partnership with smaraad') &&
    (normalized.includes('power options:') ||
      normalized.includes('voltage options:') ||
      normalized.includes('voltage:') ||
      normalized.includes('starting from'))
  );
}

function addThreadsCredentials(accounts: SocialAccounts): SocialAccounts {
  if (accounts.threads?.accessToken && accounts.threads?.accountId) return accounts;
  const accessToken = (
    process.env.DOTT_ENERGY_THREADS_ACCESS_TOKEN ??
    process.env.DOTTENERGY_THREADS_ACCESS_TOKEN ??
    process.env.THREADS_ACCESS_TOKEN ??
    ''
  ).trim();
  const accountId = (
    process.env.DOTT_ENERGY_THREADS_PROFILE_ID ??
    process.env.DOTTENERGY_THREADS_PROFILE_ID ??
    process.env.THREADS_PROFILE_ID ??
    '27610824738535971'
  ).trim();
  if (!accessToken || !accountId) return accounts;
  return {
    ...accounts,
    threads: {
      accessToken,
      accountId,
      username: 'dottenergy100',
    },
  };
}

async function loadRecentKeys() {
  try {
    const job = await supabaseFallbackService.getAutopostJob(DOTT_ENERGY_USER_ID);
    const values = [
      ...((job?.recentImageUrls as string[] | undefined) ?? []),
      ...((job?.recentCaptions as string[] | undefined) ?? []),
    ];
    return new Set(
      values
        .map(value => String(value).match(/dott-energy-(?:product|poster):[^\s,]+/i)?.[0]?.toLowerCase())
        .filter((value): value is string => Boolean(value)),
    );
  } catch (error) {
    console.warn('[dott-energy-direct] recent lookup failed', error instanceof Error ? error.message : String(error));
    return new Set<string>();
  }
}

async function loadStoredCredentials(): Promise<SocialAccounts> {
  const token = (
    process.env.META_GRAPH_TOKEN ??
    process.env.DOTT_ENERGY_META_USER_TOKEN ??
    process.env.DOTTENERGY_META_USER_TOKEN ??
    process.env.CLIENT_META_USER_TOKEN ??
    ''
  ).trim();
  if (token) {
    const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${DOTT_ENERGY_PAGE_ID}`);
    url.searchParams.set('fields', 'name,access_token,instagram_business_account{id,username}');
    url.searchParams.set('access_token', token);
    const response = await fetch(url, { signal: AbortSignal.timeout(90000) });
    const page = await response.json();
    if (!response.ok) {
      throw new Error(page?.error?.message || `Dott Energy page token lookup failed: ${response.status}`);
    }
    const pageToken = String(page?.access_token || '').trim();
    if (!pageToken) throw new Error('Dott Energy page token lookup returned no page token');
    const instagramAccount = page?.instagram_business_account;
    return addThreadsCredentials({
      facebook: {
        accessToken: pageToken,
        pageId: DOTT_ENERGY_PAGE_ID,
        ...(page?.name ? { pageName: String(page.name) } : {}),
      },
      instagram: {
        accessToken: pageToken,
        accountId: String(instagramAccount?.id || DOTT_ENERGY_IG_ID),
        username: String(instagramAccount?.username || 'dottenergy100'),
      },
    });
  }

  try {
    const snap = await firestore.collection('users').doc(DOTT_ENERGY_USER_ID).get();
    const accounts = (snap.data()?.socialAccounts ?? {}) as SocialAccounts;
    if (accounts.facebook?.accessToken && accounts.facebook?.pageId && accounts.instagram?.accessToken && accounts.instagram?.accountId) {
      return addThreadsCredentials(accounts);
    }
  } catch (error) {
    console.warn('[dott-energy-direct] Firestore credentials lookup failed', error instanceof Error ? error.message : String(error));
  }

  const fallback = await supabaseFallbackService.getSocialAccounts(DOTT_ENERGY_USER_ID);
  const accounts = (fallback?.socialAccounts ?? {}) as SocialAccounts;
  if (accounts.facebook?.accessToken && accounts.facebook?.pageId && accounts.instagram?.accessToken && accounts.instagram?.accountId) {
    return addThreadsCredentials(accounts);
  }

  throw new Error('Missing Dott Energy social credentials');
}

async function recordResult(input: {
  platform: string;
  caption: string;
  imageUrl: string;
  sourceKey: string;
  status: 'posted' | 'failed';
  remoteId?: string | null;
  errorMessage?: string | null;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const id = `dott-energy-${mode}-${input.platform}-${today}-${input.sourceKey.replace(/[^a-z0-9]+/gi, '-')}`;
  try {
    await withTimeout(
      firestore.collection('scheduledPosts').doc(id).set(
        {
          userId: DOTT_ENERGY_USER_ID,
          platform: input.platform,
          caption: input.caption,
          imageUrls: [input.imageUrl],
          targetDate: today,
          source: `dott_energy_${mode}`,
          status: input.status,
          remoteId: input.remoteId ?? null,
          errorMessage: input.errorMessage ?? null,
          scheduledFor: admin.firestore.Timestamp.now(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          ...(input.status === 'posted' ? { postedAt: admin.firestore.FieldValue.serverTimestamp() } : {}),
        },
        { merge: true },
      ),
      15000,
      'Firestore result write',
    );
  } catch (error) {
    console.warn('[dott-energy-direct] result write failed', error instanceof Error ? error.message : String(error));
  }

  try {
    await withTimeout(
      supabaseFallbackService.addSocialLog({
        userId: DOTT_ENERGY_USER_ID,
        platform: input.platform,
        scheduledPostId: id,
        status: input.status,
        responseId: input.remoteId ?? null,
        error: input.errorMessage ?? null,
        postedAt: new Date(),
        extraPayload: {
          caption: input.caption,
          imageUrls: [input.imageUrl],
          source: `dott_energy_${mode}`,
          sourceKey: input.sourceKey,
        },
      }),
      15000,
      'fallback social log write',
    );
  } catch (error) {
    console.warn('[dott-energy-direct] fallback log failed', error instanceof Error ? error.message : String(error));
  }
}

async function publishOne(platform: DottEnergyPlatform, caption: string, imageUrl: string, credentials: SocialAccounts, sourceKey: string) {
  try {
    console.log(`[dott-energy-direct] publishing ${platform}`);
    const platformCaption = platform === 'threads' ? buildThreadsCaption(caption) : caption;
    const result =
      platform === 'facebook'
        ? await publishFacebookDirect(credentials, platformCaption, imageUrl)
        : platform === 'instagram'
          ? await publishInstagramDirect(credentials, platformCaption, imageUrl)
          : await publishToThreads({ caption: platformCaption, imageUrls: [imageUrl], credentials });
    await recordResult({ platform, caption: platformCaption, imageUrl, sourceKey, status: 'posted', remoteId: result.remoteId ?? null });
    console.log(`posted ${platform}: ${result.remoteId ?? 'no-remote-id'}`);
    return { platform, status: 'posted' as const, remoteId: result.remoteId ?? null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordResult({ platform, caption: platform === 'threads' ? buildThreadsCaption(caption) : caption, imageUrl, sourceKey, status: 'failed', errorMessage: message });
    console.error(`failed ${platform}: ${message}`);
    return { platform, status: 'failed' as const, error: message };
  }
}

function buildThreadsCaption(caption: string) {
  const lines = caption
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => !/^comment\s+/i.test(line));
  const hashtags = '#DottEnergy #Smaraad #CanadaEnergy #DubaiEnergy #CleanEnergy';
  const core = lines.slice(0, 5).join('\n\n');
  const text = `${core}\n\n${hashtags}`;
  if (text.length <= 500) return text;
  const maxCoreLength = Math.max(0, 500 - hashtags.length - 5);
  return `${core.slice(0, maxCoreLength).replace(/\s+\S*$/, '')}...\n\n${hashtags}`;
}

async function publishFacebookDirect(credentials: SocialAccounts, caption: string, imageUrl: string) {
  if (!credentials.facebook?.pageId || !credentials.facebook?.accessToken) throw new Error('Facebook credentials missing');
  const params = new URLSearchParams();
  params.set('url', imageUrl);
  params.set('message', caption);
  params.set('access_token', credentials.facebook.accessToken);
  const response = await axios.post(`https://graph.facebook.com/${GRAPH_VERSION}/${credentials.facebook.pageId}/photos`, params, {
    timeout: 90000,
    validateStatus: () => true,
  });
  const data = response.data;
  if (response.status < 200 || response.status >= 300) {
    throw new Error(data?.error?.message || `Facebook publish failed: ${response.status}`);
  }
  const remoteId = data?.post_id || data?.id;
  if (!remoteId) throw new Error('No Facebook post ID returned');
  return { remoteId };
}

async function waitForInstagramReady(creationId: string, accessToken: string) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${creationId}`);
    url.searchParams.set('fields', 'status_code,status');
    url.searchParams.set('access_token', accessToken);
    const response = await axios.get(url.toString(), { timeout: 20000, validateStatus: () => true });
    const data = response.data;
    if (data?.status_code === 'FINISHED') return;
    if (data?.status_code === 'ERROR') throw new Error(`Instagram media error: ${JSON.stringify(data)}`);
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  throw new Error('Instagram media was not ready in time');
}

async function publishInstagramDirect(credentials: SocialAccounts, caption: string, imageUrl: string) {
  if (!credentials.instagram?.accountId || !credentials.instagram?.accessToken) throw new Error('Instagram credentials missing');
  const accessToken = credentials.instagram.accessToken;
  const baseUrl = `https://graph.facebook.com/${GRAPH_VERSION}/${credentials.instagram.accountId}`;
  let params = new URLSearchParams();
  params.set('image_url', imageUrl);
  params.set('caption', caption);
  params.set('access_token', accessToken);
  const create = await axios.post(`${baseUrl}/media`, params, {
    timeout: 90000,
    validateStatus: () => true,
  });
  const createData = create.data;
  if (create.status < 200 || create.status >= 300) {
    throw new Error(createData?.error?.message || `Instagram media create failed: ${create.status}`);
  }
  const creationId = createData?.id;
  if (!creationId) throw new Error('No Instagram creation ID returned');
  await waitForInstagramReady(creationId, accessToken);
  params = new URLSearchParams();
  params.set('creation_id', creationId);
  params.set('access_token', accessToken);
  const publish = await axios.post(`${baseUrl}/media_publish`, params, {
    timeout: 90000,
    validateStatus: () => true,
  });
  const publishData = publish.data;
  if (publish.status < 200 || publish.status >= 300) {
    throw new Error(publishData?.error?.message || `Instagram publish failed: ${publish.status}`);
  }
  const remoteId = publishData?.id;
  if (!remoteId) throw new Error('No Instagram post ID returned');
  return { remoteId };
}

function mimeFor(fileName: string) {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  return 'image/jpeg';
}

async function getIdToken(uid: string) {
  const customToken = await admin.auth().createCustomToken(uid);
  return retryAsync(async () => {
    const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${FIREBASE_WEB_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    });
    if (!response.ok) throw new Error(`custom token sign-in failed: ${response.status} ${await response.text()}`);
    return (await response.json()).idToken as string;
  }, 4, 'Firebase ID token exchange');
}

async function retryAsync<T>(fn: () => Promise<T>, attempts: number, label: string) {
  let lastError: any;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      console.warn(`[dott-energy-direct] ${label} attempt ${attempt}/${attempts} failed`, error?.cause?.message || error?.message || String(error));
      if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, attempt * 5000));
    }
  }
  throw new Error(`${label} failed: ${lastError?.cause?.message || lastError?.message || String(lastError)}`);
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string) {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function localGeneratedPathFromUrl(imageUrl: string) {
  let parsed: URL;
  try {
    parsed = new URL(imageUrl);
  } catch {
    return null;
  }
  if (!['localhost', '127.0.0.1'].includes(parsed.hostname)) return null;
  const marker = '/public/';
  const index = parsed.pathname.indexOf(marker);
  if (index < 0) return null;
  const relativePath = decodeURIComponent(parsed.pathname.slice(index + marker.length)).replace(/[\\/]+/g, path.sep);
  const filePath = path.resolve(process.cwd(), 'public', relativePath);
  return fs.existsSync(filePath) ? filePath : null;
}

async function uploadLocalImageForRemoteUse(imageUrl: string) {
  const filePath = localGeneratedPathFromUrl(imageUrl);
  if (!filePath) return imageUrl;
  const idToken = await getIdToken(DOTT_ENERGY_USER_ID);
  const fileName = path.basename(filePath);
  const form = new FormData();
  form.append('files', new Blob([fs.readFileSync(filePath)], { type: mimeFor(fileName) }), fileName);
  const response = await retryAsync(
    async () => {
      const uploadResponse = await fetch(`${API_BASE}/api/media/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
        body: form,
      });
      if (!uploadResponse.ok) {
        throw new Error(`media upload failed: ${uploadResponse.status} ${await uploadResponse.text()}`);
      }
      return uploadResponse;
    },
    4,
    'media upload request',
  );
  const json = await response.json();
  const remoteUrl = json.files?.[0]?.url;
  if (!remoteUrl) throw new Error('media upload response missing URL');
  return remoteUrl as string;
}

async function updateRotation(sourceKey: string, imageUrl: string, results: unknown[]) {
  try {
    const job = await withTimeout(supabaseFallbackService.getAutopostJob(DOTT_ENERGY_USER_ID), 15000, 'rotation job lookup');
    if (!job) return;
    await withTimeout(
      supabaseFallbackService.upsertAutopostJob(DOTT_ENERGY_USER_ID, {
        ...job,
        recentImageUrls: [imageUrl, sourceKey, ...(((job.recentImageUrls as string[] | undefined) ?? []).filter(Boolean))].slice(0, 400),
        recentCaptions: [sourceKey, ...(((job.recentCaptions as string[] | undefined) ?? []).filter(Boolean))].slice(0, 400),
        lastResult: results,
        lastRunAt: new Date(),
        ...(mode === 'poster'
          ? { dottEnergyPosterNextRun: new Date(Date.now() + 12 * 60 * 60 * 1000) }
        : { nextRun: new Date(Date.now() + 60 * 60 * 1000), intervalHours: 1 }),
      } as Record<string, unknown>),
      15000,
      'rotation job update',
    );
  } catch (error) {
    console.warn('[dott-energy-direct] rotation update failed', error instanceof Error ? error.message : String(error));
  }
}

async function shouldSkipPosterBecauseProductsNeedTopFeed(credentials: SocialAccounts) {
  const instagram = credentials.instagram;
  if (!instagram?.accountId || !instagram?.accessToken) return false;
  try {
    const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${instagram.accountId}/media`);
    url.searchParams.set('fields', 'id,timestamp,caption');
    url.searchParams.set('limit', String(Math.max(POSTER_DOMINANCE_CHECK_LIMIT, POSTER_DOMINANCE_TOP_WINDOW)));
    url.searchParams.set('access_token', instagram.accessToken);
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    const payload = await response.json();
    if (!response.ok) {
      console.warn('[dott-energy-direct] poster dominance check failed', payload?.error?.message || response.status);
      return true;
    }
    const posts = Array.isArray(payload?.data) ? payload.data : [];
    const topPosts = posts.slice(0, POSTER_DOMINANCE_TOP_WINDOW);
    const topPosterCount = topPosts.filter((post: any) => isPosterCaption(post?.caption)).length;
    const topProductCount = topPosts.filter((post: any) => isProductCaption(post?.caption)).length;
    const recentPosterCount = posts.filter((post: any) => isPosterCaption(post?.caption)).length;
    console.log(
      `[dott-energy-direct] poster dominance check topPosters=${topPosterCount}/${topPosts.length} topProducts=${topProductCount}/${topPosts.length} recentPosters=${recentPosterCount}/${posts.length}`,
    );
    if (!topPosts.length) return true;
    const requiredTopProducts = Math.max(1, topPosts.length - POSTER_DOMINANCE_MAX_TOP_POSTERS);
    return topPosterCount > POSTER_DOMINANCE_MAX_TOP_POSTERS || topProductCount < requiredTopProducts;
  } catch (error) {
    console.warn('[dott-energy-direct] poster dominance check error', error instanceof Error ? error.message : String(error));
    return true;
  }
}

async function main() {
  console.log(`[dott-energy-direct] starting ${mode}`);
  const credentials = await loadStoredCredentials();
  console.log('[dott-energy-direct] credentials loaded');
  const recentKeys = await loadRecentKeys();
  let caption = '';
  let imageUrl = '';
  let sourceKey = '';
  let title = '';

  if (mode === 'poster') {
    if (await shouldSkipPosterBecauseProductsNeedTopFeed(credentials)) {
      console.log('[dott-energy-direct] poster skipped: products need to dominate the top Instagram feed');
      return;
    }
    const poster = pickDottEnergyFallbackPoster({ recentKeys });
    if (!poster) throw new Error('No Dott Energy fallback posters found');
    console.log(`[dott-energy-direct] selected poster ${poster.name}`);
    caption = buildDottEnergyFallbackCaption();
    imageUrl = await uploadLocalImageForRemoteUse(await renderDottEnergyFallbackPoster(poster, 'feed'));
    sourceKey = dottEnergyFallbackPosterHistoryKey(poster);
    title = poster.name;
  } else {
    const product = await pickDottEnergyProduct({ recentKeys });
    console.log(`[dott-energy-direct] selected product ${product.title}`);
    caption = buildDottEnergyProductCaption(product);
    imageUrl = product.images[0];
    sourceKey = dottEnergyProductHistoryKey(product);
    title = product.title;
  }
  console.log(`[dott-energy-direct] remote image ${imageUrl}`);

  const results = [];
  for (const platform of targetPlatforms) {
    results.push(await publishOne(platform, caption, imageUrl, credentials, sourceKey));
  }
  await updateRotation(sourceKey, imageUrl, results);
  console.log(JSON.stringify({ mode, title, sourceKey, imageUrl, results }, null, 2));
}

main().catch(error => {
  console.error('dott-energy-direct failed:', error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
}).then(() => {
  process.exit(0);
});
