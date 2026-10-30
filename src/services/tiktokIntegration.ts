import { adminFetch } from '@services/admin/base';
export const withTikTokEnvironment=(path:string)=>typeof window!=='undefined'&&typeof window.location?.search==='string'&&new URLSearchParams(window.location.search).get('tiktokSandbox')==='1'?path+(path.includes('?')?'&':'?')+'environment=sandbox':path;

export type TikTokConfig = {
  clientKeyConfigured: boolean;
  clientSecretConfigured: boolean;
  redirectUri: string;
  computedRedirectUri?: string;
  configuredRedirectUri?: string | null;
  callbackPath?: string;
  scopes?: string[];
  connectUrl?: string;
  environment?: 'sandbox'|'production';
};

export type TikTokStatus = {
  connected: boolean;
  openId?: string | null;
  scope?: string | null;
  refreshTokenRevealPending?: boolean;
  updatedAt?: string | null;
};

type TikTokTokenPayload = {
  accessToken?: string;
  refreshToken?: string;
  openId?: string;
  expiresIn?: number;
  refreshExpiresIn?: number;
  scope?: string;
};

const normalizeTikTokPayload = (payload: { accessToken?: string; json?: string }): TikTokTokenPayload => {
  if (payload.json) {
    try {
      const parsed = JSON.parse(payload.json);
      return {
        accessToken: parsed.accessToken ?? parsed.access_token,
        refreshToken: parsed.refreshToken ?? parsed.refresh_token,
        openId: parsed.openId ?? parsed.open_id,
        expiresIn: parsed.expiresIn ?? parsed.expires_in,
        refreshExpiresIn: parsed.refreshExpiresIn ?? parsed.refresh_expires_in,
        scope: parsed.scope
      };
    } catch {
      return {};
    }
  }
  return { accessToken: payload.accessToken };
};

export const fetchTikTokConfig = async (orgId?: string) =>
  adminFetch(withTikTokEnvironment('/integrations/tiktok/config'), {}, orgId);

export const fetchTikTokStatus = async (orgId?: string) =>
  adminFetch(withTikTokEnvironment('/integrations/tiktok/status'), {}, orgId);

export const fetchTikTokConnectUrl = async (orgId?: string, returnUrl?: string) =>
  adminFetch(withTikTokEnvironment(`/integrations/tiktok/connect-url${returnUrl ? `?returnUrl=${encodeURIComponent(returnUrl)}` : ''}`), {}, orgId);

export const pasteTikTokToken = async (
  payload: { accessToken?: string; json?: string },
  orgId?: string,
) => {
  const normalized = normalizeTikTokPayload(payload);
  if (!normalized.accessToken) {
    throw new Error('Missing access token payload');
  }
  return adminFetch(
    withTikTokEnvironment('/integrations/tiktok/token'),
    { method: 'POST', body: JSON.stringify(normalized) },
    orgId,
  );
};

export const revealTikTokToken = async (orgId?: string) =>
  adminFetch(withTikTokEnvironment('/integrations/tiktok/reveal'), { method: 'POST', body: '{}' }, orgId);

export const disconnectTikTok = async (orgId?: string) =>
  adminFetch(withTikTokEnvironment('/integrations/tiktok/disconnect'), { method: 'POST', body: '{}' }, orgId);

export type TikTokCreatorReview = {
  openId: string; environment: 'sandbox'|'production'; creator: {creator_nickname?: string; creator_username?: string;
  creator_avatar_url?: string; privacy_level_options: string[]; max_video_post_duration_sec: number;
  comment_disabled?: boolean; duet_disabled?: boolean; stitch_disabled?: boolean;};
};
export const fetchTikTokCreator = (orgId?: string): Promise<TikTokCreatorReview> => adminFetch(withTikTokEnvironment('/integrations/tiktok/creator-info'),{},orgId);
export const fetchTikTokReviewedPost = (id: string,orgId?: string) => adminFetch(withTikTokEnvironment('/integrations/tiktok/reviewed-posts/'+encodeURIComponent(id)),{},orgId);
export async function submitTikTokReviewedVideo(file: File, caption: string, review: Record<string,unknown>, requestId: string,orgId?: string) {
  const {env} = await import('@services/env'); const {getIdToken} = await import('@services/firebase');
  const token=await getIdToken(); if(!token)throw new Error('Please sign in again');
  const body=new FormData();body.append('video',file);body.append('caption',caption);body.append('review',JSON.stringify(review));body.append('requestId',requestId);
  const headers: Record<string,string>={Authorization:'Bearer '+token};if(orgId)headers['x-org-id']=orgId;
  const r=await fetch(env.apiUrl.replace(/\/$/,'')+withTikTokEnvironment('/integrations/tiktok/publish-reviewed'),{method:'POST',headers,body});
  const d=await r.json();if(!r.ok)throw new Error(d.message||d.error||'Unable to submit to TikTok');return d as {jobId:string;status:string;message?:string};
}
