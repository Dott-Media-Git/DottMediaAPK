import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { createGalleryAutoPostRouter } from '../routes/galleryAutoPostRoutes';
import type { AuthedRequest } from '../middleware/firebaseAuth';
import { GalleryAutoPostService, galleryAutoPostSchema, type GalleryJob, type GalleryStore,
  type GalleryResult, type GalleryPlatform } from '../services/galleryAutoPostService';

class MemoryStore implements GalleryStore {
  jobs = new Map<string, GalleryJob>();
  async get(id: string) { return structuredClone(this.jobs.get(id) ?? null); }
  async update(id: string, change: (job: GalleryJob | null) => GalleryJob | null) {
    // Synchronous read/change/write models an atomic transaction across service instances.
    const next = change(structuredClone(this.jobs.get(id) ?? null));
    if (next) this.jobs.set(id, structuredClone(next));
    return structuredClone(next);
  }
  async due(now: number) {
    return [...this.jobs].filter(([, job]) => job.nextRunAt != null && job.nextRunAt <= now).map(([id]) => id);
  }
}
const input = {
  intervalHours: 1,
  assets: [
    { id: 'photo', url: 'https://media.example/photo.jpg', kind: 'image' as const, name: 'Photo' },
    { id: 'video', url: 'https://media.example/video.mp4', kind: 'video' as const, name: 'Video' },
  ],
  platforms: ['facebook'] as GalleryPlatform[], caption: 'My business',
};
function setup() {
  const store = new MemoryStore();
  let now = 1_000_000;
  const posts: string[] = [];
  const dependencies = { store, now: () => now,
    connected: async () => ['facebook', 'instagram', 'youtube'] as GalleryPlatform[],
    publish: async (_user: string, platform: GalleryPlatform, asset: typeof input.assets[number]): Promise<GalleryResult> => {
      posts.push(`${platform}:${asset.id}`);
      return { platform, status: 'posted', remoteId: String(posts.length) };
    },
  };
  return { store, posts, dependencies, service: new GalleryAutoPostService(dependencies),
    advance: (milliseconds: number) => { now += milliseconds; } };
}

test('interval boundaries, empty gallery, duplicate media, and platform compatibility are validated', () => {
  for (const hours of [0, 0.99, 24.01, Infinity, NaN, '1']) {
    assert.equal(galleryAutoPostSchema.safeParse({ ...input, intervalHours: hours }).success, false);
  }
  for (const hours of [1, 1.5, 24]) assert.equal(galleryAutoPostSchema.safeParse({ ...input, intervalHours: hours }).success, true);
  assert.equal(galleryAutoPostSchema.safeParse({ ...input, assets: [] }).success, false);
  assert.equal(galleryAutoPostSchema.safeParse({ ...input, assets: [input.assets[0], input.assets[0]] }).success, false);
  assert.equal(galleryAutoPostSchema.safeParse({ ...input, platforms: ['youtube'] }).success, false);
  assert.equal(galleryAutoPostSchema.safeParse({ ...input, platforms: [] }).success, false);
});

test('posts immediately, respects the interval, repeats the gallery, and survives service restart', async () => {
  const fixture = setup();
  await fixture.service.start('alice', input);
  await fixture.service.runDueJobs();
  assert.deepEqual(fixture.posts, ['facebook:photo']);
  fixture.advance(3_599_999);
  await fixture.service.runDueJobs();
  assert.equal(fixture.posts.length, 1);
  fixture.advance(1);
  const restarted = new GalleryAutoPostService(fixture.dependencies);
  await restarted.runDueJobs();
  assert.deepEqual(fixture.posts, ['facebook:photo', 'facebook:video']);
  assert.equal((await restarted.status('alice'))?.cycles, 1);
  fixture.advance(3_600_000);
  await restarted.runDueJobs();
  assert.deepEqual(fixture.posts, ['facebook:photo', 'facebook:video', 'facebook:photo']);
});

test('24 hours does not post early and a missed interval does not cause a catch-up burst', async () => {
  const fixture = setup();
  await fixture.service.start('alice', { ...input, intervalHours: 24 });
  await fixture.service.runDueJobs();
  fixture.advance(23 * 3_600_000);
  await fixture.service.runDueJobs();
  assert.equal(fixture.posts.length, 1);
  fixture.advance(7 * 24 * 3_600_000);
  await fixture.service.runDueJobs();
  await fixture.service.runDueJobs();
  assert.equal(fixture.posts.length, 2);
});

test('concurrent workers claim a due item only once and duplicate starts are rejected', async () => {
  const fixture = setup();
  const worker = new GalleryAutoPostService(fixture.dependencies);
  const starts = await Promise.allSettled([fixture.service.start('alice', input), worker.start('alice', input)]);
  assert.equal(starts.filter(result => result.status === 'fulfilled').length, 1);
  await Promise.all([fixture.service.runDueJobs(), worker.runDueJobs()]);
  assert.deepEqual(fixture.posts, ['facebook:photo']);
});

