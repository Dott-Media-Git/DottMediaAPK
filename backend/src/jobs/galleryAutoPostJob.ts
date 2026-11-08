import { galleryAutoPostService } from '../services/galleryAutoPostRuntime';
import { ngogoNatureService } from '../services/ngogoNatureRuntime';

// Server-side polling continues when the mobile app is closed. Firestore
// transactions prevent overlapping processes from claiming the same run.
let running = false;
async function tick() {
  if (running) return;
  running = true;
  try {
    const results = await Promise.allSettled([galleryAutoPostService.runDueJobs(), ngogoNatureService.runDueJobs()]);
    for (const result of results) if (result.status === 'rejected') console.error('[gallery-autopost] poll failed', result.reason);
  }
  catch (error) { console.error('[gallery-autopost] poll failed', error); }
  finally { running = false; }
}
if (process.env.DISABLE_SOCIAL_QUEUE_AUTOMATION !== 'true') {
  setInterval(() => void tick(), 60_000).unref();
  void tick();
}
