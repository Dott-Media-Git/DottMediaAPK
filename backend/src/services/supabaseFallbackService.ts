import admin from 'firebase-admin';
import axios, { type AxiosRequestConfig, type Method } from 'axios';
import { Pool, type QueryResultRow } from 'pg';
import dns from 'dns';
import https from 'https';
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

type SocialLogRecord = {
  userId: string;
  platform: string;
  scheduledPostId: string;
  status: string;
  responseId?: string | null;
  error?: string | null;
  postedAt?: unknown;
};

type UserRecord = {
  userId: string;
  email?: string | null;
  name?: string | null;
  photoURL?: string | null;
  authProvider?: string | null;
  isAdmin?: boolean;
  createdAt?: unknown;
  lastLoginAt?: unknown;
  data?: Record<string, unknown>;
};

type ProfileRecord = {
  userId: string;
  email?: string | null;
  name?: string | null;
  subscriptionStatus?: string | null;
  onboardingComplete?: boolean;
  userData?: Record<string, unknown>;
  crmData?: Record<string, unknown>;
  createdAt?: unknown;
  updatedAt?: unknown;
  data?: Record<string, unknown>;
};

type InboundMessageRecord = {
  id: string;
  channel: string;
  senderId: string;
  recipientId?: string | null;
  message?: string | null;
  messageType?: string | null;
  profileName?: string | null;
  status?: string;
  reply?: string | null;
  error?: string | null;
  receivedAt?: unknown;
  payload?: Record<string, unknown>;
};

type MetricCounterTree = Record<string, unknown>;

