import crypto from 'crypto';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const USER_AGENT = 'DottMedia-MatchdayScheduler/1.0';
const BWIN_USER_ID = process.env.BWIN_USER_ID || '1zvY9nNyXMcfxdPQEyx0bIdK7r53';

const GENERATOR = path.resolve(process.cwd(), 'backend/scripts/generate_matchday_table_from_espn.py');
const REPO_ROOT = process.cwd();
const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer';

const LEAGUES = [
  { id: 'eng.1', label: 'Premier League', theme: 'epl', bg: process.env.BWIN_EPL_BACKGROUND_IMAGE },
  { id: 'esp.1', label: 'La Liga', theme: 'laliga', bg: process.env.BWIN_LALIGA_BACKGROUND_IMAGE },
  { id: 'ita.1', label: 'Serie A', theme: 'seriea', bg: process.env.BWIN_SERIEA_BACKGROUND_IMAGE },
  { id: 'ger.1', label: 'Bundesliga', theme: 'bundesliga', bg: process.env.BWIN_BUNDESLIGA_BACKGROUND_IMAGE },
  { id: 'fra.1', label: 'Ligue 1', theme: 'ligue1', bg: process.env.BWIN_LIGUE1_BACKGROUND_IMAGE },
  { id: 'uefa.champions', label: 'UEFA Champions League', theme: 'ucl', bg: process.env.BWIN_UCL_BACKGROUND_IMAGE },
  { id: 'fifa.world', label: 'FIFA World Cup', theme: undefined, bg: undefined },
];

const requestedLeagues = (process.env.MATCHDAY_LEAGUES || '')
  .split(',')
  .map(entry => entry.trim())
  .filter(Boolean);

const activeLeagues =
  requestedLeagues.length > 0 ? LEAGUES.filter(league => requestedLeagues.includes(league.id)) : LEAGUES;

const maxLeaguesPerRun = Math.max(Number(process.env.MATCHDAY_MAX_LEAGUES ?? 0), 0);
const startDelayMinutes = Math.max(Number(process.env.MATCHDAY_START_DELAY_MINUTES ?? 5), 0);
const requestedPlatforms = (process.env.MATCHDAY_PLATFORMS || 'instagram,facebook')
  .split(',')
  .map(entry => entry.trim().toLowerCase())
  .filter(Boolean);
const platforms = Array.from(new Set(requestedPlatforms.length ? requestedPlatforms : ['instagram', 'facebook']));

function requireEnv(name, value) {
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function supabaseHeaders() {
  return {
    apikey: requireEnv('SUPABASE_SERVICE_ROLE_KEY', SUPABASE_SERVICE_ROLE_KEY),
    Authorization: `Bearer ${requireEnv('SUPABASE_SERVICE_ROLE_KEY', SUPABASE_SERVICE_ROLE_KEY)}`,
    'Content-Type': 'application/json',
  };
}

async function uploadToSupabaseStorage(buffer) {
  requireEnv('SUPABASE_URL', SUPABASE_URL);
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

async function renderMatchdayImage({ leagueId, date, title, theme, backgroundImage }) {
  const tempFile = path.join(os.tmpdir(), `bwin-matchday-${leagueId}-${date}-${crypto.randomUUID()}.jpg`);
  await new Promise((resolve, reject) => {
    const args = [
      GENERATOR,
      '--league',
      leagueId,
      '--date',
      date,
      '--title',
      title,
      '--limit',
      '8',
      '--out',
      tempFile,
    ];
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

async function hasPostedMatchday(leagueId, date) {
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

function buildCaption(leagueLabel) {
  return `${leagueLabel} matchday results are in.\n\nMore football updates: www.bwinbetug.info\nPlace bets: https://bwinbetug.com`;
}

async function hasCompletedMatches(leagueId, date) {
  try {
    const resp = await axios.get(`${ESPN_BASE}/${leagueId}/scoreboard`, {
      params: { dates: date },
      timeout: 10000,
      headers: { 'User-Agent': USER_AGENT },
    });
    const events = resp.data?.events ?? [];
    return events.some(event => {
      const comp = (event?.competitions ?? [])[0];
      return comp?.status?.type?.completed;
    });
  } catch {
    return false;
  }
}

async function findLatestCompletedDate(leagueId, maxDays = 14) {
  const today = new Date();
  for (let offset = 0; offset <= maxDays; offset += 1) {
    const date = new Date(today.getTime() - offset * 86400000);
    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
    if (await hasCompletedMatches(leagueId, dateStr)) return dateStr;
  }
  return null;
}

async function scheduleMatchdayTables({ date, spacingHours }) {
  const posts = [];
  let cursor = new Date(Date.now() + startDelayMinutes * 60 * 1000);
  let processed = 0;
  const force = process.env.MATCHDAY_FORCE === 'true';
  for (const league of activeLeagues) {
    if (maxLeaguesPerRun && processed >= maxLeaguesPerRun) break;
    const matchDate = date || (await findLatestCompletedDate(league.id));
    if (!matchDate) continue;
    if (!force && (await hasPostedMatchday(league.id, matchDate))) continue;
    try {
      const imageUrl = await renderMatchdayImage({
        leagueId: league.id,
        date: matchDate,
        title: `${league.label} Results`,
        theme: league.theme,
        backgroundImage: league.bg,
      });
      for (const platform of platforms) {
        posts.push({
          id: `matchday:${league.id}:${matchDate}:${platform}`,
          user_id: BWIN_USER_ID,
          platform,
          status: 'pending',
          target_date: matchDate,
          caption: buildCaption(league.label),
          hashtags: 'BwinbetUganda, MatchdayResults, Football, Soccer, BettingTips',
          image_urls: [imageUrl],
          scheduled_for: new Date(cursor).toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          source: 'matchday_table',
        });
      }
      cursor = new Date(cursor.getTime() + spacingHours * 60 * 60 * 1000);
      processed += 1;
    } catch (error) {
      console.warn('[matchday] render failed', league.id, error?.message ?? error);
    }
  }

  if (!posts.length) return { scheduled: 0 };

  await axios.post(`${SUPABASE_URL}/rest/v1/dott_scheduled_posts`, posts, {
    headers: {
      ...supabaseHeaders(),
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    params: { on_conflict: 'id' },
    timeout: 30000,
  });
  return { scheduled: posts.length };
}

const date = process.env.MATCHDAY_RESULTS_DATE || null;
const spacingHours = Math.max(Number(process.env.MATCHDAY_RESULTS_SPACING_HOURS ?? 4), 1);

const result = await scheduleMatchdayTables({ date, spacingHours });
console.log('[matchday] scheduled now', result);
