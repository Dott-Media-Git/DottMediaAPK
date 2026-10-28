import { firestore } from '../db/firestore.js';
import { autoPostService } from './autoPostService.js';
import { GalleryAutoPostService } from './galleryAutoPostService.js';
import { supabaseFallbackService } from './supabaseFallbackService.js';
const jobs = firestore.collection('galleryAutopostJobs');
const updateLocks = new Map();
const withUserUpdateLock = async (userId, task) => {
    const previous = updateLocks.get(userId) ?? Promise.resolve();
    let release;
    const current = new Promise(resolve => { release = resolve; });
    updateLocks.set(userId, current);
    await previous;
    try {
        return await task();
    }
    finally {
        release();
        if (updateLocks.get(userId) === current)
            updateLocks.delete(userId);
    }
};
const store = {
    async get(userId) {
        if (supabaseFallbackService.isConfigured()) {
            return await supabaseFallbackService.getGalleryAutoPostJob(userId);
        }
        const snapshot = await jobs.doc(userId).get();
        return snapshot.exists ? snapshot.data() : null;
    },
    async update(userId, change) {
        if (supabaseFallbackService.isConfigured()) {
            return withUserUpdateLock(userId, async () => {
                const current = await supabaseFallbackService.getGalleryAutoPostJob(userId);
                const next = change(current);
                await supabaseFallbackService.upsertGalleryAutoPostJob(userId, next);
                return next;
            });
        }
        if (process.env.ALLOW_MOCK_AUTH === 'true') {
            throw Object.assign(new Error('Auto-post requires a persistent database.'), { status: 503 });
        }
        return firestore.runTransaction(async (transaction) => {
            const ref = jobs.doc(userId);
            const snapshot = await transaction.get(ref);
            const next = change(snapshot.exists ? snapshot.data() : null);
            if (next)
                transaction.set(ref, next);
            return next;
        });
    },
    async due(now) {
        if (supabaseFallbackService.isConfigured()) {
            return supabaseFallbackService.getDueGalleryAutoPostUsers(now);
        }
        // One range index; running jobs retain their due time for interrupted-run detection.
        const snapshot = await jobs.where('nextRunAt', '<=', now).orderBy('nextRunAt').limit(100).get();
        return snapshot.docs.map(doc => doc.id);
    },
};
export const galleryAutoPostService = new GalleryAutoPostService({
    store,
    connected: userId => autoPostService.galleryConnectedPlatforms(userId),
    publish: (userId, platform, asset, caption) => autoPostService.publishGalleryAsset(userId, platform, asset, caption),
});
