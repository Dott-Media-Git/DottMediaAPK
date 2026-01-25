import { adminFetch } from '@services/admin/base';

export type YouTubeConfig = {
  clientIdConfigured: boolean;
  clientSecretConfigured: boolean;
  redirectUri: string;
  computedRedirectUri?: string;
  configuredRedirectUri?: string | null;
  callbackPath?: string;
  connectUrl?: string;
};

export type YouTubeStatus = {
  connected: boolean;
  channelTitle?: string | null;
  channelId?: string | null;
  privacyStatus?: 'private' | 'public' | 'unlisted';
  refreshTokenRevealPending?: boolean;
  updatedAt?: string | null;
};

export const fetchYouTubeConfig = async (orgId?: string) =>
  adminFetch('/integrations/youtube/config', {}, orgId);

export const fetchYouTubeStatus = async (orgId?: string) =>
  adminFetch('/integrations/youtube/status', {}, orgId);

export const fetchYouTubeConnectUrl = async (orgId?: string) =>
  adminFetch('/integrations/youtube/connect-url', {}, orgId);

export const pasteYouTubeToken = async (
  payload: {
    refreshToken?: string;
    token?: string;
    raw?: string;
    json?: string;
    clientId?: string;
    clientSecret?: string;
    redirectUri?: string;
    privacyStatus?: 'private' | 'public' | 'unlisted';
  },
  orgId?: string,
) =>
  adminFetch(
    '/integrations/youtube/paste-token',
    { method: 'POST', body: JSON.stringify(payload ?? {}) },
    orgId,
  );

export const updateYouTubeDefaults = async (
  payload: { privacyStatus: 'private' | 'public' | 'unlisted' },
  orgId?: string,
) =>
  adminFetch(
    '/integrations/youtube/defaults',
    { method: 'POST', body: JSON.stringify(payload) },
    orgId,
  );

export const revealYouTubeToken = async (orgId?: string) =>
  adminFetch('/integrations/youtube/reveal', { method: 'POST', body: '{}' }, orgId);

export const disconnectYouTube = async (orgId?: string) =>
  adminFetch('/integrations/youtube/disconnect', { method: 'POST', body: '{}' }, orgId);
