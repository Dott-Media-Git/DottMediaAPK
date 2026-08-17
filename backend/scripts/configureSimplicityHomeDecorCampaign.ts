import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';

import axios from 'axios';
import admin from 'firebase-admin';
import dotenv from 'dotenv';

import { firestore } from '../src/db/firestore';
import { autoPostService } from '../src/services/autoPostService';
import { supabaseFallbackService } from '../src/services/supabaseFallbackService';

dotenv.config({ path: path.resolve(process.cwd(), '.env'), override: false });

const USER_ID = 'X0ObAFQft0UWZee9IbUyYaeaBfO2';
const DEFAULT_MEDIA_DIR = 'C:\\Users\\joseph marvin\\Downloads\\Simplicity Home Decor';
const WHATSAPP_DISPLAY = '+256 774 055 210';
const WHATSAPP_LINK = 'https://wa.me/256774055210';
const IMAGE_INTERVAL_HOURS = 2;
const VIDEO_INTERVAL_HOURS = 3;
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v']);

const mediaDir = readArg('media-dir') || process.env.SIMPLICITY_MEDIA_DIR?.trim() || DEFAULT_MEDIA_DIR;
const dryRun = process.argv.includes('--dry-run');
const skipUpload = process.argv.includes('--skip-upload');
const skipFirestore = process.argv.includes('--skip-firestore');
const postNow = process.argv.includes('--post-now');
const supabaseUrl = (process.env.SUPABASE_URL ?? '').trim().replace(/\/$/, '');
const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
const bucket = process.env.CLIENT_CAMPAIGN_BUCKET?.trim() || 'dott-campaign';

if (process.env.FIRESTORE_PREFER_REST === 'true') {
  firestore.settings({ preferRest: true });
}

function readArg(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1]?.trim() ?? '' : '';
}

async function walk(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(entry => {
      const fullPath = path.join(directory, entry.name);
      return entry.isDirectory() ? walk(fullPath) : Promise.resolve([fullPath]);
    }),
  );
  return nested.flat();
}

function contentType(extension: string) {
  const normalized = extension.toLowerCase();
  if (normalized === '.png') return 'image/png';
  if (normalized === '.webp') return 'image/webp';
  if (normalized === '.mov') return 'video/quicktime';
  if (normalized === '.m4v') return 'video/x-m4v';
  if (normalized === '.mp4') return 'video/mp4';
  return 'image/jpeg';
}

async function uploadMedia(filePath: string, kind: 'images' | 'videos') {
  const buffer = await fs.readFile(filePath);
  const digest = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 24);
  const extension = path.extname(filePath).toLowerCase() || (kind === 'videos' ? '.mp4' : '.jpg');
  const objectPath = `client-autopost/simplicity-home-decor/${kind}/${digest}${extension}`;
  if (!dryRun && !skipUpload) {
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      try {
        await axios.post(`${supabaseUrl}/storage/v1/object/${bucket}/${objectPath}`, buffer, {
          headers: {
            Authorization: `Bearer ${serviceRoleKey}`,
            apikey: serviceRoleKey,
            'Content-Type': contentType(extension),
            'x-upsert': 'true',
          },
          maxBodyLength: Infinity,
          timeout: 240_000,
        });
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        if (attempt < 5) await new Promise(resolve => setTimeout(resolve, attempt * 2_000));
      }
    }
    if (lastError) throw lastError;
  }
  return `${supabaseUrl}/storage/v1/object/public/${bucket}/${objectPath}`;
}

async function uploadPool(files: string[], kind: 'images' | 'videos') {
  const unique = new Map<string, string>();
  for (const filePath of files) {
    const digest = crypto.createHash('sha256').update(await fs.readFile(filePath)).digest('hex');
    if (!unique.has(digest)) unique.set(digest, filePath);
  }
  const pending = [...unique.values()];
  const urls: string[] = [];
  let completed = 0;
  const workers = Array.from({ length: Math.min(2, pending.length) }, async () => {
    while (pending.length) {
      const filePath = pending.shift();
      if (!filePath) return;
      urls.push(await uploadMedia(filePath, kind));
      completed += 1;
      console.log(`[simplicity-campaign] uploaded ${kind} ${completed}/${unique.size}: ${path.basename(filePath)}`);
    }
  });
  await Promise.all(workers);
  return urls;
}

