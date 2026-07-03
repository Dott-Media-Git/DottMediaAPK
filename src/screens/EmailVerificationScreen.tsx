import React, { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { DMButton } from '@components/DMButton';
import { colors } from '@constants/colors';
import { useAuth } from '@context/AuthContext';
import { useI18n } from '@context/I18nContext';

export const EmailVerificationScreen: React.FC = () => {
  const { state, resendEmailVerification, checkEmailVerification, signOut } = useAuth();
  const { t } = useI18n();
  const [checking, setChecking] = useState(false);
  const [sending, setSending] = useState(false);
  const [lastSentAt, setLastSentAt] = useState(0);

  const check = async () => {
    setChecking(true);
    try {
      const verified = await checkEmailVerification();
      if (!verified) Alert.alert(t('Email not verified'), t('Open the verification link in your email, then try again.'));
    } catch (error: any) {
      Alert.alert(t('Unable to check'), error?.message ?? t('Please try again.'));
    } finally {
      setChecking(false);
    }
  };

  const resend = async () => {
    const remainingSeconds = Math.ceil((60_000 - (Date.now() - lastSentAt)) / 1000);
    if (lastSentAt && remainingSeconds > 0) {
      Alert.alert(t('Please wait'), `${t('You can request another email in')} ${remainingSeconds}s.`);
      return;
    }
    setSending(true);
    try {
      await resendEmailVerification();
      setLastSentAt(Date.now());
      Alert.alert(
        t('Verification email sent'),
        t('Check your inbox and spam or junk folder. The sender is Firebase for Dott Media.'),
      );
    } catch (error: any) {
      Alert.alert(t('Unable to send email'), error?.message ?? t('Please wait and try again.'));
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <View style={styles.iconWrap}>
          <Ionicons name="mail-unread-outline" size={38} color={colors.accent} />
        </View>
        <Text style={styles.eyebrow}>{t('SECURE YOUR ACCOUNT')}</Text>
        <Text style={styles.title}>{t('Verify your email')}</Text>
        <Text style={styles.body}>
          {t('We sent a verification link to')} <Text style={styles.email}>{state.user?.email}</Text>.
          {' '}{t('Open the link, then return here to continue.')}
        </Text>
        <View style={styles.notice}>
          <Ionicons name="information-circle-outline" size={19} color={colors.accent} />
          <Text style={styles.noticeText}>
            {t('Check Spam or Junk if it is not in your inbox. Search for “Verify your email for DottMediaApk”.')}
          </Text>
        </View>
        <DMButton title={t('I have verified my email')} onPress={check} loading={checking} />
        <View style={styles.spacer} />
        <DMButton title={t('Resend verification email')} onPress={resend} loading={sending} />
        <Text style={styles.signOut} onPress={signOut}>{t('Use a different account')}</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 520, backgroundColor: colors.card, borderRadius: 28, borderWidth: 1, borderColor: colors.border, padding: 30 },
  iconWrap: { width: 72, height: 72, borderRadius: 22, backgroundColor: colors.cardOverlay, alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
  eyebrow: { color: colors.accent, fontSize: 12, fontWeight: '800', letterSpacing: 1.4 },
  title: { color: colors.text, fontSize: 30, fontWeight: '800', marginTop: 8 },
  body: { color: colors.subtext, fontSize: 16, lineHeight: 25, marginTop: 14, marginBottom: 26 },
  email: { color: colors.text, fontWeight: '700' },
  notice: { flexDirection: 'row', gap: 10, backgroundColor: colors.cardOverlay, borderRadius: 14, padding: 14, marginBottom: 20 },
  noticeText: { flex: 1, color: colors.subtext, fontSize: 13, lineHeight: 19 },
  spacer: { height: 12 },
  signOut: { color: colors.subtext, fontWeight: '700', textAlign: 'center', marginTop: 22 },
});
