import React, { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { DMTextInput } from '@components/DMTextInput';
import { DMButton } from '@components/DMButton';
import { colors } from '@constants/colors';
import { useAuth } from '@context/AuthContext';
import { AuthStackParamList } from './LoginScreen';

type Props = NativeStackScreenProps<AuthStackParamList, 'Signup'>;

export const SignupScreen: React.FC<Props> = ({ navigation }) => {
  const { signUp, state } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleCreateAccount = async () => {
    try {
      await signUp(name.trim(), email.trim(), password);
      Alert.alert('Account created', 'Complete your subscription to unlock the CRM.');
    } catch (error) {
      Alert.alert('Signup failed', 'Please try again later.');
      console.error(error);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <LinearGradient colors={[colors.accentSecondary, colors.accent]} style={styles.hero}>
        <Text style={styles.badge}>Step 1 · Workspace</Text>
        <Text style={styles.title}>Create your workspace</Text>
        <Text style={styles.subtitle}>Spin up the same bold CRM aesthetic showcased on dott-media.com.</Text>
      </LinearGradient>
      <View style={styles.form}>
        <DMTextInput label="Full name" value={name} onChangeText={setName} />
        <DMTextInput label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" />
        <DMTextInput label="Password" value={password} onChangeText={setPassword} secureTextEntry />
        <DMButton title="Sign Up" onPress={handleCreateAccount} loading={state.loading} />
        <TouchableOpacity style={styles.footer} onPress={() => navigation.navigate('Login')}>
          <Text style={styles.footerText}>
            Already have an account? <Text style={styles.link}>Log in</Text>
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
  badge: {
    color: colors.text,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: 6,
    fontSize: 12
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
