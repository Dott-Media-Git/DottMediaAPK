import path from 'path';
import createHttpError from 'http-errors';
import multer from 'multer';
import { Router } from 'express';
import { requireFirebase } from '../middleware/firebaseAuth.js';
import { saveUploadedMediaBuffer } from '../services/generatedMediaService.js';
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
const inferMediaKind = (file) => {
    if (imageMimeTypes.has(file.mimetype))
        return 'images';
    if (videoMimeTypes.has(file.mimetype))
        return 'videos';
    if (file.mimetype.startsWith('image/'))
        return 'images';
    if (file.mimetype.startsWith('video/'))
        return 'videos';
    return null;
};
router.post('/api/media/upload', requireFirebase, upload.array('files', 12), async (req, res, next) => {
    try {
        const files = req.files ?? [];
        if (!files.length) {
            throw createHttpError(400, 'No files uploaded');
        }
        const uploaded = await Promise.all(files.map(async (file) => {
            const kind = inferMediaKind(file);
            if (!kind) {
                throw createHttpError(400, `Unsupported media type: ${file.mimetype || 'unknown'}`);
            }
            const extension = path.extname(file.originalname).replace(/^\./, '') ||
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
        }));
        res.json({ files: uploaded });
    }
    catch (error) {
        next(error);
    }
});
export default router;
