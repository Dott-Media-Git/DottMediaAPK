import React, { useEffect, useState } from 'react';
import { Alert, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { colors } from '@constants/colors';
import { DMButton } from '@components/DMButton';
import { fetchSettings, connectChannel, disconnectChannel } from '@services/admin/settingsService';
import { useAuth } from '@context/AuthContext';
import { useI18n } from '@context/I18nContext';

const channels = ['whatsapp', 'instagram', 'facebook', 'linkedin', 'web'] as const;

export const ChannelsScreen: React.FC = () => {
  const { orgId } = useAuth();
  const { t } = useI18n();
  const [settings, setSettings] = useState<any>(null);
  const [modal, setModal] = useState<{ channel: string; token: string } | null>(null);

  useEffect(() => {
    if (!orgId) return;
    fetchSettings(orgId)
      .then(setSettings)
      .catch(error => Alert.alert(t('Error'), error.message));
  }, [orgId]);

  const handleConnect = async () => {
    if (!orgId || !modal) return;
    try {
      await connectChannel(orgId, modal.channel, modal.token);
      setModal(null);
      const next = await fetchSettings(orgId);
      setSettings(next);
    } catch (error: any) {
      Alert.alert(t('Error'), error.message);
    }
  };

  const handleDisconnect = async (channel: string) => {
    if (!orgId) return;
    await disconnectChannel(orgId, channel);
    setSettings(await fetchSettings(orgId));
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {channels.map(channel => {
        const connected = settings?.channels?.[channel]?.enabled;
        return (
          <View key={channel} style={styles.card}>
            <Text style={styles.cardTitle}>{channel.toUpperCase()}</Text>
            <Text style={styles.cardSubtitle}>
              {connected ? t('Connected') : t('Not connected')}{' '}
              {settings?.channels?.[channel]?.tokenRef ? t('- token stored') : ''}
            </Text>
            <View style={styles.actions}>
              {connected ? (
                <DMButton title={t('Disconnect')} style={styles.button} onPress={() => handleDisconnect(channel)} />
              ) : (
                <DMButton
                  title={t('Connect')}
                  style={styles.button}
                  onPress={() => setModal({ channel, token: '' })}
                />
              )}
            </View>
          </View>
        );
      })}
      <Modal visible={!!modal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{t('Connect {{channel}}', { channel: modal?.channel.toUpperCase() ?? '' })}</Text>
            <TextInput
              value={modal?.token ?? ''}
              onChangeText={token => setModal(prev => (prev ? { ...prev, token } : prev))}
              placeholder={t('Paste access token')}
              placeholderTextColor={colors.subtext}
              style={styles.input}
            />
            <DMButton title={t('Save')} onPress={handleConnect} />
            <TouchableOpacity onPress={() => setModal(null)} style={styles.modalCancel}>
              <Text style={{ color: colors.subtext }}>{t('Cancel')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20 },
  card: {
    backgroundColor: colors.backgroundAlt,
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 12,
  },
  cardTitle: { color: colors.text, fontWeight: '700', fontSize: 16 },
  cardSubtitle: { color: colors.subtext, marginTop: 4 },
  actions: { marginTop: 12 },
  button: { alignSelf: 'flex-start' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalCard: {
    width: '90%',
    backgroundColor: colors.backgroundAlt,
    borderRadius: 20,
    padding: 20,
  },
  modalTitle: { color: colors.text, fontWeight: '700', marginBottom: 12 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    color: colors.text,
    marginBottom: 16,
  },
  modalCancel: { marginTop: 10, alignItems: 'center' },
});
