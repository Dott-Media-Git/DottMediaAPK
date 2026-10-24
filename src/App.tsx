import 'react-native-gesture-handler';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Platform, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Font from 'expo-font';
import { Ionicons } from '@expo/vector-icons';
import { AuthProvider, useAuth } from '@context/AuthContext';
import { AssistantProvider } from '@context/AssistantContext';
import { ThemeProvider, useThemeMode } from '@context/ThemeContext';
import { I18nProvider } from '@context/I18nContext';
import { AppNavigator } from '@navigation/AppNavigator';
import { colors } from '@constants/colors';
import { FloatingAssistant } from '@components/FloatingAssistant';
import { warmPrimaryScreenCaches } from '@services/appWarmCache';

// React Navigation 6's web drawer still calls the Reanimated 3 gesture hook,
// which was removed in Reanimated 4. Web disables drawer swipe gestures and
// uses the navigation buttons instead, so provide a no-op compatibility hook
// before the drawer is rendered. Native platforms keep the real implementation.
if (Platform.OS === 'web') {
  const reanimated = require('react-native-reanimated');
  if (typeof reanimated.useAnimatedGestureHandler !== 'function') {
    reanimated.useAnimatedGestureHandler = () => undefined;
  }
}

// Android devices can have a user-selected display font. The app does not
// ship a decorative typeface, so explicitly use Android's standard sans-serif
// family for unstyled text to keep the Play Store build visually consistent.
if (Platform.OS === 'android') {
  (Text as any).defaultProps = { ...(Text as any).defaultProps, style: { fontFamily: 'sans-serif' } };
  (TextInput as any).defaultProps = { ...(TextInput as any).defaultProps, style: { fontFamily: 'sans-serif' } };
}

const WARM_CACHE_COOLDOWN_MS = 1000 * 60 * 3;
const WEB_SCROLLBAR_STYLE_ID = 'dotti-web-scrollbars';

const installWebScrollbarStyles = (mode: 'dark' | 'light') => {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;

  const isDark = mode === 'dark';
  const track = isDark ? 'rgba(13, 17, 40, 0.72)' : 'rgba(226, 232, 240, 0.86)';
  const thumb = isDark ? '#6F4FD2' : '#8B5CF6';
  const thumbHover = isDark ? '#A98BFF' : '#6D28D9';

  let style = document.getElementById(WEB_SCROLLBAR_STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = WEB_SCROLLBAR_STYLE_ID;
    document.head.appendChild(style);
  }

  // React Native Web renders ScrollView containers as regular DOM elements.
  // Styling the native web scrollbar here keeps touch scrolling unchanged on
  // phones while giving desktop users a compact, branded control.
  style.textContent = `
    html,
    body,
    * {
      scrollbar-width: thin;
      scrollbar-color: ${thumb} ${track};
    }

    *::-webkit-scrollbar {
      width: 10px;
      height: 10px;
    }

    *::-webkit-scrollbar-track {
      background: ${track};
      border-radius: 999px;
    }

    *::-webkit-scrollbar-thumb {
      background: ${thumb};
      border: 3px solid transparent;
      border-radius: 999px;
      background-clip: content-box;
      min-height: 36px;
    }

    *::-webkit-scrollbar-thumb:hover {
      background: ${thumbHover};
      background-clip: content-box;
    }

    *::-webkit-scrollbar-thumb:active {
      background: ${thumbHover};
      background-clip: content-box;
    }

    *::-webkit-scrollbar-corner {
      background: transparent;
    }
  `;
};

const RootView: React.FC = () => {
  const { state } = useAuth();
  const { mode } = useThemeMode();
  const lastWarmAtRef = useRef(0);
  const warmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    installWebScrollbarStyles(mode);
  }, [mode]);

  const warmSnapshots = useCallback(
    (force = false) => {
      if (!state.hydrated || !state.user?.uid) return;
      const now = Date.now();
      if (!force && now - lastWarmAtRef.current < WARM_CACHE_COOLDOWN_MS) {
        return;
      }
      lastWarmAtRef.current = now;
      if (warmTimerRef.current) clearTimeout(warmTimerRef.current);
      warmTimerRef.current = setTimeout(() => {
        void warmPrimaryScreenCaches({
          userId: state.user?.uid,
          orgId: (state.user as any)?.orgId ?? state.crmData?.orgId,
          seedAnalytics: state.crmData?.analytics,
        });
      }, 700);
    },
    [state.crmData?.analytics, state.crmData?.orgId, state.hydrated, state.user],
  );

  useEffect(
    () => () => {
      if (warmTimerRef.current) clearTimeout(warmTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    if (!state.hydrated || !state.user?.uid) return;
    warmSnapshots(true);
  }, [state.hydrated, state.user?.uid, warmSnapshots]);

  useEffect(() => {
    if (!state.user?.uid) return;
    const subscription = AppState.addEventListener('change', nextState => {
      if (nextState === 'active') {
        warmSnapshots(false);
      }
    });
    return () => {
      subscription.remove();
    };
  }, [state.user?.uid, warmSnapshots]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined' || !state.user?.uid) return;
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        warmSnapshots(false);
      }
    };
    const handleFocus = () => {
      warmSnapshots(false);
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleFocus);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleFocus);
    };
  }, [state.user?.uid, warmSnapshots]);

  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={styles.root}>
        <StatusBar barStyle={mode === 'light' ? 'dark-content' : 'light-content'} />
        <AppNavigator />
        <FloatingAssistant />
        {state.loading ? (
          <View style={styles.overlay}>
            <ActivityIndicator size="large" color={colors.accent} />
          </View>
        ) : null}
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
};

export default function App() {
  const [fontsReady, setFontsReady] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const finalize = () => {
      if (isMounted) {
        setFontsReady(true);
      }
    };

    Font.loadAsync(Ionicons.font)
      .then(finalize)
      .catch(() => finalize());

    return () => {
      isMounted = false;
    };
  }, []);

  if (!fontsReady) {
    return (
      <View style={styles.fontLoader}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }
  return (
    <ThemeProvider>
      <I18nProvider>
        <AuthProvider>
          <AssistantProvider>
            <RootView />
          </AssistantProvider>
        </AuthProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.overlay
  },
  fontLoader: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background
  }
});
