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
import socialRoutes from './routes/socialRoutes';
import metaWebhookRoutes from './routes/metaWebhookRoutes';
import authRoutes from './routes/authRoutes';
import youtubeIntegrationRoutes from './routes/youtubeIntegrationRoutes';
import tiktokIntegrationRoutes from './routes/tiktokIntegrationRoutes';
import instagramReelsSoraRoutes from './routes/instagramReelsSoraRoutes';
import publicMediaRoutes from './routes/publicMediaRoutes';
import { NotificationDispatcher } from './packages/services/notificationDispatcher';
import stripeRoutes from './routes/stripeRoutes';
import { requireFirebase, AuthedRequest } from './middleware/firebaseAuth';
import { autoPostService } from './services/autoPostService';

const initializeAutomation = async () => {
  try {
    await Promise.all([
      import('./workers/automationWorker.js'),
      import('./jobs/prospectJob.js'),
      import('./jobs/followupJob.js'),
      import('./jobs/autoPostJob.js'),
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

const app = express();
const startedAt = new Date().toISOString();

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
app.use('/api', socialRoutes);
app.use('/api', authRoutes);
app.use('/', youtubeIntegrationRoutes);
app.use('/', tiktokIntegrationRoutes);
app.use('/', instagramReelsSoraRoutes);
app.use('/', publicMediaRoutes);
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
