import React, { useEffect, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import * as Linking from 'expo-linking';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DMButton } from '@components/DMButton';
import { DMCard } from '@components/DMCard';
import { colors } from '@constants/colors';
import { useThemeMode } from '@context/ThemeContext';
import { useAssistant } from '@context/AssistantContext';

const SUPPORT_WHATSAPP_URL = 'https://wa.me/2348130000000';
const NATIONALITY_STORAGE_KEY = '@dott/nationality';
const NATIONALITY_OPTIONS = [
  'Global',
  'Kenyan',
  'Nigerian',
  'South African',
  'Ghanaian',
  'Ethiopian',
  'Ugandan',
  'Egyptian',
  'American',
  'British',
  'Canadian',
  'German',
  'French',
  'Spanish',
  'Italian',
  'UAE',
  'Saudi',
  'Indian',
  'Pakistani',
  'Brazilian',
];

export const SupportScreen: React.FC = () => {
  const { mode, toggleMode } = useThemeMode();
  const { enabled: assistantEnabled, toggleAssistant } = useAssistant();
  const [assistantSwitchLoading, setAssistantSwitchLoading] = useState(false);
  const [nationality, setNationality] = useState('Global');
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(NATIONALITY_STORAGE_KEY)
      .then(value => {
        if (value) {
          setNationality(value);
        }
      })
      .catch(() => undefined);
  }, []);

  const handleSelectNationality = async (value: string) => {
    setNationality(value);
    setMenuOpen(false);
    try {
      await AsyncStorage.setItem(NATIONALITY_STORAGE_KEY, value);
    } catch (error) {
      console.warn('Failed to save nationality preference', error);
    }
  };

  const handleAssistantToggle = async (value: boolean) => {
    setAssistantSwitchLoading(true);
    try {
      await toggleAssistant(value);
    } finally {
      setAssistantSwitchLoading(false);
    }
  };

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
      <DMCard title="Assistant overlay" subtitle="Toggle the floating help bubble">
        <View style={styles.row}>
          <Text style={styles.statusLabel}>{assistantEnabled ? 'Assistant On' : 'Assistant Off'}</Text>
          <Switch
            value={assistantEnabled}
            onValueChange={handleAssistantToggle}
            thumbColor={colors.text}
            trackColor={{ false: colors.border, true: colors.accent }}
            disabled={assistantSwitchLoading}
          />
        </View>
        <Text style={styles.cardText}>Disable this if you prefer a distraction-free workspace.</Text>
      </DMCard>
      <DMCard title="Nationality" subtitle="Personalize the app without restricting access">
        <TouchableOpacity style={styles.selectButton} onPress={() => setMenuOpen(true)}>
          <View>
            <Text style={styles.selectLabel}>Current: {nationality}</Text>
            <Text style={styles.cardText}>Choose your nationality to tailor support.</Text>
          </View>
          <Ionicons name="chevron-down" size={18} color={colors.subtext} />
        </TouchableOpacity>
      </DMCard>
      <DMCard title="WhatsApp Business">
        <Text style={styles.cardText}>Chat with us for onboarding questions or live campaign tweaks.</Text>
        <DMButton title="Chat on WhatsApp" onPress={openWhatsApp} />
      </DMCard>
      <DMCard title="Resources">
        <Text style={styles.cardText}>- Automation knowledge base (coming soon)</Text>
        <Text style={styles.cardText}>- AI chatbot assistant (beta)</Text>
      </DMCard>
      <Modal visible={menuOpen} transparent animationType="fade">
        <Pressable style={styles.modalBackdrop} onPress={() => setMenuOpen(false)}>
          <Pressable style={styles.modalCard} onPress={() => undefined}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select your nationality</Text>
              <TouchableOpacity onPress={() => setMenuOpen(false)} style={styles.modalClose}>
                <Ionicons name="close" size={18} color={colors.text} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.modalList}>
              {NATIONALITY_OPTIONS.map(option => {
                const active = option === nationality;
                return (
                  <TouchableOpacity
                    key={option}
                    style={[styles.modalOption, active && styles.modalOptionActive]}
                    onPress={() => handleSelectNationality(option)}
                  >
                    <Text style={[styles.modalOptionText, active && styles.modalOptionTextActive]}>{option}</Text>
                    {active ? <Ionicons name="checkmark" size={18} color={colors.accent} /> : null}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <Text style={styles.modalFooter}>This only customizes your experience. It never limits access.</Text>
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
  modalFooter: {
    color: colors.subtext,
    fontSize: 12,
    textAlign: 'center'
  }
});
