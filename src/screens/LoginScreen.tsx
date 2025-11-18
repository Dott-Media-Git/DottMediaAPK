import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useAuth } from '@context/AuthContext';
import { DMTextInput } from '@components/DMTextInput';
import { DMButton } from '@components/DMButton';
import { colors } from '@constants/colors';

export type AuthStackParamList = {
  Login: undefined;
  Signup: undefined;
  PasswordReset: undefined;
};

type Props = NativeStackScreenProps<AuthStackParamList, 'Login'>;

export const LoginScreen: React.FC<Props> = ({ navigation }) => {
  const { signIn, state } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSignIn = async () => {
    try {
      setError('');
      await signIn(email.trim(), password);
    } catch (err) {
      setError('Unable to sign in. Please double-check your details.');
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
        <Text style={styles.badge}>AI Automation Suite</Text>
        <Text style={styles.heroTitle}>DOTT-MEDIA</Text>
        <Text style={styles.heroSubtitle}>Command your AI operations cockpit.</Text>
      </LinearGradient>
      <View style={styles.card}>
        <Text style={styles.title}>Welcome back</Text>
        <Text style={styles.subtitle}>Log in to orchestrate your AI-driven CRM.</Text>
        <DMTextInput
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <DMTextInput
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <DMButton title="Sign In" onPress={handleSignIn} loading={state.loading} />
        <TouchableOpacity style={styles.link} onPress={() => navigation.navigate('PasswordReset')}>
          <Text style={styles.linkLabel}>Forgot password?</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.footer}>
        <Text style={styles.footerLabel}>New to Dott Media?</Text>
        <TouchableOpacity onPress={() => navigation.navigate('Signup')}>
          <Text style={styles.linkLabel}>Create an account</Text>
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