import axios, { AxiosError } from 'axios';
import OpenAI from 'openai';
import { config } from '../config.js';

const GRAPH_VERSION = 'v19.0';

type Platform = 'instagram' | 'facebook';

const openai = new OpenAI({ apiKey: config.openAI.apiKey });

const buildGraphUrl = (path: string) => `https://graph.facebook.com/${GRAPH_VERSION}/${path}`;

const formatAxiosError = (error: unknown, label: string) => {
  const err = error as AxiosError;
  const status = err.response?.status;
  const data = err.response?.data;
  return new Error(`${label} failed${status ? ` (${status})` : ''}${data ? `: ${JSON.stringify(data)}` : ''}`);
};

export async function generateReply(message: string, platform: Platform) {
  const system = `You are Dotti, the Dott Media AI assistant. Reply briefly (1-2 sentences), friendly, and guide them to buy or book the Dott Media AI Sales Agent. Always include a clear CTA like 'Grab the AI Sales Agent' or 'Book a demo'. Platform: ${platform}.`;
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.4,
    max_tokens: 120,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: message.slice(0, 500) },
    ],
  });
  return completion.choices[0]?.message?.content?.trim() || 'Thanks for reaching out! Grab the Dott Media AI Sales Agent or book a demo and we will guide you in minutes.';
}

export async function replyToInstagramComment(commentId: string, message: string) {
  const url = buildGraphUrl(`${commentId}/replies`);
  try {
    await axios.post(url, null, {
      params: {
        message,
        access_token: process.env.INSTAGRAM_ACCESS_TOKEN,
      },
    });
  } catch (error) {
    throw formatAxiosError(error, 'IG comment reply');
  }
}

export async function replyToFacebookComment(commentId: string, message: string) {
  const url = buildGraphUrl(`${commentId}/comments`);
  try {
    await axios.post(url, null, {
      params: {
        message,
        access_token: process.env.FACEBOOK_PAGE_TOKEN,
      },
    });
  } catch (error) {
    throw formatAxiosError(error, 'FB comment reply');
  }
}

export async function likeInstagramComment(commentId: string) {
  if (!commentId || !process.env.INSTAGRAM_ACCESS_TOKEN) return;
  const url = buildGraphUrl(`${commentId}/likes`);
  try {
    await axios.post(url, null, {
      params: { access_token: process.env.INSTAGRAM_ACCESS_TOKEN },
    });
  } catch (error) {
    throw formatAxiosError(error, 'IG comment like');
  }
}

export async function likeFacebookComment(commentId: string) {
  if (!commentId || !process.env.FACEBOOK_PAGE_TOKEN) return;
  const url = buildGraphUrl(`${commentId}/likes`);
  try {
    await axios.post(url, null, {
      params: { access_token: process.env.FACEBOOK_PAGE_TOKEN },
    });
  } catch (error) {
    throw formatAxiosError(error, 'FB comment like');
  }
}
export async function replyToInstagramMessage(userId: string, message: string) {
  const igBusinessId = process.env.INSTAGRAM_BUSINESS_ID;
  if (!igBusinessId) throw new Error('INSTAGRAM_BUSINESS_ID missing');
  const url = `https://graph.facebook.com/v19.0/${igBusinessId}/messages`;
  try {
    await axios.post(
      url,
      {
        recipient: { id: userId },
        message: { text: message },
      },
      { params: { access_token: process.env.INSTAGRAM_ACCESS_TOKEN } },
    );
  } catch (error) {
    throw formatAxiosError(error, 'IG DM reply');
  }
}

export async function replyToFacebookMessage(userId: string, message: string) {
  const url = `https://graph.facebook.com/v19.0/me/messages`;
  try {
    await axios.post(
      url,
      {
        recipient: { id: userId },
        messaging_type: 'RESPONSE',
        message: { text: message },
      },
      { params: { access_token: process.env.FACEBOOK_PAGE_TOKEN } },
    );
  } catch (error) {
    throw formatAxiosError(error, 'FB DM reply');
  }
}
