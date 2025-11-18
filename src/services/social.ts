import { env } from '@services/env';
import { getIdToken } from '@services/firebase';

const API_BASE = env.apiUrl?.replace(/\/$/, '') ?? '';

async function authedFetch(path: string, options: RequestInit = {}) {
  if (!API_BASE) throw new Error('Missing API URL');
  const token = await getIdToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed with status ${response.status}`);
  }
  return response.json();
}

export const generateContent = async (payload: { prompt: string; businessType: string }) => {
  const body = JSON.stringify({ ...payload });
  return authedFetch('/api/content/generate', { method: 'POST', body });
};

export const schedulePost = async (payload: any) => {
  const body = JSON.stringify(payload);
  return authedFetch('/api/posts/schedule', { method: 'POST', body });
};

export const fetchSocialHistory = async () => {
  return authedFetch('/api/social/history');
};
