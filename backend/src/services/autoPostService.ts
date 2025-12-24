import admin from 'firebase-admin';
import { firestore } from '../db/firestore.js';
import { config } from '../config.js';
import { contentGenerationService, GeneratedContent } from '../packages/services/contentGenerationService.js';
import { SocialAccounts } from '../packages/services/socialPostingService.js';
import { publishToInstagram } from '../packages/services/socialPlatforms/instagramPublisher.js';
import { publishToFacebook } from '../packages/services/socialPlatforms/facebookPublisher.js';
import { publishToLinkedIn } from '../packages/services/socialPlatforms/linkedinPublisher.js';
import { publishToTwitter } from '../packages/services/socialPlatforms/twitterPublisher.js';

type AutoPostJob = {
  userId: string;
  platforms: string[];
  prompt?: string;
  businessType?: string;
  intervalHours?: number;
  nextRun?: admin.firestore.Timestamp;
  lastRunAt?: admin.firestore.Timestamp;
  active?: boolean;
  recentImageUrls?: string[];
};

type PostResult = { platform: string; status: 'posted' | 'failed'; remoteId?: string | null; error?: string };

const autopostCollection = firestore.collection('autopostJobs');

const platformPublishers: Record<string, (input: { caption: string; imageUrls: string[]; credentials?: SocialAccounts }) => Promise<{ remoteId?: string }>> =
  {
    instagram: publishToInstagram,
    threads: publishToInstagram,
    tiktok: publishToInstagram,
    facebook: publishToFacebook,
    linkedin: publishToLinkedIn,
    twitter: publishToTwitter,
    x: publishToTwitter,
  };

export class AutoPostService {
  private memoryStore = new Map<string, AutoPostJob>();
  private useMemory = config.security.allowMockAuth;
  // Post every 3 hours by default; override with AUTOPOST_INTERVAL_MINUTES for tighter testing windows.
  private defaultIntervalHours = Math.max(Number(process.env.AUTOPOST_INTERVAL_MINUTES ?? 180) / 60, 0.05);
  private fallbackImageBase =
    'https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&w=1200&q=80';
  private fallbackImagePool = [
    'https://images.unsplash.com/photo-1521737604893-d14cc237f11d?auto=format&fit=crop&w=1200&q=80',
    'https://images.unsplash.com/photo-1525182008055-f88b95ff7980?auto=format&fit=crop&w=1200&q=80',
    'https://images.unsplash.com/photo-1485217988980-11786ced9454?auto=format&fit=crop&w=1200&q=80',
    'https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&w=1200&q=80',
    'https://images.unsplash.com/photo-1521737604893-c6c1b7af0515?auto=format&fit=crop&w=1200&q=80',
    'https://images.unsplash.com/photo-1529333166437-7750a6dd5a70?auto=format&fit=crop&w=1200&q=80',
  ];

