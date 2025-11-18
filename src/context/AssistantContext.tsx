import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

type AssistantContextValue = {
  enabled: boolean;
  hydrated: boolean;
  currentScreen?: string;
  toggleAssistant: (nextValue?: boolean) => Promise<void>;
  trackScreen: (screenName: string) => void;
};

const STORAGE_KEY = '@dott/assistant-enabled';

const AssistantContext = createContext<AssistantContextValue | undefined>(undefined);

export const AssistantProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [enabled, setEnabled] = useState(true);
  const [hydrated, setHydrated] = useState(false);
  const [currentScreen, setCurrentScreen] = useState<string>();

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

  const value = useMemo<AssistantContextValue>(
    () => ({
      enabled,
      hydrated,
      currentScreen,
      toggleAssistant,
      trackScreen: setCurrentScreen
    }),
    [enabled, hydrated, currentScreen]
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
