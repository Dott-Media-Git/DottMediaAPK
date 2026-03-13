import { Client } from 'pg';

const SUPABASE_DATABASE_URL = (process.env.SUPABASE_DATABASE_URL ?? '').trim();

const SUPABASE_SCHEMA_SQL = `
create table if not exists public.dott_autopost_jobs (
  user_id text primary key,
  active boolean not null default true,
  next_run timestamptz null,
  reels_next_run timestamptz null,
  story_next_run timestamptz null,
  trend_next_run timestamptz null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists dott_autopost_jobs_next_run_idx on public.dott_autopost_jobs (next_run);
create index if not exists dott_autopost_jobs_reels_next_run_idx on public.dott_autopost_jobs (reels_next_run);
create index if not exists dott_autopost_jobs_story_next_run_idx on public.dott_autopost_jobs (story_next_run);
create index if not exists dott_autopost_jobs_trend_next_run_idx on public.dott_autopost_jobs (trend_next_run);

create table if not exists public.dott_scheduled_posts (
  id text primary key,
  user_id text not null,
  platform text not null,
  status text not null,
  target_date text null,
  caption text null,
  hashtags text null,
  image_urls jsonb not null default '[]'::jsonb,
  video_url text null,
  video_title text null,
  scheduled_for timestamptz null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  posted_at timestamptz null,
  remote_id text null,
  error_message text null,
  source text null,
  payload jsonb not null default '{}'::jsonb
);

create index if not exists dott_scheduled_posts_user_created_idx
  on public.dott_scheduled_posts (user_id, created_at desc);
create index if not exists dott_scheduled_posts_status_schedule_idx
  on public.dott_scheduled_posts (status, scheduled_for);
create index if not exists dott_scheduled_posts_user_target_status_idx
  on public.dott_scheduled_posts (user_id, target_date, status);

create table if not exists public.dott_social_limits (
  key text primary key,
  user_id text not null,
  date text not null,
  posted_count integer not null default 0,
  scheduled_count integer not null default 0,
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists dott_social_limits_user_date_idx
  on public.dott_social_limits (user_id, date);

create table if not exists public.dott_social_logs (
  id bigserial primary key,
  user_id text not null,
  platform text not null,
  scheduled_post_id text null,
  status text not null,
  response_id text null,
  error text null,
  posted_at timestamptz not null default timezone('utc', now()),
  payload jsonb not null default '{}'::jsonb
);

create index if not exists dott_social_logs_user_posted_idx
  on public.dott_social_logs (user_id, posted_at desc);

create table if not exists public.dott_social_daily (
  id text primary key,
  user_id text not null,
  date text not null,
  posts_attempted integer not null default 0,
  posts_posted integer not null default 0,
  posts_failed integer not null default 0,
  posts_skipped integer not null default 0,
  per_platform jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists dott_social_daily_user_date_idx
  on public.dott_social_daily (user_id, date desc);

create table if not exists public.dott_metric_summaries (
  id bigserial primary key,
  scope_key text not null,
  user_id text null,
  metric text not null,
  counters jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now()),
  unique (scope_key, metric)
);

create table if not exists public.dott_metric_daily (
  id bigserial primary key,
  scope_key text not null,
  user_id text null,
  metric text not null,
  date text not null,
  counters jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now()),
  unique (scope_key, metric, date)
);

create index if not exists dott_metric_daily_scope_metric_date_idx
  on public.dott_metric_daily (scope_key, metric, date desc);
`;

const sanitizeConnectionStringForLogs = (value: string) =>
  value.replace(/:\/\/([^:]+):[^@]+@/, '://$1:***@');

let initializationPromise: Promise<boolean> | null = null;
const schemaInitStatus: {
  configured: boolean;
  ok: boolean;
  attemptedAt: string | null;
  target: string | null;
  error: string | null;
} = {
  configured: Boolean(SUPABASE_DATABASE_URL),
  ok: false,
  attemptedAt: null,
  target: SUPABASE_DATABASE_URL ? sanitizeConnectionStringForLogs(SUPABASE_DATABASE_URL) : null,
  error: null,
};

const attemptSchemaInit = async (connectionString: string) => {
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });

  try {
    await client.connect();
    await client.query(SUPABASE_SCHEMA_SQL);
    console.info('[supabase-fallback] schema verified');
    return true;
  } finally {
    await client.end().catch(() => undefined);
  }
};

export const ensureSupabaseFallbackSchema = async () => {
  if (initializationPromise) return initializationPromise;

  initializationPromise = (async () => {
    schemaInitStatus.attemptedAt = new Date().toISOString();
    if (!SUPABASE_DATABASE_URL) {
      schemaInitStatus.error = 'SUPABASE_DATABASE_URL missing';
      console.info('[supabase-fallback] SUPABASE_DATABASE_URL missing; skipping schema init');
      return false;
    }

    try {
      const ok = await attemptSchemaInit(SUPABASE_DATABASE_URL);
      schemaInitStatus.ok = ok;
      schemaInitStatus.error = null;
      return ok;
    } catch (error) {
      schemaInitStatus.ok = false;
      schemaInitStatus.error = error instanceof Error ? error.message : String(error);
      console.warn(
        '[supabase-fallback] schema init failed',
        sanitizeConnectionStringForLogs(SUPABASE_DATABASE_URL),
        error instanceof Error ? error.message : error,
      );
      return false;
    }
  })();

  return initializationPromise;
};

export const getSupabaseSchemaInitStatus = () => ({ ...schemaInitStatus });
