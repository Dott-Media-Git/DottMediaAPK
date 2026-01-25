import IORedis from 'ioredis';
import { config } from '../config.js';
const baseRedisOptions = {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
};
const parseRedisUrl = (redisUrl) => {
    try {
        const parsed = new URL(redisUrl);
        if (!parsed.hostname) {
            return null;
        }
        const options = {
            ...baseRedisOptions,
            host: parsed.hostname,
            port: parsed.port ? Number(parsed.port) : 6379,
        };
        if (parsed.username) {
            options.username = decodeURIComponent(parsed.username);
        }
        if (parsed.password) {
            options.password = decodeURIComponent(parsed.password);
        }
        if (parsed.protocol === 'rediss:') {
            options.tls = {};
        }
        return options;
    }
    catch {
        return null;
    }
};
export const createRedisConnection = (label) => {
    if (process.env.SKIP_REDIS === 'true' || !config.redisUrl) {
        console.warn(`[${label}] Redis disabled; connection not created`);
        return null;
    }
    const options = parseRedisUrl(config.redisUrl);
    if (!options) {
        console.warn(`[${label}] Invalid REDIS_URL; Redis disabled`);
        return null;
    }
    const connection = new IORedis(options);
    connection.on('error', error => {
        console.warn(`[${label}] Redis connection error`, error);
    });
    return connection;
};
