import OpenAI from 'openai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { config } from '../config.js';
const client = new OpenAI({ apiKey: config.openAI.apiKey, timeout: 600000 });
const parseMs = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};
const pollIntervalMs = Math.max(parseMs(process.env.SORA_POLL_INTERVAL_MS, 5000), 1000);
const maxWaitMs = Math.max(parseMs(process.env.SORA_MAX_WAIT_MS, 10 * 60 * 1000), 60 * 1000);
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
export const generateSoraVideoFile = async (options) => {
    const response = await client.videos.create({
        prompt: options.prompt,
        model: options.model ?? 'sora-2',
        seconds: options.seconds ?? '12',
        size: options.size ?? '720x1280',
    });
    const videoId = response.id;
    if (!videoId) {
        throw new Error('OpenAI did not return a video ID');
    }
    const deadline = Date.now() + maxWaitMs;
    let latest = response;
    while (Date.now() < deadline) {
        if (latest.status === 'completed')
            break;
        if (latest.status === 'failed') {
            throw new Error(latest.error?.message ?? 'Sora generation failed');
        }
        await sleep(pollIntervalMs);
        latest = await client.videos.retrieve(videoId);
    }
    if (latest.status !== 'completed') {
        throw new Error('Timed out waiting for Sora video generation');
    }
    const content = await client.videos.downloadContent(videoId, { variant: 'video' });
    const buffer = Buffer.from(await content.arrayBuffer());
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dott-sora-'));
    const filePath = path.join(tempDir, 'sora.mp4');
    await fs.promises.writeFile(filePath, buffer);
    return { filePath, videoId };
};
