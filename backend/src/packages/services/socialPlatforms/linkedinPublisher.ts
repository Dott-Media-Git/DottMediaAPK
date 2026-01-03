import axios from 'axios';
import { SocialAccounts } from '../socialPostingService';

type PublishInput = {
  caption: string;
  imageUrls: string[];
  videoUrl?: string;
  credentials?: SocialAccounts;
};

const LINKEDIN_API = 'https://api.linkedin.com/v2';
const REQUEST_TIMEOUT_MS = 120000;
const ALLOW_PERSON_FALLBACK = process.env.LINKEDIN_ALLOW_PERSON_FALLBACK === 'true';

const getContentType = (url: string, isVideo: boolean) => {
  const lower = url.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.mp4') || lower.endsWith('.m4v')) return 'video/mp4';
  if (lower.endsWith('.mov')) return 'video/quicktime';
  if (lower.endsWith('.webm')) return 'video/webm';
  if (lower.endsWith('.avi')) return 'video/x-msvideo';
  if (lower.endsWith('.mkv')) return 'video/x-matroska';
  return isVideo ? 'video/mp4' : 'image/jpeg';
};

const buildTitle = (caption: string, isVideo: boolean) => {
  const trimmed = caption.trim();
  if (!trimmed) return isVideo ? 'Video update' : 'Image update';
  if (trimmed.length <= 80) return trimmed;
  return `${trimmed.slice(0, 77).trim()}...`;
};

const ensureText = (caption: string) => (caption?.trim()?.length ? caption.trim() : ' ');

const getLinkedInHeaders = (accessToken: string) => ({
  Authorization: `Bearer ${accessToken}`,
  'X-Restli-Protocol-Version': '2.0.0',
});

const fetchPersonUrn = async (accessToken: string) => {
  const response = await axios.get(`${LINKEDIN_API}/me`, {
    headers: getLinkedInHeaders(accessToken),
    timeout: REQUEST_TIMEOUT_MS,
  });
  const id = response.data?.id ? String(response.data.id) : '';
  return id ? `urn:li:person:${id}` : '';
};

const resolveAuthorUrn = async (raw: string | undefined, accessToken: string) => {
  const trimmed = raw?.trim() ?? '';
  if (trimmed && trimmed.startsWith('urn:li:')) return trimmed;
  if (trimmed && /^\d+$/.test(trimmed)) return `urn:li:organization:${trimmed}`;
  if (ALLOW_PERSON_FALLBACK) return await fetchPersonUrn(accessToken);
  return '';
};

const registerUpload = async (accessToken: string, owner: string, recipe: string) => {
  const response = await axios.post(
    `${LINKEDIN_API}/assets?action=registerUpload`,
    {
      registerUploadRequest: {
        owner,
        recipes: [recipe],
        serviceRelationships: [
          {
            relationshipType: 'OWNER',
            identifier: 'urn:li:userGeneratedContent',
          },
        ],
      },
    },
    {
      headers: {
        ...getLinkedInHeaders(accessToken),
        'Content-Type': 'application/json',
      },
      timeout: REQUEST_TIMEOUT_MS,
    },
  );
  const value = response.data?.value ?? {};
  const uploadMechanism = value.uploadMechanism?.['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'] ?? {};
  return {
    asset: value.asset as string | undefined,
    uploadUrl: uploadMechanism.uploadUrl as string | undefined,
  };
};

const uploadMedia = async (uploadUrl: string, mediaUrl: string, contentType: string) => {
  const download = await axios.get(mediaUrl, { responseType: 'arraybuffer', timeout: REQUEST_TIMEOUT_MS });
  const buffer = Buffer.isBuffer(download.data) ? download.data : Buffer.from(download.data);
  await axios.put(uploadUrl, buffer, {
    headers: {
      'Content-Type': contentType,
      'Content-Length': buffer.length,
    },
    timeout: REQUEST_TIMEOUT_MS,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });
};

const createUgcPost = async (accessToken: string, author: string, caption: string, mediaCategory: string, asset?: string) => {
  const payload: Record<string, unknown> = {
    author,
    lifecycleState: 'PUBLISHED',
    specificContent: {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary: { text: ensureText(caption) },
        shareMediaCategory: mediaCategory,
      },
    },
    visibility: {
      'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC',
    },
  };
  if (asset) {
    (payload.specificContent as any)['com.linkedin.ugc.ShareContent'].media = [
      {
        status: 'READY',
        description: { text: ensureText(caption) },
        media: asset,
        title: { text: buildTitle(caption, mediaCategory === 'VIDEO') },
      },
    ];
  }
  const response = await axios.post(`${LINKEDIN_API}/ugcPosts`, payload, {
    headers: {
      ...getLinkedInHeaders(accessToken),
      'Content-Type': 'application/json',
    },
    timeout: REQUEST_TIMEOUT_MS,
  });
  return (response.data?.id as string | undefined) ?? (response.headers?.['x-restli-id'] as string | undefined);
};

export async function publishToLinkedIn(input: PublishInput): Promise<{ remoteId?: string }> {
  const account = input.credentials?.linkedin;
  if (!account?.accessToken) {
    throw new Error('Missing LinkedIn credentials');
  }

  const fallbackAuthor =
    process.env.LINKEDIN_AUTHOR_URN?.trim() || process.env.LINKEDIN_ORGANIZATION_ID?.trim() || '';
  const authorUrn = await resolveAuthorUrn(account.urn || fallbackAuthor, account.accessToken);
  if (!authorUrn) {
    throw new Error('Missing LinkedIn author URN');
  }

  const mediaUrl = input.videoUrl || input.imageUrls?.[0];
  if (!mediaUrl) {
    const postId = await createUgcPost(account.accessToken, authorUrn, input.caption, 'NONE');
    return { remoteId: postId ?? `li_${Date.now()}` };
  }

  const isVideo = Boolean(input.videoUrl);
  const recipe = isVideo ? 'urn:li:digitalmediaRecipe:feedshare-video' : 'urn:li:digitalmediaRecipe:feedshare-image';
  const contentType = getContentType(mediaUrl, isVideo);

  try {
    const upload = await registerUpload(account.accessToken, authorUrn, recipe);
    if (!upload.asset || !upload.uploadUrl) {
      throw new Error('LinkedIn upload registration failed');
    }
    await uploadMedia(upload.uploadUrl, mediaUrl, contentType);
    const postId = await createUgcPost(
      account.accessToken,
      authorUrn,
      input.caption,
      isVideo ? 'VIDEO' : 'IMAGE',
      upload.asset,
    );
    return { remoteId: postId ?? `li_${Date.now()}` };
  } catch (error: any) {
    console.error('LinkedIn publish error:', error.response?.data || error.message);
    throw new Error(error.response?.data?.message || error.message || 'LinkedIn publish failed');
  }
}
