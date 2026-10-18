import { getAuth } from 'firebase/auth';
import { translate, type Locale } from '@constants/i18n';
import { env } from '@services/env';

// Prefer the Expo runtime configuration so native release builds and web use
// the same backend. A localhost default makes a released phone try to call
// itself, which surfaces as the generic "trouble reaching the server" reply.
const API_URL = (
    env.apiUrl ||
    (typeof __DEV__ !== 'undefined' && __DEV__ ? 'http://localhost:4000' : 'https://dottmediaapk.onrender.com')
).replace(/\/$/, '');
const REQUEST_TIMEOUT_MS = Math.max(Number(process.env.EXPO_PUBLIC_ASSISTANT_TIMEOUT_MS ?? 45_000), 10_000);
const MAX_ATTEMPTS = 3;

export type ChatResponse =
    | { type: 'text'; text: string }
    | { type: 'action'; action: string; params: any; text: string };

export type SyncedConversation = {
    id: string;
    title: string;
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    updatedAt: string;
};

const getHeaders = async (forceRefresh = false) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    try {
        const token = await getAuth().currentUser?.getIdToken(forceRefresh);
        if (token) headers.Authorization = `Bearer ${token}`;
        else if (env.offline) headers.Authorization = 'Bearer mock-token';
    } catch (error) {
        // A stale Firebase session must not prevent Dotti from returning a
        // useful guest/local response while the auth state recovers.
        console.warn('Unable to read the Firebase session for Dotti', error);
        if (env.offline) headers.Authorization = 'Bearer mock-token';
    }
    return headers;
};

const wait = (delayMs: number) => new Promise(resolve => setTimeout(resolve, delayMs));

const isRetryableStatus = (status: number) => status === 408 || status === 425 || status === 429 || status >= 500;

const buildUnavailableResponse = (question: string, locale: Locale) => {
    const normalized = question.trim().toLowerCase();
    if (/^(hi|hello|hey|howdy|good morning|good afternoon|good evening)[!.?,\s]*$/i.test(normalized)) {
        return translate(locale, 'Hi! I’m Dotti. The live brain is reconnecting, but I’m here. What would you like to work on?');
    }
    return translate(
        locale,
        'I’m still here, but the live brain is temporarily reconnecting. Your message was kept in this chat—please send it again and I’ll continue from the context already here.'
    );
};

export const sendChatQuery = async (
    question: string,
    context: any,
    locale: Locale = 'en',
    conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [],
    conversationId?: string,
    conversationTitle?: string,
    attachments: Array<{ name: string; mimeType: string; size?: number; text?: string; dataUrl?: string }> = [],
): Promise<ChatResponse> => {
    try {
        let forceRefresh = false;
        let lastError: unknown;
        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
            const headers = await getHeaders(forceRefresh);
            forceRefresh = false;
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
            try {
                const response = await fetch(`${API_URL}/api/assistant/chat`, {
                    method: 'POST',
                    headers,
                    signal: controller.signal,
                    body: JSON.stringify({ question, context, conversationHistory, conversationId, conversationTitle, attachments: attachments.slice(0, 8) }),
                });

                if (response.ok) {
                    const data = await response.json();
                    if (data?.answer) return data.answer;
                    throw new Error('Assistant API returned no answer');
                }

                // Refresh an expired ID token once before falling back.
                if (response.status === 401 && !forceRefresh && attempt < MAX_ATTEMPTS - 1) {
                    forceRefresh = true;
                    continue;
                }
                const error = new Error(`Chat API error: ${response.status} ${response.statusText}`);
                lastError = error;
                if (!isRetryableStatus(response.status) || attempt >= MAX_ATTEMPTS - 1) throw error;
            } catch (error) {
                lastError = error;
                if (attempt >= MAX_ATTEMPTS - 1) throw error;
            } finally {
                clearTimeout(timeout);
            }
            await wait(Math.min(1_000 * 2 ** attempt, 4_000));
        }
        throw lastError ?? new Error('Assistant request failed');
    } catch (error) {
        console.error('Chat service error:', error);
        return {
            type: 'text',
            text: buildUnavailableResponse(question, locale),
        };
    }
};

export const fetchSyncedConversations = async (): Promise<SyncedConversation[]> => {
    if (!API_URL) return [];
    const response = await fetch(`${API_URL}/api/assistant/conversations`, { headers: await getHeaders() });
    if (!response.ok) throw new Error(`Conversation sync failed: ${response.status}`);
    const data = await response.json();
    return Array.isArray(data?.conversations)
        ? data.conversations.map((conversation: any) => ({
            id: String(conversation.id),
            title: String(conversation.title || 'Chat with Dotti'),
            updatedAt: String(conversation.updatedAt || new Date(0).toISOString()),
            messages: Array.isArray(conversation.messages)
                ? conversation.messages.map((message: any) => ({ role: message.role, content: String(message.content || '') }))
                : [],
        }))
        : [];
};

export const deleteSyncedConversation = async (conversationId: string) => {
    if (!API_URL) return;
    const response = await fetch(`${API_URL}/api/assistant/conversations/${encodeURIComponent(conversationId)}`, {
        method: 'DELETE',
        headers: await getHeaders(),
    });
    if (!response.ok && response.status !== 404) throw new Error(`Conversation delete sync failed: ${response.status}`);
};
