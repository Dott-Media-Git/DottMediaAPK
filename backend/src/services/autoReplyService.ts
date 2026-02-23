import axios, { AxiosError } from 'axios';
import OpenAI from 'openai';
import { config } from '../config.js';
import { firestore } from '../db/firestore.js';
import { pickFallbackReply, FallbackKind } from './fallbackReplyLibrary.js';
import { resolveBrandIdForClient } from './brandKitService.js';
import { OPENAI_REPLY_TIMEOUT_MS } from '../utils/openaiTimeout.js';

const GRAPH_VERSION = 'v19.0';
const SETTINGS_CACHE_TTL_MS = 5 * 60 * 1000;
const replyPromptCache = new Map<string, { value: string; fetchedAt: number; loaded: boolean }>();
const replyProfileCache = new Map<string, { value: string; fetchedAt: number; loaded: boolean }>();

type Platform = 'instagram' | 'facebook';

const openai = new OpenAI({ apiKey: config.openAI.apiKey, timeout: OPENAI_REPLY_TIMEOUT_MS });

const buildGraphUrl = (path: string) => `https://graph.facebook.com/${GRAPH_VERSION}/${path}`;

const formatAxiosError = (error: unknown, label: string) => {
  const err = error as AxiosError;
  const status = err.response?.status;
  const data = err.response?.data;
  return new Error(`${label} failed${status ? ` (${status})` : ''}${data ? `: ${JSON.stringify(data)}` : ''}`);
};

const getAutoReplyPromptOverride = async (userId?: string) => {
  if (!userId) return null;
  const now = Date.now();
  const cached = replyPromptCache.get(userId);
  if (cached?.loaded && now - cached.fetchedAt < SETTINGS_CACHE_TTL_MS) {
    return cached.value || null;
  }
  try {
    const snap = await firestore.collection('assistant_settings').doc(userId).get();
    const value = (snap.data()?.autoReplyPrompt as string | undefined)?.trim() ?? '';
    replyPromptCache.set(userId, { value: value || '', fetchedAt: now, loaded: true });
    return value || null;
  } catch (error) {
    console.warn('Failed to load auto-reply prompt override', (error as Error).message);
    replyPromptCache.set(userId, { value: '', fetchedAt: now, loaded: true });
    return null;
  }
};

const getReplyProfile = async (userId?: string) => {
  if (!userId) return null;
  const now = Date.now();
  const cached = replyProfileCache.get(userId);
  if (cached?.loaded && now - cached.fetchedAt < SETTINGS_CACHE_TTL_MS) {
    return cached.value || null;
  }
  try {
    const snap = await firestore.collection('users').doc(userId).get();
    const email = (snap.data()?.email as string | undefined)?.toLowerCase().trim() ?? '';
    const brandId = email ? resolveBrandIdForClient(email) : null;
    const profile = brandId === 'bwinbetug' ? 'bwinbetug' : '';
    replyProfileCache.set(userId, { value: profile, fetchedAt: now, loaded: true });
    return profile || null;
  } catch (error) {
    console.warn('Failed to load reply profile', (error as Error).message);
    replyProfileCache.set(userId, { value: '', fetchedAt: now, loaded: true });
    return null;
  }
};

export async function generateReply(
  message: string,
  platform: Platform,
  userId?: string,
  kind: FallbackKind = 'message',
) {
  const profile = await getReplyProfile(userId);
  const baseSystem =
    profile === 'bwinbetug'
      ? `You are Bwinbet UG's sports assistant. Reply briefly (1-2 sentences), friendly, and sports-focused. Always direct users to www.bwinbetug.info for full details, fixtures, markets, or support. Platform: ${platform}.`
      : `You are Dotti, the Dott Media AI assistant. Reply briefly (1-2 sentences), friendly, and guide them to buy or book the Dott Media AI Sales Agent. Always include a clear CTA like 'Grab the AI Sales Agent' or 'Book a demo'. Platform: ${platform}.`;
  const override = await getAutoReplyPromptOverride(userId);
  const system = override ? `${baseSystem}\nAdditional guidance: ${override}` : baseSystem;
  const fallback = pickFallbackReply({ channel: platform, kind, profile });
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.4,
      max_tokens: 120,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: message.slice(0, 500) },
      ],
    });
    return completion.choices[0]?.message?.content?.trim() || fallback;
  } catch (err) {
    console.error('OpenAI generateReply failed', { error: (err as Error).message, platform });
    // Return a safe, short fallback so webhook flow continues even if the AI is unavailable
    return fallback;
  }
} 

