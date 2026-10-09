const frontendBaseUrl = () =>
  (process.env.FRONTEND_URL || process.env.PUBLIC_APP_URL || 'https://dottmediaapk.web.app').replace(/\/+$/, '');

/**
 * Native clients use an Expo deep link so WebBrowser.openAuthSessionAsync can
 * close the provider window and return to the app. Keep redirects restricted
 * to our app scheme or configured web origin; the value is carried inside the
 * signed OAuth state and is never accepted as an arbitrary open redirect.
 */
export const sanitizeOAuthReturnUrl = (value: unknown) => {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const parsed = new URL(value.trim());
    const frontend = new URL(frontendBaseUrl());
    if (parsed.protocol === 'dottmedia:' || (parsed.protocol === frontend.protocol && parsed.host === frontend.host)) {
      return parsed.toString();
    }
  } catch {
    // Ignore malformed return URLs and use the normal web redirect.
  }
  return undefined;
};

export const oauthSuccessRedirect = (platform: string, returnUrl?: unknown) => {
  const safeReturnUrl = sanitizeOAuthReturnUrl(returnUrl);
  if (safeReturnUrl) {
    const url = new URL(safeReturnUrl);
    if (!url.searchParams.has('connected')) url.searchParams.set('connected', platform);
    return url.toString();
  }
  const url = new URL(`${frontendBaseUrl()}${platform === 'ads' ? '/ads' : '/integrations'}`);
  url.searchParams.set('connected', platform);
  return url.toString();
};
