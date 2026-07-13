import 'react-native-gesture-handler';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, StatusBar, StyleSheet, View } from 'react-native';
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

const WARM_CACHE_COOLDOWN_MS = 1000 * 60 * 3;

const RootView: React.FC = () => {
  const { state } = useAuth();
  const { mode } = useThemeMode();
  const lastWarmAtRef = useRef(0);
  const warmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
