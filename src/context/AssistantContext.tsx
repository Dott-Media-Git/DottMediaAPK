import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { deleteSyncedConversation, fetchSyncedConversations, sendChatQuery } from '@services/chatService';
import { navigationRef } from '@navigation/navigationRef';
import { useAuth } from './AuthContext';
import { useI18n } from './I18nContext';

type Message = {
  role: 'user' | 'assistant';
  content: string;
};

export type Conversation = {
  id: string;
  title: string;
  messages: Message[];
  updatedAt: string;
};

type AssistantContextValue = {
  enabled: boolean;
  hydrated: boolean;
  currentScreen?: string;
  isChatOpen: boolean;
  messages: Message[];
  conversations: Conversation[];
  activeConversationId?: string;
  isTyping: boolean;
  assistantTone: string;
  assistantVoice: string;
  toggleAssistant: (nextValue?: boolean) => Promise<void>;
  setAssistantTone: (tone: string) => Promise<void>;
  setAssistantVoice: (voice: string) => Promise<void>;
  toggleChat: (isOpen: boolean) => void;
  startNewChat: () => void;
  openConversation: (id: string) => void;
  deleteConversation: (id: string) => Promise<void>;
  trackScreen: (screenName: string) => void;
  sendMessage: (text: string, attachments?: Array<{ name: string; mimeType: string; size?: number; text?: string; dataUrl?: string }>) => Promise<string>;
};

const STORAGE_KEY = '@dott/assistant-enabled';
const STORAGE_KEY_ASSISTANT_TONE = '@dott/assistant-tone';
const STORAGE_KEY_ASSISTANT_VOICE = '@dott/assistant-voice';
const STORAGE_KEY_ALWAYS_ON_MIGRATION = '@dott/assistant-enabled-for-all-v1';
const conversationsStorageKey = (userId?: string) => `@dott/conversations/${userId || 'guest'}`;

const AssistantContext = createContext<AssistantContextValue | undefined>(undefined);

const buildConversationContext = (currentMessages: Message[]) => {
  // Only send the active thread. Including every previous conversation makes
  // short follow-ups such as “option 3 and 2” ambiguous and can cause Dotti to
  // answer from an unrelated chat.
  const deduplicated = currentMessages.filter((message, index) => {
    if (index === 0) return true;
    const previous = currentMessages[index - 1];
    return previous.role !== message.role || previous.content !== message.content;
  });

  const selected: Message[] = [];
  let characterCount = 0;
  for (let index = deduplicated.length - 1; index >= 0 && selected.length < 120; index -= 1) {
    const message = deduplicated[index];
    const content = message.content.slice(0, 4000);
    if (selected.length > 0 && characterCount + content.length > 60_000) break;
    selected.unshift({ ...message, content });
    characterCount += content.length;
  }
  return selected;
};

