import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SUPPORTED_LOCALES, translate, type Locale } from '@constants/i18n';

type I18nContextValue = {
  locale: Locale;
  setLocale: (next: Locale) => Promise<void>;
  t: (key: string, params?: Record<string, string | number>) => string;
};

const STORAGE_KEY = '@dott/locale';
const DEFAULT_LOCALE = SUPPORTED_LOCALES[0];

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

const normalizeLocale = (value?: string): Locale => {
  if (!value) return DEFAULT_LOCALE;
  return (SUPPORTED_LOCALES as string[]).includes(value) ? (value as Locale) : DEFAULT_LOCALE;
};

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then(value => setLocaleState(normalizeLocale(value ?? undefined)))
      .catch(() => undefined);
  }, []);

  const setLocale = async (next: Locale) => {
    const normalized = normalizeLocale(next);
    setLocaleState(normalized);
    await AsyncStorage.setItem(STORAGE_KEY, normalized);
  };

  const t = (key: string, params?: Record<string, string | number>) => translate(locale, key, params);

  const value = useMemo(
    () => ({
      locale,
      setLocale,
      t
    }),
    [locale]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export const useI18n = () => {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error('useI18n must be used within I18nProvider');
  }
  return ctx;
};
