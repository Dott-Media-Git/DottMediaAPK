import { getAuth } from 'firebase/auth';
import { translate, type Locale } from '@constants/i18n';
import { env } from '@services/env';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4000';

export type ChatResponse =
    | { type: 'text'; text: string }
    | { type: 'action'; action: string; params: any; text: string };

export type SyncedConversation = {
    id: string;
    title: string;
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    updatedAt: string;
};

const getHeaders = async () => {
    const token = await getAuth().currentUser?.getIdToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    else if (env.offline) headers.Authorization = 'Bearer mock-token';
    return headers;
};

export const sendChatQuery = async (
    question: string,
    context: any,
    locale: Locale = 'en',
    conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [],
    conversationId?: string,
    conversationTitle?: string,
): Promise<ChatResponse> => {
    const headers = await getHeaders();

    try {
        const response = await fetch(`${API_URL}/api/assistant/chat`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ question, context, conversationHistory, conversationId, conversationTitle }),
        });

        if (!response.ok) {
            throw new Error(`Chat API error: ${response.statusText}`);
        }

        const data = await response.json();
        return data.answer;
    } catch (error) {
        console.error('Chat service error:', error);
        return {
            type: 'text',
            text: translate(locale, "I'm having trouble reaching the server. Please try again."),
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
