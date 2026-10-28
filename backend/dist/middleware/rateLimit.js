const buckets = new Map();
const getClientKey = (req) => {
    const forwardedFor = req.header('x-forwarded-for')?.split(',')[0]?.trim();
    return forwardedFor || req.ip || req.socket.remoteAddress || 'unknown';
};
setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets.entries()) {
        if (bucket.resetAt <= now)
            buckets.delete(key);
    }
}, 60000).unref();
export function createRateLimit({ windowMs, max, message, skip }) {
    return (req, res, next) => {
        if (skip?.(req))
            return next();
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