export const AssistantProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { state: authState } = useAuth();
  const { locale, t } = useI18n();
  const [enabled, setEnabled] = useState(true);
  const [hydrated, setHydrated] = useState(false);
  const [currentScreen, setCurrentScreen] = useState<string>();
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string>();
  const [conversationsHydrated, setConversationsHydrated] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [assistantTone, setAssistantToneValue] = useState('fresh');
  const [assistantVoice, setAssistantVoiceValue] = useState('neutral');
  const messagesRef = useRef<Message[]>([]);
  const activeConversationIdRef = useRef<string | undefined>(undefined);
  const hydratedConversationUserRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    AsyncStorage.multiGet([STORAGE_KEY, STORAGE_KEY_ASSISTANT_TONE, STORAGE_KEY_ASSISTANT_VOICE, STORAGE_KEY_ALWAYS_ON_MIGRATION])
      .then(entries => {
        const enabledValue = entries[0]?.[1];
        const toneValue = entries[1]?.[1];
        const voiceValue = entries[2]?.[1];
        const migrated = entries[3]?.[1] === 'true';

        if (!migrated) {
          setEnabled(true);
          void AsyncStorage.multiSet([
            [STORAGE_KEY, 'true'],
            [STORAGE_KEY_ALWAYS_ON_MIGRATION, 'true'],
          ]);
        } else if (enabledValue !== null) {
          setEnabled(enabledValue === 'true');
        }
        if (toneValue) {
          setAssistantToneValue(toneValue);
        }
        if (voiceValue) {
          setAssistantVoiceValue(voiceValue);
        }
      })
      .finally(() => setHydrated(true));
  }, []);

  useEffect(() => {
    const conversationUserId = authState.user?.uid;
    // Clear a previous user's thread immediately, before asynchronous storage
    // and cloud reads begin. This prevents an account switch from leaking
    // messages while still allowing a fast first message to survive hydration.
    if (hydratedConversationUserRef.current !== conversationUserId) {
      hydratedConversationUserRef.current = conversationUserId;
      messagesRef.current = [];
      activeConversationIdRef.current = undefined;
      setMessages([]);
      setActiveConversationId(undefined);
    }
    setConversationsHydrated(false);
    const localPromise = AsyncStorage.getItem(conversationsStorageKey(conversationUserId))
      .then(value => value ? JSON.parse(value) : [])
      .catch(() => []);
    const cloudPromise = conversationUserId
      ? fetchSyncedConversations().catch(error => {
          console.warn('Cloud conversation sync unavailable; using local conversations', error);
          return [];
        })
      : Promise.resolve([]);
    Promise.all([localPromise, cloudPromise])
      .then(([localValue, cloudValue]) => {
        const local = Array.isArray(localValue) ? localValue as Conversation[] : [];
        const merged = new Map<string, Conversation>();
        [...local, ...cloudValue].forEach(conversation => {
          const existing = merged.get(conversation.id);
          if (!existing || new Date(conversation.updatedAt).getTime() >= new Date(existing.updatedAt).getTime()) {
            merged.set(conversation.id, conversation);
          }
        });
        const next = [...merged.values()]
          .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
          .slice(0, 50);
        setConversations(next);
        void AsyncStorage.setItem(conversationsStorageKey(conversationUserId), JSON.stringify(next));
        // A fast message may arrive while storage is loading. Do not erase it
        // when the hydration request completes.
        if (messagesRef.current.length === 0) {
          activeConversationIdRef.current = undefined;
          setActiveConversationId(undefined);
          setMessages([]);
        }
      })
      .catch(() => setConversations([]))
      .finally(() => setConversationsHydrated(true));
  }, [authState.user?.uid]);

  useEffect(() => {
    if (!conversationsHydrated || messages.length === 0) return;
    const id = activeConversationId ?? `chat-${Date.now()}`;
    if (!activeConversationId) setActiveConversationId(id);
    const firstUserMessage = messages.find(message => message.role === 'user')?.content ?? 'New conversation';
    const title = firstUserMessage.replace(/\s+/g, ' ').trim().slice(0, 52) || 'New conversation';
    setConversations(current => {
      const next = [
        { id, title, messages, updatedAt: new Date().toISOString() },
        ...current.filter(conversation => conversation.id !== id),
      ].slice(0, 50);
      void AsyncStorage.setItem(conversationsStorageKey(authState.user?.uid), JSON.stringify(next));
      return next;
    });
  }, [messages, activeConversationId, conversationsHydrated, authState.user?.uid]);

  const toggleAssistant = async (nextValue?: boolean) => {
    const resolved = typeof nextValue === 'boolean' ? nextValue : !enabled;
    setEnabled(resolved);
    await AsyncStorage.setItem(STORAGE_KEY, resolved ? 'true' : 'false');
  };

  const setAssistantTone = async (tone: string) => {
    setAssistantToneValue(tone);
    await AsyncStorage.setItem(STORAGE_KEY_ASSISTANT_TONE, tone);
  };

  const setAssistantVoice = async (voice: string) => {
    setAssistantVoiceValue(voice);
    await AsyncStorage.setItem(STORAGE_KEY_ASSISTANT_VOICE, voice);
  };

  const toggleChat = (isOpen: boolean) => {
    setIsChatOpen(isOpen);
  };

  const startNewChat = () => {
    messagesRef.current = [];
    activeConversationIdRef.current = undefined;
    setMessages([]);
    setIsTyping(false);
    setActiveConversationId(undefined);
  };

  const openConversation = (id: string) => {
    const conversation = conversations.find(item => item.id === id);
    if (!conversation) return;
    activeConversationIdRef.current = id;
    messagesRef.current = conversation.messages;
    setActiveConversationId(id);
    setMessages(conversation.messages);
    setIsTyping(false);
  };

  const deleteConversation = async (id: string) => {
    const next = conversations.filter(item => item.id !== id);
    setConversations(next);
    await AsyncStorage.setItem(conversationsStorageKey(authState.user?.uid), JSON.stringify(next));
    await deleteSyncedConversation(id).catch(error => console.warn('Cloud conversation delete failed', error));
    if (activeConversationId === id) startNewChat();
  };

  const handleToolCall = (action: string, params: any) => {
    console.log('Executing tool:', action, params);
    if (action === 'navigate') {
      if (navigationRef.isReady()) {
        try {
          navigationRef.navigate(params.screen as never);
          return `Navigated to ${params.screen}`;
        } catch (error) {
          console.warn('Navigation failed', error);
          return 'Failed to navigate.';
        }
      }
      console.warn('Navigation not ready yet');
      return 'Unable to navigate right now.';
    }
    if (action === 'get_insights') {
      // In a real app, we would query the analytics service here.
      // For now, we return a placeholder or rely on the context already sent.
      return `Here are the insights for ${params.metric}.`;
    }
    return 'Action performed.';
  };

  const sendMessage = async (text: string, attachments?: Array<{ name: string; mimeType: string; size?: number; text?: string; dataUrl?: string }>) => {
    const hadActiveConversation = Boolean(activeConversationIdRef.current);
    const conversationId = activeConversationIdRef.current ?? `chat-${Date.now()}`;
    activeConversationIdRef.current = conversationId;
    if (!hadActiveConversation) setActiveConversationId(conversationId);
    const userMsg: Message = { role: 'user', content: text };
    const currentMessages = messagesRef.current;
    const nextMessages = [...currentMessages, userMsg];
    messagesRef.current = nextMessages;
    setMessages(nextMessages);
    setIsTyping(true);

    try {
      const connectedChannels = [
        authState.crmData?.instagram ? 'instagram' : null,
        authState.crmData?.facebook ? 'facebook' : null,
        authState.crmData?.linkedin ? 'linkedin' : null
      ].filter(Boolean) as string[];
      const context = {
        currentScreen,
        company: authState.crmData?.companyName,
        orgId: ((authState.user as any)?.orgId ?? authState.crmData?.orgId) as string | undefined,
        businessGoals: authState.crmData?.businessGoals,
        targetAudience: authState.crmData?.targetAudience,
        analytics: authState.crmData?.analytics,
        subscriptionStatus: authState.subscriptionStatus,
        connectedChannels,
        locale,
        assistantTone,
        assistantVoice,
      };

      const conversationContext = buildConversationContext(currentMessages);
      const conversationTitle = (currentMessages.find(message => message.role === 'user')?.content ?? text)
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 52) || 'Chat with Dotti';
      const response = await sendChatQuery(
        text,
        context,
        locale,
        conversationContext,
        conversationId,
        conversationTitle,
        attachments,
      );

      let botText = '';

      if (response.type === 'action') {
        handleToolCall(response.action, response.params);
        botText = response.text;
      } else {
        botText = response.text;
      }

      const botMsg: Message = { role: 'assistant', content: botText };
      const completedMessages = [...messagesRef.current, botMsg];
      messagesRef.current = completedMessages;
      setMessages(completedMessages);
      return botText;
    } catch (error) {
      const fallbackText = t("I'm sorry, I ran into an issue. Please try again.");
      const errorMsg: Message = {
        role: 'assistant',
        content: fallbackText,
      };
      const completedMessages = [...messagesRef.current, errorMsg];
      messagesRef.current = completedMessages;
      setMessages(completedMessages);
      return fallbackText;
    } finally {
      setIsTyping(false);
    }
  };

  const value = useMemo<AssistantContextValue>(
    () => ({
      enabled,
      hydrated,
      currentScreen,
      isChatOpen,
      messages,
      conversations,
      activeConversationId,
      isTyping,
      assistantTone,
      assistantVoice,
      toggleAssistant,
      setAssistantTone,
      setAssistantVoice,
      toggleChat,
      startNewChat,
      openConversation,
      deleteConversation,
      trackScreen: setCurrentScreen,
      sendMessage,
    }),
    [enabled, hydrated, currentScreen, isChatOpen, messages, conversations, activeConversationId, isTyping, assistantTone, assistantVoice]
  );

  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>;
};

export const useAssistant = () => {
  const ctx = useContext(AssistantContext);
  if (!ctx) {
    throw new Error('useAssistant must be used within AssistantProvider');
  }
  return ctx;
};
