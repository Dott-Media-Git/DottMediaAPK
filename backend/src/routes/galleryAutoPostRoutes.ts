import { Router, type RequestHandler } from 'express';
import { ZodError } from 'zod';
import type { AuthedRequest } from '../middleware/firebaseAuth';
import type { GalleryAutoPostService, GalleryPlatform } from '../services/galleryAutoPostService';

export function createGalleryAutoPostRouter(
  galleryAutoPostService: GalleryAutoPostService,
  connectedPlatforms: (userId: string) => Promise<GalleryPlatform[]>,
  authenticate: RequestHandler,
) {
const router = Router();
router.use(authenticate);
router.get('/', async (req, res, next) => {
  try {
    const userId = (req as AuthedRequest).authUser!.uid;
    const [job, platforms] = await Promise.all([
      galleryAutoPostService.status(userId), connectedPlatforms(userId),
    ]);
    res.set('Cache-Control', 'no-store').json({ job, platforms });
  } catch (error) { next(error); }
});
router.post('/', async (req, res, next) => {
  try {
    const userId = (req as AuthedRequest).authUser!.uid;
    const job = await galleryAutoPostService.start(userId, req.body);
    res.status(201).json({ job });
    // Start the first item immediately after the durable job is created. The
    // background poller will handle all later three-hour runs.
    void galleryAutoPostService.runUser(userId).catch(error => {
      console.error('[gallery-autopost] initial run failed', { userId, error });
    });
  } catch (error) {
    if (error instanceof ZodError) return res.status(400).json({ message: error.issues[0]?.message });
    next(error);
  }
});
router.delete('/', async (req, res, next) => {
  try {
    const job = await galleryAutoPostService.stop((req as AuthedRequest).authUser!.uid);
    res.json({ job });
  } catch (error) { next(error); }
});
return router;
}
