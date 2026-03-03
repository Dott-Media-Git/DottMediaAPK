import { TwitterApi } from 'twitter-api-v2';

export type XDmCredentials = {
  appKey: string;
  appSecret: string;
  accessToken: string;
  accessSecret: string;
};

const normalizeHandle = (value: string) => value.trim().replace(/^@/, '').replace(/\?.*$/, '').replace(/\/$/, '');

const extractRecipient = (raw: string) => {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) return { userId: trimmed, handle: null };
  const byUrl = trimmed.match(/(?:x|twitter)\.com\/([a-z0-9_]{1,15})/i);
  if (byUrl?.[1]) return { userId: null, handle: normalizeHandle(byUrl[1]) };
  const byHandle = trimmed.match(/^@?([a-z0-9_]{1,15})$/i);
  if (byHandle?.[1]) return { userId: null, handle: normalizeHandle(byHandle[1]) };
  return null;
};

const toErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  return String(error);
};

/**
 * Sends an X DM through user-context OAuth 1.0a credentials.
 * Requires DM-enabled app permissions and the recipient to allow DMs.
 */
export async function sendXDirectMessage(
  recipient: string | undefined,
  text: string,
  credentials: XDmCredentials,
) {
  if (!recipient?.trim()) {
    throw new Error('X recipient is missing.');
  }

  const resolved = extractRecipient(recipient);
  if (!resolved) {
    throw new Error(`Unsupported X recipient format: "${recipient}"`);
  }

  const client = new TwitterApi(credentials).readWrite;

  let targetUserId = resolved.userId;
  if (!targetUserId && resolved.handle) {
    const lookup = await client.v2.userByUsername(resolved.handle);
    targetUserId = lookup.data?.id;
  }

  if (!targetUserId) {
    throw new Error(`Unable to resolve X recipient id for "${recipient}"`);
  }

  try {
    await client.v2.post(`dm_conversations/with/${targetUserId}/messages`, {
      text: text.trim(),
    });
  } catch (error) {
    const message = toErrorMessage(error);
    throw new Error(`X DM failed: ${message}`);
  }
}

