import fs from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';

import {
  BWIN_USER_ID,
  getBwinAccounts,
  publishToFacebookImage,
  publishToInstagramImage,
  queryScheduledRows,
  uploadImageBuffer,
  upsertScheduledRows,
} from './lib/bwinWorkerCommon.mjs';
import { buildPredictionBatch } from './lib/bwinPredictionEngine.mjs';
import { renderPredictionCardBuffer } from './lib/bwinPredictionRender.mjs';

dotenv.config();

const DRY_RUN = String(process.env.BWIN_PREDICTION_DRY_RUN || '').toLowerCase() === 'true';
const PICK_LIMIT = Math.max(Number(process.env.BWIN_PREDICTION_PICK_LIMIT ?? 5), 3);
const DAYS_AHEAD = Math.max(Number(process.env.BWIN_PREDICTION_DAYS_AHEAD ?? 2), 1);
const HORIZON_HOURS = Math.max(Number(process.env.BWIN_PREDICTION_HORIZON_HOURS ?? 36), 6);
const PREVIEW_PATH = (process.env.BWIN_PREDICTION_PREVIEW_PATH || '').trim();

function buildHashtagBlock() {
  return '#BwinbetUganda #BettingTips #FootballPredictions #MatchPicks #SoccerPicks #OddsWatch';
}

function buildCaption(batch) {
  const leagueLine = batch.leagues.length ? `Leagues: ${batch.leagues.join(' | ')}` : 'Leagues: Mixed board';
  return [
    'Today\'s Bwinbet prediction board is locked in.',
    'These picks are driven by fixture edge, standings strength and home advantage.',
    leagueLine,
    'More football updates: www.bwinbetug.info',
    'Place bets: https://bwinbetug.com',
    '',
    buildHashtagBlock(),
  ].join('\n');
}

async function loadExistingPredictedEventIds() {
  const ids = new Set();
  try {
    const since = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const rows = await queryScheduledRows({
      select: 'id,payload',
      source: 'eq.prediction_card',
      platform: 'eq.instagram',
      status: 'eq.posted',
      posted_at: `gte.${since}`,
      order: 'posted_at.desc',
      limit: 100,
    });
    rows.forEach(row => {
      const picks = Array.isArray(row?.payload?.batch?.picks)
        ? row.payload.batch.picks
        : Array.isArray(row?.payload?.picks)
          ? row.payload.picks
          : [];
      picks.forEach(pick => {
        if (pick?.eventId) ids.add(String(pick.eventId));
      });
    });
  } catch (error) {
    console.warn('[bwin-prediction] unable to load recent prediction history; proceeding without exclusion', error?.message || error);
  }
  return ids;
}

async function maybeWritePreview(buffer) {
  if (!PREVIEW_PATH) return;
  const target = path.resolve(PREVIEW_PATH);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, buffer);
  console.info('[bwin-prediction] preview saved', target);
}

function createRow({ id, platform, status, batch, caption, hashtags, imageUrl, remoteId, errorMessage, payload }) {
  const now = new Date().toISOString();
  return {
    id,
    user_id: BWIN_USER_ID,
    platform,
    status,
    target_date: batch.marketDate,
    caption,
    hashtags,
    image_urls: imageUrl ? [imageUrl] : [],
    scheduled_for: now,
    created_at: now,
    updated_at: now,
    posted_at: status === 'posted' ? now : null,
    remote_id: remoteId || null,
    error_message: errorMessage || null,
    source: 'prediction_card',
    payload,
  };
}

async function main() {
  const excludedEventIds = await loadExistingPredictedEventIds();
  const batch = await buildPredictionBatch({
    excludedEventIds,
    pickLimit: PICK_LIMIT,
    daysAhead: DAYS_AHEAD,
    horizonHours: HORIZON_HOURS,
  });

  if (!batch) {
    console.info('[bwin-prediction] No fresh fixtures found for a new prediction board.');
    return;
  }

  const imageBuffer = await renderPredictionCardBuffer(batch);
  await maybeWritePreview(imageBuffer);

  console.info('[bwin-prediction] batch ready', {
    batchKey: batch.batchKey,
    picks: batch.picks.map(pick => ({
      fixture: pick.fixture,
      market: pick.marketLabel,
      odds: pick.estimatedOdds,
    })),
  });

  if (DRY_RUN) return;

  const publicUrl = await uploadImageBuffer(imageBuffer);
  const caption = buildCaption(batch);
  const hashtags = buildHashtagBlock();
  const accounts = await getBwinAccounts();
  const payload = {
    batch,
    imageUrl: publicUrl,
    caption,
    hashtags,
  };

  const rows = [];
  let successCount = 0;

  if (accounts.instagram?.accountId && accounts.instagram?.accessToken) {
    try {
      const result = await publishToInstagramImage({
        accountId: accounts.instagram.accountId,
        accessToken: accounts.instagram.accessToken,
        imageUrl: publicUrl,
        caption,
      });
      rows.push(
        createRow({
          id: `prediction:${batch.batchKey}:instagram`,
          platform: 'instagram',
          status: 'posted',
          batch,
          caption,
          hashtags,
          imageUrl: publicUrl,
          remoteId: result.remoteId,
          payload,
        }),
      );
      successCount += 1;
    } catch (error) {
      rows.push(
        createRow({
          id: `prediction:${batch.batchKey}:instagram`,
          platform: 'instagram',
          status: 'failed',
          batch,
          caption,
          hashtags,
          imageUrl: publicUrl,
          errorMessage: error?.response?.data?.error?.message || error?.message || String(error),
          payload,
        }),
      );
      console.error('[bwin-prediction] instagram publish failed', error?.response?.data || error?.message || error);
    }
  }

  if (accounts.facebook?.pageId && accounts.facebook?.accessToken) {
    try {
      const result = await publishToFacebookImage({
        pageId: accounts.facebook.pageId,
        accessToken: accounts.facebook.accessToken,
        imageUrl: publicUrl,
        caption,
      });
      rows.push(
        createRow({
          id: `prediction:${batch.batchKey}:facebook`,
          platform: 'facebook',
          status: 'posted',
          batch,
          caption,
          hashtags,
          imageUrl: publicUrl,
          remoteId: result.remoteId,
          payload,
        }),
      );
      successCount += 1;
    } catch (error) {
      rows.push(
        createRow({
          id: `prediction:${batch.batchKey}:facebook`,
          platform: 'facebook',
          status: 'failed',
          batch,
          caption,
          hashtags,
          imageUrl: publicUrl,
          errorMessage: error?.response?.data?.error?.message || error?.message || String(error),
          payload,
        }),
      );
      console.error('[bwin-prediction] facebook publish failed', error?.response?.data || error?.message || error);
    }
  }

  await upsertScheduledRows(rows);

  if (!successCount) {
    throw new Error('Prediction board publish failed on all platforms.');
  }

  console.info('[bwin-prediction] published', {
    batchKey: batch.batchKey,
    imageUrl: publicUrl,
    successCount,
  });
}

main().catch(error => {
  console.error('[bwin-prediction] Failed:', error?.message || String(error));
  process.exitCode = 1;
});
