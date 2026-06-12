import { env } from '@services/env';
import { getIdToken } from '@services/firebase';

const API_BASE = env.apiUrl?.replace(/\/$/, '') ?? '';

export const adminFetch = async (path: string, options: RequestInit = {}, orgId?: string) => {
  if (!API_BASE) throw new Error('API url not configured');
  const token = await getIdToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (orgId) headers['x-org-id'] = orgId;
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });
  if (!response.ok) {
    const body = await response.text();
    let message = body;
    try {
      const parsed = JSON.parse(body);
      message = parsed?.message || parsed?.error || body;
    } catch {
      message = body;
    }
    throw new Error(message || `Request failed (${response.status})`);
  }
  return response.json();
};
