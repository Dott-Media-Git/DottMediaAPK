import axios from 'axios';
const TIKTOK_API_BASE = 'https://open.tiktokapis.com';
const MIN_CHUNK_BYTES = 5 * 1024 * 1024;
const MAX_CHUNK_BYTES = 64 * 1024 * 1024;
const DEFAULT_CHUNK_BYTES = 8 * 1024 * 1024;
const tikTokApi = async (accessToken, path, payload) => {
    const response = await axios.post(`${TIKTOK_API_BASE}${path}`, payload, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json; charset=UTF-8',
        },
        timeout: 60000,
    });
    const body = response.data ?? {};
    const code = String(body?.error?.code || '').trim();
    if (code && code !== 'ok') {
        const message = String(body?.error?.message || 'TikTok API request failed');
        const error = new Error(`${path}: ${code}${message ? ` - ${message}` : ''}`);
        error.tiktok = body;
        throw error;
    }
    return body;
};
const chooseChunkSize = (size) => {
    if (size <= MIN_CHUNK_BYTES)
        return size;
    return Math.min(Math.max(DEFAULT_CHUNK_BYTES, MIN_CHUNK_BYTES), MAX_CHUNK_BYTES);
};
const toCaption = (value) => {
    const cleaned = String(value || '').replace(/\s+/g, ' ').trim();
    if (!cleaned)
        return '';
    return cleaned.length > 2200 ? cleaned.slice(0, 2200) : cleaned;
};
const parseTikTokCode = (error) => {
    return (String(error?.tiktok?.error?.code || '').trim() ||
        String(error?.response?.data?.error?.code || '').trim() ||
        '');
};
const parseTikTokMessage = (error) => {
    return (String(error?.tiktok?.error?.message || '').trim() ||
        String(error?.response?.data?.error?.message || '').trim() ||
        String(error?.message || '').trim());
};
const shouldFallbackToFileUpload = (error) => {
    const code = parseTikTokCode(error);
    const message = parseTikTokMessage(error).toLowerCase();
    return code === 'url_ownership_unverified' || code === 'video_pull_failed' || message.includes('url');
};
const pickPrivacyLevel = (creatorInfo) => {
    const options = Array.isArray(creatorInfo?.privacy_level_options) ? creatorInfo?.privacy_level_options : [];
    if (options.includes('SELF_ONLY'))
        return 'SELF_ONLY';
    if (options.length)
        return options[0];
    return 'SELF_ONLY';
};
const uploadFileChunks = async (uploadUrl, buffer, mimeType, chunkSize) => {
    const total = buffer.length;
    let start = 0;
    while (start < total) {
        const end = Math.min(start + chunkSize, total) - 1;
        const chunk = buffer.subarray(start, end + 1);
        await axios.put(uploadUrl, chunk, {
            headers: {
                'Content-Type': mimeType,
                'Content-Length': String(chunk.length),
                'Content-Range': `bytes ${start}-${end}/${total}`,
            },
            timeout: 180000,
            maxBodyLength: Infinity,
            maxContentLength: Infinity,
            validateStatus: status => status >= 200 && status < 300,
        });
        start = end + 1;
    }
};
export async function publishToTikTok(input) {
    const { credentials } = input;
    const account = credentials?.tiktok;
    if (!account?.accessToken) {
        throw new Error('Missing TikTok credentials');
    }
    if (!input.videoUrl) {
        throw new Error('TikTok requires a video URL');
    }
    const accessToken = account.accessToken;
    const caption = toCaption(input.caption);
    const creatorInfoRes = await tikTokApi(accessToken, '/v2/post/publish/creator_info/query/', {});
    const creatorInfo = creatorInfoRes.data ?? {};
    const postInfo = {
        privacy_level: pickPrivacyLevel(creatorInfo),
        disable_comment: Boolean(creatorInfo.comment_disabled),
        disable_duet: Boolean(creatorInfo.duet_disabled),
        disable_stitch: Boolean(creatorInfo.stitch_disabled),
    };
    if (caption)
        postInfo.title = caption;
    let publishId = '';
    let uploadUrl = '';
    try {
        const initRes = await tikTokApi(accessToken, '/v2/post/publish/video/init/', {
            post_info: postInfo,
            source_info: {
                source: 'PULL_FROM_URL',
                video_url: input.videoUrl,
            },
        });
        publishId = String(initRes?.data?.publish_id || '').trim();
        if (!publishId)
            throw new Error('TikTok init did not return publish_id');
    }
    catch (error) {
        if (!shouldFallbackToFileUpload(error)) {
            throw new Error(`TikTok publish init failed: ${parseTikTokCode(error) || parseTikTokMessage(error)}`);
        }
        const download = await axios.get(input.videoUrl, {
            responseType: 'arraybuffer',
            timeout: 240000,
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
        });
        const buffer = Buffer.from(download.data);
        if (!buffer.length) {
            throw new Error('TikTok FILE_UPLOAD fallback failed: empty video download');
        }
        const chunkSize = chooseChunkSize(buffer.length);
        const totalChunkCount = Math.ceil(buffer.length / chunkSize);
        if (totalChunkCount < 1 || totalChunkCount > 1000) {
            throw new Error(`TikTok FILE_UPLOAD fallback failed: unsupported chunk count ${totalChunkCount}`);
        }
        const fileInitRes = await tikTokApi(accessToken, '/v2/post/publish/video/init/', {
            post_info: postInfo,
            source_info: {
                source: 'FILE_UPLOAD',
                video_size: buffer.length,
                chunk_size: chunkSize,
                total_chunk_count: totalChunkCount,
            },
        });
        publishId = String(fileInitRes?.data?.publish_id || '').trim();
        uploadUrl = String(fileInitRes?.data?.upload_url || '').trim();
        if (!publishId || !uploadUrl) {
            throw new Error('TikTok FILE_UPLOAD init did not return publish_id/upload_url');
        }
        const mimeType = String(download.headers?.['content-type'] || 'video/mp4').split(';')[0].trim() || 'video/mp4';
        await uploadFileChunks(uploadUrl, buffer, mimeType, chunkSize);
    }
    try {
        const statusRes = await tikTokApi(accessToken, '/v2/post/publish/status/fetch/', { publish_id: publishId });
        const status = String(statusRes?.data?.status || '').trim();
        const failReason = String(statusRes?.data?.fail_reason || '').trim();
        if (status) {
            console.info('[tiktok] publish status', { publishId, status, failReason: failReason || null });
        }
    }
    catch (error) {
        console.warn('[tiktok] status fetch failed', {
            publishId,
            code: parseTikTokCode(error) || null,
            message: parseTikTokMessage(error),
        });
    }
    return { remoteId: publishId };
}
