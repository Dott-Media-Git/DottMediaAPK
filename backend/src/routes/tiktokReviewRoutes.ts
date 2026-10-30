import type {Router} from 'express';
import multer from 'multer';
import {createHash} from 'crypto';
import {z} from 'zod';
import createHttpError from 'http-errors';
import {requireFirebaseStrict, type AuthedRequest} from '../middleware/firebaseAuth';
import {getTikTokIntegrationSecrets} from '../services/socialIntegrationService';
import {consumeUsageForUserId} from '../services/billing/billingService';
import {firestore} from '../db/firestore';
import {tikTokConnectionKey, tikTokEnvironment} from '../services/tiktokReviewConfig';
import {publishReviewedTikTok, queryTikTokCreator, queryTikTokPostStatus} from '../services/tiktokReviewedPublisher';

const upload = multer({storage: multer.memoryStorage(), limits: {files: 1, fields: 3, fileSize: 80 * 1024 * 1024, fieldSize: 16000}});
const boolean = z.boolean();
const reviewSchema = z.object({privacyLevel: z.string().min(1), allowComment: boolean, allowDuet: boolean,
  allowStitch: boolean, commercial: boolean, ownBrand: boolean, brandedContent: boolean,
  musicConsent: z.literal(true), explicitConsent: z.literal(true), reviewedOpenId: z.string().min(1), aiGenerated: boolean});
async function connection(uid: string) {
  const c = await getTikTokIntegrationSecrets(tikTokConnectionKey(uid));
  if (!c?.accessToken || !c.openId) throw createHttpError(409, 'Connect your TikTok account first');
  if (c.accessTokenExpiresAt && c.accessTokenExpiresAt < Date.now()) throw createHttpError(409, 'Your TikTok session expired. Reconnect your account.');
  if (!c.scope?.split(/[,\s]+/).includes('video.publish')) throw createHttpError(409, 'Reconnect TikTok and grant direct posting access');
  return c;
}
export function mountTikTokReviewRoutes(router: Router) {
  router.get('/integrations/tiktok/creator-info', requireFirebaseStrict, async (req, res, next) => {
    try {
      const uid = (req as AuthedRequest).authUser!.uid, c = await connection(uid);
      const creator = await queryTikTokCreator(c.accessToken);
      res.setHeader('Cache-Control', 'no-store');
      res.json({creator, openId: c.openId, environment: tikTokEnvironment()});
    } catch (e) {next(e);}
  });
  router.post('/integrations/tiktok/publish-reviewed', requireFirebaseStrict, upload.single('video'), async (req, res, next) => {
    let job: FirebaseFirestore.DocumentReference | undefined;
    let created=false;
    try {
      const uid = (req as AuthedRequest).authUser!.uid;
      const requestId = z.string().uuid().parse(req.body.requestId);
      const review = reviewSchema.parse(JSON.parse(req.body.review));
      const caption = z.string().max(2200).parse(req.body.caption || '');
      if (!req.file || req.file.mimetype !== 'video/mp4') throw createHttpError(400, 'Choose an MP4 video smaller than 80 MB');
      const c = await connection(uid);
      if (review.reviewedOpenId !== c.openId) throw createHttpError(409, 'The TikTok account changed. Refresh and review again.');
      const id = createHash('sha256').update(`${tikTokEnvironment()}:${uid}:${requestId}`).digest('hex');
      job = firestore.collection('tiktokReviewedPosts').doc(id);
      const previous = await firestore.runTransaction(async tx => {
        const old = await tx.get(job!);
        if (old.exists) return old.data();
        tx.create(job!, {userId: uid, openId: c.openId, environment: tikTokEnvironment(), status: 'STARTING', createdAt: Date.now()});
        return null;
      });
      if (previous) {res.json({jobId: id, status: previous.status, message: 'This submission already exists. Check its status before retrying.'}); return;}
      created=true;
      if (tikTokEnvironment() === 'production') await consumeUsageForUserId(uid, 'scheduledPosts', 1);
      const result = await publishReviewedTikTok(c.accessToken, c.openId, req.file.buffer, caption, review);
      await job.update({publishId: result.publishId, status: 'PROCESSING_UPLOAD', updatedAt: Date.now()});
      res.json({jobId: id, status: 'PROCESSING_UPLOAD', message: 'TikTok received your upload. Processing can take a few minutes.'});
    } catch (e) {
      // Never retry a potentially accepted upload automatically.
      if (job && created) {
        const message=e instanceof Error?e.message:'Submission could not be confirmed. Check TikTok before retrying.';
        await job.update({status:'REQUIRES_CHECK',message,updatedAt:Date.now()}).catch(()=>undefined);
        res.status(202).json({jobId:job.id,status:'REQUIRES_CHECK',message});return;
      }
      next(e);
    }
  });
  router.get('/integrations/tiktok/reviewed-posts/:id', requireFirebaseStrict, async (req, res, next) => {
    try {
      if (!/^[a-f0-9]{64}$/.test(String(req.params.id))) throw createHttpError(404, 'Post not found');
      const uid = (req as AuthedRequest).authUser!.uid;
      const ref = firestore.collection('tiktokReviewedPosts').doc(String(req.params.id)), job = (await ref.get()).data();
      if (!job || job.userId !== uid || job.environment !== tikTokEnvironment()) throw createHttpError(404, 'Post not found');
      if (!job.publishId) {res.json({status: job.status, message: job.message || 'Submission has not been confirmed. Check TikTok before creating another post.'}); return;}
      const c = await connection(uid);
      if (c.openId !== job.openId) throw createHttpError(409, 'Reconnect the original TikTok account to check this post');
      const result = await queryTikTokPostStatus(c.accessToken, job.publishId);
      await ref.update({status: result.status, updatedAt: Date.now()});
      res.setHeader('Cache-Control', 'no-store'); res.json(result);
    } catch (e) {next(e);}
  });
}
