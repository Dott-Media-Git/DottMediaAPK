import type {Router} from 'express';
import multer from 'multer';
import {createHash} from 'crypto';
import {z} from 'zod';
import createHttpError from 'http-errors';
import {requireFirebaseStrict, type AuthedRequest} from '../middleware/firebaseAuth';
import {getTikTokIntegrationSecrets} from '../services/socialIntegrationService';
import {supabaseFallbackService} from '../services/supabaseFallbackService';
import {tikTokConnectionKey, tikTokEnvironment} from '../services/tiktokReviewConfig';
import {publishReviewedTikTok, queryTikTokCreator, queryTikTokPostStatus, TikTokProviderError} from '../services/tiktokReviewedPublisher';

const upload = multer({storage: multer.memoryStorage(), limits: {files: 1, fields: 3, fileSize: 80 * 1024 * 1024, fieldSize: 16000}});
const boolean = z.boolean();
const safeErrorCode = (error: unknown) => {
  const value = error as {code?: unknown; name?: unknown};
  const code = value?.code ?? value?.name;
  return code === undefined || code === null ? 'unknown' : String(code).slice(0, 80);
};
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
    let jobId: string | undefined;
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
      const previous = await supabaseFallbackService.getTikTokReviewedPost(uid, id);
      if (previous) {res.json({jobId: id, status: previous.status, message: 'This submission already exists. Check its status before retrying.'}); return;}
      await supabaseFallbackService.createTikTokReviewedPost({id, userId: uid, openId: c.openId, environment: tikTokEnvironment(), status: 'STARTING', createdAt: Date.now()});
      jobId = id;
      created=true;
      const result = await publishReviewedTikTok(c.accessToken, c.openId, req.file.buffer, caption, review);
      await supabaseFallbackService.updateTikTokReviewedPost(id, {publishId: result.publishId, status: 'PROCESSING_UPLOAD'});
      res.json({jobId: id, status: 'PROCESSING_UPLOAD', message: 'TikTok received your upload. Processing can take a few minutes.'});
    } catch (e) {
      // Never retry a potentially accepted upload automatically.
      if (jobId && created) {
        const message = reviewedPublishMessage(e);
        if (e instanceof TikTokProviderError) {
          console.warn('[tiktok] reviewed publish requires check', {
            stage: e.stage,
            status: e.httpStatus,
            providerCode: e.providerCode,
          });
        } else {
          console.warn('[tiktok] reviewed publish requires check', {code: safeErrorCode(e)});
        }
        await supabaseFallbackService.updateTikTokReviewedPost(jobId, {status:'REQUIRES_CHECK',message}).catch(()=>undefined);
        res.status(202).json({jobId,status:'REQUIRES_CHECK',message});return;
      }
      next(e);
    }
  });
  router.get('/integrations/tiktok/reviewed-posts/:id', requireFirebaseStrict, async (req, res, next) => {
    try {
      if (!/^[a-f0-9]{64}$/.test(String(req.params.id))) throw createHttpError(404, 'Post not found');
      const uid = (req as AuthedRequest).authUser!.uid;
      const job = await supabaseFallbackService.getTikTokReviewedPost(uid, String(req.params.id));
      if (!job || job.userId !== uid || job.environment !== tikTokEnvironment()) throw createHttpError(404, 'Post not found');
      if (!job.publishId) {res.json({status: job.status, message: job.message || 'Submission has not been confirmed. Check TikTok before creating another post.'}); return;}
      const c = await connection(uid);
      if (c.openId !== job.openId) throw createHttpError(409, 'Reconnect the original TikTok account to check this post');
      const result = await queryTikTokPostStatus(c.accessToken, job.publishId);
      if (result.status === 'PUBLISH_COMPLETE') {
        const completedAt = new Date();
        await supabaseFallbackService.updateTikTokReviewedPost(String(req.params.id), {
          status: 'posted',
          postedAt: completedAt,
          targetDate: completedAt.toISOString().slice(0, 10),
        });
      } else {
        await supabaseFallbackService.updateTikTokReviewedPost(String(req.params.id), {status: result.status});
      }
      res.setHeader('Cache-Control', 'no-store'); res.json(result);
    } catch (e) {next(e);}
  });
}

function reviewedPublishMessage(error: unknown) {
  if (!(error instanceof TikTokProviderError)) {
    return 'TikTok did not confirm this submission. Check TikTok before retrying.';
  }
  if (error.stage === 'video_upload' && error.httpStatus === 403) {
    return 'TikTok rejected the video upload (HTTP 403). The upload destination may have expired; check TikTok before retrying this video.';
  }
  if (error.stage === 'video_init' && error.providerCode === 'spam_risk_too_many_pending_share') {
    return 'TikTok has reached its pending-share limit for this account. Wait for an earlier share to finish before submitting another video.';
  }
  if (error.stage === 'video_init' && error.providerCode === 'spam_risk_user_banned_from_posting') {
    return 'TikTok has temporarily restricted posting for this account. Check the account in TikTok before retrying.';
  }
  if (error.stage === 'video_init' && error.providerCode === 'spam_risk_too_many_posts') {
    return 'TikTok has reached the daily post limit for this account. Wait for the limit to reset before retrying.';
  }
  if (error.stage === 'video_init' && error.providerCode === 'reached_active_user_cap') {
    return 'TikTok has reached the active-user limit for this app. The app owner must raise the limit or complete TikTok review before retrying.';
  }
  if (error.stage === 'video_init' && error.providerCode === 'unaudited_client_can_only_post_to_private_accounts') {
    return 'TikTok blocked this post because the app is not audited for public-account posting. Make the connected TikTok account private for testing, or complete TikTok app review.';
  }
  if (error.stage === 'video_init' && error.providerCode === 'privacy_level_option_mismatch') {
    return 'TikTok rejected the selected privacy level. Refresh the creator settings and choose one of the options TikTok currently provides.';
  }
  if (error.stage === 'video_init' && error.httpStatus === 403) {
    return 'TikTok blocked video initialization (HTTP 403). Check that the connected account is private when the app is unaudited, and check TikTok daily limits or posting restrictions.';
  }
  if (error.httpStatus === 401 || error.providerCode === 'scope_not_authorized' || error.providerCode === 'access_token_invalid') {
    return 'TikTok rejected the connection credentials. Reconnect TikTok and grant video posting access before retrying.';
  }
  const code = error.providerCode ? `; code ${error.providerCode}` : '';
  return `TikTok rejected the ${error.stage.replace('_', ' ')} request${error.httpStatus ? ` (HTTP ${error.httpStatus}${code})` : code}. Check TikTok before retrying.`;
}
