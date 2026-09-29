import { galleryAutoPostService } from '../services/galleryAutoPostRuntime';

// Server-side polling continues when the mobile app is closed. Firestore
// transactions prevent overlapping processes from claiming the same run.
let running = false;
async function tick() {
  if (running) return;
  running = true;
  try { await galleryAutoPostService.runDueJobs(); }
  catch (error) { console.error('[gallery-autopost] poll failed', error); }
  finally { running = false; }
}
if (process.env.DISABLE_SOCIAL_QUEUE_AUTOMATION !== 'true') {
  setInterval(() => void tick(), 60_000).unref();
  void tick();
}
