import axios from 'axios';
import crypto from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { supabaseFallbackService } from './supabaseFallbackService';

const SUPABASE_URL = (process.env.SUPABASE_URL ?? '').trim().replace(/\/$/, '');
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
const USER_AGENT = 'DottMedia-MatchdayResults/1.0';

const BWIN_USER_ID = process.env.BWIN_USER_ID || '1zvY9nNyXMcfxdPQEyx0bIdK7r53';
const PY_RENDERER = path.resolve(process.cwd(), 'backend/scripts/generate_matchday_table_from_espn.py');
const REPO_ROOT = path.resolve(process.cwd());

const LEAGUES = [
  { id: 'eng.1', label: 'Premier League' },
  { id: 'esp.1', label: 'La Liga' },
  { id: 'ita.1', label: 'Serie A' },
  { id: 'ger.1', label: 'Bundesliga' },
  { id: 'fra.1', label: 'Ligue 1' },
  { id: 'uefa.champions', label: 'UEFA Champions League' },
  { id: 'fifa.world', label: 'FIFA World Cup' },
];

type MatchdaySchedule = {
  leagueId: string;
  leagueLabel: string;
  date: string;
  imageUrl: string;
};

const requestedPlatforms = (process.env.MATCHDAY_PLATFORMS || 'instagram,facebook')
  .split(',')
  .map(entry => entry.trim().toLowerCase())
  .filter(Boolean);

const activePlatforms = Array.from(new Set(requestedPlatforms.length ? requestedPlatforms : ['instagram', 'facebook']));

const supabaseHeaders = () => ({
  apikey: SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
});

async function uploadToSupabaseStorage(buffer: Buffer) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase credentials missing for matchday uploads.');
  }
  const bucket = 'bwin-news';
  const objectPath = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.jpg`;
  await axios.post(`${SUPABASE_URL}/storage/v1/object/${bucket}/${objectPath}`, buffer, {
    headers: {
      ...supabaseHeaders(),
      'Content-Type': 'image/jpeg',
      'x-upsert': 'true',
    },
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    timeout: 60000,
  });
  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${objectPath}`;
}

async function renderMatchdayImage({
  leagueId,
  date,
  title,
  theme,
  backgroundImage,
}: {
  leagueId: string;
  date: string;
  title: string;
  theme?: string;
  backgroundImage?: string;
}) {
  const tempFile = path.join(os.tmpdir(), `bwin-matchday-${leagueId}-${date}-${crypto.randomUUID()}.jpg`);
  await new Promise<void>((resolve, reject) => {
    const args = [PY_RENDERER, '--league', leagueId, '--date', date, '--title', title, '--limit', '8', '--out', tempFile];
    if (theme) args.push('--theme', theme);
    if (backgroundImage) args.push('--background-image', backgroundImage);
    const child = spawn('python', args, { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) return resolve();
      reject(new Error(`matchday renderer failed (${code}): ${stderr.trim()}`));
    });
  });
  const buffer = await fs.readFile(tempFile);
  return uploadToSupabaseStorage(buffer);
}

async function hasPostedMatchday(leagueId: string, date: string) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return false;
  const key = `matchday:${leagueId}:${date}`;
  const response = await axios.get(`${SUPABASE_URL}/rest/v1/dott_scheduled_posts`, {
    headers: supabaseHeaders(),
    params: {
      select: 'id,status',
      id: `ilike.${key}:%`,
      limit: 1,
    },
    timeout: 30000,
  });
  return Array.isArray(response.data) && response.data.length > 0;
}

function buildCaption(leagueLabel: string) {
  return `${leagueLabel} matchday results are in.\n\nMore football updates: www.bwinbetug.info\nPlace bets: https://bwinbetug.com`;
}

export async function scheduleMatchdayTables({
  date,
  startAt,
  spacingHours,
}: {
  date: string;
  startAt: Date;
  spacingHours: number;
}) {
  const schedules: MatchdaySchedule[] = [];
  for (const league of LEAGUES) {
    if (await hasPostedMatchday(league.id, date)) continue;
    try {
      const themeMap: Record<string, { theme?: string; background?: string }> = {
        'uefa.champions': {
          theme: 'ucl',
          background: process.env.BWIN_UCL_BACKGROUND_IMAGE ?? undefined,
        },
        'eng.1': {
          theme: 'epl',
          background: process.env.BWIN_EPL_BACKGROUND_IMAGE ?? undefined,
        },
        'esp.1': {
          theme: 'laliga',
          background: process.env.BWIN_LALIGA_BACKGROUND_IMAGE ?? undefined,
        },
        'ita.1': {
          theme: 'seriea',
          background: process.env.BWIN_SERIEA_BACKGROUND_IMAGE ?? undefined,
        },
        'ger.1': {
          theme: 'bundesliga',
          background: process.env.BWIN_BUNDESLIGA_BACKGROUND_IMAGE ?? undefined,
        },
        'fra.1': {
          theme: 'ligue1',
          background: process.env.BWIN_LIGUE1_BACKGROUND_IMAGE ?? undefined,
        },
      };
      const themeConfig = themeMap[league.id] ?? {};
      const imageUrl = await renderMatchdayImage({
        leagueId: league.id,
        date,
        title: `${league.label} Results`,
        theme: themeConfig.theme,
        backgroundImage: themeConfig.background,
      });
      schedules.push({ leagueId: league.id, leagueLabel: league.label, date, imageUrl });
    } catch (error) {
      console.warn('[matchday] render failed', league.id, error instanceof Error ? error.message : String(error));
    }
  }

  if (!schedules.length) return { scheduled: 0 };

  const posts = [];
  let cursor = new Date(startAt);
  for (const schedule of schedules) {
    for (const platform of activePlatforms) {
      posts.push({
        id: `matchday:${schedule.leagueId}:${schedule.date}:${platform}`,
        userId: BWIN_USER_ID,
        platform,
        status: 'pending',
        targetDate: schedule.date,
        caption: buildCaption(schedule.leagueLabel),
        hashtags: 'BwinbetUganda, MatchdayResults, Football, Soccer, BettingTips',
        imageUrls: [schedule.imageUrl],
        scheduledFor: new Date(cursor),
        createdAt: new Date(),
        updatedAt: new Date(),
        source: 'matchday_table',
      });
    }
    cursor = new Date(cursor.getTime() + spacingHours * 60 * 60 * 1000);
  }

  await supabaseFallbackService.upsertScheduledPosts(posts);
  return { scheduled: posts.length };
}
