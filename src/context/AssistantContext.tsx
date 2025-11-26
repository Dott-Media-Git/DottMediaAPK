import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import { sendChatQuery } from '@services/chatService';
import { useAuth } from './AuthContext';

type Message = {
  role: 'user' | 'assistant';
  content: string;
};

type AssistantContextValue = {
  enabled: boolean;
  hydrated: boolean;
  currentScreen?: string;
  isChatOpen: boolean;
  messages: Message[];
  isTyping: boolean;
  toggleAssistant: (nextValue?: boolean) => Promise<void>;
  toggleChat: (isOpen: boolean) => void;
  trackScreen: (screenName: string) => void;
  sendMessage: (text: string) => Promise<void>;
};

const STORAGE_KEY = '@dott/assistant-enabled';

const AssistantContext = createContext<AssistantContextValue | undefined>(undefined);

export const AssistantProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { state: authState } = useAuth();
  const navigation = useNavigation<any>();
  const [enabled, setEnabled] = useState(true);
  const [hydrated, setHydrated] = useState(false);
  const [currentScreen, setCurrentScreen] = useState<string>();
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isTyping, setIsTyping] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then(value => {
        if (value !== null) {
          setEnabled(value === 'true');
        }
      })
      .finally(() => setHydrated(true));
  }, []);

  const toggleAssistant = async (nextValue?: boolean) => {
    const resolved = typeof nextValue === 'boolean' ? nextValue : !enabled;
    setEnabled(resolved);
    await AsyncStorage.setItem(STORAGE_KEY, resolved ? 'true' : 'false');
  };

  const toggleChat = (isOpen: boolean) => {
    setIsChatOpen(isOpen);
  };

  const handleToolCall = (action: string, params: any) => {
    console.log('Executing tool:', action, params);
    if (action === 'navigate') {
      try {
        navigation.navigate(params.screen);
        return `Navigated to ${params.screen}`;
      } catch (error) {
        console.warn('Navigation failed', error);
        return 'Failed to navigate.';
      }
    }
    if (action === 'get_insights') {
      // In a real app, we would query the analytics service here.
      // For now, we return a placeholder or rely on the context already sent.
      return `Here are the insights for ${params.metric}.`;
    }
    return 'Action performed.';
  };

  const sendMessage = async (text: string) => {
    const userMsg: Message = { role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);
    setIsTyping(true);

    try {
      const context = {
        currentScreen,
        company: authState.crmData?.companyName,
        analytics: authState.crmData?.analytics,
      };

      const response = await sendChatQuery(text, context);

      let botText = '';

      if (response.type === 'action') {
        handleToolCall(response.action, response.params);
        botText = response.text;
      } else {
        botText = response.text;
      }

      const botMsg: Message = { role: 'assistant', content: botText };
      setMessages(prev => [...prev, botMsg]);
    } catch (error) {
      const errorMsg: Message = {
        role: 'assistant',
        content: "I'm sorry, I ran into an issue. Please try again.",
      };
      setMessages(prev => [...prev, errorMsg]);
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
      isTyping,
      toggleAssistant,
      toggleChat,
      trackScreen: setCurrentScreen,
      sendMessage,
    }),
    [enabled, hydrated, currentScreen, isChatOpen, messages, isTyping]
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
