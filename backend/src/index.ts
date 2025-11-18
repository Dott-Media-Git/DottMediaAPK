import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import createHttpError, { HttpError } from 'http-errors';
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
import './workers/automationWorker';
import './jobs/prospectJob';
import './jobs/followupJob';
import webhookReplyRoutes from './routes/webhookReplyRoutes';
import inboundWebhookRoutes from './routes/inboundWebhookRoutes';
import engagementWebhookRoutes from './routes/engagementWebhookRoutes';
import webWidgetRoutes from './routes/webWidgetRoutes';
import adminRoutes from './routes/adminRoutes';
import contentRoutes from './routes/contentRoutes';
import socialRoutes from './routes/socialRoutes';
import { NotificationDispatcher } from './packages/services/notificationDispatcher';
import stripeRoutes from './routes/stripeRoutes';

const notificationDispatcher = new NotificationDispatcher();
notificationDispatcher.start();

const app = express();

app.use('/stripe/webhook', express.raw({ type: 'application/json' }), stripeRoutes);

app.use(helmet());
app.use(
  cors({
    origin: '*',
  }),
);
app.use(express.json({ limit: '1mb' }));
app.use(morgan('combined'));

app.get('/healthz', (_req, res) => res.json({ ok: true }));

app.use('/', inboundWebhookRoutes);
app.use('/', engagementWebhookRoutes);
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
app.use('/', adminRoutes);

app.use((req, _res, next) => {
  next(createHttpError(404, `Route ${req.path} not found`));
});

app.use((err: HttpError, _req: Request, res: Response, _next: NextFunction) => {
  const status = err.status ?? 500;
  const message = status === 500 ? 'Internal server error' : err.message;
  if (status === 500) {
    console.error(err);
  }
  res.status(status).json({ message });
});

app.listen(config.port, () => {
  console.log(`Dott Media backend running on :${config.port}`);
});
