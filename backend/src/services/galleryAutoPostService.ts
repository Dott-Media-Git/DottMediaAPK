import { randomUUID } from 'node:crypto';
import { z } from 'zod';

export const galleryPlatforms = ['facebook', 'instagram', 'threads', 'linkedin', 'twitter', 'youtube', 'tiktok'] as const;
export type GalleryPlatform = typeof galleryPlatforms[number];
export const galleryAutoPostSchema = z.object({
  intervalHours: z.number().finite().min(1).max(24),
  assets: z.array(z.object({
    id: z.string().min(1).max(200),
    url: z.string().url().max(2048).refine(value => value.startsWith('https://'), 'Media must use HTTPS'),
    kind: z.enum(['image', 'video']),
    name: z.string().max(300).default(''),
  })).min(1, 'Add content to your gallery first.').max(200),
  platforms: z.array(z.enum(galleryPlatforms)).min(1).max(7),
  caption: z.string().max(2200).default(''),
}).superRefine((value, ctx) => {
  if (new Set(value.assets.map(asset => asset.id)).size !== value.assets.length ||
      new Set(value.assets.map(asset => asset.url)).size !== value.assets.length) {
    ctx.addIssue({ code: 'custom', message: 'The gallery contains duplicate items.', path: ['assets'] });
  }
  if (value.assets.some(asset => !compatiblePlatforms(asset.kind, value.platforms).length)) {
    ctx.addIssue({ code: 'custom', message: 'Select an account that supports photos as well as videos.', path: ['platforms'] });
  }
});
export type GalleryInput = z.infer<typeof galleryAutoPostSchema>;
export type GalleryAsset = GalleryInput['assets'][number];
export type GalleryResult = { platform: string; status: 'posted' | 'failed'; remoteId?: string | null; error?: string };
export type GalleryJob = GalleryInput & {
  userId: string;
  generation: string;
  active: boolean;
  cursor: number;
  cycles: number;
  nextRunAt: number | null;
  runToken: string | null;
  runStartedAt: number | null;
  lastRunAt: number | null;
  lastResults: GalleryResult[];
  error: string | null;
};
export interface GalleryStore {
  get(userId: string): Promise<GalleryJob | null>;
  // The callback must be synchronous and free of side effects: transactions may retry it.
  update(userId: string, change: (job: GalleryJob | null) => GalleryJob | null): Promise<GalleryJob | null>;
  due(now: number): Promise<string[]>;
}
export function compatiblePlatforms(kind: GalleryAsset['kind'], platforms: GalleryPlatform[]) {
  return [...new Set(platforms)].filter(platform => kind === 'video' || !['youtube', 'tiktok'].includes(platform));
}
type Dependencies = {
  store: GalleryStore;
  connected: (userId: string) => Promise<GalleryPlatform[]>;
  publish: (userId: string, platform: GalleryPlatform, asset: GalleryAsset, caption: string) => Promise<GalleryResult>;
  now?: () => number;
};
const STALE_RUN_MS = 30 * 60 * 1000;

export class GalleryAutoPostService {
  private now: () => number;
  constructor(private dependencies: Dependencies) { this.now = dependencies.now ?? Date.now; }

  async status(userId: string) {
    const job = await this.dependencies.store.get(userId);
    if (job?.runStartedAt != null && this.now() - job.runStartedAt >= STALE_RUN_MS) {
      return this.dependencies.store.update(userId, current => {
        if (current?.runStartedAt == null || this.now() - current.runStartedAt < STALE_RUN_MS) return current;
        // A remote platform may have accepted a post before the process died.
        // Never automatically retry an uncertain publish.
        return { ...current, active: false, nextRunAt: null, runToken: null, runStartedAt: null,
          error: 'Posting was interrupted. Check your social accounts before starting Auto-post again.' };
      });
    }
    return job;
  }

  async start(userId: string, input: unknown) {
    const parsed = galleryAutoPostSchema.parse(input);
    const connected = await this.dependencies.connected(userId);
    if (parsed.platforms.some(platform => !connected.includes(platform))) {
      throw Object.assign(new Error('Connect the selected social accounts before starting Auto-post.'), { status: 400 });
    }
    await this.status(userId);
    const now = this.now();
    const generation = randomUUID();
    return this.dependencies.store.update(userId, current => {
      if (current?.active || current?.runToken) {
        throw Object.assign(new Error('Auto-post is already active or finishing a post. Stop it before starting again.'), { status: 409 });
      }
      return { ...parsed, platforms: [...new Set(parsed.platforms)], userId, generation,
        active: true, cursor: 0, cycles: 0, nextRunAt: now, runToken: null, runStartedAt: null,
        lastRunAt: null, lastResults: [], error: null };
    });
  }

  stop(userId: string) {
    return this.dependencies.store.update(userId, job => job ? { ...job, active: false, nextRunAt: null } : null);
  }

  async runDueJobs() {
    const users = await this.dependencies.store.due(this.now());
    for (const userId of users) {
      try { await this.runUser(userId); }
      catch (error) { console.error('[gallery-autopost] job failed', { userId, error }); }
    }
  }

  async runUser(userId: string) {
    await this.status(userId);
    const runToken = randomUUID();
    const now = this.now();
    const job = await this.dependencies.store.update(userId, current => {
      if (!current?.active || current.runToken || current.nextRunAt == null || current.nextRunAt > now) return current;
      return { ...current, runToken, runStartedAt: now, lastResults: [] };
    });
    if (!job || job.runToken !== runToken) return;
    const results: GalleryResult[] = [];
    let error: string | null = null;
    try {
      const asset = job.assets[job.cursor];
      for (const platform of compatiblePlatforms(asset.kind, job.platforms)) {
        const current = await this.dependencies.store.get(userId);
        if (!current?.active || current.runToken !== runToken) break;
        const result = await this.dependencies.publish(userId, platform, asset, job.caption);
        results.push(result);
        await this.dependencies.store.update(userId, current => current?.runToken === runToken
          ? { ...current, lastResults: [...results] } : current);
      }
      const failures = results.filter(result => result.status === 'failed');
      if (failures.length) error = failures.map(result => `${result.platform}: ${result.error || 'Posting failed'}`).join('; ');
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Posting failed. Please check your connected accounts.';
    }
    const finishedAt = this.now();
    await this.dependencies.store.update(userId, current => {
      if (current?.runToken !== runToken) return current;
      const active = current.active && !error;
      const nextCursor = (job.cursor + 1) % job.assets.length;
      return { ...current, active, cursor: nextCursor,
        cycles: job.cycles + (nextCursor === 0 ? 1 : 0),
        nextRunAt: active ? finishedAt + job.intervalHours * 3600000 : null,
        lastRunAt: finishedAt, lastResults: results, error, runToken: null, runStartedAt: null };
    });
  }
}
