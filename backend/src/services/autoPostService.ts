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
  fallbackCaption?: string;
  fallbackHashtags?: string;
  recentCaptions?: string[];
  requireAiImages?: boolean;
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
    'https://images.unsplash.com/photo-1504384308090-c894fdcc538d?ixlib=rb-4.0.3&auto=format&fit=crop&w=1200&q=80';
  private fallbackImagePool = [
    'https://images.unsplash.com/photo-1504384308090-c894fdcc538d?ixlib=rb-4.0.3&auto=format&fit=crop&w=1200&q=80',
    'https://images.unsplash.com/photo-1521737604893-d14cc237f11d?ixlib=rb-4.0.3&auto=format&fit=crop&w=1200&q=80',
    'https://images.unsplash.com/photo-1525182008055-f88b95ff7980?ixlib=rb-4.0.3&auto=format&fit=crop&w=1200&q=80',
    'https://images.unsplash.com/photo-1485217988980-11786ced9454?ixlib=rb-4.0.3&auto=format&fit=crop&w=1200&q=80',
    'https://images.unsplash.com/photo-1529333166437-7750a6dd5a70?ixlib=rb-4.0.3&auto=format&fit=crop&w=1200&q=80',
  ];
  private defaultFallbackCaption =
    'Meet the Dott Media AI Sales Bot helping businesses convert leads into customers. Want a quick demo? DM us to get started.';
  private defaultFallbackHashtags =
    'DottMedia, AISalesBot, SalesAutomation, LeadGeneration, BusinessGrowth, CRM, MarketingAutomation, SalesPipeline, CustomerSuccess, AI, Automation, SmallBusiness, DigitalMarketing, B2B, Productivity';
  private fallbackCaptionVariants = [
    'DM us for a quick demo.',
    'Book a 15-minute walkthrough.',
    'Want the demo link? Send a message.',
    "Ready to grow? Let's talk.",
    'Ask for a quick demo today.',
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
    const styledPrompt = this.applyNeonPreference(basePrompt);
    let runPrompt = this.buildVisualPrompt(styledPrompt);
    const businessType = job.businessType ?? 'AI CRM + automation agency';
    const recentImages = this.getRecentImageHistory(job);
    const recentSet = new Set(recentImages);
    const requireAiImages = this.requireAiImages(job);
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
      if (fresh.length && generated) {
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
    const imageUrls = this.resolveImageUrls(finalGenerated.images ?? [], recentSet, requireAiImages);
    const fallbackCopy = this.buildFallbackCopy(job);
    const recentCaptions = this.getRecentCaptionHistory(job);
    const captionHistory = new Set(recentCaptions);
    const usedCaptions: string[] = [];

    if (requireAiImages && imageUrls.length === 0) {
      const nextRunDate = new Date();
      nextRunDate.setHours(nextRunDate.getHours() + intervalHours);
      const failed = (job.platforms ?? []).map(platform => ({
        platform,
        status: 'failed' as const,
        error: 'ai_image_generation_failed',
      }));
      await autopostCollection.doc(userId).set(
        {
          lastRunAt: admin.firestore.FieldValue.serverTimestamp(),
          lastResult: failed,
          nextRun: admin.firestore.Timestamp.fromDate(nextRunDate),
          active: job.active !== false,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      return {
        posted: 0,
        failed,
        nextRun: nextRunDate.toISOString(),
      };
    }

    for (const platform of job.platforms ?? []) {
      const publisher = platformPublishers[platform] ?? publishToTwitter;
      const rawCaption = this.captionForPlatform(platform, finalGenerated, fallbackCopy);
      const { caption, signature } = this.ensureCaptionVariety(platform, rawCaption, captionHistory);
      try {
        const response = await publisher({ caption, imageUrls, credentials });
        results.push({ platform, status: 'posted', remoteId: response?.remoteId ?? null });
        usedCaptions.push(signature);
        captionHistory.add(signature);
      } catch (error) {
        results.push({ platform, status: 'failed', error: (error as Error).message });
      }
    }

    const nextRunDate = new Date();
    nextRunDate.setHours(nextRunDate.getHours() + intervalHours);
    const nextRecentImages = this.mergeRecentImages(recentImages, imageUrls);
    const nextRecentCaptions = this.mergeRecentCaptions(recentCaptions, usedCaptions);

    await autopostCollection.doc(userId).set(
      {
        lastRunAt: admin.firestore.FieldValue.serverTimestamp(),
        lastResult: results,
        nextRun: admin.firestore.Timestamp.fromDate(nextRunDate),
        active: job.active !== false,
        recentImageUrls: nextRecentImages,
        recentCaptions: nextRecentCaptions,
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
        recentCaptions: nextRecentCaptions,
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

  private captionForPlatform(
    platform: string,
    content: GeneratedContent,
    fallbackCopy: { caption: string; hashtags: string },
  ) {
    const captions: Record<string, string> = {
      instagram: content.caption_instagram,
      threads: content.caption_instagram,
      tiktok: content.caption_instagram,
      facebook: content.caption_linkedin,
      linkedin: content.caption_linkedin,
      twitter: content.caption_x,
      x: content.caption_x,
    };
    const chosen = (captions[platform] ?? content.caption_linkedin ?? content.caption_instagram ?? '').trim();
    const fallbackCaption = fallbackCopy.caption.trim();
    const caption = chosen.length ? chosen : fallbackCaption;
    const hasHashtags = /#[A-Za-z0-9_]+/.test(caption);
    const sourceHashtags =
      platform === 'instagram' || platform === 'threads' || platform === 'tiktok'
        ? content.hashtags_instagram
        : content.hashtags_generic;
    const hashtags = hasHashtags ? '' : this.formatHashtags(sourceHashtags ?? fallbackCopy.hashtags);
    if (platform === 'twitter' || platform === 'x') {
      return [caption, hashtags].filter(Boolean).join(' ');
    }
    return [caption, hashtags].filter(Boolean).join('\n\n');
  }

  private buildFallbackCopy(job: AutoPostJob) {
    const caption = job.fallbackCaption?.trim() || this.defaultFallbackCaption;
    const hashtags = job.fallbackHashtags?.trim() || this.defaultFallbackHashtags;
    return { caption, hashtags };
  }

  private formatHashtags(raw?: string) {
    if (!raw) return '';
    const tokens = raw
      .split(/[,\\n]/g)
      .map(token => token.trim())
      .filter(Boolean)
      .flatMap(token => token.split(/\\s+/).filter(Boolean))
      .map(token => token.replace(/^#+/, '').replace(/[^A-Za-z0-9_]/g, ''))
      .filter(Boolean);
    if (!tokens.length) return '';
    const seen = new Set<string>();
    const unique = tokens.filter(token => {
      const key = token.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return unique.slice(0, 25).map(token => `#${token}`).join(' ');
  }

  private fallbackImageUrl() {
    // Ensure a fresh image URL each run to avoid caching
    return `${this.fallbackImageBase}&t=${Date.now()}`;
  }

  private getRecentImageHistory(job: AutoPostJob): string[] {
    if (!Array.isArray(job.recentImageUrls)) return [];
    return job.recentImageUrls.filter(Boolean);
  }

  private getRecentCaptionHistory(job: AutoPostJob): string[] {
    if (!Array.isArray(job.recentCaptions)) return [];
    return job.recentCaptions.filter(Boolean);
  }

  private selectFreshImages(images: string[], recent: Set<string>) {
    return images.filter(url => url && !recent.has(url));
  }

  private resolveImageUrls(images: string[], recent: Set<string>, requireAiImages: boolean) {
    const fresh = this.selectFreshImages(images, recent);
    if (fresh.length) return fresh;
    if (requireAiImages) return [];
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

  private mergeRecentCaptions(existing: string[], used: string[]) {
    const maxHistory = Math.max(Number(process.env.AUTOPOST_CAPTION_HISTORY ?? 12), 3);
    const next = [...used, ...existing].filter(Boolean);
    const seen = new Set<string>();
    const unique = next.filter(value => {
      if (seen.has(value)) return false;
      seen.add(value);
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
    const style = this.getVisualStyle(basePrompt);
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
    const neonLighting = [
      'neon glow with high-contrast shadows',
      'magenta and cyan rim lighting',
      'futuristic neon ambience with light haze',
      'vivid neon highlights with soft bloom',
    ];
    const neonPalettes = [
      'magenta and cyan neon with deep charcoal',
      'electric blue and pink neon accents',
      'neon teal and violet against dark glass',
      'high-contrast neon gradients with glossy blacks',
    ];
    const neonDetails = [
      'glowing holographic UI overlays',
      'neon edge lighting on glass surfaces',
      'reflective floors with neon streaks',
      'futuristic neon signage accents',
      'robot dressed with a tie and glasses',
    ];
    const subtleNeonLighting = [
      'soft ambient glow with minimal neon highlights',
      'gentle neon rim lighting with balanced shadows',
      'subtle neon accents with clean studio lighting',
      'light haze with restrained neon bloom',
    ];
    const subtleNeonPalettes = [
      'neutral tones with faint cyan accents',
      'soft charcoal with muted neon teal',
      'warm neutrals with minimal magenta glow',
      'clean white with subtle neon edge lighting',
    ];
    const subtleNeonDetails = [
      'light holographic UI overlays',
      'subtle neon accents on glass edges',
      'soft reflections with minimal neon streaks',
      'restrained neon signage accents',
      'robot dressed with a tie and glasses',
    ];
    const pick = (items: string[]) => items[Math.floor(Math.random() * items.length)];
    const pickLighting =
      style === 'neon'
        ? pick(neonLighting)
        : style === 'neon-subtle'
          ? pick(subtleNeonLighting)
          : pick(lighting);
    const pickPalette =
      style === 'neon'
        ? pick(neonPalettes)
        : style === 'neon-subtle'
          ? pick(subtleNeonPalettes)
          : pick(palettes);
    const pickDetail =
      style === 'neon'
        ? pick(neonDetails)
        : style === 'neon-subtle'
          ? pick(subtleNeonDetails)
          : pick(details);
    const ref = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    return `${basePrompt} Context: ${sceneContext}. Scene: ${pick(scenes)}. Interaction: ${pick(interactions)}. Setting: ${pick(settings)}. Composition: ${pick(
      compositions,
    )}. Lighting: ${pickLighting}. Palette: ${pickPalette}. Details: ${pickDetail}. Ref ${ref}.`;
  }

  private getSceneContext() {
    const raw = process.env.AUTOPOST_SCENE_CONTEXT?.trim();
    return raw && raw.length > 0 ? raw : 'executive suite';
  }

  private applyNeonPreference(basePrompt: string) {
    const forceNeon = (process.env.AUTOPOST_FORCE_NEON ?? 'true').toLowerCase() !== 'false';
    if (!forceNeon) return basePrompt;
    const lower = basePrompt.toLowerCase();
    if (lower.includes('neon') || lower.includes('cyberpunk')) {
      return basePrompt;
    }
    return `${basePrompt} Neon lighting with magenta and cyan accents, futuristic glow, glossy reflections.`;
  }

  private getVisualStyle(basePrompt: string) {
    const lower = basePrompt.toLowerCase();
    if (lower.includes('subtle neon') || lower.includes('minimal neon') || lower.includes('soft neon')) {
      return 'neon-subtle';
    }
    return lower.includes('neon') || lower.includes('cyberpunk') ? 'neon' : 'default';
  }

  private requireAiImages(job: AutoPostJob) {
    if (typeof job.requireAiImages === 'boolean') return job.requireAiImages;
    const flag = process.env.AUTOPOST_REQUIRE_AI_IMAGES?.toLowerCase();
    if (flag === 'false') return false;
    return true;
  }

  private ensureCaptionVariety(platform: string, caption: string, history: Set<string>) {
    const signature = this.buildCaptionSignature(platform, caption);
    if (!history.has(signature)) {
      return { caption, signature };
    }
    for (const variant of this.fallbackCaptionVariants) {
      const candidate = this.appendCaptionSuffix(caption, variant, platform);
      const candidateSignature = this.buildCaptionSignature(platform, candidate);
      if (!history.has(candidateSignature)) {
        return { caption: candidate, signature: candidateSignature };
      }
    }
    return { caption, signature };
  }

  private appendCaptionSuffix(caption: string, suffix: string, platform: string) {
    const joiner = platform === 'twitter' || platform === 'x' ? ' ' : '\n\n';
    const hashtagMatch = caption.match(/\s(#[A-Za-z0-9_]+)/);
    if (!hashtagMatch || hashtagMatch.index === undefined) {
      return `${caption}${joiner}${suffix}`.trim();
    }
    const idx = hashtagMatch.index;
    if (idx <= 0) {
      return `${caption}${joiner}${suffix}`.trim();
    }
    const head = caption.slice(0, idx).trim();
    const tail = caption.slice(idx).trim();
    return [head, suffix, tail].filter(Boolean).join(joiner).trim();
  }

  private buildCaptionSignature(platform: string, caption: string) {
    const normalized = caption.toLowerCase().replace(/\s+/g, ' ').trim();
    return `${platform}:${normalized}`;
  }
}

export const autoPostService = new AutoPostService();
