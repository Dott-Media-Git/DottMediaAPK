import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useAuth } from '@context/AuthContext';
import { DMTextInput } from '@components/DMTextInput';
import { DMButton } from '@components/DMButton';
import { colors } from '@constants/colors';
import { Ionicons } from '@expo/vector-icons';
import { useI18n } from '@context/I18nContext';

export type AuthStackParamList = {
  Login: undefined;
  Signup: undefined;
  PasswordReset: undefined;
};

type Props = NativeStackScreenProps<AuthStackParamList, 'Login'>;

export const LoginScreen: React.FC<Props> = ({ navigation }) => {
  const { signIn, state } = useAuth();
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');

  const getAuthErrorMessage = (err: unknown) => {
    const code = typeof err === 'object' && err !== null && 'code' in err ? String((err as any).code) : '';
    switch (code) {
      case 'auth/invalid-email':
        return t('Enter a valid email address.');
      case 'auth/user-not-found':
      case 'auth/invalid-login-credentials':
        return t('No account found for this email.');
      case 'auth/wrong-password':
        return t('Incorrect password.');
      case 'auth/too-many-requests':
        return t('Too many attempts. Try again later.');
      case 'auth/network-request-failed':
        return t('Network error. Check your connection.');
      default:
        return t('Unable to sign in. Please double-check your details.');
    }
  };

  const handleSignIn = async () => {
    try {
      setError('');
      await signIn(email.trim().toLowerCase(), password);
    } catch (err) {
      setError(getAuthErrorMessage(err));
      console.error(err);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <LinearGradient
        colors={[colors.accent, colors.accentSecondary]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.hero}
      >
        <Text style={styles.badge}>{t('AI Automation Suite')}</Text>
        <Text style={styles.heroTitle}>DOTT-MEDIA</Text>
        <Text style={styles.heroSubtitle}>{t('Command your AI operations cockpit.')}</Text>
      </LinearGradient>
      <View style={styles.card}>
        <Text style={styles.title}>{t('Welcome back')}</Text>
        <Text style={styles.subtitle}>{t('Log in to orchestrate your AI-driven CRM.')}</Text>
        <DMTextInput
          label={t('Email')}
          value={email}
          onChangeText={text => {
            setEmail(text);
            if (error) setError('');
          }}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <DMTextInput
          label={t('Password')}
          value={password}
          onChangeText={text => {
            setPassword(text);
            if (error) setError('');
          }}
          secureTextEntry={!showPassword}
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
        <DMButton title={t('Sign In')} onPress={handleSignIn} loading={state.loading} />
        <TouchableOpacity style={styles.link} onPress={() => navigation.navigate('PasswordReset')}>
          <Text style={styles.linkLabel}>{t('Forgot password?')}</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.footer}>
        <Text style={styles.footerLabel}>{t('New to Dott Media?')}</Text>
        <TouchableOpacity onPress={() => navigation.navigate('Signup')}>
          <Text style={styles.linkLabel}>{t('Create an account')}</Text>
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
    borderRadius: 30,
    padding: 24,
    marginBottom: 24
  },
  badge: {
    color: colors.text,
    fontSize: 13,
    textTransform: 'uppercase',
    letterSpacing: 1.8,
    marginBottom: 10
  },
  heroTitle: {
    color: colors.text,
    fontSize: 34,
    fontWeight: '900',
    letterSpacing: 2,
    marginBottom: 4
  },
  heroSubtitle: {
    color: colors.background,
    opacity: 0.9,
    lineHeight: 20,
    fontSize: 14
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 28,
    padding: 24,
    borderWidth: 1,
    borderColor: colors.border
  },
  title: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 4
  },
  subtitle: {
    color: colors.subtext,
    marginBottom: 24
  },
  link: {
    marginTop: 14,
    alignItems: 'center'
  },
  linkLabel: {
    color: colors.accentMuted,
    fontWeight: '600'
  },
  footer: {
    alignItems: 'center',
    marginTop: 24
  },
  footerLabel: {
    color: colors.subtext,
    marginBottom: 6
  },
  error: {
    color: colors.danger,
    marginBottom: 12,
    textAlign: 'center'
  }
});
