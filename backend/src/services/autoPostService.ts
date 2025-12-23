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
      'Create a realistic, photo-style scene of the Dott Media AI Sales Bot interacting with people in a modern office; friendly humanoid robot assisting a diverse team, natural expressions, warm daylight, cinematic depth, subtle futuristic UI overlays, clean space reserved for a headline.';
    const runPrompt = `${basePrompt} ${this.uniqueDescriptor()}`;
    const businessType = job.businessType ?? 'AI CRM + automation agency';

    let generated: GeneratedContent;
    try {
      generated = await contentGenerationService.generateContent({ prompt: runPrompt, businessType, imageCount: 1 });
    } catch (error) {
      console.error('[autopost] generation failed', error);
      throw error;
    }

    const credentials = await this.resolveCredentials(userId);
    const results: PostResult[] = [];

    for (const platform of job.platforms ?? []) {
      const publisher = platformPublishers[platform] ?? publishToTwitter;
      const caption = this.captionForPlatform(platform, generated, runPrompt);
      const imageUrls = (generated.images?.length ? generated.images : [this.fallbackImageUrl()]).filter(Boolean);
      try {
        const response = await publisher({ caption, imageUrls, credentials });
        results.push({ platform, status: 'posted', remoteId: response?.remoteId ?? null });
      } catch (error) {
        results.push({ platform, status: 'failed', error: (error as Error).message });
      }
    }

    const nextRunDate = new Date();
    nextRunDate.setHours(nextRunDate.getHours() + intervalHours);

    await autopostCollection.doc(userId).set(
      {
        lastRunAt: admin.firestore.FieldValue.serverTimestamp(),
        lastResult: results,
        nextRun: admin.firestore.Timestamp.fromDate(nextRunDate),
        active: job.active !== false,
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

  private uniqueDescriptor() {
    const colors = ['electric blue', 'neon pink', 'mint', 'amber', 'violet', 'teal'];
    const motifs = [
      'holographic grids',
      'isometric dashboards',
      'abstract neon lines',
      'gradient liquid shapes',
      'floating UI cards',
      'soft glow lighting',
      '3D sales funnel icons',
      'CRM widgets hovering',
    ];
    const style = [
      'cinematic lighting',
      'studio shot',
      'futuristic minimal',
      'bold contrast',
      'clean tech aesthetic',
      'premium SaaS feel',
      'vibrant social-first look',
    ];
    const orientations = ['1:1 square', '4:5 portrait', '16:9 widescreen'];
    const color = colors[Math.floor(Math.random() * colors.length)];
    const motif = motifs[Math.floor(Math.random() * motifs.length)];
    const vibe = style[Math.floor(Math.random() * style.length)];
    const orientation = orientations[Math.floor(Math.random() * orientations.length)];
    return `Palette: ${color}. Visual: ${motif}. Style: ${vibe}. Orientation: ${orientation}. Ref ${Date.now()}.`;
  }
}

export const autoPostService = new AutoPostService();
