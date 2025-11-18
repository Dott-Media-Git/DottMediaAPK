import * as Sentry from '@sentry/node';
import { config } from '../config';

const sentryEnabled = Boolean(config.sentry.dsn);

if (sentryEnabled) {
  Sentry.init({
    dsn: config.sentry.dsn ?? undefined,
    environment: config.sentry.environment,
    tracesSampleRate: 0,
  });
}

export { Sentry, sentryEnabled };

export const captureException = (error: unknown, extra?: Record<string, unknown>) => {
  if (!sentryEnabled) return;
  Sentry.captureException(error, extra ? { extra } : undefined);
};