  async start(payload: { userId: string; platforms?: string[]; prompt?: string; businessType?: string }) {
    const platforms = payload.platforms?.length ? payload.platforms : ['instagram', 'facebook', 'linkedin'];
    const now = new Date();
    await autopostCollection.doc(payload.userId).set(
      {
        userId: payload.userId,
        platforms,
        ...(payload.prompt ? { prompt: payload.prompt } : {}),
        ...(payload.businessType ? { businessType: payload.businessType } : {}),
        intervalHours: this.defaultIntervalHours,
        nextRun: admin.firestore.Timestamp.fromDate(now),
        active: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    if (this.useMemory) {
      this.memoryStore.set(payload.userId, {
        userId: payload.userId,
        platforms,
        prompt: payload.prompt ?? undefined,
        businessType: payload.businessType ?? undefined,
        intervalHours: this.defaultIntervalHours,
        nextRun: admin.firestore.Timestamp.fromDate(now),
        active: true,
      });
    }
    return this.runForUser(payload.userId);
  }

  async runDueJobs() {
    const now = admin.firestore.Timestamp.now();
    if (this.useMemory) {
      const due = Array.from(this.memoryStore.entries()).filter(
        ([, job]) => job.active !== false && job.nextRun && job.nextRun.toMillis() <= now.toMillis(),
      );
      let processed = 0;
      const results: Array<{ userId: string; posted: number; failed: number; nextRun?: string }> = [];
      for (const [userId, job] of due) {
        const outcome = await this.executeJob(userId, job);
        processed += 1;
        results.push({ userId, posted: outcome.posted, failed: outcome.failed.length, nextRun: outcome.nextRun });
      }
      return { processed, results };
    }

    // Query only by nextRun to avoid composite index requirement, then filter active in memory.
    const snap = await autopostCollection.where('nextRun', '<=', now).get();
    if (snap.empty) return { processed: 0 };
    let processed = 0;
    const results: Array<{ userId: string; posted: number; failed: number; nextRun?: string }> = [];
    for (const doc of snap.docs) {
      const data = doc.data() as AutoPostJob;
      if (data.active === false) continue;
      const outcome = await this.executeJob(doc.id, data);
      processed += 1;
      results.push({ userId: doc.id, posted: outcome.posted, failed: outcome.failed.length, nextRun: outcome.nextRun });
    }
    return { processed, results };
  }

  async runForUser(userId: string) {
    if (this.useMemory && this.memoryStore.has(userId)) {
      return this.executeJob(userId, this.memoryStore.get(userId)!);
    }
    const snap = await autopostCollection.doc(userId).get();
    if (!snap.exists) {
      return { posted: 0, failed: [{ platform: 'all', error: 'autopost_not_configured', status: 'failed' as const }], nextRun: null };
    }
    return this.executeJob(userId, snap.data() as AutoPostJob);
  }

  private async executeJob(userId: string, job: AutoPostJob) {
    const intervalHours = job.intervalHours && job.intervalHours > 0 ? job.intervalHours : this.defaultIntervalHours;
    const basePrompt =
      job.prompt ??
      'Create a realistic, photo-style scene of the Dott Media AI Sales Bot interacting with people in an executive suite; friendly humanoid robot wearing a tie and glasses, assisting a diverse team, natural expressions, premium interior finishes, cinematic depth, subtle futuristic UI overlays, clean space reserved for a headline.';
    let runPrompt = this.buildVisualPrompt(basePrompt);
    const businessType = job.businessType ?? 'AI CRM + automation agency';
    const recentImages = this.getRecentImageHistory(job);
    const recentSet = new Set(recentImages);
    const maxImageAttempts = Math.max(Number(process.env.AUTOPOST_IMAGE_ATTEMPTS ?? 3), 1);

    let generated: GeneratedContent | null = null;
    let generationError: Error | null = null;
    for (let attempt = 0; attempt < maxImageAttempts; attempt += 1) {
      try {
        generated = await contentGenerationService.generateContent({ prompt: runPrompt, businessType, imageCount: 1 });
        generationError = null;
      } catch (error) {
        generationError = error as Error;
        console.error('[autopost] generation failed', error);
      }
      const fresh = this.selectFreshImages(generated?.images ?? [], recentSet);
      if (fresh.length) {
        generated.images = fresh;
        break;
      }
      runPrompt = this.buildVisualPrompt(basePrompt);
    }
    if (!generated) {
      if (generationError) {
        console.warn('[autopost] using fallback content after generation failures');
      }
      generated = {
        images: [],
        caption_instagram: '',
        caption_linkedin: '',
        caption_x: '',
        hashtags_instagram: '',
        hashtags_generic: '',
      };
    }

    const credentials = await this.resolveCredentials(userId);
    const results: PostResult[] = [];
    const finalGenerated = generated;
    const imageUrls = this.resolveImageUrls(finalGenerated.images ?? [], recentSet);

    for (const platform of job.platforms ?? []) {
      const publisher = platformPublishers[platform] ?? publishToTwitter;
      const caption = this.captionForPlatform(platform, finalGenerated, runPrompt);
      try {
        const response = await publisher({ caption, imageUrls, credentials });
        results.push({ platform, status: 'posted', remoteId: response?.remoteId ?? null });
      } catch (error) {
        results.push({ platform, status: 'failed', error: (error as Error).message });
      }
    }

    const nextRunDate = new Date();
    nextRunDate.setHours(nextRunDate.getHours() + intervalHours);
    const nextRecentImages = this.mergeRecentImages(recentImages, imageUrls);

    await autopostCollection.doc(userId).set(
      {
        lastRunAt: admin.firestore.FieldValue.serverTimestamp(),
        lastResult: results,
        nextRun: admin.firestore.Timestamp.fromDate(nextRunDate),
        active: job.active !== false,
        recentImageUrls: nextRecentImages,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    if (this.useMemory) {
      this.memoryStore.set(userId, {
        ...job,
        lastRunAt: admin.firestore.Timestamp.now(),
        nextRun: admin.firestore.Timestamp.fromDate(nextRunDate),
        active: job.active !== false,
        recentImageUrls: nextRecentImages,
      });
    }

    return {
      posted: results.filter(result => result.status === 'posted').length,
      failed: results.filter(result => result.status === 'failed'),
      nextRun: nextRunDate.toISOString(),
    };
  }

  private async resolveCredentials(userId: string): Promise<SocialAccounts> {
    const defaults = this.defaultSocialAccounts();
    const userDoc = await firestore.collection('users').doc(userId).get();
    const userAccounts = (userDoc.data()?.socialAccounts as SocialAccounts | undefined) ?? {};
    return { ...defaults, ...userAccounts };
  }

  private defaultSocialAccounts(): SocialAccounts {
    const defaults: SocialAccounts = {};
    if (config.channels.facebook.pageId && config.channels.facebook.pageToken) {
      defaults.facebook = { accessToken: config.channels.facebook.pageToken, pageId: config.channels.facebook.pageId };
    }
    if (config.channels.instagram.businessId && config.channels.instagram.accessToken) {
      defaults.instagram = { accessToken: config.channels.instagram.accessToken, accountId: config.channels.instagram.businessId };
    }
    if (config.linkedin.accessToken && config.linkedin.organizationId) {
      defaults.linkedin = {
        accessToken: config.linkedin.accessToken,
        urn: `urn:li:organization:${config.linkedin.organizationId}`,
      };
    }
    return defaults;
  }

  private captionForPlatform(platform: string, content: GeneratedContent, fallbackPrompt: string) {
    const captions: Record<string, string> = {
      instagram: [content.caption_instagram, content.hashtags_instagram].filter(Boolean).join('\n\n'),
      threads: [content.caption_instagram, content.hashtags_instagram].filter(Boolean).join('\n\n'),
      tiktok: [content.caption_instagram, content.hashtags_instagram].filter(Boolean).join('\n\n'),
      facebook: [content.caption_linkedin, content.hashtags_generic].filter(Boolean).join('\n\n'),
      linkedin: [content.caption_linkedin, content.hashtags_generic].filter(Boolean).join('\n\n'),
      twitter: [content.caption_x, content.hashtags_generic].filter(Boolean).join(' '),
      x: [content.caption_x, content.hashtags_generic].filter(Boolean).join(' '),
    };
    const chosen = captions[platform] ?? content.caption_linkedin ?? content.caption_instagram;
    return chosen?.trim() || `${fallbackPrompt} #ai #automation`;
  }

  private fallbackImageUrl() {
    // Ensure a fresh image URL each run to avoid caching
    return `${this.fallbackImageBase}&t=${Date.now()}`;
  }

  private getRecentImageHistory(job: AutoPostJob): string[] {
    if (!Array.isArray(job.recentImageUrls)) return [];
    return job.recentImageUrls.filter(Boolean);
  }

  private selectFreshImages(images: string[], recent: Set<string>) {
    return images.filter(url => url && !recent.has(url));
  }

  private resolveImageUrls(images: string[], recent: Set<string>) {
    const fresh = this.selectFreshImages(images, recent);
    if (fresh.length) return fresh;
    const fallback = this.pickFallbackImage(recent);
    return fallback ? [fallback] : images;
  }

  private mergeRecentImages(existing: string[], used: string[]) {
    const maxHistory = Math.max(Number(process.env.AUTOPOST_IMAGE_HISTORY ?? 12), 3);
    const next = [...used, ...existing].filter(Boolean);
    const seen = new Set<string>();
    const unique = next.filter(url => {
      if (seen.has(url)) return false;
      seen.add(url);
      return true;
    });
    return unique.slice(0, maxHistory);
  }

  private pickFallbackImage(recent: Set<string>) {
    const pool = this.fallbackImagePool.filter(url => !recent.has(url));
    const pickFrom = pool.length ? pool : this.fallbackImagePool;
    if (!pickFrom.length) return this.fallbackImageUrl();
    const chosen = pickFrom[Math.floor(Math.random() * pickFrom.length)];
    return `${chosen}&t=${Date.now()}`;
  }

  private buildVisualPrompt(basePrompt: string) {
    const sceneContext = this.getSceneContext();
    const scenes = [
      'strategy session in a high-rise executive suite',
      'client consultation in a private boardroom suite',
      'robot guiding a product demo in a premium sales suite',
      'team huddle around a glass table in a skyline suite',
      'customer success check-in in a luxury meeting suite',
      'robot assisting a marketer in a modern executive suite',
      'lead pipeline review in a glass-walled suite',
      'sales standup in a refined conference suite',
    ];
    const interactions = [
      'robot pointing at a funnel chart while people discuss',
      'robot handing a tablet to a team member',
      'robot and human shaking hands in agreement',
      'robot highlighting insights on a floating UI panel',
      'robot taking notes while the team presents',
      'robot collaborating on a shared screen',
      'robot guiding a live demo with subtle gestures',
      'robot and team reviewing KPIs together',
    ];
    const settings = [
      'executive suite with city skyline windows',
      'luxury boardroom with soft daylight',
      'premium client suite with warm neutral tones',
      'glass-walled executive lounge with refined decor',
      'high-end conference suite with minimal accents',
      'private strategy suite with modern finishes',
      'suite-style meeting space with soft seating',
    ];
    const compositions = [
      'wide establishing shot',
      'eye-level candid shot',
      'over-the-shoulder view toward the screen',
      'three-quarter angle with depth of field',
      'medium shot focused on faces and gestures',
      'close-up on the robot and one collaborator',
    ];
    const lighting = [
      'morning sunlight with soft shadows',
      'golden hour glow',
      'diffused daylight, clean and natural',
      'soft studio lighting with gentle highlights',
      'cool daylight balanced with warm accents',
    ];
    const palettes = [
      'warm neutrals with teal accents',
      'soft gray with amber highlights',
      'clean white with cobalt blue accents',
      'muted charcoal with mint highlights',
      'light sand tones with subtle navy',
    ];
    const details = [
      'subtle holographic UI overlays',
      'minimalistic charts on screens',
      'clean glass surfaces with reflections',
      'calm, confident expressions',
      'tidy workspace with notebooks and coffee',
      'modern devices and a sleek tablet',
      'robot dressed with a tie and glasses',
    ];
    const pick = (items: string[]) => items[Math.floor(Math.random() * items.length)];
    const ref = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    return `${basePrompt} Context: ${sceneContext}. Scene: ${pick(scenes)}. Interaction: ${pick(interactions)}. Setting: ${pick(settings)}. Composition: ${pick(
      compositions,
    )}. Lighting: ${pick(lighting)}. Palette: ${pick(palettes)}. Details: ${pick(details)}. Ref ${ref}.`;
  }

  private getSceneContext() {
    const raw = process.env.AUTOPOST_SCENE_CONTEXT?.trim();
    return raw && raw.length > 0 ? raw : 'executive suite';
  }
}

export const autoPostService = new AutoPostService();
