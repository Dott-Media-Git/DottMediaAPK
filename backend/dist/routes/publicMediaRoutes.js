import express, { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { firestore } from '../db/firestore.js';
import { renderStoryImage } from '../services/storyImageService.js';
const router = Router();
const helpDir = process.env.HELP_DOCS_DIR?.trim() || './public/help';
if (helpDir) {
    const resolved = path.resolve(helpDir);
    if (fs.existsSync(resolved)) {
        router.use('/public/help', express.static(resolved));
        console.info(`[help] help docs directory enabled (${resolved}).`);
    }
    else {
        console.warn(`[help] help docs directory not found (${resolved}).`);
    }
}
router.get('/public/media/health', (_req, res) => {
    res.json({ ok: true });
});
router.get('/public/fallback-images/manifest', (_req, res) => {
    const fallbackDir = process.env.AUTOPOST_FALLBACK_DIR?.trim();
    if (!fallbackDir) {
        res.status(404).json({ ok: false, error: 'AUTOPOST_FALLBACK_DIR not set.' });
        return;
    }
    const resolved = path.resolve(fallbackDir);
    if (!fs.existsSync(resolved)) {
        res.status(404).json({ ok: false, error: 'Fallback image directory not found.', dir: resolved });
        return;
    }
    const files = fs
        .readdirSync(resolved, { withFileTypes: true })
        .filter(entry => entry.isFile())
        .map(entry => entry.name)
        .filter(name => /\.(png|jpe?g|webp|gif)$/i.test(name));
    res.json({ ok: true, count: files.length, files });
});
router.get('/public/fallback-videos/manifest', (_req, res) => {
    const fallbackDir = process.env.AUTOPOST_FALLBACK_VIDEO_DIR?.trim() || './public/fallback-videos';
    if (!fallbackDir) {
        res.status(404).json({ ok: false, error: 'AUTOPOST_FALLBACK_VIDEO_DIR not set.' });
        return;
    }
    const resolved = path.resolve(fallbackDir);
    if (!fs.existsSync(resolved)) {
        res.status(404).json({ ok: false, error: 'Fallback video directory not found.', dir: resolved });
        return;
    }
    const files = fs
        .readdirSync(resolved, { withFileTypes: true })
        .filter(entry => entry.isFile())
        .map(entry => entry.name)
        .filter(name => /\.(mp4|mov|m4v|webm|avi|mkv)$/i.test(name));
    res.json({ ok: true, count: files.length, files });
});
router.get('/public/story-image/:id', async (req, res) => {
    const rawId = req.params.id ?? '';
    const id = rawId.replace(/\.png$/i, '').trim();
    if (!id) {
        res.status(400).json({ ok: false, error: 'Missing story image id.' });
        return;
    }
    try {
        const doc = await firestore.collection('storyImageDrafts').doc(id).get();
        if (!doc.exists) {
            res.status(404).json({ ok: false, error: 'Story image not found.' });
            return;
        }
        const data = doc.data();
        const buffer = await renderStoryImage({
            headline: data?.headline ?? 'AI update',
            summary: data?.summary ?? '',
            source: data?.source ?? '',
            imageUrl: data?.imageUrl ?? '',
        });
        res.set({
            'Content-Type': 'image/png',
            'Cache-Control': 'public, max-age=3600',
        });
        res.end(buffer);
    }
    catch (error) {
        console.error('[story-image] failed to render', error);
        res.status(500).json({ ok: false, error: 'Failed to render story image.' });
    }
});
export default router;
