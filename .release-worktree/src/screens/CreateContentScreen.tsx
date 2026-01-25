import React, { useState } from 'react';
import { Alert, Image, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { DMButton } from '@components/DMButton';
import { colors } from '@constants/colors';
import { generateContent } from '@services/social';
import { useAuth } from '@context/AuthContext';

export const CreateContentScreen: React.FC = () => {
  const { state } = useAuth();
  const [prompt, setPrompt] = useState('');
  const [businessType, setBusinessType] = useState(state.crmData?.businessGoals ?? 'growth marketing');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      Alert.alert('Prompt required');
      return;
    }
    setLoading(true);
    try {
      const response = await generateContent({ prompt, businessType });
      setResult(response.content);
    } catch (error: any) {
      Alert.alert('Generation failed', error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <Text style={styles.label}>Prompt</Text>
        <TextInput
          style={styles.input}
          value={prompt}
          onChangeText={setPrompt}
          placeholder="Describe the campaign idea..."
          placeholderTextColor={colors.subtext}
          multiline
        />
        <Text style={styles.label}>Business Type / Tone</Text>
        <TextInput
          style={styles.input}
          value={businessType}
          onChangeText={setBusinessType}
          placeholder="e.g. AI agency, SaaS marketing"
          placeholderTextColor={colors.subtext}
        />
        <DMButton title={loading ? 'Generating...' : 'Generate Content'} onPress={handleGenerate} disabled={loading} />
      </View>

      {result && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Images</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {result.images?.map((url: string) => (
              <Image key={url} source={{ uri: url }} style={styles.image} />
            ))}
          </ScrollView>

          <Text style={styles.sectionTitle}>Captions</Text>
          <Text style={styles.captionLabel}>Instagram</Text>
          <Text style={styles.captionText}>{result.caption_instagram}</Text>
          <Text style={styles.captionLabel}>LinkedIn</Text>
          <Text style={styles.captionText}>{result.caption_linkedin}</Text>
          <Text style={styles.captionLabel}>X / Twitter</Text>
          <Text style={styles.captionText}>{result.caption_x}</Text>

          <Text style={styles.captionLabel}>Hashtags (IG)</Text>
          <Text style={styles.captionText}>{result.hashtags_instagram}</Text>
          <Text style={styles.captionLabel}>Hashtags (Generic)</Text>
          <Text style={styles.captionText}>{result.hashtags_generic}</Text>
        </View>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, paddingBottom: 80 },
  card: {
    backgroundColor: colors.backgroundAlt,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 18
  },
  label: { color: colors.text, fontWeight: '700', marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    color: colors.text,
    padding: 12,
    marginBottom: 12,
    minHeight: 48
  },
  sectionTitle: { color: colors.text, fontWeight: '700', marginTop: 12 },
  image: { width: 160, height: 160, borderRadius: 16, marginRight: 12, marginTop: 8 },
  captionLabel: { color: colors.accent, marginTop: 10, fontWeight: '600' },
  captionText: { color: colors.text, marginTop: 4, lineHeight: 20 }
});