test('stop prevents future posts and is isolated to the authenticated user', async () => {
  const fixture = setup();
  await fixture.service.start('alice', input);
  await fixture.service.start('bob', input);
  await fixture.service.stop('alice');
  await fixture.service.runDueJobs();
  assert.equal((await fixture.service.status('alice'))?.lastRunAt, null);
  assert.equal((await fixture.service.status('bob'))?.active, true);
  assert.equal(fixture.posts.length, 1);
});

test('stop during publishing prevents subsequent platforms and the next gallery item', async () => {
  const fixture = setup();
  fixture.dependencies.publish = async (_user, platform) => {
    fixture.posts.push(platform);
    await fixture.service.stop('alice');
    return { platform, status: 'posted' };
  };
  await fixture.service.start('alice', { ...input, platforms: ['facebook', 'instagram'] });
  await fixture.service.runDueJobs();
  fixture.advance(3_600_000);
  await fixture.service.runDueJobs();
  assert.deepEqual(fixture.posts, ['facebook']);
  assert.equal((await fixture.service.status('alice'))?.active, false);
});

test('a failed platform pauses the job without retrying successful platforms', async () => {
  const fixture = setup();
  fixture.dependencies.publish = async (_user, platform) => {
    fixture.posts.push(platform);
    return platform === 'facebook' ? { platform, status: 'posted' } : { platform, status: 'failed', error: 'Token expired' };
  };
  await fixture.service.start('alice', { ...input, platforms: ['facebook', 'instagram'] });
  await fixture.service.runDueJobs();
  fixture.advance(3_600_000);
  await fixture.service.runDueJobs();
  assert.deepEqual(fixture.posts, ['facebook', 'instagram']);
  const job = await fixture.service.status('alice');
  assert.equal(job?.active, false);
  assert.match(job?.error ?? '', /Token expired/);
});

test('interrupted runs pause rather than repeating an uncertain external publish', async () => {
  const fixture = setup();
  await fixture.service.start('alice', input);
  await fixture.store.update('alice', job => ({ ...job!, runToken: 'dead-worker', runStartedAt: 1_000_000 }));
  fixture.advance(31 * 60_000);
  await fixture.service.runDueJobs();
  assert.equal(fixture.posts.length, 0);
  assert.equal((await fixture.service.status('alice'))?.active, false);
  assert.match((await fixture.service.status('alice'))?.error ?? '', /interrupted/);
});

test('disconnected accounts and failed durable writes never acknowledge a start', async () => {
  const fixture = setup();
  await assert.rejects(() => fixture.service.start('alice', { ...input, platforms: ['threads'] }), /Connect/);
  fixture.store.update = async () => { throw new Error('Database unavailable'); };
  await assert.rejects(() => fixture.service.start('alice', input), /Database unavailable/);
  assert.equal(fixture.posts.length, 0);
});

test('mixed gallery sends photos only to compatible accounts', async () => {
  const fixture = setup();
  await fixture.service.start('alice', { ...input, platforms: ['facebook', 'youtube'] });
  await fixture.service.runDueJobs();
  fixture.advance(3_600_000);
  await fixture.service.runDueJobs();
  assert.deepEqual(fixture.posts, ['facebook:photo', 'facebook:video', 'youtube:video']);
});

test('HTTP handlers validate requests, ignore supplied ownership, and return durable start/stop state', async () => {
  const fixture = setup();
  const app = express();
  app.use(express.json());
  app.use('/api/gallery/autopost', createGalleryAutoPostRouter(fixture.service, fixture.dependencies.connected, (req, res, next) => {
    if (req.header('Authorization') !== 'Bearer test-alice') { res.sendStatus(401); return; }
    (req as AuthedRequest).authUser = { uid: 'alice' } as AuthedRequest['authUser'];
    next();
  }));
  app.use(((error, _req, res, _next) => res.status(error.status ?? 500).json({ message: error.message })) as express.ErrorRequestHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/gallery/autopost`;
  const headers = { Authorization: 'Bearer test-alice', 'Content-Type': 'application/json' };
  try {
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(url, { method: 'POST', headers, body: JSON.stringify({ ...input, intervalHours: 25 }) })).status, 400);
    const start = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ ...input, userId: 'bob' }) });
    assert.equal(start.status, 201);
    assert.equal((await start.json()).job.userId, 'alice');
    assert.equal(await fixture.store.get('bob'), null);
    assert.equal((await fetch(url, { method: 'POST', headers, body: JSON.stringify(input) })).status, 409);
    const status = await fetch(url, { headers });
    assert.equal(status.headers.get('cache-control'), 'no-store');
    assert.equal((await status.json()).job.active, true);
    const stop = await fetch(url, { method: 'DELETE', headers });
    assert.equal((await stop.json()).job.active, false);
    await fixture.service.runDueJobs();
    assert.equal(fixture.posts.length, 0);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
