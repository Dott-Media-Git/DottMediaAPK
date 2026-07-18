import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { sendChatQuery } from '@services/chatService';
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
  sendMessage: (text: string, attachmentContext?: string) => Promise<string>;
};

const STORAGE_KEY = '@dott/assistant-enabled';
const STORAGE_KEY_ASSISTANT_TONE = '@dott/assistant-tone';
const STORAGE_KEY_ASSISTANT_VOICE = '@dott/assistant-voice';
const conversationsStorageKey = (userId?: string) => `@dott/conversations/${userId || 'guest'}`;

const AssistantContext = createContext<AssistantContextValue | undefined>(undefined);

const buildConversationContext = (conversations: Conversation[], currentMessages: Message[]) => {
  const orderedConversations = [...conversations].sort(
    (left, right) => new Date(left.updatedAt).getTime() - new Date(right.updatedAt).getTime(),
  );
  const combined = [...orderedConversations.flatMap(conversation => conversation.messages), ...currentMessages];
  const deduplicated = combined.filter((message, index) => {
    if (index === 0) return true;
    const previous = combined[index - 1];
    return previous.role !== message.role || previous.content !== message.content;
  });

  // Keep a broad cross-conversation memory while staying safely inside provider context limits.
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

  useEffect(() => {
    AsyncStorage.multiGet([STORAGE_KEY, STORAGE_KEY_ASSISTANT_TONE, STORAGE_KEY_ASSISTANT_VOICE])
      .then(entries => {
        const enabledValue = entries[0]?.[1];
        const toneValue = entries[1]?.[1];
        const voiceValue = entries[2]?.[1];

        if (enabledValue !== null) {
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
    setConversationsHydrated(false);
    AsyncStorage.getItem(conversationsStorageKey(authState.user?.uid))
      .then(value => {
        const parsed = value ? JSON.parse(value) : [];
        setConversations(Array.isArray(parsed) ? parsed : []);
        setMessages([]);
        setActiveConversationId(undefined);
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
    setMessages([]);
    setIsTyping(false);
    setActiveConversationId(undefined);
  };

  const openConversation = (id: string) => {
    const conversation = conversations.find(item => item.id === id);
    if (!conversation) return;
    setActiveConversationId(id);
    setMessages(conversation.messages);
    setIsTyping(false);
  };

  const deleteConversation = async (id: string) => {
    const next = conversations.filter(item => item.id !== id);
    setConversations(next);
    await AsyncStorage.setItem(conversationsStorageKey(authState.user?.uid), JSON.stringify(next));
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

  const sendMessage = async (text: string, attachmentContext?: string) => {
    const userMsg: Message = { role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);
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

      const effectiveText = attachmentContext?.trim() ? `${text}\n\nAttached files:\n${attachmentContext.trim()}` : text;
      const conversationContext = buildConversationContext(conversations, messages);
      const response = await sendChatQuery(effectiveText, context, locale, conversationContext);

      let botText = '';

      if (response.type === 'action') {
        handleToolCall(response.action, response.params);
        botText = response.text;
      } else {
        botText = response.text;
      }

      const botMsg: Message = { role: 'assistant', content: botText };
      setMessages(prev => [...prev, botMsg]);
      return botText;
    } catch (error) {
      const fallbackText = t("I'm sorry, I ran into an issue. Please try again.");
      const errorMsg: Message = {
        role: 'assistant',
        content: fallbackText,
      };
      setMessages(prev => [...prev, errorMsg]);
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
