import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { ThemeMode, setThemeColors } from '@constants/colors';

type ThemeContextValue = {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  toggleMode: () => void;
};

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [mode, setModeState] = useState<ThemeMode>('dark');

  useEffect(() => {
    setThemeColors(mode);
  }, [mode]);

  const value = useMemo(
    () => ({
      mode,
      setMode: (next: ThemeMode) => setModeState(next),
      toggleMode: () => setModeState(prev => (prev === 'dark' ? 'light' : 'dark'))
    }),
    [mode]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useThemeMode = () => {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useThemeMode must be used within ThemeProvider');
  }
  return ctx;
};
