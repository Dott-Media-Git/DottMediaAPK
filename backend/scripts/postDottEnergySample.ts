import '../src/config.js';
import admin from 'firebase-admin';
import { firestore } from '../src/db/firestore.js';
import { publishToFacebook, publishToFacebookStory } from '../src/packages/services/socialPlatforms/facebookPublisher.js';
import { publishToInstagram, publishToInstagramStory } from '../src/packages/services/socialPlatforms/instagramPublisher.js';
import type { SocialAccounts } from '../src/packages/services/socialPostingService.js';
import { resolveFacebookPageId } from '../src/services/socialAccountResolver.js';
import {
  buildDottEnergyProductCaption,
  dottEnergyProductHistoryKey,
  pickDottEnergyProduct,
  renderDottEnergyProductImage,
} from '../src/services/dottEnergyProductService.js';
import { supabaseFallbackService } from '../src/services/supabaseFallbackService.js';

const DOTT_ENERGY_USER_ID = 'LVR7p3WzdFM51ds92Kacf6S40og2';
const DOTT_ENERGY_PAGE_ID = '1201086759745632';
const DOTT_ENERGY_IG_ID = '17841433799368009';
const today = new Date().toISOString().slice(0, 10);
const includeStories = process.argv.includes('--stories') || process.argv.includes('--include-stories');
const dryRun = process.argv.includes('--dry-run');

async function loadRecentProductKeys() {
  if (dryRun) return new Set<string>();
  if (dryRun) {
    console.log(JSON.stringify({ product: product.title, sourceKey, feedImageUrl, storyImageUrl, results }, null, 2));
    return;
  }

  try {
    const job = await supabaseFallbackService.getAutopostJob(DOTT_ENERGY_USER_ID);
    const values = [
      ...((job?.recentImageUrls as string[] | undefined) ?? []),
      ...((job?.recentCaptions as string[] | undefined) ?? []),
    ];
    return new Set(
      values
        .map(value => String(value).match(/dott-energy-product:[^\s,]+/i)?.[0]?.toLowerCase())
        .filter((value): value is string => Boolean(value)),
    );
  } catch (error) {
    console.warn('[dott-energy-sample] recent product lookup failed', error instanceof Error ? error.message : String(error));
    return new Set<string>();
  }
}

async function loadStoredCredentials(): Promise<SocialAccounts> {
  if (dryRun) {
    return {
      facebook: { accessToken: 'dry-run', pageId: DOTT_ENERGY_PAGE_ID },
      instagram: { accessToken: 'dry-run', accountId: DOTT_ENERGY_IG_ID, username: 'dottenergy100' },
    };
  }

  const token = (
    process.env.DOTT_ENERGY_META_USER_TOKEN ??
    process.env.DOTTENERGY_META_USER_TOKEN ??
    process.env.CLIENT_META_USER_TOKEN ??
    process.env.META_GRAPH_TOKEN ??
    ''
  ).trim();
  if (token) {
    const resolved = await resolveFacebookPageId(token, DOTT_ENERGY_PAGE_ID);
    const pageToken = resolved?.pageToken?.trim() || token;
    return {
      facebook: {
        accessToken: pageToken,
        pageId: resolved?.pageId?.trim() || DOTT_ENERGY_PAGE_ID,
        ...(resolved?.pageName ? { pageName: resolved.pageName } : {}),
      },
      instagram: {
        accessToken: pageToken,
        accountId: DOTT_ENERGY_IG_ID,
        username: 'dottenergy100',
      },
    };
  }

  try {
    const snap = await firestore.collection('users').doc(DOTT_ENERGY_USER_ID).get();
    const accounts = (snap.data()?.socialAccounts ?? {}) as SocialAccounts;
    if (accounts.facebook?.accessToken && accounts.facebook?.pageId && accounts.instagram?.accessToken && accounts.instagram?.accountId) {
      return accounts;
    }
  } catch (error) {
    console.warn('[dott-energy-sample] Firestore credentials lookup failed', error instanceof Error ? error.message : String(error));
  }

  try {
    const fallback = await supabaseFallbackService.getSocialAccounts(DOTT_ENERGY_USER_ID);
    const accounts = (fallback?.socialAccounts ?? {}) as SocialAccounts;
    if (accounts.facebook?.accessToken && accounts.facebook?.pageId && accounts.instagram?.accessToken && accounts.instagram?.accountId) {
      return accounts;
    }
  } catch (error) {
    console.warn('[dott-energy-sample] Supabase credentials lookup failed', error instanceof Error ? error.message : String(error));
  }

  throw new Error('Missing Dott Energy credentials. Set DOTT_ENERGY_META_USER_TOKEN or connect the account in Social Integrations.');
}

