import path from 'path';
import createHttpError from 'http-errors';
import multer from 'multer';
import { Router } from 'express';
import { requireFirebase, requireFirebaseStrict, type AuthedRequest } from '../middleware/firebaseAuth';
import { saveUploadedMediaBuffer } from '../services/generatedMediaService';
import { supabaseFallbackService } from '../services/supabaseFallbackService';
import { recoverGalleryImageUrls } from '../services/galleryRecovery';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 12,
    fileSize: 80 * 1024 * 1024,
  },
});

const imageMimeTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

const videoMimeTypes = new Set([
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-matroska',
]);

const inferMediaKind = (file: Express.Multer.File) => {
  if (imageMimeTypes.has(file.mimetype)) return 'images' as const;
  if (videoMimeTypes.has(file.mimetype)) return 'videos' as const;
  if (file.mimetype.startsWith('image/')) return 'images' as const;
  if (file.mimetype.startsWith('video/')) return 'videos' as const;
  return null;
};

router.get('/api/media/recover-gallery', requireFirebaseStrict, async (req, res, next) => {
  try {
    if (!supabaseFallbackService.isConfigured()) throw createHttpError(503, 'Gallery recovery is temporarily unavailable');
    const userId = (req as AuthedRequest).authUser!.uid;
    const posts = await supabaseFallbackService.getPostsByUser(userId, 1000);
    res.set('Cache-Control', 'no-store').json({ urls: recoverGalleryImageUrls(posts) });
  } catch (error) { next(error); }
});

router.post('/api/media/upload', requireFirebase, upload.array('files', 12), async (req, res, next) => {
  try {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (!files.length) {
      throw createHttpError(400, 'No files uploaded');
    }

    const uploaded = await Promise.all(
      files.map(async file => {
        const kind = inferMediaKind(file);
        if (!kind) {
          throw createHttpError(400, `Unsupported media type: ${file.mimetype || 'unknown'}`);
        }
        const extension =
          path.extname(file.originalname).replace(/^\./, '') ||
          (kind === 'images'
            ? file.mimetype.replace('image/', '')
            : file.mimetype.replace('video/', ''));
        const url = await saveUploadedMediaBuffer(file.buffer, kind, extension);
        return {
          name: file.originalname,
          url,
          kind: kind === 'images' ? 'image' : 'video',
          mimeType: file.mimetype,
          size: file.size,
        };
      }),
    );

    res.json({ files: uploaded });
  } catch (error) {
    next(error);
  }
});

export default router;
