import { firestore } from '../db/firestore';
import { autoPostService } from './autoPostService';
import { GalleryAutoPostService, type GalleryJob, type GalleryStore } from './galleryAutoPostService';

const jobs = firestore.collection('galleryAutopostJobs');
const store: GalleryStore = {
  async get(userId) {
    const snapshot = await jobs.doc(userId).get();
    return snapshot.exists ? snapshot.data() as GalleryJob : null;
  },
  async update(userId, change) {
    if (process.env.ALLOW_MOCK_AUTH === 'true') {
      throw Object.assign(new Error('Auto-post requires a persistent database.'), { status: 503 });
    }
    return firestore.runTransaction(async transaction => {
      const ref = jobs.doc(userId);
      const snapshot = await transaction.get(ref);
      const next = change(snapshot.exists ? snapshot.data() as GalleryJob : null);
      if (next) transaction.set(ref, next);
      return next;
    });
  },
  async due(now) {
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
