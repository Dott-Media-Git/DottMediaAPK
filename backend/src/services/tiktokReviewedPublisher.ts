import axios from 'axios';
export type TikTokCreator = {
  creator_avatar_url?: string; creator_username?: string; creator_nickname?: string;
  privacy_level_options: string[]; comment_disabled?: boolean; duet_disabled?: boolean;
  stitch_disabled?: boolean; max_video_post_duration_sec: number;
};
export type TikTokReview = {
  privacyLevel: string; allowComment: boolean; allowDuet: boolean; allowStitch: boolean;
  commercial: boolean; ownBrand: boolean; brandedContent: boolean; musicConsent: boolean;
  explicitConsent: boolean; reviewedOpenId: string; aiGenerated: boolean;
};
async function api<T>(token: string, path: string, body: unknown): Promise<T> {
  const r = await axios.post('https://open.tiktokapis.com' + path, body, {
    headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'}, timeout: 30000,
  });
  if (r.data?.error?.code && r.data.error.code !== 'ok') throw new Error(`TikTok: ${r.data.error.message || r.data.error.code}`);
  if (!r.data?.data) throw new Error('TikTok returned an incomplete response');
  return r.data.data;
}
export const queryTikTokCreator = (token: string) => api<TikTokCreator>(token, '/v2/post/publish/creator_info/query/', {});

// Parse movie duration on the server; form metadata is not trusted.
export function mp4Duration(b: Buffer): number {
  function scan(start: number, end: number): number | undefined {
    for (let p = start; p + 8 <= end;) {
      let size = b.readUInt32BE(p), header = 8;
      const type = b.toString('ascii', p + 4, p + 8);
      if (size === 1) {
        if (p + 16 > end) throw new Error('Invalid MP4 header');
        const large = b.readBigUInt64BE(p + 8);
        if (large > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Invalid MP4 box size');
        size = Number(large); header = 16;
      } else if (!size) size = end - p;
      if (size < header || p + size > end) throw new Error('Invalid MP4 box');
      if (type === 'moov') {const d = scan(p + header, p + size); if (d !== undefined) return d;}
      if (type === 'mvhd') {
        const q = p + header, v = b[q];
        if (v > 1 || q + (v ? 32 : 20) > p + size) throw new Error('Invalid MP4 duration');
        const scale = b.readUInt32BE(q + (v ? 20 : 12));
        const duration = v ? Number(b.readBigUInt64BE(q + 24)) : b.readUInt32BE(q + 16);
        if (!scale || !duration || !Number.isFinite(duration)) throw new Error('Invalid MP4 duration');
        return duration / scale;
      }
      p += size;
    }
  }
  const d = scan(0, b.length);
  if (!d || !Number.isFinite(d)) throw new Error('Choose an MP4 video with a readable duration');
  return d;
}
export function reviewedPostInfo(c: TikTokCreator, r: TikTokReview, openId: string, duration: number, caption: string) {
  if (!r.explicitConsent || !r.musicConsent) throw new Error('Review and consent are required before uploading to TikTok');
  if (!openId || r.reviewedOpenId !== openId) throw new Error('The connected TikTok account changed. Refresh and review again.');
  if (!r.privacyLevel || !c.privacy_level_options?.includes(r.privacyLevel)) throw new Error('Choose an available privacy option');
  if (!(c.max_video_post_duration_sec > 0) || duration > c.max_video_post_duration_sec) throw new Error('Video exceeds the creator account duration limit');
  if (r.allowComment && c.comment_disabled || r.allowDuet && c.duet_disabled || r.allowStitch && c.stitch_disabled) throw new Error('The creator has disabled a selected interaction');
  if (r.commercial && !r.ownBrand && !r.brandedContent) throw new Error('Choose Your brand or Branded content');
  if (!r.commercial && (r.ownBrand || r.brandedContent)) throw new Error('Enable commercial disclosure before selecting a brand option');
  if (r.brandedContent && r.privacyLevel === 'SELF_ONLY') throw new Error('Branded content visibility cannot be private');
  if (caption.length > 2200) throw new Error('Caption must be at most 2200 characters');
  return {title: caption, privacy_level: r.privacyLevel, disable_comment: !r.allowComment, disable_duet: !r.allowDuet,
    disable_stitch: !r.allowStitch, brand_organic_toggle: r.commercial && r.ownBrand,
    brand_content_toggle: r.commercial && r.brandedContent, is_aigc: r.aiGenerated};
}
export async function publishReviewedTikTok(token: string, openId: string, video: Buffer, caption: string, review: TikTokReview) {
  const duration = mp4Duration(video);
  const creator = await queryTikTokCreator(token);
  const postInfo = reviewedPostInfo(creator, review, openId, duration, caption);
  const chunk = video.length <= 64 * 1024 * 1024 ? video.length : 8 * 1024 * 1024;
  const chunks = video.length <= 64 * 1024 * 1024 ? 1 : Math.floor(video.length / chunk);
  const init = await api<{publish_id: string; upload_url: string}>(token, '/v2/post/publish/video/init/', {
    post_info: postInfo, source_info: {source: 'FILE_UPLOAD', video_size: video.length, chunk_size: chunk, total_chunk_count: chunks},
  });
  if (!init.publish_id || !init.upload_url) throw new Error('TikTok did not return an upload destination');
  const u = new URL(init.upload_url);
  if (u.protocol !== 'https:' || !/(^|\.)tiktokapis\.com$/.test(u.hostname)) throw new Error('TikTok returned an unexpected upload destination');
  for (let i = 0, start = 0; i < chunks; i++) {
    const end = i === chunks - 1 ? video.length : start + chunk;
    await axios.put(init.upload_url, video.subarray(start, end), {headers: {
      'Content-Type': 'video/mp4', 'Content-Length': String(end - start), 'Content-Range': `bytes ${start}-${end - 1}/${video.length}`,
    }, timeout: 120000, maxBodyLength: 80 * 1024 * 1024});
    start = end;
  }
  return {publishId: init.publish_id};
}
export const queryTikTokPostStatus = (token: string, publishId: string) => api<{
  status: string; fail_reason?: string; publicly_available_post_id?: string[];
}>(token, '/v2/post/publish/status/fetch/', {publish_id: publishId});
