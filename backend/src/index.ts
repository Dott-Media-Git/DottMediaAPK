import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import createHttpError, { HttpError } from 'http-errors';
import fs from 'fs';
import path from 'path';
import { config } from './config';
import automationRoutes from './routes/automationRoutes';
import assistantRoutes from './routes/assistantRoutes';
import analyticsRoutes from './routes/analyticsRoutes';
import whatsappRoutes from './routes/whatsappRoutes';
import facebookRoutes from './routes/facebookRoutes';
import instagramRoutes from './routes/instagramRoutes';
import threadsRoutes from './routes/threadsRoutes';
import linkedinRoutes from './routes/linkedinRoutes';
import widgetRoutes from './routes/widgetRoutes';
import outreachRoutes from './routes/outreachRoutes';
import followUpRoutes from './routes/followUpRoutes';
import schedulerRoutes from './routes/schedulerRoutes';
import offerRoutes from './routes/offerRoutes';
import knowledgeRoutes from './routes/knowledgeRoutes';
import botRoutes from './routes/botRoutes';
import webhookReplyRoutes from './routes/webhookReplyRoutes';
import inboundWebhookRoutes from './routes/inboundWebhookRoutes';
import engagementWebhookRoutes from './routes/engagementWebhookRoutes';
import webWidgetRoutes from './routes/webWidgetRoutes';
import adminRoutes from './routes/adminRoutes';
import contentRoutes from './routes/contentRoutes';
import footballTrendRoutes from './routes/footballTrendRoutes';
import trendRoutes from './routes/trendRoutes';
import socialRoutes from './routes/socialRoutes';
import metaWebhookRoutes from './routes/metaWebhookRoutes';
import metaIntegrationRoutes from './routes/metaIntegrationRoutes';
import metaAdsRoutes from './routes/metaAdsRoutes';
import authRoutes from './routes/authRoutes';
import youtubeIntegrationRoutes from './routes/youtubeIntegrationRoutes';
import tiktokIntegrationRoutes from './routes/tiktokIntegrationRoutes';
import instagramReelsSoraRoutes from './routes/instagramReelsSoraRoutes';
import publicMediaRoutes from './routes/publicMediaRoutes';
import redirectRoutes from './routes/redirectRoutes';
import mediaRoutes from './routes/mediaRoutes';
import { NotificationDispatcher } from './packages/services/notificationDispatcher';
import stripeRoutes from './routes/stripeRoutes';
import { requireFirebase, AuthedRequest } from './middleware/firebaseAuth';
import { autoPostService } from './services/autoPostService';
import { autopostComplianceService } from './services/autopostComplianceService';
import { firestore } from './db/firestore';
import { ensureGeneratedMediaRoot } from './services/generatedMediaService';
import { ensureSupabaseFallbackSchema } from './services/supabaseSchemaService';
import { backfillSupabaseFallback } from './services/supabaseBackfillService';

const initializeAutomation = async () => {
  try {
    await Promise.all([
      import('./workers/automationWorker.js'),
      import('./jobs/prospectJob.js'),
      import('./jobs/followupJob.js'),
      import('./jobs/autoPostJob.js'),
      import('./jobs/autopostComplianceJob.js'),
      import('./jobs/socialQueueJob.js'),
      import('./jobs/instagramCommentPollJob.js'),
      import('./jobs/instagramDmPollJob.js'),
      import('./jobs/facebookCommentPollJob.js'),
      import('./jobs/threadsCommentPollJob.js'),
      import('./workers/youtubeWorker.js'),
    ]);
  } catch (error) {
    console.error('Failed to initialize automation background jobs', error);
  }
};

if (config.security.allowMockAuth) {
  console.warn('Skipping automation workers in mock mode');
} else {
  void initializeAutomation();
}

const notificationDispatcher = new NotificationDispatcher();
if (config.security.allowMockAuth) {
  console.warn('Skipping NotificationDispatcher in mock mode');
} else {
  notificationDispatcher.start();
}

