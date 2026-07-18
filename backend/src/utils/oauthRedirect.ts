const frontendBaseUrl = () =>
  (process.env.FRONTEND_URL || process.env.PUBLIC_APP_URL || 'https://dottmediaapk.web.app').replace(/\/+$/, '');

export const oauthSuccessRedirect = (platform: string) => {
  const url = new URL(`${frontendBaseUrl()}${platform === 'ads' ? '/ads' : '/integrations'}`);
  url.searchParams.set('connected', platform);
  return url.toString();
};