async function run() {
  if (!supabaseUrl || !serviceRoleKey) throw new Error('Supabase storage configuration is missing');
  const files = await walk(mediaDir);
  const imageFiles = files.filter(file => IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase()));
  const videoFiles = files.filter(file => VIDEO_EXTENSIONS.has(path.extname(file).toLowerCase()));
  if (!imageFiles.length || !videoFiles.length) throw new Error('Both image and video media are required');

  const [sourceImageUrls, videoUrls] = await Promise.all([
    uploadPool(imageFiles, 'images'),
    uploadPool(videoFiles, 'videos'),
  ]);

  const now = Date.now();
  // Allow the production deployment to finish before the first source-media run.
  const nextImageRun = admin.firestore.Timestamp.fromDate(new Date(now + 30 * 60_000));
  const nextVideoRun = admin.firestore.Timestamp.fromDate(new Date(now + 60 * 60_000));
  const prompt =
    `Write concise, product-led sales captions for Simplicity Home Decor using the supplied media. Describe only what is visibly relevant: throws, cushions, bedsheets, patterns, colours, texture, comfort and room styling. Never invent a price, material, size, discount, stock level or delivery promise. End every caption with: Order or enquire on WhatsApp ${WHATSAPP_DISPLAY} — ${WHATSAPP_LINK}.`;
  const fallbackCaption =
    `Give your space a warm, polished finish with beautiful home textiles from Simplicity Home Decor. Ask about the colours, patterns and options shown. Order or enquire on WhatsApp ${WHATSAPP_DISPLAY} — ${WHATSAPP_LINK}`;
  const autoReplyPrompt =
    `Reply as Simplicity Home Decor. Be warm, concise and sales-focused. Help with throws, cushions, bedsheets, colours, availability and delivery without inventing prices or stock. Direct every interested customer to WhatsApp ${WHATSAPP_DISPLAY} (${WHATSAPP_LINK}). Never mention Dott Media or AI.`;
  const job = {
    userId: USER_ID,
    active: true,
    platforms: ['facebook', 'instagram', 'threads'],
    intervalHours: IMAGE_INTERVAL_HOURS,
    nextRun: nextImageRun,
    sourceImageUrls,
    sourceImageCursor: 0,
    videoUrls,
    videoCursor: 0,
    reelsVideoUrls: videoUrls,
    reelsVideoCursor: 0,
    reelsPlatforms: ['instagram_reels', 'facebook', 'threads'],
    reelsSourceMode: 'static',
    reelsIntervalHours: VIDEO_INTERVAL_HOURS,
    reelsNextRun: nextVideoRun,
    storyNextRun: null,
    storyTrendEnabled: false,
    prompt,
    businessType: 'Home decor, throws, cushions and bedding',
    fallbackCaption,
    fallbackHashtags: 'SimplicityHomeDecor, HomeDecorUganda, Throws, Cushions, Bedsheets, KampalaHomes, InteriorStyling',
    requireAiImages: false,
  };

  if (!dryRun) {
    try {
      if (skipFirestore) throw new Error('Firestore mirror skipped by operator');
      await firestore.collection('autopostJobs').doc(USER_ID).set(
        { ...job, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true },
      );
      await firestore.collection('assistant_settings').doc(USER_ID).set(
        {
          autoReplyEnabled: true,
          autoReplyPrompt,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    } catch (error) {
      console.warn('[simplicity-campaign] Firestore mirror unavailable; Supabase remains the live primary schedule', error instanceof Error ? error.message : String(error));
    }
    await supabaseFallbackService.upsertAutopostJob(USER_ID, {
      ...job,
      nextRun: nextImageRun.toDate(),
      reelsNextRun: nextVideoRun.toDate(),
      updatedAt: new Date(),
    });

    if (postNow) {
      const imageJob = (await firestore.collection('autopostJobs').doc(USER_ID).get()).data() ?? job;
      const imageResult = await (autoPostService as any).executeJob(USER_ID, imageJob, {
        platforms: ['facebook', 'instagram', 'threads'],
        intervalHours: IMAGE_INTERVAL_HOURS,
        nextRunField: 'nextRun',
        lastRunField: 'lastRunAt',
        resultField: 'lastResult',
        useGenericVideoFallback: false,
      });
      const videoJob = (await firestore.collection('autopostJobs').doc(USER_ID).get()).data() ?? job;
      const videoResult = await (autoPostService as any).executeJob(USER_ID, videoJob, {
        platforms: ['instagram_reels', 'facebook'],
        intervalHours: VIDEO_INTERVAL_HOURS,
        nextRunField: 'reelsNextRun',
        lastRunField: 'reelsLastRunAt',
        resultField: 'reelsLastResult',
        useGenericVideoFallback: true,
      });
      console.log(JSON.stringify({ freshPosts: { image: imageResult, video: videoResult } }));
    }
  }

  console.log(JSON.stringify({
    configured: !dryRun,
    userId: USER_ID,
    images: sourceImageUrls.length,
    videos: videoUrls.length,
    imageIntervalHours: IMAGE_INTERVAL_HOURS,
    videoIntervalHours: VIDEO_INTERVAL_HOURS,
    nextImageRun: nextImageRun.toDate().toISOString(),
    nextVideoRun: nextVideoRun.toDate().toISOString(),
    whatsapp: WHATSAPP_DISPLAY,
  }));
}

run().catch(error => {
  console.error('[simplicity-campaign] failed', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