export async function replyToInstagramComment(commentId: string, message: string, accessToken?: string) {
  const url = buildGraphUrl(`${commentId}/replies`);
  const token = accessToken ?? process.env.INSTAGRAM_ACCESS_TOKEN;
  if (!token) {
    console.warn('INSTAGRAM_ACCESS_TOKEN missing, skipping IG comment reply', { commentId });
    return;
  }
  try {
    await axios.post(url, null, {
      params: {
        message,
        access_token: token,
      },
    });
  } catch (error) {
    throw formatAxiosError(error, 'IG comment reply');
  }
} 

export async function replyToFacebookComment(commentId: string, message: string, pageToken?: string) {
  const url = buildGraphUrl(`${commentId}/comments`);
  const token = pageToken ?? process.env.FACEBOOK_PAGE_TOKEN;
  if (!token) {
    console.warn('FACEBOOK_PAGE_TOKEN missing, skipping FB comment reply', { commentId });
    return;
  }
  try {
    await axios.post(url, null, {
      params: {
        message,
        access_token: token,
      },
    });
  } catch (error) {
    throw formatAxiosError(error, 'FB comment reply');
  }
}

export async function likeInstagramComment(commentId: string, accessToken?: string) {
  const token = accessToken ?? process.env.INSTAGRAM_ACCESS_TOKEN;
  if (!commentId || !token) return;
  const url = buildGraphUrl(`${commentId}/likes`);
  try {
    await axios.post(url, null, {
      params: { access_token: token },
    });
  } catch (error) {
    throw formatAxiosError(error, 'IG comment like');
  }
}

export async function likeFacebookComment(commentId: string, pageToken?: string) {
  const token = pageToken ?? process.env.FACEBOOK_PAGE_TOKEN;
  if (!commentId || !token) return;
  const url = buildGraphUrl(`${commentId}/likes`);
  try {
    await axios.post(url, null, {
      params: { access_token: token },
    });
  } catch (error) {
    throw formatAxiosError(error, 'FB comment like');
  }
}
export async function replyToInstagramMessage(
  userId: string,
  message: string,
  options?: { accessToken?: string; igBusinessId?: string }
) {
  const igBusinessId = options?.igBusinessId ?? process.env.INSTAGRAM_BUSINESS_ID;
  if (!igBusinessId) throw new Error('INSTAGRAM_BUSINESS_ID missing');
  const url = `https://graph.facebook.com/v19.0/${igBusinessId}/messages`;
  const token = options?.accessToken ?? process.env.INSTAGRAM_ACCESS_TOKEN;
  if (!token) throw new Error('INSTAGRAM_ACCESS_TOKEN missing');
  try {
    await axios.post(
      url,
      {
        recipient: { id: userId },
        message: { text: message },
      },
      { params: { access_token: token } },
    );
  } catch (error) {
    throw formatAxiosError(error, 'IG DM reply');
  }
}

export async function replyToFacebookMessage(userId: string, message: string, pageToken?: string) {
  const url = `https://graph.facebook.com/v19.0/me/messages`;
  const token = pageToken ?? process.env.FACEBOOK_PAGE_TOKEN;
  if (!token) {
    console.warn('FACEBOOK_PAGE_TOKEN missing, skipping FB DM reply', { userId });
    return;
  }
  try {
    await axios.post(
      url,
      {
        recipient: { id: userId },
        messaging_type: 'RESPONSE',
        message: { text: message },
      },
      { params: { access_token: token } },
    );
  } catch (error) {
    throw formatAxiosError(error, 'FB DM reply');
  }
}
