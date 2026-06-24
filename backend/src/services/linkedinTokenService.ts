import axios from 'axios';

export type LinkedInTokenAccount = {
  accessToken: string;
  refreshToken?: string;
  accessTokenExpiresAt?: number | null;
  refreshTokenExpiresAt?: number | null;
};

type LinkedInTokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  scope?: string;
};

const REFRESH_WINDOW_MS = 24 * 60 * 60 * 1000;

export const refreshLinkedInAccount = async <T extends LinkedInTokenAccount>(account: T): Promise<T> => {
  const expiresAt = Number(account.accessTokenExpiresAt ?? 0);
  if (!account.refreshToken || !expiresAt || expiresAt > Date.now() + REFRESH_WINDOW_MS) {
    return account;
  }

  const clientId = process.env.LINKEDIN_CLIENT_ID?.trim() ?? '';
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET?.trim() ?? '';
  if (!clientId || !clientSecret) {
    throw new Error('LinkedIn token refresh is not configured');
  }

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: account.refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });
  const response = await axios.post<LinkedInTokenResponse>(
    'https://www.linkedin.com/oauth/v2/accessToken',
    params.toString(),
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 30000,
    },
  );
  const accessToken = response.data?.access_token?.trim();
  if (!accessToken) throw new Error('LinkedIn refresh did not return an access token');

  const accessExpiresIn = Number(response.data.expires_in ?? 0);
  const refreshExpiresIn = Number(response.data.refresh_token_expires_in ?? 0);
  return {
    ...account,
    accessToken,
    refreshToken: response.data.refresh_token?.trim() || account.refreshToken,
    accessTokenExpiresAt: accessExpiresIn ? Date.now() + accessExpiresIn * 1000 : account.accessTokenExpiresAt,
    refreshTokenExpiresAt: refreshExpiresIn
      ? Date.now() + refreshExpiresIn * 1000
      : account.refreshTokenExpiresAt,
  };
};
