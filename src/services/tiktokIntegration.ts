import { adminFetch } from '@services/admin/base';

export type TikTokConfig = {
  clientKeyConfigured: boolean;
  clientSecretConfigured: boolean;
  redirectUri: string;
  computedRedirectUri?: string;
  configuredRedirectUri?: string | null;
  callbackPath?: string;
  scopes?: string[];
  connectUrl?: string;
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
  adminFetch('/integrations/tiktok/config', {}, orgId);

export const fetchTikTokStatus = async (orgId?: string) =>
  adminFetch('/integrations/tiktok/status', {}, orgId);

export const fetchTikTokConnectUrl = async (orgId?: string) =>
  adminFetch('/integrations/tiktok/connect-url', {}, orgId);

export const pasteTikTokToken = async (
  payload: { accessToken?: string; json?: string },
  orgId?: string,
) => {
  const normalized = normalizeTikTokPayload(payload);
  if (!normalized.accessToken) {
    throw new Error('Missing access token payload');
  }
  return adminFetch(
    '/integrations/tiktok/token',
    { method: 'POST', body: JSON.stringify(normalized) },
    orgId,
  );
};

export const revealTikTokToken = async (orgId?: string) =>
  adminFetch('/integrations/tiktok/reveal', { method: 'POST', body: '{}' }, orgId);

export const disconnectTikTok = async (orgId?: string) =>
  adminFetch('/integrations/tiktok/disconnect', { method: 'POST', body: '{}' }, orgId);
