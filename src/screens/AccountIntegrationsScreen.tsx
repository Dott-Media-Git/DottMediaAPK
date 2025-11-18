import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { DMButton } from '@components/DMButton';
import { colors } from '@constants/colors';

const platforms = ['instagram', 'facebook', 'linkedin', 'twitter'];

export const AccountIntegrationsScreen: React.FC = () => {
  const [tokens, setTokens] = useState<Record<string, string>>(
    platforms.reduce((acc, platform) => ({ ...acc, [platform]: '' }), {}),
  );

  const save = () => {
    Alert.alert('Coming soon', 'Platform token storage will be connected to vault.');
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <Text style={styles.title}>Link Channels</Text>
        {platforms.map(platform => (
          <View key={platform} style={{ marginBottom: 16 }}>
            <Text style={styles.label}>{platform.toUpperCase()} Token</Text>
            <TextInput
              value={tokens[platform]}
              onChangeText={value => setTokens(prev => ({ ...prev, [platform]: value }))}
              placeholder="Paste access token"
              placeholderTextColor={colors.subtext}
              style={styles.input}
            />
          </View>
        ))}
        <DMButton title="Save Connections" onPress={save} />
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20 },
  card: {
    backgroundColor: colors.backgroundAlt,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  title: { color: colors.text, fontSize: 20, fontWeight: '700', marginBottom: 12 },
  label: { color: colors.text, marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    color: colors.text,
  },
});