const SUPABASE_URL = (process.env.SUPABASE_URL ?? '').trim().replace(/\/$/, '');
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
const SUPABASE_DATABASE_URL = (process.env.SUPABASE_DATABASE_URL ?? '').trim();
const REST_BASE = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1` : '';
const allowInsecureSupabaseTls =
  process.env.ALLOW_INSECURE_SUPABASE_TLS === 'true' ||
  process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0' ||
  (process.env.NODE_ENV !== 'production' && process.env.ALLOW_INSECURE_SUPABASE_TLS !== 'false');
const supabaseHttpsAgent = allowInsecureSupabaseTls ? new https.Agent({ rejectUnauthorized: false }) : undefined;
const NOW = () => new Date().toISOString();
dns.setDefaultResultOrder('ipv4first');
const pgPool = SUPABASE_DATABASE_URL
  ? new Pool({
      connectionString: SUPABASE_DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 3,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    })
  : null;

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
  private circuitOpenUntil = 0;
  private consecutiveFailures = 0;
  private databaseCircuitOpenUntil = 0;
  private consecutiveDatabaseFailures = 0;

  isConfigured() {
    return Boolean(REST_BASE && SUPABASE_SERVICE_ROLE_KEY);
  }

  private warnUnavailableOnce() {
    if (this.unavailableWarned || this.isConfigured()) return;
    this.unavailableWarned = true;
    console.warn('[supabase-fallback] SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY missing; fallback inactive');
  }

  private hasDatabaseFallback() {
    return Boolean(pgPool);
  }

  private async databaseQuery<T extends QueryResultRow = QueryResultRow>(sql: string, values: unknown[] = []) {
    if (!pgPool) throw new Error('supabase_database_not_configured');
    if (Date.now() < this.databaseCircuitOpenUntil) {
      throw new Error(`supabase_database_circuit_open retry_after_ms=${this.databaseCircuitOpenUntil - Date.now()}`);
    }
    try {
      const result = await pgPool.query<T>(sql, values);
      this.consecutiveDatabaseFailures = 0;
      this.databaseCircuitOpenUntil = 0;
      return result.rows;
    } catch (error) {
      this.consecutiveDatabaseFailures += 1;
      const message = error instanceof Error ? error.message : String(error);
      const code = (error as { code?: string })?.code;
      const networkFailure =
        code === 'ENETUNREACH' ||
        code === 'ETIMEDOUT' ||
        code === 'ECONNREFUSED' ||
        code === 'ECONNRESET' ||
        /ENETUNREACH|timeout|terminated/i.test(message);
      if (networkFailure || this.consecutiveDatabaseFailures >= 3) {
        const backoffMs = Math.min(300000, 60000 * this.consecutiveDatabaseFailures);
        this.databaseCircuitOpenUntil = Date.now() + backoffMs;
        console.warn('[supabase-fallback] database circuit opened', {
          backoffMs,
          error: code ? `${code}: ${message}` : message,
        });
      }
      throw error;
    }
  }

  private isCircuitOpen() {
    return Date.now() < this.circuitOpenUntil;
  }

  private markRequestSuccess() {
    this.consecutiveFailures = 0;
    this.circuitOpenUntil = 0;
  }

  private sanitizeRequestError(error: unknown, method: Method, table: string) {
    const status = axios.isAxiosError(error) ? error.response?.status : undefined;
    const code = axios.isAxiosError(error)
      ? ((error.response?.data as { error_code?: string | number } | undefined)?.error_code ?? error.code)
      : undefined;
    const cloudflareName = axios.isAxiosError(error)
      ? (error.response?.data as { error_name?: string } | undefined)?.error_name
      : undefined;
    const message = [
      'supabase_request_failed',
      String(method).toUpperCase(),
      table,
      status ? `status=${status}` : null,
      code ? `code=${code}` : null,
      cloudflareName ? `reason=${cloudflareName}` : null,
    ]
      .filter(Boolean)
      .join(' ');
    return new Error(message);
  }

  private shouldOpenCircuit(error: unknown) {
    if (!axios.isAxiosError(error)) return false;
    const status = error.response?.status ?? 0;
    const cloudflareCode = (error.response?.data as { error_code?: number } | undefined)?.error_code;
    return (
      status === 522 ||
      status === 523 ||
      status === 524 ||
      status >= 500 ||
      cloudflareCode === 522 ||
      error.code === 'ECONNABORTED' ||
      error.code === 'ETIMEDOUT'
    );
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
        'User-Agent': 'DottMediaBackend/1.0',
        ...(options.prefer ? { Prefer: options.prefer } : {}),
      },
      data: options.body,
      timeout: 30000,
      ...(supabaseHttpsAgent ? { httpsAgent: supabaseHttpsAgent } : {}),
    };

    if (this.isCircuitOpen()) {
      throw new Error(`supabase_circuit_open retry_after_ms=${this.circuitOpenUntil - Date.now()}`);
    }

    try {
      const response = await axios.request<T>(config);
      this.markRequestSuccess();
      return response.data;
    } catch (error) {
      this.consecutiveFailures += 1;
      const sanitized = this.sanitizeRequestError(error, method, table);
      if (this.shouldOpenCircuit(error) || this.consecutiveFailures >= 3) {
        const backoffMs = Math.min(120000, 30000 * this.consecutiveFailures);
        this.circuitOpenUntil = Date.now() + backoffMs;
        console.warn('[supabase-fallback] REST circuit opened', {
          table,
          method: String(method).toUpperCase(),
          backoffMs,
          error: sanitized.message,
        });
      }
      throw sanitized;
    }
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

  async getRecentScheduledPosts(limit = 500) {
    if (!this.isConfigured()) return [];
    const rows = await this.request<any[]>('GET', 'dott_scheduled_posts', {
      params: {
        select: '*',
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
    responseId?: string | null;
    error?: string | null;
    postedAt?: unknown;
    extraPayload?: Record<string, unknown>;
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
          posted_at: toIsoString(payload.postedAt) ?? NOW(),
          payload: sanitizeJson(payload.extraPayload ? { ...payload, ...payload.extraPayload } : payload) ?? {},
        },
      ],
    });
  }

  async addInboundMessage(record: InboundMessageRecord) {
    if (!this.isConfigured() || !record.id) return;
    const row = {
      id: record.id,
      channel: record.channel,
      sender_id: record.senderId,
      recipient_id: record.recipientId ?? null,
      message: record.message ?? null,
      message_type: record.messageType ?? null,
      profile_name: record.profileName ?? null,
      status: record.status ?? 'received',
      reply: record.reply ?? null,
      error: record.error ?? null,
      received_at: toIsoString(record.receivedAt) ?? NOW(),
      updated_at: NOW(),
      payload: sanitizeJson(record.payload ?? {}) ?? {},
    };
    try {
      await this.request('POST', 'dott_inbound_messages', {
        params: { on_conflict: 'id' },
        prefer: 'resolution=merge-duplicates,return=minimal',
        body: [row],
      });
    } catch (error) {
      const status = (error as { response?: { status?: number } })?.response?.status;
      if (status !== 404) throw error;
      await this.addSocialLog({
        userId: record.senderId,
        platform: `${record.channel}_inbound`,
        scheduledPostId: record.id,
        status: record.status ?? 'received',
        responseId: null,
        error: record.error ?? undefined,
        postedAt: record.receivedAt,
        extraPayload: row,
      });
    }
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

  async getSocialLogsByUser(userId: string, limit = 250) {
    if (!userId) return [] as SocialLogRecord[];
    if (this.hasDatabaseFallback()) {
      try {
        const rows = await this.databaseQuery<{
          user_id: string;
          platform: string;
          scheduled_post_id: string;
          status: string;
          response_id?: string | null;
          error?: string | null;
          posted_at?: string | null;
        }>(
          `select user_id, platform, scheduled_post_id, status, response_id, error, posted_at
             from public.dott_social_logs
            where user_id = $1
            order by posted_at desc
            limit $2`,
          [userId, limit],
        );
        return rows.map(row => ({
          userId: row.user_id,
          platform: row.platform,
          scheduledPostId: row.scheduled_post_id,
          status: row.status,
          responseId: row.response_id ?? null,
          error: row.error ?? null,
          postedAt: toTimestampStub(row.posted_at),
        }));
      } catch (error) {
        console.warn('[supabase-fallback] database social log lookup failed; falling back to REST', error instanceof Error ? error.message : String(error));
      }
    }
    if (!this.isConfigured()) return [] as SocialLogRecord[];
    const rows = await this.request<any[]>('GET', 'dott_social_logs', {
      params: {
        select: '*',
        user_id: `eq.${userId}`,
        order: 'posted_at.desc',
        limit,
      },
    });
    return Array.isArray(rows)
      ? rows.map(row => ({
          userId: row.user_id,
          platform: row.platform,
          scheduledPostId: row.scheduled_post_id,
          status: row.status,
          responseId: row.response_id ?? null,
          error: row.error ?? null,
          postedAt: toTimestampStub(row.posted_at),
        }))
      : [];
  }

  async getRecentSocialLogs(limit = 500) {
    if (!this.isConfigured()) return [] as SocialLogRecord[];
    const rows = await this.request<any[]>('GET', 'dott_social_logs', {
      params: {
        select: '*',
        order: 'posted_at.desc',
        limit,
      },
    });
    return Array.isArray(rows)
      ? rows.map(row => ({
          userId: row.user_id,
          platform: row.platform,
          scheduledPostId: row.scheduled_post_id,
          status: row.status,
          responseId: row.response_id ?? null,
          error: row.error ?? null,
          postedAt: toTimestampStub(row.posted_at),
        }))
      : [];
  }

  async getRecentScheduledPostIds(userId: string, limit = 250) {
    if (!this.isConfigured() || !userId) return [] as string[];
    const rows = await this.request<any[]>('GET', 'dott_social_logs', {
      params: {
        select: 'scheduled_post_id',
        user_id: `eq.${userId}`,
        order: 'posted_at.desc',
        limit,
      },
    });
    return Array.isArray(rows)
      ? rows
          .map(row => String(row.scheduled_post_id ?? '').toLowerCase().trim())
          .filter(Boolean)
      : [];
  }

  async upsertUser(record: UserRecord) {
    if (!this.isConfigured() || !record.userId) return;
    const row = {
      user_id: record.userId,
      email: record.email ?? null,
      name: record.name ?? null,
      photo_url: record.photoURL ?? null,
      auth_provider: record.authProvider ?? null,
      is_admin: Boolean(record.isAdmin),
      data: sanitizeJson(record.data ?? {}) ?? {},
      created_at: toIsoString(record.createdAt),
      last_login_at: toIsoString(record.lastLoginAt),
      updated_at: NOW(),
    };
    try {
      await this.request('POST', 'dott_users', {
        params: { on_conflict: 'user_id' },
        prefer: 'resolution=merge-duplicates,return=minimal',
        body: [row],
      });
    } catch (error) {
      if (!this.hasDatabaseFallback()) throw error;
      await this.databaseQuery(
        `insert into public.dott_users
          (user_id, email, name, photo_url, auth_provider, is_admin, data, created_at, last_login_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10)
         on conflict (user_id) do update set
          email = excluded.email,
          name = excluded.name,
          photo_url = excluded.photo_url,
          auth_provider = excluded.auth_provider,
          is_admin = excluded.is_admin,
          data = excluded.data,
          created_at = coalesce(public.dott_users.created_at, excluded.created_at),
          last_login_at = excluded.last_login_at,
          updated_at = excluded.updated_at`,
        [
          row.user_id,
          row.email,
          row.name,
          row.photo_url,
          row.auth_provider,
          row.is_admin,
          JSON.stringify(row.data),
          row.created_at,
          row.last_login_at,
          row.updated_at,
        ],
      );
    }
  }

  async upsertProfile(record: ProfileRecord) {
    if (!this.isConfigured() || !record.userId) return;
    const row = {
      user_id: record.userId,
      email: record.email ?? null,
      name: record.name ?? null,
      subscription_status: record.subscriptionStatus ?? null,
      onboarding_complete: Boolean(record.onboardingComplete),
      user_data: sanitizeJson(record.userData ?? {}) ?? {},
      crm_data: sanitizeJson(record.crmData ?? {}) ?? {},
      data: sanitizeJson(record.data ?? {}) ?? {},
      created_at: toIsoString(record.createdAt),
      updated_at: toIsoString(record.updatedAt) ?? NOW(),
    };
    try {
      await this.request('POST', 'dott_profiles', {
        params: { on_conflict: 'user_id' },
        prefer: 'resolution=merge-duplicates,return=minimal',
        body: [row],
      });
    } catch (error) {
      if (!this.hasDatabaseFallback()) throw error;
      await this.databaseQuery(
        `insert into public.dott_profiles
          (user_id, email, name, subscription_status, onboarding_complete, user_data, crm_data, data, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9, $10)
         on conflict (user_id) do update set
          email = excluded.email,
          name = excluded.name,
          subscription_status = excluded.subscription_status,
          onboarding_complete = excluded.onboarding_complete,
          user_data = excluded.user_data,
          crm_data = excluded.crm_data,
          data = excluded.data,
          created_at = coalesce(public.dott_profiles.created_at, excluded.created_at),
          updated_at = excluded.updated_at`,
        [
          row.user_id,
          row.email,
          row.name,
          row.subscription_status,
          row.onboarding_complete,
          JSON.stringify(row.user_data),
          JSON.stringify(row.crm_data),
          JSON.stringify(row.data),
          row.created_at,
          row.updated_at,
        ],
      );
    }
  }

  async getProfile(userId: string) {
    if (!this.isConfigured() || !userId) return null;
    let row: any = null;
    try {
      row = await this.getSingleRow<any>('dott_profiles', { user_id: `eq.${userId}` });
    } catch (error) {
      if (!this.hasDatabaseFallback()) throw error;
      const rows = await this.databaseQuery<any>('select * from public.dott_profiles where user_id = $1 limit 1', [userId]);
      row = rows[0] ?? null;
    }
    if (!row) return null;
    return {
      userId: row.user_id,
      email: row.email ?? null,
      name: row.name ?? null,
      subscriptionStatus: row.subscription_status ?? null,
      onboardingComplete: Boolean(row.onboarding_complete),
      userData: row.user_data && typeof row.user_data === 'object' ? row.user_data : {},
      crmData: row.crm_data && typeof row.crm_data === 'object' ? row.crm_data : {},
      data: row.data && typeof row.data === 'object' ? row.data : {},
    };
  }

  async upsertAutopostJob(userId: string, job: Record<string, unknown>) {
    if (!this.isConfigured() || !userId) return;
    const data = (sanitizeJson(job) ?? {}) as Record<string, unknown>;
    if (!data.socialAccounts) {
      try {
        const existing = await this.getSingleRow<any>('dott_autopost_jobs', { user_id: `eq.${userId}` });
        const existingData = existing?.data && typeof existing.data === 'object' ? existing.data : {};
        if (existingData.socialAccounts && typeof existingData.socialAccounts === 'object') {
          data.socialAccounts = existingData.socialAccounts;
        }
        if (data.email === undefined && existingData.email !== undefined) {
          data.email = existingData.email;
        }
      } catch (error) {
        const status = (error as { response?: { status?: number } })?.response?.status;
        if (status !== 404) throw error;
      }
    }
    const row = {
      user_id: userId,
      active: job.active !== false,
      next_run: toIsoString(job.nextRun),
      reels_next_run: toIsoString(job.reelsNextRun),
      story_next_run: toIsoString(job.storyNextRun),
      trend_next_run: toIsoString(job.trendNextRun),
      data,
      updated_at: NOW(),
    };
    try {
      await this.request('POST', 'dott_autopost_jobs', {
        params: { on_conflict: 'user_id' },
        prefer: 'resolution=merge-duplicates,return=minimal',
        body: [row],
      });
    } catch (error) {
      if (!this.hasDatabaseFallback()) throw error;
      await this.databaseQuery(
        `insert into public.dott_autopost_jobs
          (user_id, active, next_run, reels_next_run, story_next_run, trend_next_run, data, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
         on conflict (user_id) do update set
          active = excluded.active,
          next_run = excluded.next_run,
          reels_next_run = excluded.reels_next_run,
          story_next_run = excluded.story_next_run,
          trend_next_run = excluded.trend_next_run,
          data = excluded.data,
          updated_at = excluded.updated_at`,
        [
          row.user_id,
          row.active,
          row.next_run,
          row.reels_next_run,
          row.story_next_run,
          row.trend_next_run,
          JSON.stringify(row.data),
          row.updated_at,
        ],
      );
    }
  }

  async upsertSocialAccounts(userId: string, payload: { email?: string | null; socialAccounts?: Record<string, unknown> }) {
    if (!this.isConfigured() || !userId) return;
    const row = {
      user_id: userId,
      email: payload.email ?? null,
      accounts: sanitizeJson(payload.socialAccounts ?? {}) ?? {},
      updated_at: NOW(),
    };
    try {
      await this.request('POST', 'dott_social_accounts', {
        params: { on_conflict: 'user_id' },
        prefer: 'resolution=merge-duplicates,return=minimal',
        body: [row],
      });
      return;
    } catch (error) {
      const status = (error as { response?: { status?: number } })?.response?.status;
      if (status !== 404 && this.hasDatabaseFallback()) {
        await this.databaseQuery(
          `insert into public.dott_social_accounts (user_id, email, accounts, updated_at)
           values ($1, $2, $3::jsonb, $4)
           on conflict (user_id) do update set
            email = excluded.email,
            accounts = excluded.accounts,
            updated_at = excluded.updated_at`,
          [row.user_id, row.email, JSON.stringify(row.accounts), row.updated_at],
        );
        return;
      }
      if (status !== 404) throw error;
      console.warn('[supabase-fallback] dott_social_accounts missing; storing social accounts in autopost data', {
        userId,
      });
    }

    const existing = await this.getSingleRow<any>('dott_autopost_jobs', { user_id: `eq.${userId}` });
    const existingData = existing?.data && typeof existing.data === 'object' ? existing.data : {};
    const data = {
      ...existingData,
      email: payload.email ?? existingData.email ?? null,
      socialAccounts: sanitizeJson(payload.socialAccounts ?? {}) ?? {},
    };
    await this.request('POST', 'dott_autopost_jobs', {
      params: { on_conflict: 'user_id' },
      prefer: 'resolution=merge-duplicates,return=minimal',
      body: [
        {
          user_id: userId,
          active: existing?.active ?? true,
          next_run: existing?.next_run ?? toIsoString(existingData.nextRun),
          reels_next_run: existing?.reels_next_run ?? toIsoString(existingData.reelsNextRun),
          story_next_run: existing?.story_next_run ?? toIsoString(existingData.storyNextRun),
          trend_next_run: existing?.trend_next_run ?? toIsoString(existingData.trendNextRun),
          data,
          updated_at: NOW(),
        },
      ],
    });
  }

  async getSocialAccounts(userId: string) {
    if (!this.isConfigured() || !userId) return null;
    let row: any = null;
    try {
      row = await this.getSingleRow<any>('dott_social_accounts', { user_id: `eq.${userId}` });
    } catch (error) {
      const status = (error as { response?: { status?: number } })?.response?.status;
      if (status !== 404 && this.hasDatabaseFallback()) {
        return this.getSocialAccountsFromDatabase(userId);
      }
      if (status !== 404) throw error;
      console.warn('[supabase-fallback] dott_social_accounts missing; reading social accounts from autopost data', {
        userId,
      });
    }
    if (!row) {
      const autopostRow = await this.getSingleRow<any>('dott_autopost_jobs', { user_id: `eq.${userId}` });
      const data = autopostRow?.data && typeof autopostRow.data === 'object' ? autopostRow.data : {};
      const socialAccounts = data.socialAccounts && typeof data.socialAccounts === 'object' ? data.socialAccounts : null;
      return socialAccounts ? { email: data.email ?? null, socialAccounts } : null;
    }
    return {
      email: row.email ?? null,
      socialAccounts: row.accounts && typeof row.accounts === 'object' ? row.accounts : {},
    };
  }

  async getSocialAccountsByIdentifiers(userIds: string[] = [], emails: string[] = []) {
    if (!this.isConfigured()) return null;
    const normalizedUserIds = Array.from(new Set(userIds.map(value => value.trim()).filter(Boolean)));
    const normalizedEmails = Array.from(new Set(emails.map(value => value.trim().toLowerCase()).filter(Boolean)));
    if (!normalizedUserIds.length && !normalizedEmails.length) return null;

    const mapRow = (row: any) => ({
      userId: row.user_id,
      email: row.email ?? null,
      socialAccounts: row.accounts && typeof row.accounts === 'object' ? row.accounts : {},
    });

    if (this.hasDatabaseFallback()) {
      try {
        const rows = await this.databaseQuery<any>(
          `select user_id, email, accounts
             from public.dott_social_accounts
            where ($1::text[] <> '{}'::text[] and user_id = any($1::text[]))
               or ($2::text[] <> '{}'::text[] and lower(email) = any($2::text[]))
            order by updated_at desc nulls last
            limit 1`,
          [normalizedUserIds, normalizedEmails],
        );
        if (rows[0]) return mapRow(rows[0]);
      } catch (error) {
        console.warn('[supabase-fallback] social account identifier database lookup failed', {
          userIds: normalizedUserIds,
          emails: normalizedEmails,
          error,
        });
      }
    }

    const rows = await this.getAllSocialAccounts(1000);
    return (
      rows.find(row => {
        const userMatch = row.userId && normalizedUserIds.includes(row.userId);
        const emailMatch = row.email && normalizedEmails.includes(String(row.email).toLowerCase());
        return userMatch || emailMatch;
      }) ?? null
    );
  }

  async getAllSocialAccounts(limit = 1000) {
    if (!this.isConfigured()) return [] as Array<{ userId: string; email?: string | null; socialAccounts: Record<string, unknown> }>;
    try {
      const rows = await this.request<any[]>('GET', 'dott_social_accounts', {
        params: {
          select: '*',
          order: 'updated_at.desc',
          limit,
        },
      });
      return Array.isArray(rows)
        ? rows.map(row => ({
            userId: row.user_id,
            email: row.email ?? null,
            socialAccounts: row.accounts && typeof row.accounts === 'object' ? row.accounts : {},
          }))
        : [];
    } catch (error) {
      const status = (error as { response?: { status?: number } })?.response?.status;
      if (status !== 404 && this.hasDatabaseFallback()) {
        const rows = await this.databaseQuery<any>(
          'select user_id, email, accounts from public.dott_social_accounts order by updated_at desc limit $1',
          [limit],
        );
        return rows.map(row => ({
          userId: row.user_id,
          email: row.email ?? null,
          socialAccounts: row.accounts && typeof row.accounts === 'object' ? row.accounts : {},
        }));
      }
      if (status !== 404) throw error;
      const jobs = await this.getActiveAutopostJobs(limit);
      return jobs
        .map(job => ({
          userId: String(job.userId ?? ''),
          email: (job.email as string | undefined) ?? null,
          socialAccounts:
            job.socialAccounts && typeof job.socialAccounts === 'object'
              ? (job.socialAccounts as Record<string, unknown>)
              : {},
        }))
        .filter(row => row.userId);
    }
  }

  private async getSocialAccountsFromDatabase(userId: string) {
    const rows = await this.databaseQuery<any>(
      'select email, accounts from public.dott_social_accounts where user_id = $1 limit 1',
      [userId],
    );
    const row = rows[0];
    if (row) {
      return {
        email: row.email ?? null,
        socialAccounts: row.accounts && typeof row.accounts === 'object' ? row.accounts : {},
      };
    }
    const fallback = await this.databaseQuery<any>('select data from public.dott_autopost_jobs where user_id = $1 limit 1', [userId]);
    const data = fallback[0]?.data && typeof fallback[0].data === 'object' ? fallback[0].data : {};
    const socialAccounts = data.socialAccounts && typeof data.socialAccounts === 'object' ? data.socialAccounts : null;
    return socialAccounts ? { email: data.email ?? null, socialAccounts } : null;
  }

  async getAutopostJob(userId: string) {
    if (!this.isConfigured() || !userId) return null;
    let row: any = null;
    try {
      row = await this.getSingleRow<any>('dott_autopost_jobs', { user_id: `eq.${userId}` });
    } catch (error) {
      if (!this.hasDatabaseFallback()) throw error;
      const rows = await this.databaseQuery<any>('select * from public.dott_autopost_jobs where user_id = $1 limit 1', [userId]);
      row = rows[0] ?? null;
    }
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

  async getActiveAutopostJobs(limit = 500) {
    if (!this.isConfigured()) return [] as Array<Record<string, unknown>>;
    const rows = await this.request<any[]>('GET', 'dott_autopost_jobs', {
      params: {
        select: '*',
        active: 'eq.true',
        order: 'updated_at.desc',
        limit,
      },
    });
    if (!Array.isArray(rows)) return [];
    return rows.map(row => {
      const data = typeof row.data === 'object' && row.data ? { ...(row.data as Record<string, unknown>) } : {};
      return {
        ...data,
        userId: row.user_id,
        active: row.active ?? data.active ?? true,
        nextRun: toTimestamp(row.next_run) ?? toTimestamp(data.nextRun),
        reelsNextRun: toTimestamp(row.reels_next_run) ?? toTimestamp(data.reelsNextRun),
        storyNextRun: toTimestamp(row.story_next_run) ?? toTimestamp(data.storyNextRun),
        trendNextRun: toTimestamp(row.trend_next_run) ?? toTimestamp(data.trendNextRun),
      };
    });
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
    const expectedUpperBound = new Date(new Date(expectedIso).getTime() + 1000).toISOString();
    let rows: any[];
    try {
      rows = await this.request<any[]>('PATCH', 'dott_autopost_jobs', {
        params: {
          select: 'user_id',
          user_id: `eq.${userId}`,
          [field]: `lte.${expectedUpperBound}`,
        },
        prefer: 'return=representation',
        body: {
          [field]: nextIso,
          updated_at: NOW(),
        },
      });
    } catch (error) {
      if (!this.hasDatabaseFallback()) throw error;
      rows = await this.databaseQuery(
        `update public.dott_autopost_jobs
         set ${field} = $1, updated_at = $2
         where user_id = $3 and ${field} <= $4
         returning user_id`,
        [nextIso, NOW(), userId, expectedUpperBound],
      );
    }
    return Array.isArray(rows) && rows.length > 0;
  }

  async getDueAutopostJobs(field: 'next_run' | 'reels_next_run' | 'story_next_run' | 'trend_next_run', before: Date) {
    if (!this.isConfigured()) return [];
    const rows = await this.request<any[]>('GET', 'dott_autopost_jobs', {
      params: {
        select: '*',
        active: 'eq.true',
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
        active: 'eq.true',
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
