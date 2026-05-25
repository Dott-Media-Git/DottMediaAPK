import admin from 'firebase-admin';
import axios from 'axios';
import { resolveAnalyticsScopeKey } from './analyticsScope.js';
const SUPABASE_URL = (process.env.SUPABASE_URL ?? '').trim().replace(/\/$/, '');
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
const REST_BASE = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1` : '';
const NOW = () => new Date().toISOString();
const toScopeKey = (scope) => resolveAnalyticsScopeKey(scope || {}) || 'global';
const toTimestamp = (value) => {
    if (!value)
        return undefined;
    if (value instanceof Date)
        return admin.firestore.Timestamp.fromDate(value);
    if (typeof value === 'string' || typeof value === 'number') {
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime())) {
            return admin.firestore.Timestamp.fromDate(parsed);
        }
    }
    if (typeof value === 'object') {
        const candidate = value;
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
const toTimestampStub = (value) => {
    const timestamp = toTimestamp(value);
    return timestamp ? { seconds: timestamp.seconds, nanoseconds: timestamp.nanoseconds } : undefined;
};
const toIsoString = (value) => {
    if (!value)
        return null;
    if (typeof value === 'string') {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
    }
    if (value instanceof Date)
        return value.toISOString();
    if (typeof value === 'number') {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
    }
    if (typeof value === 'object') {
        const candidate = value;
        if (typeof candidate.toDate === 'function')
            return candidate.toDate().toISOString();
        if (typeof candidate.seconds === 'number')
            return new Date(candidate.seconds * 1000).toISOString();
        if (typeof candidate._seconds === 'number')
            return new Date(candidate._seconds * 1000).toISOString();
    }
    return null;
};
const sanitizeJson = (value) => {
    if (value === undefined)
        return undefined;
    if (value === null)
        return null;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
        return value;
    if (value instanceof Date)
        return value.toISOString();
    if (Array.isArray(value))
        return value.map(entry => sanitizeJson(entry)).filter(entry => entry !== undefined);
    if (typeof value === 'object') {
        const timestamp = toIsoString(value);
        if (timestamp)
            return timestamp;
        const output = {};
        Object.entries(value).forEach(([key, entry]) => {
            const cleaned = sanitizeJson(entry);
            if (cleaned !== undefined)
                output[key] = cleaned;
        });
        return output;
    }
    return undefined;
};
const toNumber = (value) => {
    const numeric = Number(value ?? 0);
    return Number.isFinite(numeric) ? numeric : 0;
};
const mergeNumericTree = (base, patch) => {
    if (patch === undefined)
        return base;
    if (patch === null)
        return base ?? null;
    if (typeof patch === 'number')
        return toNumber(base) + patch;
    if (typeof patch === 'string' || typeof patch === 'boolean')
        return patch;
    if (Array.isArray(patch))
        return patch.map(entry => sanitizeJson(entry));
    if (typeof patch === 'object') {
        const existing = base && typeof base === 'object' && !Array.isArray(base) ? base : {};
        const output = { ...existing };
        Object.entries(patch).forEach(([key, value]) => {
            output[key] = mergeNumericTree(existing[key], value);
        });
        return output;
    }
    return patch;
};
const sortDescByDate = (rows) => [...rows].sort((a, b) => `${b.date ?? ''}`.localeCompare(`${a.date ?? ''}`));
class SupabaseFallbackService {
    constructor() {
        this.unavailableWarned = false;
        this.circuitOpenUntil = 0;
        this.consecutiveFailures = 0;
    }
    isConfigured() {
        return Boolean(REST_BASE && SUPABASE_SERVICE_ROLE_KEY);
    }
    warnUnavailableOnce() {
        if (this.unavailableWarned || this.isConfigured())
            return;
        this.unavailableWarned = true;
        console.warn('[supabase-fallback] SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY missing; fallback inactive');
    }
    isCircuitOpen() {
        return Date.now() < this.circuitOpenUntil;
    }
    markRequestSuccess() {
        this.consecutiveFailures = 0;
        this.circuitOpenUntil = 0;
    }
    sanitizeRequestError(error, method, table) {
        const status = axios.isAxiosError(error) ? error.response?.status : undefined;
        const code = axios.isAxiosError(error)
            ? (error.response?.data?.error_code ?? error.code)
            : undefined;
        const cloudflareName = axios.isAxiosError(error)
            ? error.response?.data?.error_name
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
    shouldOpenCircuit(error) {
        if (!axios.isAxiosError(error))
            return false;
        const status = error.response?.status ?? 0;
        const cloudflareCode = error.response?.data?.error_code;
        return (status === 522 ||
            status === 523 ||
            status === 524 ||
            status >= 500 ||
            cloudflareCode === 522 ||
            error.code === 'ECONNABORTED' ||
            error.code === 'ETIMEDOUT');
    }
    async request(method, table, options = {}) {
        if (!this.isConfigured()) {
            this.warnUnavailableOnce();
            throw new Error('supabase_not_configured');
        }
        const search = new URLSearchParams();
        Object.entries(options.params ?? {}).forEach(([key, value]) => {
            if (value === undefined)
                return;
            if (value === null) {
                search.append(key, 'is.null');
                return;
            }
            search.append(key, String(value));
        });
        const config = {
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
        if (this.isCircuitOpen()) {
            throw new Error(`supabase_circuit_open retry_after_ms=${this.circuitOpenUntil - Date.now()}`);
        }
        try {
            const response = await axios.request(config);
            this.markRequestSuccess();
            return response.data;
        }
        catch (error) {
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
    async getSingleRow(table, params) {
        const rows = await this.request('GET', table, {
            params: { select: '*', limit: 1, ...params },
        });
        return Array.isArray(rows) && rows.length ? rows[0] : null;
    }
    serializeScheduledPost(post) {
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
    deserializeScheduledPost(row) {
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
    async upsertScheduledPosts(posts) {
        if (!this.isConfigured() || !posts.length)
            return;
        const body = posts.map(post => this.serializeScheduledPost(post));
        await this.request('POST', 'dott_scheduled_posts', {
            params: { on_conflict: 'id' },
            prefer: 'resolution=merge-duplicates,return=minimal',
            body,
        });
    }
    async updateScheduledPost(id, patch) {
        if (!this.isConfigured() || !id)
            return;
        const body = {};
        if (patch.status !== undefined)
            body.status = patch.status;
        if (patch.targetDate !== undefined)
            body.target_date = patch.targetDate;
        if (patch.caption !== undefined)
            body.caption = patch.caption;
        if (patch.hashtags !== undefined)
            body.hashtags = patch.hashtags;
        if (patch.imageUrls !== undefined)
            body.image_urls = sanitizeJson(patch.imageUrls) ?? [];
        if (patch.videoUrl !== undefined)
            body.video_url = patch.videoUrl;
        if (patch.videoTitle !== undefined)
            body.video_title = patch.videoTitle;
        if (patch.scheduledFor !== undefined)
            body.scheduled_for = toIsoString(patch.scheduledFor);
        if (patch.createdAt !== undefined)
            body.created_at = toIsoString(patch.createdAt);
        if (patch.updatedAt !== undefined)
            body.updated_at = toIsoString(patch.updatedAt);
        if (patch.postedAt !== undefined)
            body.posted_at = toIsoString(patch.postedAt);
        if (patch.remoteId !== undefined)
            body.remote_id = patch.remoteId;
        if (patch.errorMessage !== undefined)
            body.error_message = patch.errorMessage;
        if (patch.source !== undefined)
            body.source = patch.source;
        await this.request('PATCH', 'dott_scheduled_posts', {
            params: { id: `eq.${id}` },
            prefer: 'return=minimal',
            body,
        });
    }
    async getPendingScheduledPosts(before, limit = 25) {
        if (!this.isConfigured())
            return [];
        const rows = await this.request('GET', 'dott_scheduled_posts', {
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
    async getPostsByUser(userId, limit = 400) {
        if (!this.isConfigured() || !userId)
            return [];
        const rows = await this.request('GET', 'dott_scheduled_posts', {
            params: {
                select: '*',
                user_id: `eq.${userId}`,
                order: 'created_at.desc',
                limit,
            },
        });
        return Array.isArray(rows) ? rows.map(row => this.deserializeScheduledPost(row)) : [];
    }
    async getPostedPostsByDate(userId, date, limit = 2500) {
        if (!this.isConfigured() || !userId || !date)
            return [];
        const rows = await this.request('GET', 'dott_scheduled_posts', {
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
    async getSocialLimit(key) {
        if (!this.isConfigured() || !key)
            return null;
        const row = await this.getSingleRow('dott_social_limits', { key: `eq.${key}` });
        if (!row)
            return null;
        return {
            key: row.key,
            userId: row.user_id,
            date: row.date,
            postedCount: toNumber(row.posted_count),
            scheduledCount: toNumber(row.scheduled_count),
        };
    }
    async incrementSocialLimit(record) {
        if (!this.isConfigured())
            return;
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
    async upsertSocialLimits(records) {
        if (!this.isConfigured() || !records.length)
            return;
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
    async addSocialLog(payload) {
        if (!this.isConfigured())
            return;
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
    async addInboundMessage(record) {
        if (!this.isConfigured() || !record.id)
            return;
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
        }
        catch (error) {
            const status = error?.response?.status;
            if (status !== 404)
                throw error;
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
    async incrementSocialDaily(payload) {
        if (!this.isConfigured())
            return;
        const id = `${payload.userId}_${payload.date}`;
        const row = await this.getSingleRow('dott_social_daily', { id: `eq.${id}` });
        const perPlatform = { ...(row?.per_platform ?? {}) };
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
    async upsertSocialDailyRows(rows) {
        if (!this.isConfigured() || !rows.length)
            return;
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
    async getSocialDailySummary(userId, limit = 14) {
        if (!this.isConfigured() || !userId)
            return [];
        const rows = await this.request('GET', 'dott_social_daily', {
            params: {
                select: '*',
                user_id: `eq.${userId}`,
                order: 'date.desc',
                limit,
            },
        });
        return sortDescByDate((Array.isArray(rows) ? rows : []).map(row => ({
            userId: row.user_id,
            date: row.date,
            postsAttempted: toNumber(row.posts_attempted),
            postsPosted: toNumber(row.posts_posted),
            postsFailed: toNumber(row.posts_failed),
            postsSkipped: toNumber(row.posts_skipped),
            perPlatform: row.per_platform ?? {},
        })));
    }
    async getSocialLogsByUser(userId, limit = 250) {
        if (!this.isConfigured() || !userId)
            return [];
        const rows = await this.request('GET', 'dott_social_logs', {
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
    async getRecentScheduledPostIds(userId, limit = 250) {
        if (!this.isConfigured() || !userId)
            return [];
        const rows = await this.request('GET', 'dott_social_logs', {
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
    async upsertAutopostJob(userId, job) {
        if (!this.isConfigured() || !userId)
            return;
        const data = (sanitizeJson(job) ?? {});
        if (!data.socialAccounts) {
            try {
                const existing = await this.getSingleRow('dott_autopost_jobs', { user_id: `eq.${userId}` });
                const existingData = existing?.data && typeof existing.data === 'object' ? existing.data : {};
                if (existingData.socialAccounts && typeof existingData.socialAccounts === 'object') {
                    data.socialAccounts = existingData.socialAccounts;
                }
                if (data.email === undefined && existingData.email !== undefined) {
                    data.email = existingData.email;
                }
            }
            catch (error) {
                const status = error?.response?.status;
                if (status !== 404)
                    throw error;
            }
        }
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
                    data,
                    updated_at: NOW(),
                },
            ],
        });
    }
    async upsertSocialAccounts(userId, payload) {
        if (!this.isConfigured() || !userId)
            return;
        try {
            await this.request('POST', 'dott_social_accounts', {
                params: { on_conflict: 'user_id' },
                prefer: 'resolution=merge-duplicates,return=minimal',
                body: [
                    {
                        user_id: userId,
                        email: payload.email ?? null,
                        accounts: sanitizeJson(payload.socialAccounts ?? {}) ?? {},
                        updated_at: NOW(),
                    },
                ],
            });
            return;
        }
        catch (error) {
            const status = error?.response?.status;
            if (status !== 404)
                throw error;
            console.warn('[supabase-fallback] dott_social_accounts missing; storing social accounts in autopost data', {
                userId,
            });
        }
        const existing = await this.getSingleRow('dott_autopost_jobs', { user_id: `eq.${userId}` });
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
    async getSocialAccounts(userId) {
        if (!this.isConfigured() || !userId)
            return null;
        let row = null;
        try {
            row = await this.getSingleRow('dott_social_accounts', { user_id: `eq.${userId}` });
        }
        catch (error) {
            const status = error?.response?.status;
            if (status !== 404)
                throw error;
            console.warn('[supabase-fallback] dott_social_accounts missing; reading social accounts from autopost data', {
                userId,
            });
        }
        if (!row) {
            const autopostRow = await this.getSingleRow('dott_autopost_jobs', { user_id: `eq.${userId}` });
            const data = autopostRow?.data && typeof autopostRow.data === 'object' ? autopostRow.data : {};
            const socialAccounts = data.socialAccounts && typeof data.socialAccounts === 'object' ? data.socialAccounts : null;
            return socialAccounts ? { email: data.email ?? null, socialAccounts } : null;
        }
        return {
            email: row.email ?? null,
            socialAccounts: row.accounts && typeof row.accounts === 'object' ? row.accounts : {},
        };
    }
    async getAutopostJob(userId) {
        if (!this.isConfigured() || !userId)
            return null;
        const row = await this.getSingleRow('dott_autopost_jobs', { user_id: `eq.${userId}` });
        if (!row)
            return null;
        const data = typeof row.data === 'object' && row.data ? { ...row.data } : {};
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
        if (!this.isConfigured())
            return [];
        const rows = await this.request('GET', 'dott_autopost_jobs', {
            params: {
                select: '*',
                active: 'eq.true',
                order: 'updated_at.desc',
                limit,
            },
        });
        if (!Array.isArray(rows))
            return [];
        return rows.map(row => {
            const data = typeof row.data === 'object' && row.data ? { ...row.data } : {};
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
    async claimAutopostRun(userId, field, expectedRun, nextRun) {
        if (!this.isConfigured() || !userId)
            return false;
        const expectedIso = toIsoString(expectedRun);
        const nextIso = toIsoString(nextRun);
        if (!expectedIso || !nextIso)
            return false;
        const expectedUpperBound = new Date(new Date(expectedIso).getTime() + 1000).toISOString();
        const rows = await this.request('PATCH', 'dott_autopost_jobs', {
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
        return Array.isArray(rows) && rows.length > 0;
    }
    async getDueAutopostJobs(field, before) {
        if (!this.isConfigured())
            return [];
        const rows = await this.request('GET', 'dott_autopost_jobs', {
            params: {
                select: '*',
                active: 'eq.true',
                [field]: `lte.${before.toISOString()}`,
                order: `${field}.asc`,
                limit: 200,
            },
        });
        if (!Array.isArray(rows))
            return [];
        const jobs = await Promise.all(rows.map(row => this.getAutopostJob(row.user_id)));
        return jobs.filter(Boolean);
    }
    async getAutopostJobsWithNullRun(field) {
        if (!this.isConfigured())
            return [];
        const rows = await this.request('GET', 'dott_autopost_jobs', {
            params: {
                select: '*',
                active: 'eq.true',
                [field]: 'is.null',
                limit: 200,
            },
        });
        if (!Array.isArray(rows))
            return [];
        const jobs = await Promise.all(rows.map(row => this.getAutopostJob(row.user_id)));
        return jobs.filter(Boolean);
    }
    async incrementMetricSummary(metric, counters, scope) {
        if (!this.isConfigured())
            return;
        const scopeKey = toScopeKey(scope);
        const row = await this.getSingleRow('dott_metric_summaries', {
            scope_key: `eq.${scopeKey}`,
            metric: `eq.${metric}`,
        });
        const nextCounters = mergeNumericTree(row?.counters ?? {}, counters);
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
    async upsertMetricSummaries(rows) {
        if (!this.isConfigured() || !rows.length)
            return;
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
    async incrementMetricDaily(metric, counters, scope, date) {
        if (!this.isConfigured())
            return;
        const scopeKey = toScopeKey(scope);
        const targetDate = date ?? new Date().toISOString().slice(0, 10);
        const row = await this.getSingleRow('dott_metric_daily', {
            scope_key: `eq.${scopeKey}`,
            metric: `eq.${metric}`,
            date: `eq.${targetDate}`,
        });
        const nextCounters = mergeNumericTree(row?.counters ?? {}, counters);
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
    async upsertMetricDailyRows(rows) {
        if (!this.isConfigured() || !rows.length)
            return;
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
        if (!body.length)
            return;
        await this.request('POST', 'dott_metric_daily', {
            params: { on_conflict: 'scope_key,metric,date' },
            prefer: 'resolution=merge-duplicates,return=minimal',
            body,
        });
    }
    async getMetricSummary(metric, scope) {
        if (!this.isConfigured())
            return null;
        const scopeKey = toScopeKey(scope);
        const row = await this.getSingleRow('dott_metric_summaries', {
            scope_key: `eq.${scopeKey}`,
            metric: `eq.${metric}`,
        });
        return row?.counters ?? null;
    }
    async getMetricDailyRows(metric, scope, limit = 14, minDate) {
        if (!this.isConfigured())
            return [];
        const scopeKey = toScopeKey(scope);
        const rows = await this.request('GET', 'dott_metric_daily', {
            params: {
                select: '*',
                scope_key: `eq.${scopeKey}`,
                metric: `eq.${metric}`,
                ...(minDate ? { date: `gte.${minDate}` } : {}),
                order: 'date.desc',
                limit,
            },
        });
        return sortDescByDate((Array.isArray(rows) ? rows : []).map(row => ({
            date: row.date,
            counters: row.counters ?? {},
        })));
    }
}
export const supabaseFallbackService = new SupabaseFallbackService();
