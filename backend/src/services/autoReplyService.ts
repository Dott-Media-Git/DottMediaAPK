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

type Platform = 'instagram' | 'facebook' | 'threads';

const CLIENT_REPLY_PROFILES: Record<string, string> = {
  tce1fq1cofgdupoxp23mpumqraz1: 'shecare',
  '80byieiuuknftuvxtuobxmfc7pu1': 'dotthr',
  lvr7p3wzdfm51ds92kacf6s40og2: 'dottenergy',
  '1zvy9nnyxmcfxdpqeyx0bidk7r53': 'bwinbetug',
  acmvetccoithegk5d7edyieamdf3: 'carmarketplace',
  d1ingjlknraqh35m0nmgfw1lvd2: 'staysphere',
  vzdh1dnfflvjly8bbgc26wacmmw2: 'gamers44life',
};

const openai = new OpenAI({ apiKey: config.openAI.apiKey, timeout: OPENAI_REPLY_TIMEOUT_MS });
const openAiRepliesEnabled = () => {
  if (process.env.AUTO_REPLY_OPENAI_ENABLED === 'false' || process.env.OPENAI_AUTO_REPLY_ENABLED === 'false') return false;
  const key = config.openAI.apiKey?.trim() ?? '';
  return Boolean(key) && !/^sk-(test|example|placeholder)/i.test(key);
};

const buildGraphUrl = (path: string) => `https://graph.facebook.com/${GRAPH_VERSION}/${path}`;
const THREADS_GRAPH_VERSION = process.env.THREADS_GRAPH_VERSION ?? 'v1.0';
const THREADS_GRAPH_BASE_URL = process.env.THREADS_GRAPH_BASE_URL ?? 'https://graph.threads.net';

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
  const userProfile = CLIENT_REPLY_PROFILES[userId.trim().toLowerCase()];
  if (userProfile) return userProfile;
  const now = Date.now();
  const cached = replyProfileCache.get(userId);
  if (cached?.loaded && now - cached.fetchedAt < SETTINGS_CACHE_TTL_MS) {
    return cached.value || null;
  }
  try {
    const snap = await firestore.collection('users').doc(userId).get();
    const data = snap.data() as
      | {
          email?: string;
          socialAccounts?: {
            facebook?: { pageName?: string };
            instagram?: { username?: string };
          };
        }
      | undefined;
    const email = (data?.email as string | undefined)?.toLowerCase().trim() ?? '';
    const brandId = email ? resolveBrandIdForClient(email) : null;
    const socialKey = [
      data?.socialAccounts?.facebook?.pageName,
      data?.socialAccounts?.instagram?.username,
      email,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    const profile =
      brandId === 'bwinbetug'
        ? 'bwinbetug'
        : /carmarket|carmarketug/.test(socialKey)
          ? 'carmarketplace'
          : /staysphere|stay-sphere/.test(socialKey)
            ? 'staysphere'
            : /gamers44life/.test(socialKey)
              ? 'gamers44life'
              : /shecare/.test(socialKey)
                ? 'shecare'
                : /dott human resource|dotthr|dott hr/.test(socialKey)
                  ? 'dotthr'
                  : /dott energy|dottenergy/.test(socialKey)
                    ? 'dottenergy'
              : '';
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
  if (profile === 'bwinbetug' && kind === 'comment') {
    return 'Thanks for the support. For more football updates or to place bets, follow the link in the bio.';
  }
  const clientInstructions: Record<string, string> = {
    carmarketplace:
      'You reply for Carmarketug, a car marketplace. Be brief, helpful, and ask for budget, preferred model, location, or viewing details. Do not mention Dott Media or AI Sales Agent.',
    staysphere:
      'You reply for Stay-sphere93, a short-stay and accommodation brand. Be brief, helpful, and ask for dates, guest count, preferred area, budget, or availability. Do not mention Dott Media or AI Sales Agent.',
    gamers44life:
      'You reply for Gamers44life, a gaming community page. Be brief, energetic, and ask about the game, platform, rank, setup, or content ideas. Do not mention Dott Media or AI Sales Agent.',
    shecare:
      'You reply for SheCare Doctor, a private women’s health support account. Be warm, discreet, respectful, and brief. Encourage private DM or WhatsApp for confidential support. Do not give medical instructions, do not judge, and never mention Dott Media or AI.',
    dotthr:
      'You reply for Dott Human Resource. Be professional, warm, and practical. Ask about hiring needs, team size, HR structure, onboarding, policy, or staff-management support. Never mention Dott Media or AI.',
    dottenergy:
      'You reply for Dott Energy, a wind turbine and renewable energy store. Ask for location, power needs, preferred turbine size, battery/inverter setup, and whether they need a turbine, generator, or controller. Promote the store when relevant and never mention Dott Media or AI.',
  };
  const bwinInstruction =
    kind === 'comment'
      ? 'Reply with exactly: "Thanks for the support. For more football updates or to place bets, follow the link in the bio."'
      : 'Always direct users to the link in bio for full details, fixtures, markets, or support.';
  const baseSystem =
    profile === 'bwinbetug'
      ? `You are our sports team's sports assistant. Reply briefly (1-2 sentences), friendly, and sports-focused. ${bwinInstruction} Platform: ${platform}.`
      : profile && clientInstructions[profile]
        ? `${clientInstructions[profile]} Reply in 1-2 sentences. Platform: ${platform}.`
      : `You are Dotti, the Dott Media AI assistant. Reply briefly (1-2 sentences), friendly, and guide them to buy or book the Dott Media AI Sales Agent. Always include a clear CTA like 'Grab the AI Sales Agent' or 'Book a demo'. Platform: ${platform}.`;
  const override = await getAutoReplyPromptOverride(userId);
  const system = override ? `${baseSystem}\nAdditional guidance: ${override}` : baseSystem;
  const fallback = pickFallbackReply({ channel: platform, kind, profile });
  if (!openAiRepliesEnabled()) {
    return fallback;
  }
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

export async function replyToThreadsComment(
  replyToId: string,
  message: string,
  options: { accountId?: string; accessToken?: string } = {},
) {
  const accountId = options.accountId?.trim();
  const token = options.accessToken?.trim();
  if (!accountId || !token) {
    throw new Error('Threads accountId/accessToken missing');
  }
  try {
    const createResp = await axios.post(`${THREADS_GRAPH_BASE_URL}/${THREADS_GRAPH_VERSION}/${accountId}/threads`, null, {
      params: {
        media_type: 'TEXT',
        text: message,
        reply_to_id: replyToId,
        access_token: token,
      },
    });
    const creationId = createResp.data?.id as string | undefined;
    if (!creationId) throw new Error('Threads reply container missing id');
    await axios.post(`${THREADS_GRAPH_BASE_URL}/${THREADS_GRAPH_VERSION}/${accountId}/threads_publish`, null, {
      params: {
        creation_id: creationId,
        access_token: token,
      },
    });
  } catch (error) {
    throw formatAxiosError(error, 'Threads comment reply');
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

export async function replyToInstagramLoginMessage(userId: string, message: string, accessToken?: string) {
  const token = accessToken?.trim();
  if (!token) throw new Error('Instagram Login access token missing');
  try {
    await axios.post(
      'https://graph.instagram.com/me/messages',
      {
        recipient: { id: userId },
        message: { text: message },
      },
      { params: { access_token: token } },
    );
  } catch (error) {
    throw formatAxiosError(error, 'IG Login DM reply');
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
