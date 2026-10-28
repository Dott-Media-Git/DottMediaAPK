import axios from 'axios';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pipeline } from 'stream/promises';
const MIN_CONTENT_LENGTH = 50 * 1024;
const parsedMaxMb = Number(process.env.YOUTUBE_UPLOAD_MAX_MB ?? '');
const DEFAULT_MAX_MB = Number.isFinite(parsedMaxMb) && parsedMaxMb > 0 ? parsedMaxMb : 512;
const DEFAULT_MAX_BYTES = DEFAULT_MAX_MB * 1024 * 1024;
const isSupportedProtocol = (value) => {
    try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
    }
    catch {
        return false;
    }
};
const extractContentType = (value) => (value ?? '').split(';')[0].trim().toLowerCase();
const responseFinalUrl = (response, fallback) => response?.request?.res?.responseUrl || response?.request?.path || fallback;
const looksLikeHtml = (buffer) => {
    const snippet = buffer.toString('utf8', 0, 64).trim().toLowerCase();
    return snippet.startsWith('<!doctype html') || snippet.startsWith('<html');
};
const buildError = (message, data) => ({
    ok: false,
    error: message,
    ...data,
});
const isValidContentType = (contentType) => contentType.startsWith('video/') || contentType === 'application/octet-stream';
const parseContentLength = (value) => {
    if (!value)
        return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};
const parseContentRange = (value) => {
    if (!value)
        return null;
    const match = /\/(\d+)$/.exec(value);
    return match ? Number(match[1]) : null;
};
export const validateVideoUrl = async (videoUrl) => {
    if (!isSupportedProtocol(videoUrl)) {
        return buildError('videoUrl must be http/https');
    }
    const attempt = async () => {
        try {
            const headResponse = await axios.head(videoUrl, {
                maxRedirects: 5,
                timeout: 10000,
                validateStatus: () => true,
            });
            if (headResponse.status === 200 || headResponse.status === 206) {
                const contentType = extractContentType(headResponse.headers['content-type']);
                const contentLength = parseContentLength(headResponse.headers['content-length']);
                const finalUrlAfterRedirects = responseFinalUrl(headResponse, videoUrl);
                return { contentType, contentLength, finalUrlAfterRedirects };
            }
        }
        catch {
            // Fall through to range request.
        }
        const rangeResponse = await axios.get(videoUrl, {
            headers: { Range: 'bytes=0-2047' },
            maxRedirects: 5,
            timeout: 10000,
            responseType: 'arraybuffer',
            validateStatus: () => true,
        });
        if (!(rangeResponse.status === 200 || rangeResponse.status === 206)) {
            throw new Error(`Unexpected status ${rangeResponse.status}`);
        }
        const contentType = extractContentType(rangeResponse.headers['content-type']);
        const contentLength = parseContentRange(rangeResponse.headers['content-range']) ?? parseContentLength(rangeResponse.headers['content-length']);
        const finalUrlAfterRedirects = responseFinalUrl(rangeResponse, videoUrl);
        const sample = Buffer.from(rangeResponse.data ?? '');
        return { contentType, contentLength, finalUrlAfterRedirects, sample };
    };
    try {
        const { contentType, contentLength, finalUrlAfterRedirects, sample } = await attempt();
        if (!contentType || !isValidContentType(contentType)) {
            return buildError('Content-Type must be video/* or application/octet-stream', {
                contentType,
                contentLength: contentLength ?? undefined,
                finalUrlAfterRedirects,
            });
        }
        if (!contentLength || contentLength < MIN_CONTENT_LENGTH) {
            return buildError('Content-Length missing or too small for a video file', {
                contentType,
                contentLength: contentLength ?? undefined,
                finalUrlAfterRedirects,
            });
        }
        if (contentType === 'text/html' || (sample && looksLikeHtml(sample))) {
            return buildError('videoUrl appears to return HTML, not a video file', {
                contentType,
                contentLength,
                finalUrlAfterRedirects,
            });
        }
        return {
            ok: true,
            contentType,
            contentLength,
            finalUrlAfterRedirects,
        };
    }
    catch (error) {
        return buildError('Unable to validate video URL');
    }
};
export const downloadVideoToTemp = async (videoUrl, options) => {
    const maxBytes = options?.maxBytes ?? DEFAULT_MAX_BYTES;
    const timeoutMs = options?.timeoutMs ?? 30000;
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dott-video-'));
    const filePath = path.join(tempDir, 'upload');
    try {
        const response = await axios.get(videoUrl, {
            responseType: 'stream',
            maxRedirects: 5,
            timeout: timeoutMs,
            validateStatus: status => status === 200 || status === 206,
        });
        const contentType = extractContentType(response.headers['content-type']);
        const contentLength = parseContentLength(response.headers['content-length']);
        if (contentLength && contentLength > maxBytes) {
            throw new Error('Video exceeds size limit');
        }
        let downloaded = 0;
        response.data.on('data', (chunk) => {
            downloaded += chunk.length;
            if (downloaded > maxBytes) {
                response.data.destroy(new Error('Video exceeds size limit'));
            }
        });
        await pipeline(response.data, fs.createWriteStream(filePath));
        return {
            filePath,
            contentType,
            contentLength: contentLength ?? downloaded,
        };
    }
    catch (error) {
        await cleanupTempFile(filePath);
        throw error;
    }
};
export const cleanupTempFile = async (filePath) => {
    try {
        await fs.promises.unlink(filePath);
    }
    catch {
        // ignore
    }
    try {
        await fs.promises.rm(path.dirname(filePath), { recursive: true, force: true });
    }
    catch {
        // ignore
    }
};