void ensureSupabaseFallbackSchema().then(ready => {
  if (!ready) return;
  if (process.env.SUPABASE_BACKFILL_ON_STARTUP === 'true') {
    void backfillSupabaseFallback();
  } else {
    console.info('[supabase-backfill] startup backfill disabled; set SUPABASE_BACKFILL_ON_STARTUP=true to run it.');
  }
});

const app = express();
const startedAt = new Date().toISOString();
const footballTrendsEnabled = process.env.FOOTBALL_TRENDS_ENABLED === 'true';

app.use('/stripe/webhook', express.raw({ type: 'application/json' }), stripeRoutes);

app.use(helmet());
app.use(
  cors({
    origin: '*',
  }),
);
app.use(express.json({ limit: '1mb' }));
app.use(morgan('combined'));

const fallbackDir = process.env.AUTOPOST_FALLBACK_DIR?.trim();
if (fallbackDir) {
  const resolved = path.resolve(fallbackDir);
  if (fs.existsSync(resolved)) {
    app.use('/public/fallback-images', express.static(resolved));
    console.info(`[autopost] fallback image directory enabled (${resolved}).`);
  } else {
    console.warn(`[autopost] fallback image directory not found (${resolved}).`);
  }
}

const fallbackVideoDir = process.env.AUTOPOST_FALLBACK_VIDEO_DIR?.trim() || './public/fallback-videos';
if (fallbackVideoDir) {
  const resolved = path.resolve(fallbackVideoDir);
  if (fs.existsSync(resolved)) {
    app.use('/public/fallback-videos', express.static(resolved));
    console.info(`[autopost] fallback video directory enabled (${resolved}).`);
  } else {
    console.warn(`[autopost] fallback video directory not found (${resolved}).`);
  }
}

const generatedMediaRoot = ensureGeneratedMediaRoot();
app.use('/public/generated-media', express.static(generatedMediaRoot));

app.get('/healthz', (_req, res) => res.json({ ok: true }));
app.get('/version', (_req, res) => {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    Pragma: 'no-cache',
    Expires: '0',
  });
  res.json({
    ok: true,
    startedAt,
    commit:
      process.env.RENDER_GIT_COMMIT ??
      process.env.GIT_COMMIT ??
      process.env.SOURCE_VERSION ??
      null,
    serviceId: process.env.RENDER_SERVICE_ID ?? null,
    serviceName: process.env.RENDER_SERVICE_NAME ?? null,
  });
});

app.use('/', inboundWebhookRoutes);
app.use('/', engagementWebhookRoutes);
app.use('/', metaWebhookRoutes);
app.use('/', webWidgetRoutes);
app.use('/', whatsappRoutes);
app.use('/', facebookRoutes);
app.use('/', instagramRoutes);
app.use('/', threadsRoutes);
app.use('/', linkedinRoutes);
app.use('/', widgetRoutes);
app.use('/', botRoutes);
app.use('/', webhookReplyRoutes);
app.use('/api', outreachRoutes);
app.use('/api', followUpRoutes);
app.use('/api', schedulerRoutes);
app.use('/api', offerRoutes);
app.use('/api', knowledgeRoutes);
app.use('/api', automationRoutes);
app.use('/api', assistantRoutes);
app.use('/api', analyticsRoutes);
app.use('/api', contentRoutes);
app.use('/api', trendRoutes);
if (footballTrendsEnabled) {
  app.use('/api', footballTrendRoutes);
} else {
  console.info('[football-trends] Routes disabled (set FOOTBALL_TRENDS_ENABLED=true).');
}
app.use('/api', socialRoutes);
app.use('/api', metaAdsRoutes);
app.use('/', metaIntegrationRoutes);
app.use('/api', authRoutes);
app.use('/', youtubeIntegrationRoutes);
app.use('/', tiktokIntegrationRoutes);
app.use('/', instagramReelsSoraRoutes);
app.use('/', publicMediaRoutes);
app.use('/', redirectRoutes);
app.use('/', mediaRoutes);
app.use('/', adminRoutes);

