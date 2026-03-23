import admin from 'firebase-admin';
import axios, { type AxiosRequestConfig, type Method } from 'axios';
import { resolveAnalyticsScopeKey, type AnalyticsScope } from './analyticsScope';

type QueryValue = string | number | boolean | null | undefined;

type ScheduledPostRecord = {
  id: string;
  userId: string;
  platform: string;
  status: string;
  targetDate?: string;
  caption?: string;
  hashtags?: string;
  imageUrls?: string[];
  videoUrl?: string;
  videoTitle?: string;
  scheduledFor?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  postedAt?: unknown;
  remoteId?: string | null;
  errorMessage?: string | null;
  source?: string | null;
};

type SocialLimitRecord = {
  key: string;
  userId: string;
  date: string;
  postedCount?: number;
  scheduledCount?: number;
};

type SocialDailyIncrement = {
  userId: string;
  date: string;
  platform: string;
  status: 'posted' | 'failed' | 'skipped_limit';
};

type SocialDailyRecord = {
  userId: string;
  date: string;
  postsAttempted?: number;
  postsPosted?: number;
  postsFailed?: number;
  postsSkipped?: number;
  perPlatform?: Record<string, number>;
};

type MetricCounterTree = Record<string, unknown>;

const SUPABASE_URL = (process.env.SUPABASE_URL ?? '').trim().replace(/\/$/, '');
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
const REST_BASE = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1` : '';
const NOW = () => new Date().toISOString();

const toScopeKey = (scope?: AnalyticsScope) => resolveAnalyticsScopeKey(scope || {}) || 'global';

const toTimestamp = (value: unknown) => {
  if (!value) return undefined;
  if (value instanceof Date) return admin.firestore.Timestamp.fromDate(value);
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return admin.firestore.Timestamp.fromDate(parsed);
    }
  }
  if (typeof value === 'object') {
    const candidate = value as { toDate?: () => Date; seconds?: number; _seconds?: number };
    if (typeof candidate.toDate === 'function') {
      return admin.firestore.Timestamp.fromDate(candidate.toDate());
    }
    if (typeof candidate.seconds === 'number') {
      return admin.firestore.Timestamp.fromMillis(candidate.seconds * 1000);
    }
    if (typeof candidate._seconds === 'number') {
      return admin.firestore.Timestamp.fromMillis(candidate._seconds * 1000);
    }
  }
  return undefined;
};

const toTimestampStub = (value: unknown) => {
  const timestamp = toTimestamp(value);
  return timestamp ? { seconds: timestamp.seconds, nanoseconds: timestamp.nanoseconds } : undefined;
};

const toIsoString = (value: unknown): string | null => {
  if (!value) return null;
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  if (typeof value === 'object') {
    const candidate = value as {
      toDate?: () => Date;
      seconds?: number;
      _seconds?: number;
    };
    if (typeof candidate.toDate === 'function') return candidate.toDate().toISOString();
    if (typeof candidate.seconds === 'number') return new Date(candidate.seconds * 1000).toISOString();
    if (typeof candidate._seconds === 'number') return new Date(candidate._seconds * 1000).toISOString();
  }
  return null;
};

const sanitizeJson = (value: unknown): unknown => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(entry => sanitizeJson(entry)).filter(entry => entry !== undefined);
  if (typeof value === 'object') {
    const timestamp = toIsoString(value);
    if (timestamp) return timestamp;
    const output: Record<string, unknown> = {};
    Object.entries(value as Record<string, unknown>).forEach(([key, entry]) => {
      const cleaned = sanitizeJson(entry);
      if (cleaned !== undefined) output[key] = cleaned;
    });
    return output;
  }
  return undefined;
};

const toNumber = (value: unknown) => {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
};

const mergeNumericTree = (base: unknown, patch: unknown): unknown => {
  if (patch === undefined) return base;
  if (patch === null) return base ?? null;
  if (typeof patch === 'number') return toNumber(base) + patch;
  if (typeof patch === 'string' || typeof patch === 'boolean') return patch;
  if (Array.isArray(patch)) return patch.map(entry => sanitizeJson(entry));
  if (typeof patch === 'object') {
    const existing = base && typeof base === 'object' && !Array.isArray(base) ? (base as Record<string, unknown>) : {};
    const output: Record<string, unknown> = { ...existing };
    Object.entries(patch as Record<string, unknown>).forEach(([key, value]) => {
      output[key] = mergeNumericTree(existing[key], value);
    });
    return output;
  }
  return patch;
};

const sortDescByDate = <T extends { date?: string }>(rows: T[]) =>
  [...rows].sort((a, b) => `${b.date ?? ''}`.localeCompare(`${a.date ?? ''}`));

class SupabaseFallbackService {
  private unavailableWarned = false;

  isConfigured() {
    return Boolean(REST_BASE && SUPABASE_SERVICE_ROLE_KEY);
  }

  private warnUnavailableOnce() {
    if (this.unavailableWarned || this.isConfigured()) return;
    this.unavailableWarned = true;
    console.warn('[supabase-fallback] SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY missing; fallback inactive');
  }

  private async request<T = any>(
    method: Method,
    table: string,
    options: {
      params?: Record<string, QueryValue>;
      body?: unknown;
      prefer?: string;
    } = {},
  ): Promise<T> {
    if (!this.isConfigured()) {
      this.warnUnavailableOnce();
      throw new Error('supabase_not_configured');
    }

    const search = new URLSearchParams();
    Object.entries(options.params ?? {}).forEach(([key, value]) => {
      if (value === undefined) return;
      if (value === null) {
        search.append(key, 'is.null');
        return;
      }
      search.append(key, String(value));
    });

    const config: AxiosRequestConfig = {
      url: `${REST_BASE}/${table}${search.size ? `?${search.toString()}` : ''}`,
      method,
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        ...(options.prefer ? { Prefer: options.prefer } : {}),
      },
      data: options.body,
      timeout: 30000,
    };

    const response = await axios.request<T>(config);
    return response.data;
  }

  private async getSingleRow<T = any>(table: string, params: Record<string, QueryValue>) {
    const rows = await this.request<T[]>('GET', table, {
      params: { select: '*', limit: 1, ...params },
    });
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  }

  private serializeScheduledPost(post: ScheduledPostRecord) {
    return {
      id: post.id,
      user_id: post.userId,
      platform: post.platform,
      status: post.status,
      target_date: post.targetDate ?? null,
      caption: post.caption ?? '',
      hashtags: post.hashtags ?? '',
      image_urls: sanitizeJson(post.imageUrls ?? []) ?? [],
      video_url: post.videoUrl ?? null,
      video_title: post.videoTitle ?? null,
      scheduled_for: toIsoString(post.scheduledFor),
      created_at: toIsoString(post.createdAt) ?? NOW(),
      updated_at: toIsoString(post.updatedAt) ?? NOW(),
      posted_at: toIsoString(post.postedAt),
      remote_id: post.remoteId ?? null,
      error_message: post.errorMessage ?? null,
      source: post.source ?? null,
      payload: sanitizeJson(post) ?? {},
    };
  }

  private deserializeScheduledPost(row: any): Record<string, unknown> {
    return {
      id: row.id,
      userId: row.user_id,
      platform: row.platform,
      status: row.status,
      targetDate: row.target_date ?? undefined,
      caption: row.caption ?? '',
      hashtags: row.hashtags ?? '',
      imageUrls: Array.isArray(row.image_urls) ? row.image_urls.filter(Boolean) : [],
      videoUrl: row.video_url ?? undefined,
      videoTitle: row.video_title ?? undefined,
      scheduledFor: toTimestampStub(row.scheduled_for),
      createdAt: toTimestampStub(row.created_at),
      updatedAt: toTimestampStub(row.updated_at),
      postedAt: toTimestampStub(row.posted_at),
      remoteId: row.remote_id ?? undefined,
      errorMessage: row.error_message ?? undefined,
      source: row.source ?? undefined,
    };
  }

  async upsertScheduledPosts(posts: ScheduledPostRecord[]) {
    if (!this.isConfigured() || !posts.length) return;
    const body = posts.map(post => this.serializeScheduledPost(post));
    await this.request('POST', 'dott_scheduled_posts', {
      params: { on_conflict: 'id' },
      prefer: 'resolution=merge-duplicates,return=minimal',
      body,
    });
  }

  async updateScheduledPost(id: string, patch: Partial<ScheduledPostRecord>) {
    if (!this.isConfigured() || !id) return;
    const body: Record<string, unknown> = {};
    if (patch.status !== undefined) body.status = patch.status;
    if (patch.targetDate !== undefined) body.target_date = patch.targetDate;
    if (patch.caption !== undefined) body.caption = patch.caption;
    if (patch.hashtags !== undefined) body.hashtags = patch.hashtags;
    if (patch.imageUrls !== undefined) body.image_urls = sanitizeJson(patch.imageUrls) ?? [];
    if (patch.videoUrl !== undefined) body.video_url = patch.videoUrl;
    if (patch.videoTitle !== undefined) body.video_title = patch.videoTitle;
    if (patch.scheduledFor !== undefined) body.scheduled_for = toIsoString(patch.scheduledFor);
    if (patch.createdAt !== undefined) body.created_at = toIsoString(patch.createdAt);
    if (patch.updatedAt !== undefined) body.updated_at = toIsoString(patch.updatedAt);
    if (patch.postedAt !== undefined) body.posted_at = toIsoString(patch.postedAt);
    if (patch.remoteId !== undefined) body.remote_id = patch.remoteId;
    if (patch.errorMessage !== undefined) body.error_message = patch.errorMessage;
    if (patch.source !== undefined) body.source = patch.source;
    await this.request('PATCH', 'dott_scheduled_posts', {
      params: { id: `eq.${id}` },
      prefer: 'return=minimal',
      body,
    });
  }

  async getPendingScheduledPosts(before: Date, limit = 25) {
    if (!this.isConfigured()) return [];
    const rows = await this.request<any[]>('GET', 'dott_scheduled_posts', {
      params: {
        select: '*',
        status: 'eq.pending',
        scheduled_for: `lte.${before.toISOString()}`,
        order: 'scheduled_for.asc',
        limit,
      },
    });
    return Array.isArray(rows) ? rows.map(row => this.deserializeScheduledPost(row)) : [];
  }

  async getPostsByUser(userId: string, limit = 400) {
    if (!this.isConfigured() || !userId) return [];
    const rows = await this.request<any[]>('GET', 'dott_scheduled_posts', {
      params: {
        select: '*',
        user_id: `eq.${userId}`,
        order: 'created_at.desc',
        limit,
      },
    });
    return Array.isArray(rows) ? rows.map(row => this.deserializeScheduledPost(row)) : [];
  }

  async getPostedPostsByDate(userId: string, date: string, limit = 2500) {
    if (!this.isConfigured() || !userId || !date) return [];
    const rows = await this.request<any[]>('GET', 'dott_scheduled_posts', {
      params: {
        select: '*',
        user_id: `eq.${userId}`,
        target_date: `eq.${date}`,
        status: 'eq.posted',
        order: 'posted_at.desc',
        limit,
      },
    });
    return Array.isArray(rows) ? rows.map(row => this.deserializeScheduledPost(row)) : [];
  }

  async getSocialLimit(key: string) {
    if (!this.isConfigured() || !key) return null;
    const row = await this.getSingleRow<any>('dott_social_limits', { key: `eq.${key}` });
    if (!row) return null;
    return {
      key: row.key,
      userId: row.user_id,
      date: row.date,
      postedCount: toNumber(row.posted_count),
      scheduledCount: toNumber(row.scheduled_count),
    };
  }

  async incrementSocialLimit(record: SocialLimitRecord) {
    if (!this.isConfigured()) return;
    const existing = await this.getSocialLimit(record.key);
    const next = {
      key: record.key,
      user_id: record.userId,
      date: record.date,
      posted_count: toNumber(existing?.postedCount) + toNumber(record.postedCount),
      scheduled_count: toNumber(existing?.scheduledCount) + toNumber(record.scheduledCount),
      updated_at: NOW(),
    };
    await this.request('POST', 'dott_social_limits', {
      params: { on_conflict: 'key' },
      prefer: 'resolution=merge-duplicates,return=minimal',
      body: [next],
    });
  }

  async upsertSocialLimits(records: SocialLimitRecord[]) {
    if (!this.isConfigured() || !records.length) return;
    const body = records.map(record => ({
      key: record.key,
      user_id: record.userId,
      date: record.date,
      posted_count: toNumber(record.postedCount),
      scheduled_count: toNumber(record.scheduledCount),
      updated_at: NOW(),
    }));
    await this.request('POST', 'dott_social_limits', {
      params: { on_conflict: 'key' },
      prefer: 'resolution=merge-duplicates,return=minimal',
      body,
    });
  }

  async addSocialLog(payload: {
    userId: string;
    platform: string;
    scheduledPostId: string;
    status: string;
    responseId?: string;
    error?: string;
  }) {
    if (!this.isConfigured()) return;
    await this.request('POST', 'dott_social_logs', {
      prefer: 'return=minimal',
      body: [
        {
          user_id: payload.userId,
          platform: payload.platform,
          scheduled_post_id: payload.scheduledPostId,
          status: payload.status,
          response_id: payload.responseId ?? null,
          error: payload.error ?? null,
          posted_at: NOW(),
          payload: sanitizeJson(payload) ?? {},
        },
      ],
    });
  }

  async incrementSocialDaily(payload: SocialDailyIncrement) {
    if (!this.isConfigured()) return;
    const id = `${payload.userId}_${payload.date}`;
    const row = await this.getSingleRow<any>('dott_social_daily', { id: `eq.${id}` });
    const perPlatform = { ...((row?.per_platform as Record<string, unknown>) ?? {}) };
    perPlatform[payload.platform] = toNumber(perPlatform[payload.platform]) + 1;
    const next = {
      id,
      user_id: payload.userId,
      date: payload.date,
      posts_attempted: toNumber(row?.posts_attempted) + 1,
      posts_posted: toNumber(row?.posts_posted) + (payload.status === 'posted' ? 1 : 0),
      posts_failed: toNumber(row?.posts_failed) + (payload.status === 'failed' ? 1 : 0),
      posts_skipped: toNumber(row?.posts_skipped) + (payload.status === 'skipped_limit' ? 1 : 0),
      per_platform: perPlatform,
      updated_at: NOW(),
    };
    await this.request('POST', 'dott_social_daily', {
      params: { on_conflict: 'id' },
      prefer: 'resolution=merge-duplicates,return=minimal',
      body: [next],
    });
  }

  async upsertSocialDailyRows(rows: SocialDailyRecord[]) {
    if (!this.isConfigured() || !rows.length) return;
    const body = rows.map(row => ({
      id: `${row.userId}_${row.date}`,
      user_id: row.userId,
      date: row.date,
      posts_attempted: toNumber(row.postsAttempted),
      posts_posted: toNumber(row.postsPosted),
      posts_failed: toNumber(row.postsFailed),
      posts_skipped: toNumber(row.postsSkipped),
      per_platform: sanitizeJson(row.perPlatform ?? {}) ?? {},
      updated_at: NOW(),
    }));
    await this.request('POST', 'dott_social_daily', {
      params: { on_conflict: 'id' },
      prefer: 'resolution=merge-duplicates,return=minimal',
      body,
    });
  }

  async getSocialDailySummary(userId: string, limit = 14) {
    if (!this.isConfigured() || !userId) return [];
    const rows = await this.request<any[]>('GET', 'dott_social_daily', {
      params: {
        select: '*',
        user_id: `eq.${userId}`,
        order: 'date.desc',
        limit,
      },
    });
    return sortDescByDate(
      (Array.isArray(rows) ? rows : []).map(row => ({
        userId: row.user_id,
        date: row.date,
        postsAttempted: toNumber(row.posts_attempted),
        postsPosted: toNumber(row.posts_posted),
        postsFailed: toNumber(row.posts_failed),
        postsSkipped: toNumber(row.posts_skipped),
        perPlatform: (row.per_platform as Record<string, number>) ?? {},
      })),
    );
  }

  async upsertAutopostJob(userId: string, job: Record<string, unknown>) {
    if (!this.isConfigured() || !userId) return;
    await this.request('POST', 'dott_autopost_jobs', {
      params: { on_conflict: 'user_id' },
      prefer: 'resolution=merge-duplicates,return=minimal',
      body: [
        {
          user_id: userId,
          active: job.active !== false,
          next_run: toIsoString(job.nextRun),
          reels_next_run: toIsoString(job.reelsNextRun),
          story_next_run: toIsoString(job.storyNextRun),
          trend_next_run: toIsoString(job.trendNextRun),
          data: sanitizeJson(job) ?? {},
          updated_at: NOW(),
        },
      ],
    });
  }

  async getAutopostJob(userId: string) {
    if (!this.isConfigured() || !userId) return null;
    const row = await this.getSingleRow<any>('dott_autopost_jobs', { user_id: `eq.${userId}` });
    if (!row) return null;
    const data = typeof row.data === 'object' && row.data ? { ...(row.data as Record<string, unknown>) } : {};
    return {
      ...data,
      userId,
      active: row.active ?? data.active ?? true,
      nextRun: toTimestamp(row.next_run) ?? toTimestamp(data.nextRun),
      reelsNextRun: toTimestamp(row.reels_next_run) ?? toTimestamp(data.reelsNextRun),
      storyNextRun: toTimestamp(row.story_next_run) ?? toTimestamp(data.storyNextRun),
      trendNextRun: toTimestamp(row.trend_next_run) ?? toTimestamp(data.trendNextRun),
    };
  }

  async claimAutopostRun(
    userId: string,
    field: 'next_run' | 'reels_next_run' | 'story_next_run' | 'trend_next_run',
    expectedRun: unknown,
    nextRun: unknown,
  ) {
    if (!this.isConfigured() || !userId) return false;
    const expectedIso = toIsoString(expectedRun);
    const nextIso = toIsoString(nextRun);
    if (!expectedIso || !nextIso) return false;
    const rows = await this.request<any[]>('PATCH', 'dott_autopost_jobs', {
      params: {
        select: 'user_id',
        user_id: `eq.${userId}`,
        [field]: `eq.${expectedIso}`,
      },
      prefer: 'return=representation',
      body: {
        [field]: nextIso,
        updated_at: NOW(),
      },
    });
    return Array.isArray(rows) && rows.length > 0;
  }

  async getDueAutopostJobs(field: 'next_run' | 'reels_next_run' | 'story_next_run' | 'trend_next_run', before: Date) {
    if (!this.isConfigured()) return [];
    const rows = await this.request<any[]>('GET', 'dott_autopost_jobs', {
      params: {
        select: '*',
        [field]: `lte.${before.toISOString()}`,
        order: `${field}.asc`,
        limit: 200,
      },
    });
    if (!Array.isArray(rows)) return [];
    const jobs = await Promise.all(rows.map(row => this.getAutopostJob(row.user_id)));
    return jobs.filter(Boolean);
  }

  async getAutopostJobsWithNullRun(field: 'reels_next_run' | 'story_next_run') {
    if (!this.isConfigured()) return [];
    const rows = await this.request<any[]>('GET', 'dott_autopost_jobs', {
      params: {
        select: '*',
        [field]: 'is.null',
        limit: 200,
      },
    });
    if (!Array.isArray(rows)) return [];
    const jobs = await Promise.all(rows.map(row => this.getAutopostJob(row.user_id)));
    return jobs.filter(Boolean);
  }

  async incrementMetricSummary(metric: string, counters: MetricCounterTree, scope?: AnalyticsScope) {
    if (!this.isConfigured()) return;
    const scopeKey = toScopeKey(scope);
    const row = await this.getSingleRow<any>('dott_metric_summaries', {
      scope_key: `eq.${scopeKey}`,
      metric: `eq.${metric}`,
    });
    const nextCounters = mergeNumericTree(row?.counters ?? {}, counters) as Record<string, unknown>;
    await this.request('POST', 'dott_metric_summaries', {
      params: { on_conflict: 'scope_key,metric' },
      prefer: 'resolution=merge-duplicates,return=minimal',
      body: [
        {
          scope_key: scopeKey,
          user_id: scope?.userId ?? null,
          metric,
          counters: sanitizeJson(nextCounters) ?? {},
          updated_at: NOW(),
        },
      ],
    });
  }

  async upsertMetricSummaries(
    rows: Array<{ scopeKey: string; metric: string; counters: MetricCounterTree; userId?: string | null }>,
  ) {
    if (!this.isConfigured() || !rows.length) return;
    const body = rows.map(row => ({
      scope_key: row.scopeKey,
      user_id: row.userId ?? null,
      metric: row.metric,
      counters: sanitizeJson(row.counters) ?? {},
      updated_at: NOW(),
    }));
    await this.request('POST', 'dott_metric_summaries', {
      params: { on_conflict: 'scope_key,metric' },
      prefer: 'resolution=merge-duplicates,return=minimal',
      body,
    });
  }

  async incrementMetricDaily(metric: string, counters: MetricCounterTree, scope?: AnalyticsScope, date?: string) {
    if (!this.isConfigured()) return;
    const scopeKey = toScopeKey(scope);
    const targetDate = date ?? new Date().toISOString().slice(0, 10);
    const row = await this.getSingleRow<any>('dott_metric_daily', {
      scope_key: `eq.${scopeKey}`,
      metric: `eq.${metric}`,
      date: `eq.${targetDate}`,
    });
    const nextCounters = mergeNumericTree(row?.counters ?? {}, counters) as Record<string, unknown>;
    await this.request('POST', 'dott_metric_daily', {
      params: { on_conflict: 'scope_key,metric,date' },
      prefer: 'resolution=merge-duplicates,return=minimal',
      body: [
        {
          scope_key: scopeKey,
          user_id: scope?.userId ?? null,
          metric,
          date: targetDate,
          counters: sanitizeJson(nextCounters) ?? {},
          updated_at: NOW(),
        },
      ],
    });
  }

  async upsertMetricDailyRows(
    rows: Array<{
      scopeKey: string;
      metric: string;
      date: string;
      counters: MetricCounterTree;
      userId?: string | null;
    }>,
  ) {
    if (!this.isConfigured() || !rows.length) return;
    const body = rows
      .filter(row => row.date)
      .map(row => ({
        scope_key: row.scopeKey,
        user_id: row.userId ?? null,
        metric: row.metric,
        date: row.date,
        counters: sanitizeJson(row.counters) ?? {},
        updated_at: NOW(),
      }));
    if (!body.length) return;
    await this.request('POST', 'dott_metric_daily', {
      params: { on_conflict: 'scope_key,metric,date' },
      prefer: 'resolution=merge-duplicates,return=minimal',
      body,
    });
  }

  async getMetricSummary(metric: string, scope?: AnalyticsScope) {
    if (!this.isConfigured()) return null;
    const scopeKey = toScopeKey(scope);
    const row = await this.getSingleRow<any>('dott_metric_summaries', {
      scope_key: `eq.${scopeKey}`,
      metric: `eq.${metric}`,
    });
    return row?.counters ?? null;
  }

  async getMetricDailyRows(metric: string, scope?: AnalyticsScope, limit = 14, minDate?: string) {
    if (!this.isConfigured()) return [];
    const scopeKey = toScopeKey(scope);
    const rows = await this.request<any[]>('GET', 'dott_metric_daily', {
      params: {
        select: '*',
        scope_key: `eq.${scopeKey}`,
        metric: `eq.${metric}`,
        ...(minDate ? { date: `gte.${minDate}` } : {}),
        order: 'date.desc',
        limit,
      },
    });
    return sortDescByDate(
      (Array.isArray(rows) ? rows : []).map(row => ({
        date: row.date,
        counters: (row.counters as Record<string, unknown>) ?? {},
      })),
    );
  }
}

export const supabaseFallbackService = new SupabaseFallbackService();
