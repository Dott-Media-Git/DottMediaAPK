import { getAuth } from 'firebase/auth';
import { translate, type Locale } from '@constants/i18n';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4000';

export type ChatResponse =
    | { type: 'text'; text: string }
    | { type: 'action'; action: string; params: any; text: string };

export const sendChatQuery = async (
    question: string,
    context: any,
    locale: Locale = 'en'
): Promise<ChatResponse> => {
    const auth = getAuth();
    const token = await auth.currentUser?.getIdToken();

    // If using mock auth in frontend, we might not have a real token.
    // The backend handles mock auth via ALLOW_MOCK_AUTH, but we should send a dummy token if needed.
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
    };

    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    } else {
        // Fallback for mock mode if no firebase user
        headers['Authorization'] = 'Bearer mock-token';
    }

    try {
        const response = await fetch(`${API_URL}/api/assistant/chat`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ question, context }),
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
