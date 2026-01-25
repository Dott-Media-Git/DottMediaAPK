import React, { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { DMTextInput } from '@components/DMTextInput';
import { DMButton } from '@components/DMButton';
import { colors } from '@constants/colors';
import { useAuth } from '@context/AuthContext';
import { AuthStackParamList } from './LoginScreen';
import { Ionicons } from '@expo/vector-icons';
import { useI18n } from '@context/I18nContext';

type Props = NativeStackScreenProps<AuthStackParamList, 'Signup'>;

export const SignupScreen: React.FC<Props> = ({ navigation }) => {
  const { signUp, state } = useAuth();
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const getPasswordStrength = (value: string) => {
    if (!value) {
      return { level: 'empty', message: '' };
    }
    const lengthOk = value.length >= 8;
    const hasUpper = /[A-Z]/.test(value);
    const hasLower = /[a-z]/.test(value);
    const hasNumber = /\d/.test(value);
    const hasSymbol = /[^A-Za-z0-9]/.test(value);
    const score = [lengthOk, hasUpper, hasLower, hasNumber, hasSymbol].filter(Boolean).length;
    if (score <= 2) return { level: 'weak', message: t('Weak password') };
    if (score === 3) return { level: 'medium', message: t('Medium password strength') };
    return { level: 'strong', message: t('Strong password') };
  };

  const strength = getPasswordStrength(password);

  const handleCreateAccount = async () => {
    try {
      if (strength.level === 'weak') {
        Alert.alert(
          t('Weak password'),
          t('Please use at least 8 characters with upper/lowercase letters, a number, and a symbol.')
        );
        return;
      }
      await signUp(name.trim(), email.trim().toLowerCase(), password);
      Alert.alert(t('Account created'), t('Continue to the setup screen to start using the CRM.'));
    } catch (error) {
      Alert.alert(t('Signup failed'), t('Please try again later.'));
      console.error(error);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <LinearGradient colors={[colors.accentSecondary, colors.accent]} style={styles.hero}>
        <Text style={styles.title}>{t('Create your workspace')}</Text>
        <Text style={styles.subtitle}>{t('Spin up the same bold CRM aesthetic showcased on dott-media.com.')}</Text>
      </LinearGradient>
      <View style={styles.form}>
        <DMTextInput label={t('Full name')} value={name} onChangeText={setName} />
        <DMTextInput label={t('Email')} value={email} onChangeText={setEmail} autoCapitalize="none" />
        <DMTextInput
          label={t('Password')}
          value={password}
          onChangeText={setPassword}
          secureTextEntry={!showPassword}
          error={strength.level === 'weak' ? strength.message : undefined}
          helperText={
            strength.level === 'medium' || strength.level === 'strong' ? strength.message : undefined
          }
          rightElement={
            <TouchableOpacity
              onPress={() => setShowPassword(prev => !prev)}
              accessibilityLabel={showPassword ? t('Hide password') : t('Show password')}
            >
              <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.subtext} />
            </TouchableOpacity>
          }
        />
        <DMButton title={t('Sign Up')} onPress={handleCreateAccount} loading={state.loading} />
        <TouchableOpacity style={styles.footer} onPress={() => navigation.navigate('Login')}>
          <Text style={styles.footerText}>
            {t('Already have an account?')} <Text style={styles.link}>{t('Log in')}</Text>
          </Text>
        </TouchableOpacity>
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
  hero: {
    borderRadius: 28,
    padding: 24,
    marginBottom: 20
  },
  title: {
    color: colors.text,
    fontSize: 26,
    fontWeight: '800',
    marginBottom: 8
  },
  subtitle: {
    color: colors.background,
    lineHeight: 20
  },
  form: {
    backgroundColor: colors.card,
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: colors.border
  },
  footer: {
    marginTop: 18,
    alignItems: 'center'
  },
  footerText: {
    color: colors.subtext
  },
  link: {
    color: colors.accentMuted,
    fontWeight: '600'
  }
});

