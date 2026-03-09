import { Router } from 'express';
import { incrementWebTrafficAnalytics } from '../services/analyticsService';

const router = Router();

const bwinBetTargetUrl = 'https://bwinbetug.com';
const bwinInfoTargetUrl = 'https://www.bwinbetug.info';

const normalizeTrafficSource = (value?: string) => {
  const raw = (value ?? '').trim().toLowerCase();
  if (!raw) return 'web';
  if (raw.includes('instagram') || raw === 'ig') return 'instagram';
  if (raw.includes('facebook') || raw === 'fb') return 'facebook';
  if (raw.includes('threads')) return 'threads';
  if (raw.includes('twitter') || raw === 'x' || raw.includes('x.com') || raw.includes('t.co')) return 'x';
  if (raw.includes('linkedin')) return 'linkedin';
  if (raw.includes('tiktok') || raw.includes('tik tok')) return 'tiktok';
  if (raw.includes('youtube') || raw.includes('youtu.be')) return 'youtube';
  if (raw.includes('whatsapp') || raw.includes('wa.me')) return 'whatsapp';
  if (raw.includes('web') || raw.includes('direct')) return 'web';
  return 'other';
};

const normalizeTrafficPlacement = (value?: string) => {
  const raw = (value ?? '').trim().toLowerCase();
  if (!raw) return 'other';
  if (raw.includes('bio') || raw.includes('profile')) return 'bio';
  if (raw.includes('story')) return 'story';
  if (raw.includes('reel')) return 'reel';
  if (raw.includes('dm') || raw.includes('message')) return 'dm';
  if (raw.includes('comment')) return 'comment';
  if (raw.includes('web') || raw.includes('site') || raw.includes('page')) return 'website';
  if (raw.includes('post') || raw.includes('caption')) return 'post';
  return 'other';
};

router.get('/r/bwin', async (req, res) => {
  const ownerId = typeof req.query.ownerId === 'string' ? req.query.ownerId.trim() : '';
  const scopeId = typeof req.query.scopeId === 'string' ? req.query.scopeId.trim() : '';
  const source = normalizeTrafficSource(typeof req.query.source === 'string' ? req.query.source : 'social');
  const placement = normalizeTrafficPlacement(typeof req.query.placement === 'string' ? req.query.placement : 'post');

  try {
    if (ownerId || scopeId) {
      await incrementWebTrafficAnalytics(
        {
          redirectClicks: 1,
          source,
          placement,
        },
        { scopeId: scopeId || undefined, userId: ownerId || undefined },
      );
    }
  } catch (error) {
    console.warn('[redirect] failed to record bwin bet click', error);
  }

  res.set('Cache-Control', 'no-store, max-age=0');
  res.redirect(302, bwinBetTargetUrl);
});

router.get('/r/bwin-info', (req, res) => {
  const source = normalizeTrafficSource(typeof req.query.source === 'string' ? req.query.source : 'social');
  const placement = normalizeTrafficPlacement(typeof req.query.placement === 'string' ? req.query.placement : 'post');
  const params = new URLSearchParams();
  params.set('utm_source', source);
  params.set('utm_medium', placement === 'bio' ? 'social_bio' : 'social_post');
  params.set('utm_campaign', 'bwinbetug');
  params.set('utm_content', placement);

  res.set('Cache-Control', 'no-store, max-age=0');
  res.redirect(302, `${bwinInfoTargetUrl}/?${params.toString()}`);
});

export default router;
