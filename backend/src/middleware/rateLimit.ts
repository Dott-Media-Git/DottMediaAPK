import { Request, Response, NextFunction } from 'express';

type RateLimitOptions = {
  windowMs: number;
  max: number;
  message: string;
  skip?: (req: Request) => boolean;
};

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

const getClientKey = (req: Request) => {
  const forwardedFor = req.header('x-forwarded-for')?.split(',')[0]?.trim();
  return forwardedFor || req.ip || req.socket.remoteAddress || 'unknown';
};

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}, 60_000).unref();

export function createRateLimit({ windowMs, max, message, skip }: RateLimitOptions) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (skip?.(req)) return next();

    const now = Date.now();
    const key = `${getClientKey(req)}:${req.path}`;
    const current = buckets.get(key);
    const bucket = current && current.resetAt > now ? current : { count: 0, resetAt: now + windowMs };
    bucket.count += 1;
    buckets.set(key, bucket);

    const remaining = Math.max(max - bucket.count, 0);
    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(remaining));
    res.setHeader('RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
      return res.status(429).json({ message });
    }

    next();
  };
}
