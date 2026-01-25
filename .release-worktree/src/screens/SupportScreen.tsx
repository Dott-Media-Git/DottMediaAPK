import React, { useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import * as Linking from 'expo-linking';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { DMButton } from '@components/DMButton';
import { DMCard } from '@components/DMCard';
import { colors } from '@constants/colors';
import { useThemeMode } from '@context/ThemeContext';
import { useAssistant } from '@context/AssistantContext';
import { useI18n } from '@context/I18nContext';
import { LOCALE_FLAGS, LOCALE_LABELS, SUPPORTED_LOCALES, type Locale } from '@constants/i18n';
import { getIdToken } from '@services/firebase';
import { env } from '@services/env';

const SUPPORT_WHATSAPP_URL = 'https://wa.me/2348130000000';
const LANGUAGE_OPTIONS: Array<{ value: Locale; label: string; flag: string }> = SUPPORTED_LOCALES.map(locale => ({
  value: locale,
  label: LOCALE_LABELS[locale],
  flag: LOCALE_FLAGS[locale]
}));

export const SupportScreen: React.FC = () => {
  const { mode, toggleMode } = useThemeMode();
  const { enabled: assistantEnabled, toggleAssistant } = useAssistant();
  const { locale, setLocale, t } = useI18n();
  const [assistantSwitchLoading, setAssistantSwitchLoading] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const currentLabel = `${LOCALE_FLAGS[locale]} ${LOCALE_LABELS[locale]}`;

  const handleSelectLocale = async (value: Locale) => {
    await setLocale(value);
    setMenuOpen(false);
  };

  const handleAssistantToggle = async (value: boolean) => {
    setAssistantSwitchLoading(true);
    try {
      await toggleAssistant(value);
    } finally {
      setAssistantSwitchLoading(false);
    }
  };

  const handleCopyIdToken = async () => {
    try {
      const token = await getIdToken();
      if (!token) {
        Alert.alert(t('Token unavailable'), t('Sign in again to generate a fresh token.'));
        return;
      }
      const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
      if (clipboard?.writeText) {
        await clipboard.writeText(token);
        Alert.alert(t('Copied'), t('Firebase ID token copied to clipboard.'));
      } else {
        console.log('Firebase ID token:', token);
        Alert.alert(t('Token ready'), t('Token printed to console.'));
      }
    } catch (error) {
      console.error(error);
      Alert.alert(t('Unable to fetch token'), t('Please try again.'));
    }
  };

  const openWhatsApp = async () => {
    try {
      const supported = await Linking.canOpenURL(SUPPORT_WHATSAPP_URL);
      if (supported) {
        await Linking.openURL(SUPPORT_WHATSAPP_URL);
      } else {
        Alert.alert(t('WhatsApp not available'), t('Please install WhatsApp or contact support via email.'));
      }
    } catch (error) {
      Alert.alert(t('Unable to open WhatsApp'), t('Please try again later.'));
      console.error(error);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <LinearGradient colors={[colors.accent, colors.accentSecondary]} style={styles.hero}>
        <Text style={styles.badge}>{t('Support')}</Text>
        <Text style={styles.title}>{t('Ops team on standby')}</Text>
        <Text style={styles.subtitle}>
          {t('Same neon vibe you see on dott-media.com, now backing live WhatsApp and knowledge base support.')}
        </Text>
      </LinearGradient>
      <DMCard title={t('Theme')}>
        <Text style={styles.cardText}>{t('Toggle between light and dark workspaces whenever you like.')}</Text>
        <DMButton
          title={mode === 'dark' ? t('Switch to Light Mode') : t('Switch to Dark Mode')}
          onPress={toggleMode}
        />
      </DMCard>
      <DMCard title={t('Assistant overlay')} subtitle={t('Toggle the floating help bubble')}>
        <View style={styles.row}>
          <Text style={styles.statusLabel}>{assistantEnabled ? t('Assistant On') : t('Assistant Off')}</Text>
          <Switch
            value={assistantEnabled}
            onValueChange={handleAssistantToggle}
            thumbColor={colors.text}
            trackColor={{ false: colors.border, true: colors.accent }}
            disabled={assistantSwitchLoading}
          />
        </View>
        <Text style={styles.cardText}>{t('Disable this if you prefer a distraction-free workspace.')}</Text>
      </DMCard>
      {env.debugTools ? (
        <DMCard title={t('Debug tools')} subtitle={t('Temporary utilities for support')}>
          <Text style={styles.cardText}>
            {t('Copy your Firebase ID token to share with support.')}
          </Text>
          <DMButton title={t('Copy Firebase ID token')} onPress={handleCopyIdToken} />
        </DMCard>
      ) : null}
      <DMCard title={t('Language')} subtitle={t('Select your language')}>
        <TouchableOpacity style={styles.selectButton} onPress={() => setMenuOpen(true)}>
          <View>
            <Text style={styles.selectLabel}>
              {t('Current: {{value}}', { value: currentLabel })}
            </Text>
            <Text style={styles.cardText}>{t('Choose your language to personalize the app.')}</Text>
          </View>
          <Ionicons name="chevron-down" size={18} color={colors.subtext} />
        </TouchableOpacity>
      </DMCard>
      <DMCard title={t('WhatsApp Business')}>
        <Text style={styles.cardText}>{t('Chat with us for onboarding questions or live campaign tweaks.')}</Text>
        <DMButton title={t('Chat on WhatsApp')} onPress={openWhatsApp} />
      </DMCard>
      <DMCard title={t('Resources')}>
        <Text style={styles.cardText}>{t('- Automation knowledge base (coming soon)')}</Text>
        <Text style={styles.cardText}>{t('- AI chatbot assistant (beta)')}</Text>
      </DMCard>
      <Modal visible={menuOpen} transparent animationType="fade">
        <Pressable style={styles.modalBackdrop} onPress={() => setMenuOpen(false)}>
          <Pressable style={styles.modalCard} onPress={() => undefined}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t('Select your language')}</Text>
              <TouchableOpacity onPress={() => setMenuOpen(false)} style={styles.modalClose}>
                <Ionicons name="close" size={18} color={colors.text} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.modalList}>
              {LANGUAGE_OPTIONS.map(option => {
                const active = option.value === locale;
                return (
                  <TouchableOpacity
                    key={option.value}
                    style={[styles.modalOption, active && styles.modalOptionActive]}
                    onPress={() => handleSelectLocale(option.value)}
                  >
                    <View style={styles.modalOptionLabel}>
                      <Text style={styles.modalOptionFlag}>{option.flag}</Text>
                      <Text style={[styles.modalOptionText, active && styles.modalOptionTextActive]}>
                        {option.label}
                      </Text>
                    </View>
                    {active ? <Ionicons name="checkmark" size={18} color={colors.accent} /> : null}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <Text style={styles.modalFooter}>{t('This only changes text. It never limits access.')}</Text>
          </Pressable>
        </Pressable>
      </Modal>
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
  },
  selectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.backgroundAlt
  },
  selectLabel: {
    color: colors.text,
    fontWeight: '600',
    marginBottom: 6
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6
  },
  statusLabel: {
    color: colors.text,
    fontWeight: '600',
    fontSize: 16
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(5, 4, 15, 0.6)',
    justifyContent: 'center',
    padding: 20
  },
  modalCard: {
    backgroundColor: colors.card,
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: colors.border,
    maxHeight: '80%'
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12
  },
  modalTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700'
  },
  modalClose: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.backgroundAlt
  },
  modalList: {
    marginBottom: 12
  },
  modalOption: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.backgroundAlt,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  modalOptionActive: {
    borderColor: colors.accent,
    backgroundColor: colors.cardOverlay
  },
  modalOptionText: {
    color: colors.text
  },
  modalOptionTextActive: {
    color: colors.accent,
    fontWeight: '700'
  },
  modalOptionLabel: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  modalOptionFlag: {
    marginRight: 10,
    fontSize: 16
  },
  modalFooter: {
    color: colors.subtext,
    fontSize: 12,
    textAlign: 'center'
  }
});
