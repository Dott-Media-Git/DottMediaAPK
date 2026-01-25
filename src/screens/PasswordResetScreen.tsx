import React, { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { DMTextInput } from '@components/DMTextInput';
import { DMButton } from '@components/DMButton';
import { colors } from '@constants/colors';
import { useAuth } from '@context/AuthContext';
import { AuthStackParamList } from './LoginScreen';
import { useI18n } from '@context/I18nContext';

type Props = NativeStackScreenProps<AuthStackParamList, 'PasswordReset'>;

export const PasswordResetScreen: React.FC<Props> = () => {
  const { sendPasswordReset, state } = useAuth();
  const { t } = useI18n();
  const [email, setEmail] = useState('');

  const handleReset = async () => {
    try {
      await sendPasswordReset(email.trim());
      Alert.alert(t('Check your inbox'), t('Password reset instructions have been sent.'));
    } catch (error) {
      Alert.alert(t('Reset failed'), t('Unable to send password reset. Try again later.'));
      console.error(error);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.card}>
        <Text style={styles.title}>{t('Reset password')}</Text>
        <Text style={styles.subtitle}>{t('Enter the email linked to your workspace.')}</Text>
        <DMTextInput label={t('Email')} value={email} onChangeText={setEmail} autoCapitalize="none" />
        <DMButton title={t('Send reset email')} onPress={handleReset} loading={state.loading} />
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    padding: 24,
    justifyContent: 'center'
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: colors.border
  },
  title: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 8
  },
  subtitle: {
    color: colors.subtext,
    marginBottom: 24
  }
});
