import React, { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { DMButton } from '@components/DMButton';
import { DMTextInput } from '@components/DMTextInput';
import { colors } from '@constants/colors';
import { useAuth } from '@context/AuthContext';
import { useI18n } from '@context/I18nContext';

export const PhoneVerificationScreen: React.FC = () => {
  const { startPhoneVerification, confirmPhoneVerification, signOut } = useAuth();
  const { t } = useI18n();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const sendCode = async () => {
    if (!/^\+[1-9]\d{7,14}$/.test(phone.trim())) {
      Alert.alert(t('Invalid phone number'), t('Use international format, for example +256700000000.'));
      return;
    }
    setLoading(true);
    try {
      await startPhoneVerification(phone);
      setCodeSent(true);
      Alert.alert(t('Code sent'), t('Enter the SMS verification code sent to your phone.'));
    } catch (error: any) {
      Alert.alert(t('Unable to send code'), error?.message ?? t('Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  const verifyCode = async () => {
    setLoading(true);
    try {
      await confirmPhoneVerification(code);
    } catch (error: any) {
      Alert.alert(t('Invalid verification code'), error?.message ?? t('Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Ionicons name="phone-portrait-outline" size={42} color={colors.accent} />
        <Text style={styles.eyebrow}>{t('SECURE YOUR ACCOUNT')}</Text>
        <Text style={styles.title}>{t('Verify your phone')}</Text>
        <Text style={styles.body}>{t('Add a mobile number in international format. We will send a one-time SMS code.')}</Text>
        <DMTextInput label={t('Phone number')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
        {codeSent ? (
          <>
            <DMTextInput label={t('Verification code')} value={code} onChangeText={setCode} keyboardType="number-pad" />
            <DMButton title={t('Verify phone')} onPress={verifyCode} loading={loading} />
          </>
        ) : (
          <DMButton title={t('Send verification code')} onPress={sendCode} loading={loading} />
        )}
        <Text style={styles.signOut} onPress={signOut}>{t('Use a different account')}</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 520, gap: 14, backgroundColor: colors.card, borderRadius: 28, borderWidth: 1, borderColor: colors.border, padding: 30 },
  eyebrow: { color: colors.accent, fontSize: 12, fontWeight: '800', letterSpacing: 1.4 },
  title: { color: colors.text, fontSize: 30, fontWeight: '800' },
  body: { color: colors.subtext, fontSize: 16, lineHeight: 24, marginBottom: 8 },
  signOut: { color: colors.subtext, fontWeight: '700', textAlign: 'center', marginTop: 8 },
});