// Direct autopost endpoint to ensure availability (mirrors socialRoutes autopost handler)
app.post('/api/autopost/runNow', requireFirebase, async (req, res, next) => {
  try {
    const authUser = (req as AuthedRequest).authUser;
    if (!authUser) return res.status(401).json({ message: 'Unauthorized' });
    const {
      platforms,
      prompt,
      businessType,
      videoUrl,
      videoUrls,
      videoTitle,
      youtubePrivacyStatus,
      youtubeVideoUrl,
      youtubeVideoUrls,
      youtubeShorts,
      tiktokVideoUrl,
      tiktokVideoUrls,
      instagramReelsVideoUrl,
      instagramReelsVideoUrls,
      reelsIntervalHours,
    } = req.body ?? {};
    const result = await autoPostService.start({
      userId: authUser.uid,
      platforms,
      prompt,
      businessType,
      videoUrl,
      videoUrls,
      videoTitle,
      youtubePrivacyStatus,
      youtubeVideoUrl,
      youtubeVideoUrls,
      youtubeShorts,
      tiktokVideoUrl,
      tiktokVideoUrls,
      instagramReelsVideoUrl,
      instagramReelsVideoUrls,
      reelsIntervalHours,
    });
    res.json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
});

// Manual server-side trigger for due autopost jobs.
app.post('/api/autopost/runDue', async (req, res, next) => {
  try {
    const triggerToken = process.env.AUTOPOST_RUN_TOKEN ?? process.env.CRON_SECRET ?? '';
    const providedToken =
      req.header('x-autopost-token') ??
      req.header('x-cron-token') ??
      (req.query.token as string | undefined) ??
      req.body?.token;
    if (triggerToken && providedToken !== triggerToken) {
      return res.status(401).json({ message: 'Invalid token' });
    }

    const result = await autoPostService.runDueJobs();
    res.json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
});

app.post('/api/autopost/complianceCheck', async (req, res, next) => {
  try {
    const triggerToken = process.env.AUTOPOST_RUN_TOKEN ?? process.env.CRON_SECRET ?? '';
    const providedToken =
      req.header('x-autopost-token') ??
      req.header('x-cron-token') ??
      (req.query.token as string | undefined) ??
      req.body?.token;
    if (triggerToken && providedToken !== triggerToken) {
      return res.status(401).json({ message: 'Invalid token' });
    }

    const result = await autopostComplianceService.checkAndRepair('manual_endpoint');
    res.json({ ...result, ok: true });
  } catch (error) {
    next(error);
  }
});

app.post('/api/autopost/runBwinNewsNow', async (req, res, next) => {
  try {
    const triggerToken = process.env.AUTOPOST_RUN_TOKEN ?? process.env.CRON_SECRET ?? '';
    const providedToken =
      req.header('x-autopost-token') ??
      req.header('x-cron-token') ??
      (req.query.token as string | undefined) ??
      req.body?.token;
    if (triggerToken && providedToken !== triggerToken) {
      return res.status(401).json({ message: 'Invalid token' });
    }

    const uid = '1zvY9nNyXMcfxdPQEyx0bIdK7r53';
    const job = ((await (autoPostService as any).loadAutopostJob(uid)) ?? {}) as Record<string, unknown>;
    const requestedPlatforms = Array.isArray(req.body?.platforms) ? req.body.platforms : null;
    const trendPlatforms = requestedPlatforms?.length
      ? requestedPlatforms.filter((platform: unknown) => typeof platform === 'string' && platform.trim())
      : ['facebook', 'instagram', 'threads'];
    let outcome: any;
    try {
      outcome = await (autoPostService as any).executeTrendPosts(uid, {
        ...job,
        trendEnabled: true,
        trendContentType: 'news',
        trendContentTypes: ['news'],
        trendContentCycle: ['news'],
        trendStructuredScheduleEnabled: false,
        trendPlatforms,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn('[autopost] manual Bwin news trigger failed', error);
      return res.json({
        ok: false,
        posted: 0,
        failed: [{ platform: 'bwin_news', status: 'failed', error: message }],
        nextRun: null,
      });
    }

    res.json({
      ok: true,
      posted: outcome?.posted ?? 0,
      failed: Array.isArray(outcome?.failed)
        ? outcome.failed.map((failure: any) => ({
            platform: failure.platform,
            status: failure.status,
            error: failure.error,
          }))
        : [],
      nextRun: outcome?.nextRun ?? null,
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/autopost/runFreshSocialSet', async (req, res, next) => {
  try {
    const triggerToken = process.env.AUTOPOST_RUN_TOKEN ?? process.env.CRON_SECRET ?? '';
    const providedToken =
      req.header('x-autopost-token') ??
      req.header('x-cron-token') ??
      (req.query.token as string | undefined) ??
      req.body?.token;
    if (triggerToken && providedToken !== triggerToken) {
      return res.status(401).json({ message: 'Invalid token' });
    }

    const allAccounts = [
      { label: 'Bwin', uid: '1zvY9nNyXMcfxdPQEyx0bIdK7r53', bwin: true },
      { label: 'Carmarketug', uid: 'acmVetCcOiTHeGk5D7eDYieamDF3', reels: true },
      { label: 'Staysphere', uid: 'D1iNgjLKNRaQhH35M0NmGfw1LVD2', reels: true },
      { label: 'Gamers44life', uid: 'vzdH1DnfFLVjlY8bBgC26WACmmw2', reels: true },
      { label: 'DottEnergy', uid: 'LVR7p3WzdFM51ds92Kacf6S40og2', reels: false },
    ];
    const requestedAccounts = Array.isArray(req.body?.accounts)
      ? new Set(
          req.body.accounts
            .map((value: unknown) => String(value ?? '').trim().toLowerCase())
            .filter(Boolean),
        )
      : null;
    const accounts = requestedAccounts
      ? allAccounts.filter(account => requestedAccounts.has(account.label.toLowerCase()) || requestedAccounts.has(account.uid))
      : allAccounts;
    const service = autoPostService as any;
    const summarize = (outcome: any) => ({
      posted: outcome?.posted ?? 0,
      failed: Array.isArray(outcome?.failed)
        ? outcome.failed.map((failure: any) => ({
            platform: failure.platform,
            status: failure.status,
            error: failure.error,
          }))
        : [],
      nextRun: outcome?.nextRun ?? null,
    });

    const runFreshSet = async () => {
      const results = [];
      for (const account of accounts) {
        const job = await service.loadAutopostJob(account.uid);
        if (!job) {
          results.push({ account: account.label, error: 'autopost_job_missing' });
          continue;
        }
        const result: Record<string, unknown> = { account: account.label };
        if (account.bwin) {
          const newsJob = {
            ...job,
            trendContentType: 'news',
            trendContentTypes: ['news'],
            trendPlatforms: ['facebook', 'instagram'],
            storyPlatforms: ['facebook_story', 'instagram_story'],
          };
          result.feed = summarize(await service.executeTrendPosts(account.uid, newsJob));
          result.stories = summarize(await service.executeTrendStories(account.uid, newsJob));
        } else {
          result.feed = summarize(
            await service.executeJob(account.uid, job, {
              platforms: ['facebook', 'instagram'],
              intervalHours: job.intervalHours ?? 1,
              nextRunField: 'nextRun',
              lastRunField: 'lastRunAt',
              resultField: 'lastResult',
            }),
          );
          const afterFeedJob = (await service.loadAutopostJob(account.uid)) ?? job;
          result.stories = summarize(
            await service.executeJob(account.uid, afterFeedJob, {
              platforms: Array.isArray(afterFeedJob.storyPlatforms) && afterFeedJob.storyPlatforms.length
                ? afterFeedJob.storyPlatforms
                : ['facebook_story', 'instagram_story'],
              intervalHours: afterFeedJob.storyIntervalHours ?? 1,
              nextRunField: 'storyNextRun',
              lastRunField: 'storyLastRunAt',
              resultField: 'storyLastResult',
            }),
          );
          if (account.reels) {
            const afterStoriesJob = (await service.loadAutopostJob(account.uid)) ?? afterFeedJob;
            result.reels = summarize(
              await service.executeJob(account.uid, afterStoriesJob, {
                platforms: ['instagram_reels'],
                intervalHours: afterStoriesJob.reelsIntervalHours ?? 2,
                nextRunField: 'reelsNextRun',
                lastRunField: 'reelsLastRunAt',
                resultField: 'reelsLastResult',
                useGenericVideoFallback: false,
              }),
            );
          }
        }
        results.push(result);
      }
      return results;
    };

    if (req.body?.background === true) {
      void runFreshSet()
        .then(results => console.info('[autopost] runFreshSocialSet background complete', { results }))
        .catch(error => console.error('[autopost] runFreshSocialSet background failed', error));
      return res.status(202).json({ ok: true, accepted: true, accounts: accounts.map(account => account.label) });
    }

    res.json({ ok: true, results: await runFreshSet() });
  } catch (error) {
    next(error);
  }
});

// Manual server-side trigger for outbound discovery + messaging.
app.post('/api/outbound/runNow', async (req, res, next) => {
  try {
    const triggerToken = process.env.OUTBOUND_RUN_TOKEN ?? process.env.CRON_SECRET ?? '';
    const providedToken =
      req.header('x-outbound-token') ??
      req.header('x-cron-token') ??
      (req.query.token as string | undefined) ??
      req.body?.token;
    if (triggerToken && providedToken !== triggerToken) {
      return res.status(401).json({ message: 'Invalid token' });
    }

    const requestedUserId = typeof req.body?.userId === 'string' ? req.body.userId.trim() : '';
    const { resolveDiscoveryLimit, resolveOutboundDiscoveryTarget } = await import('./services/outboundTargetingService.js');
    const { runProspectDiscovery } = await import('./packages/services/prospectFinder/index.js');
    const { outreachAgent } = await import('./packages/services/outreachAgent/index.js');

    const target = await resolveOutboundDiscoveryTarget();
    const limit = resolveDiscoveryLimit();
    const prospects = await runProspectDiscovery({ industry: target.industry, country: target.country, limit });
    const outreach = await outreachAgent.runDailyOutreach(
      prospects,
      requestedUserId ? { userId: requestedUserId } : undefined,
    );

    res.json({
      ok: true,
      target,
      discovered: prospects.length,
      outreach,
      userId: requestedUserId || null,
    });
  } catch (error) {
    next(error);
  }
});

app.use((req, _res, next) => {
  next(createHttpError(404, `Route ${req.path} not found`));
});

app.use((err: HttpError, req: Request, res: Response, _next: NextFunction) => {
  const status = err.status ?? 500;
  const message = status === 500 ? 'Internal server error' : err.message;
  const debugEnabled = process.env.DEBUG_ERRORS === 'true';
  const debugToken = process.env.DEBUG_ERRORS_TOKEN;
  const debugRequested = ['1', 'true', 'yes'].includes((req.header('x-debug') ?? '').toLowerCase());
  const debugAuthorized = !debugToken || req.header('x-debug-token') === debugToken;
  const payload: Record<string, unknown> = { message };
  if (status === 500) {
    console.error(err);
    if (debugEnabled && debugRequested && debugAuthorized) {
      payload.details = err.message ?? 'unknown_error';
      payload.name = err.name ?? 'Error';
    }
  }
  res.status(status).json(payload);
});

export { app };

import { fileURLToPath } from 'url';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  app.listen(config.port, () => {
    console.log(`Dott Media backend running on :${config.port}`);
  });
}
