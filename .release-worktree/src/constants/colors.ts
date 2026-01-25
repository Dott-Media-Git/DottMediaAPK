export type ThemeMode = 'dark' | 'light';

export type Palette = {
  background: string;
  backgroundAlt: string;
  card: string;
  cardOverlay: string;
  cardBorderStart: string;
  cardBorderEnd: string;
  surface: string;
  text: string;
  subtext: string;
  accent: string;
  accentSecondary: string;
  accentMuted: string;
  border: string;
  success: string;
  danger: string;
  warning: string;
  overlay: string;
};

const darkPalette: Palette = {
  background: '#05040F',
  backgroundAlt: '#070A1F',
  card: 'rgba(13, 17, 40, 0.95)',
  cardOverlay: 'rgba(18, 22, 54, 0.8)',
  cardBorderStart: '#3F1AC9',
  cardBorderEnd: '#101632',
  surface: '#101632',
  text: '#F4F6FF',
  subtext: '#9BA9CA',
  accent: '#8B5DFF',
  accentSecondary: '#FF3DAE',
  accentMuted: '#4CC2FF',
  border: '#1E2650',
  success: '#4ADE80',
  danger: '#FB7185',
  warning: '#FBBF24',
  overlay: 'rgba(5, 7, 18, 0.78)'
};

const lightPalette: Palette = {
  background: '#FFFFFF',
  backgroundAlt: '#FFFFFF',
  card: '#FFFFFF',
  cardOverlay: '#F5F5F5',
  cardBorderStart: '#E5E7EB',
  cardBorderEnd: '#FFFFFF',
  surface: '#FFFFFF',
  text: '#0D1321',
  subtext: '#4B5563',
  accent: '#7C3AED',
  accentSecondary: '#FF2D55',
  accentMuted: '#2563EB',
  border: '#E2E8F0',
  success: '#16A34A',
  danger: '#DC2626',
  warning: '#FBBF24',
  overlay: 'rgba(15, 23, 42, 0.08)'
};

export const colors: Palette = { ...darkPalette };

export const setThemeColors = (mode: ThemeMode) => {
  const next = mode === 'light' ? lightPalette : darkPalette;
  (Object.keys(next) as Array<keyof Palette>).forEach(key => {
    colors[key] = next[key];
  });
};

export type ColorKey = keyof Palette;