async function recordResult(input: {
  platform: string;
  caption: string;
  imageUrl: string;
  status: 'posted' | 'failed' | 'dry_run';
  remoteId?: string | null;
  errorMessage?: string | null;
  sourceKey: string;
}) {
  if (dryRun) return;
  const id = `dott-energy-sample-${input.platform}-${today}-${input.sourceKey.replace(/[^a-z0-9]+/gi, '-')}`;
  try {
    await firestore.collection('scheduledPosts').doc(id).set(
      {
        userId: DOTT_ENERGY_USER_ID,
        platform: input.platform,
        caption: input.caption,
        imageUrls: [input.imageUrl],
        targetDate: today,
        source: 'dott_energy_shopify_sample',
        status: input.status,
        remoteId: input.remoteId ?? null,
        errorMessage: input.errorMessage ?? null,
        scheduledFor: admin.firestore.Timestamp.now(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        ...(input.status === 'posted' ? { postedAt: admin.firestore.FieldValue.serverTimestamp() } : {}),
      },
      { merge: true },
    );
  } catch (error) {
    console.warn('[dott-energy-sample] result write failed', error instanceof Error ? error.message : String(error));
  }

  try {
    await supabaseFallbackService.addSocialLog({
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
        source: 'dott_energy_shopify_sample',
      },
    });
  } catch (error) {
    console.warn('[dott-energy-sample] fallback log failed', error instanceof Error ? error.message : String(error));
  }
}

async function publishOne(
  platform: 'facebook' | 'instagram' | 'facebook_story' | 'instagram_story',
  caption: string,
  imageUrl: string,
  credentials: SocialAccounts,
  sourceKey: string,
) {
  if (dryRun) {
    console.log(`[dry-run] ${platform}: ${imageUrl}`);
    await recordResult({ platform, caption, imageUrl, status: 'dry_run', sourceKey });
    return { platform, status: 'dry_run' as const };
  }

  const publisher =
    platform === 'facebook'
      ? publishToFacebook
      : platform === 'instagram'
        ? publishToInstagram
        : platform === 'facebook_story'
          ? publishToFacebookStory
          : publishToInstagramStory;
  try {
    const result = await publisher({ caption, imageUrls: [imageUrl], credentials });
    await recordResult({ platform, caption, imageUrl, status: 'posted', remoteId: result.remoteId ?? null, sourceKey });
    console.log(`posted ${platform}: ${result.remoteId ?? 'no-remote-id'}`);
    return { platform, status: 'posted' as const, remoteId: result.remoteId ?? null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordResult({ platform, caption, imageUrl, status: 'failed', errorMessage: message, sourceKey });
    console.error(`failed ${platform}: ${message}`);
    return { platform, status: 'failed' as const, error: message };
  }
}

async function main() {
  const credentials = await loadStoredCredentials();
  const product = await pickDottEnergyProduct({ recentKeys: await loadRecentProductKeys() });
  const caption = buildDottEnergyProductCaption(product);
  const sourceKey = dottEnergyProductHistoryKey(product);
  const feedImageUrl = await renderDottEnergyProductImage(product, product.images[0], 'feed');
  const storyImageUrl = includeStories ? await renderDottEnergyProductImage(product, product.images[0], 'story') : null;

  const results = [
    await publishOne('facebook', caption, feedImageUrl, credentials, sourceKey),
    await publishOne('instagram', caption, feedImageUrl, credentials, sourceKey),
  ];
  if (includeStories && storyImageUrl) {
    const storyCaption = `${product.title}\n\nShop Dott Energy: ${process.env.DOTT_ENERGY_SHOP_URL ?? 'https://dott-energy-2.myshopify.com'}`;
    results.push(await publishOne('facebook_story', storyCaption, storyImageUrl, credentials, sourceKey));
    results.push(await publishOne('instagram_story', storyCaption, storyImageUrl, credentials, sourceKey));
  }

  if (dryRun) {
    console.log(JSON.stringify({ product: product.title, sourceKey, feedImageUrl, storyImageUrl, results }, null, 2));
    return;
  }

  try {
    const job = await supabaseFallbackService.getAutopostJob(DOTT_ENERGY_USER_ID);
    if (job) {
      await supabaseFallbackService.upsertAutopostJob(DOTT_ENERGY_USER_ID, {
        ...job,
        recentImageUrls: [feedImageUrl, sourceKey, ...(((job.recentImageUrls as string[] | undefined) ?? []).filter(Boolean))].slice(0, 400),
        recentCaptions: [sourceKey, ...(((job.recentCaptions as string[] | undefined) ?? []).filter(Boolean))].slice(0, 400),
        lastResult: results,
        lastRunAt: new Date(),
        nextRun: new Date(Date.now() + 60 * 60 * 1000),
        storyNextRun: new Date(Date.now() + 60 * 60 * 1000),
        intervalHours: 1,
        storyIntervalHours: 1,
      } as Record<string, unknown>);
    }
  } catch (error) {
    console.warn('[dott-energy-sample] autopost fallback state update failed', error instanceof Error ? error.message : String(error));
  }

  console.log(JSON.stringify({ product: product.title, sourceKey, feedImageUrl, storyImageUrl, results }, null, 2));
}

main().catch(error => {
  console.error('post-dott-energy-sample failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
