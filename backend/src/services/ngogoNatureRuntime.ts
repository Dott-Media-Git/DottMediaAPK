import { autoPostService } from './autoPostService';
import { GalleryAutoPostService, type GalleryJob, type GalleryStore } from './galleryAutoPostService';
import { supabaseFallbackService } from './supabaseFallbackService';

const USER_ID = 'ouwaugr76lhdQ6IJbTuoCK9yMV93';
const USERNAME = 'ngogo_safari_lodge';
const captions = [
  'Every adventure begins with a little wonder. 🌿✨ Discover Uganda and make Ngogo Safari Lodge part of your next getaway. 📩 Message us to plan your stay.\n\n#NgogoSafariLodge #ExploreUganda #UgandaSafari #VisitUganda #TravelUganda',
  'Make room for moments you will remember. 🌅🌿 Experience the beauty of Uganda with Ngogo Safari Lodge. 📩 Get in touch to plan your visit.\n\n#NgogoSafariLodge #ExploreUganda #UgandaTravel #SafariMoments #VisitUganda',
  'A getaway worth dreaming about. ✨🌿 Let Ngogo Safari Lodge be part of your next Uganda adventure. 📩 Send us a message to find out more.\n\n#NgogoSafariLodge #ExploreUganda #UgandaSafari #TravelInspiration #VisitUganda',
  'Find your next memorable escape in Uganda. 🌿📸 Discover more with Ngogo Safari Lodge. 📩 Message us to start planning.\n\n#NgogoSafariLodge #ExploreUganda #UgandaTravel #SafariInspiration #VisitUganda',
];
const store: GalleryStore = {
  async get(userId) { return userId === USER_ID ? await supabaseFallbackService.getNatureRotation(userId) as GalleryJob | null : null; },
  async update(userId, change) {
    if (userId !== USER_ID) return null;
    return await supabaseFallbackService.updateNatureRotation(userId, change) as GalleryJob | null;
  },
  async due(now) {
    const job = await this.get(USER_ID);
    return job?.active && job.nextRunAt != null && job.nextRunAt <= now ? [USER_ID] : [];
  },
};
export const ngogoNatureService = new GalleryAutoPostService({
  store,
  connected: userId => autoPostService.galleryConnectedPlatforms(userId),
  publish: (userId, platform, asset) => {
    const index = Number.parseInt(asset.id.replace(/\D/g, ''), 10) || 0;
    return autoPostService.publishGalleryAsset(userId, platform, asset, captions[index % captions.length], USERNAME);
  },
});
