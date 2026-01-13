export type HelpDocEntry = {
  id: string;
  title: string;
  summary: string;
  url: string;
  tags: string[];
};

const helpDocsBaseUrl = (process.env.HELP_DOCS_BASE_URL ?? 'https://dottmediaapk.web.app/help').replace(/\/$/, '');

export const helpDocIndex: HelpDocEntry[] = [
  {
    id: 'instagram-onboarding',
    title: 'Instagram Connection Onboarding',
    summary:
      'Connect an Instagram Business/Creator account linked to a Facebook Page. Requires a Meta app with Instagram Graph API + Webhooks, app live with advanced access, and permissions including instagram_basic, pages_show_list, instagram_content_publish, pages_read_engagement, instagram_manage_comments/messages/insights, and pages_manage_metadata. Use /me/accounts to resolve the Instagram business account ID and store the access token + accountId in Dott Media.',
    url: `${helpDocsBaseUrl}/instagram-onboarding.html`,
    tags: [
      'instagram',
      'onboarding',
      'connect',
      'access token',
      'business account',
      'account id',
      'meta',
      'graph api',
      'permissions',
    ],
  },
  {
    id: 'facebook-onboarding',
    title: 'Facebook Page Connection Onboarding',
    summary:
      'Connect a Facebook Page for publishing and engagement. Requires a Meta app with Graph API + Webhooks, app live with permissions pages_show_list, pages_read_engagement, pages_manage_posts, pages_manage_engagement, pages_manage_metadata, and pages_messaging. Fetch the Page access token + pageId via /me/accounts and store them in Dott Media.',
    url: `${helpDocsBaseUrl}/facebook-onboarding.html`,
    tags: [
      'facebook',
      'page',
      'onboarding',
      'connect',
      'access token',
      'page id',
      'meta',
      'graph api',
      'permissions',
    ],
  },
  {
    id: 'linkedin-onboarding',
    title: 'LinkedIn Organization Connection Onboarding',
    summary:
      'Connect a LinkedIn Company Page (organization) for posting. Requires a LinkedIn app with Marketing Developer Platform access and scopes r_liteprofile, w_organization_social, r_organization_social, and rw_organization_admin. Get the organization URN (via organizationAcls) and store the access token + URN in Dott Media.',
    url: `${helpDocsBaseUrl}/linkedin-onboarding.html`,
    tags: ['linkedin', 'organization', 'urn', 'onboarding', 'connect', 'access token', 'permissions'],
  },
  {
    id: 'x-onboarding',
    title: 'X (Twitter) Connection Onboarding',
    summary:
      'Connect an X (Twitter) account for posting. Requires an X Developer app with Read and Write permissions and OAuth 1.0a access token + access token secret. Store the token and secret in Dott Media.',
    url: `${helpDocsBaseUrl}/x-onboarding.html`,
    tags: ['x', 'twitter', 'onboarding', 'connect', 'access token', 'access secret', 'oauth'],
  },
  {
    id: 'tiktok-onboarding',
    title: 'TikTok Connection Onboarding',
    summary:
      'Connect a TikTok Creator/Business account for video publishing. Requires a TikTok app with scopes user.info.basic, video.upload, and video.publish. Use the Dott Media OAuth flow to store access/refresh tokens and open_id.',
    url: `${helpDocsBaseUrl}/tiktok-onboarding.html`,
    tags: ['tiktok', 'onboarding', 'connect', 'access token', 'refresh token', 'video upload', 'permissions'],
  },
  {
    id: 'youtube-onboarding',
    title: 'YouTube Connection Onboarding',
    summary:
      'Connect a YouTube channel for uploads. Requires Google Cloud OAuth credentials with scope https://www.googleapis.com/auth/youtube.upload. Use Dott Media connect to store a refresh token and optional channel metadata.',
    url: `${helpDocsBaseUrl}/youtube-onboarding.html`,
    tags: ['youtube', 'onboarding', 'connect', 'refresh token', 'upload', 'oauth'],
  },
  {
    id: 'threads-onboarding',
    title: 'Threads Connection Onboarding',
    summary:
      'Threads posting uses the connected Instagram Business account. Ensure Instagram is connected with instagram_basic, instagram_content_publish, and pages_show_list permissions. No separate Threads credentials are required.',
    url: `${helpDocsBaseUrl}/threads-onboarding.html`,
    tags: ['threads', 'instagram', 'onboarding', 'connect', 'permissions'],
  },
  {
    id: 'whatsapp-onboarding',
    title: 'WhatsApp Business Connection Onboarding',
    summary:
      'Connect WhatsApp Business (org-wide). Requires a WABA, phone number ID, Meta app with WhatsApp product, permissions whatsapp_business_messaging and whatsapp_business_management, access token, and webhook verify token.',
    url: `${helpDocsBaseUrl}/whatsapp-onboarding.html`,
    tags: ['whatsapp', 'business', 'onboarding', 'connect', 'phone number id', 'access token', 'webhook'],
  },
];
