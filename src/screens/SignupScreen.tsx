import React, { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
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
  const [error, setError] = useState('');

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

  const openLogin = () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.location.assign('/login');
      return;
    }
    navigation.navigate('Login');
  };

  const handleCreateAccount = async () => {
    const trimmedName = name.trim();
    const normalizedEmail = email.trim().toLowerCase();
    setError('');

    if (!trimmedName || !normalizedEmail || !password) {
      setError(t('Please enter your name, email address, and password.'));
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setError(t('Enter a valid email address.'));
      return;
    }

    try {
      if (strength.level === 'weak') {
        Alert.alert(
          t('Weak password'),
          t('Please use at least 8 characters with upper/lowercase letters, a number, and a symbol.')
        );
        return;
      }
      await signUp(trimmedName, normalizedEmail, password);
      Alert.alert(t('Verify your email'), t('We sent a verification link to your email address.'));
    } catch (signupError) {
      const code =
        typeof signupError === 'object' && signupError !== null && 'code' in signupError
          ? String((signupError as any).code)
          : '';
      const message =
        code === 'auth/email-already-in-use'
          ? t('An account already exists for this email. Try logging in instead.')
          : code === 'auth/network-request-failed'
            ? t('Network error. Check your connection and try again.')
            : t('Signup failed. Please try again.');
      setError(message);
      Alert.alert(t('Signup failed'), message);
      console.error(signupError);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
      >
      <LinearGradient colors={[colors.accentSecondary, colors.accent]} style={styles.hero}>
        <Text style={styles.title}>{t('Join Dotti')}</Text>
        <Text style={styles.subtitle}>{t('Welcome to Dotti — let’s get you set up and ready to grow.')}</Text>
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
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <DMButton title={t('Sign Up')} onPress={handleCreateAccount} loading={state.loading} />
        <TouchableOpacity
          style={styles.footer}
          {...(Platform.OS === 'web' ? ({ href: '/login' } as any) : {})}
          accessibilityRole="link"
          accessibilityLabel={t('Log in')}
          hitSlop={{ top: 12, right: 20, bottom: 12, left: 20 }}
          onPress={openLogin}
        >
          <Text style={styles.footerText}>
            {t('Already have an account?')} <Text style={styles.link}>{t('Log in')}</Text>
          </Text>
        </TouchableOpacity>
      </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollView: {
    flex: 1
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingTop: 24,
    paddingHorizontal: 24,
    paddingBottom: 64
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
  },
  error: {
    color: colors.danger,
    marginBottom: 12,
    textAlign: 'center'
  }
});

