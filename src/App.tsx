import 'react-native-gesture-handler';
import React from 'react';
import { ActivityIndicator, StatusBar, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '@context/AuthContext';
import { AssistantProvider } from '@context/AssistantContext';
import { ThemeProvider, useThemeMode } from '@context/ThemeContext';
import { AppNavigator } from '@navigation/AppNavigator';
import { colors } from '@constants/colors';
import { FloatingAssistant } from '@components/FloatingAssistant';

const RootView: React.FC = () => {
  const { state } = useAuth();
  const { mode } = useThemeMode();
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
  return (
    <ThemeProvider>
      <AuthProvider>
        <AssistantProvider>
          <RootView />
        </AssistantProvider>
      </AuthProvider>
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
  }
});