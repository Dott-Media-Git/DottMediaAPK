import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View, Image } from 'react-native';
import { DMCard } from '@components/DMCard';
import { colors } from '@constants/colors';
import { useAuth } from '@context/AuthContext';
import { useI18n } from '@context/I18nContext';

export const ProfileScreen: React.FC = () => {
  const { state, signOut } = useAuth();
  const { t } = useI18n();
  const user = state.user;
  const crm = state.crmData;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <DMCard title={t('Profile')} subtitle={t('Account overview')}>
        <View style={styles.profileRow}>
          {user?.photoURL ? (
            <Image source={{ uri: user.photoURL }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarFallback}>
              <Text style={styles.avatarText}>{user?.name?.charAt(0) ?? 'U'}</Text>
            </View>
          )}
          <View>
            <Text style={styles.profileName}>{user?.name ?? t('User')}</Text>
            <Text style={styles.profileEmail}>{user?.email ?? t('No email on file')}</Text>
          </View>
        </View>
      </DMCard>

      <DMCard title={t('Subscription')}>
        <Text style={styles.detailLabel}>{t('Status')}</Text>
        <Text style={styles.detailValue}>{state.subscriptionStatus}</Text>
      </DMCard>

      <DMCard title={t('Business Profile')}>
        <Text style={styles.detailLabel}>{t('Company')}</Text>
        <Text style={styles.detailValue}>{crm?.companyName ?? t('Not set')}</Text>
        <Text style={styles.detailLabel}>{t('Contact Email')}</Text>
        <Text style={styles.detailValue}>{crm?.email ?? t('Not set')}</Text>
        <Text style={styles.detailLabel}>{t('Phone')}</Text>
        <Text style={styles.detailValue}>{crm?.phone ?? t('Not set')}</Text>
      </DMCard>

      <DMCard title={t('Account')}>
        <TouchableOpacity style={styles.signOutButton} onPress={signOut}>
          <Text style={styles.signOutText}>{t('Sign out')}</Text>
        </TouchableOpacity>
      </DMCard>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, paddingBottom: 40 },
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar: { width: 56, height: 56, borderRadius: 28 },
  avatarFallback: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.cardOverlay,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center'
  },
  avatarText: { color: colors.text, fontSize: 20, fontWeight: '700' },
  profileName: { color: colors.text, fontSize: 18, fontWeight: '700' },
  profileEmail: { color: colors.subtext, marginTop: 4 },
  detailLabel: { color: colors.subtext, fontSize: 12, marginTop: 8 },
  detailValue: { color: colors.text, fontWeight: '600', marginTop: 2 },
  signOutButton: {
    backgroundColor: colors.accent,
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: 'center'
  },
  signOutText: {
    color: colors.background,
    fontWeight: '700'
  }
});
