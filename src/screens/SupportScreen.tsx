import React from 'react';
import { Alert, ScrollView, StyleSheet, Text } from 'react-native';
import * as Linking from 'expo-linking';
import { LinearGradient } from 'expo-linear-gradient';
import { DMButton } from '@components/DMButton';
import { DMCard } from '@components/DMCard';
import { colors } from '@constants/colors';
import { useThemeMode } from '@context/ThemeContext';

const SUPPORT_WHATSAPP_URL = 'https://wa.me/2348130000000';

export const SupportScreen: React.FC = () => {
  const { mode, toggleMode } = useThemeMode();

  const openWhatsApp = async () => {
    try {
      const supported = await Linking.canOpenURL(SUPPORT_WHATSAPP_URL);
      if (supported) {
        await Linking.openURL(SUPPORT_WHATSAPP_URL);
      } else {
        Alert.alert('WhatsApp not available', 'Please install WhatsApp or contact support via email.');
      }
    } catch (error) {
      Alert.alert('Unable to open WhatsApp', 'Please try again later.');
      console.error(error);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <LinearGradient colors={[colors.accent, colors.accentSecondary]} style={styles.hero}>
        <Text style={styles.badge}>Support</Text>
        <Text style={styles.title}>Ops team on standby</Text>
        <Text style={styles.subtitle}>
          Same neon vibe you see on dott-media.com, now backing live WhatsApp and knowledge base support.
        </Text>
      </LinearGradient>
      <DMCard title="Theme">
        <Text style={styles.cardText}>Toggle between light and dark workspaces whenever you like.</Text>
        <DMButton title={mode === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'} onPress={toggleMode} />
      </DMCard>
      <DMCard title="WhatsApp Business">
        <Text style={styles.cardText}>Chat with us for onboarding questions or live campaign tweaks.</Text>
        <DMButton title="Chat on WhatsApp" onPress={openWhatsApp} />
      </DMCard>
      <DMCard title="Resources">
        <Text style={styles.cardText}>- Automation knowledge base (coming soon)</Text>
        <Text style={styles.cardText}>- AI chatbot assistant (beta)</Text>
      </DMCard>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background
  },
  content: {
    padding: 20,
    paddingBottom: 40
  },
  hero: {
    borderRadius: 30,
    padding: 22,
    marginBottom: 18
  },
  badge: {
    color: colors.text,
    textTransform: 'uppercase',
    letterSpacing: 1.4,
    fontSize: 12
  },
  title: {
    color: colors.text,
    fontSize: 26,
    fontWeight: '800',
    marginTop: 8,
    marginBottom: 6
  },
  subtitle: {
    color: colors.background,
    opacity: 0.9,
    lineHeight: 20
  },
  cardText: {
    color: colors.subtext,
    marginBottom: 8
  }
});
