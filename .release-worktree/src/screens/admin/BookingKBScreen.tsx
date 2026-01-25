import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { DMButton } from '@components/DMButton';
import { colors } from '@constants/colors';
import { useAuth } from '@context/AuthContext';
import { fetchSettings, updateSettings } from '@services/admin/settingsService';

export const BookingKBScreen: React.FC = () => {
  const { orgId } = useAuth();
  const [booking, setBooking] = useState({ provider: 'google', calendarId: '' });
  const [sources, setSources] = useState<string[]>([]);

  useEffect(() => {
    if (!orgId) return;
    fetchSettings(orgId)
      .then(settings => {
        setBooking(settings.booking);
        setSources(settings.knowledgeBase?.sources ?? []);
      })
      .catch(error => Alert.alert('Error', error.message));
  }, [orgId]);

  const save = async () => {
    if (!orgId) return;
    await updateSettings(orgId, { booking, knowledgeBase: { sources } });
    Alert.alert('Saved', 'Booking & knowledge settings updated');
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <Text style={styles.label}>Booking Provider</Text>
        <View style={styles.row}>
          {(['google', 'calendly'] as const).map(option => (
            <Text
              key={option}
              style={[styles.chip, booking.provider === option && styles.chipActive]}
              onPress={() => setBooking(prev => ({ ...prev, provider: option }))}
            >
              {option.toUpperCase()}
            </Text>
          ))}
        </View>
        <TextInput
          placeholder="Calendar ID"
          placeholderTextColor={colors.subtext}
          style={styles.input}
          value={booking.calendarId}
          onChangeText={calendarId => setBooking(prev => ({ ...prev, calendarId }))}
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Knowledge Sources</Text>
        {sources.map((src, idx) => (
          <View key={idx} style={styles.sourceRow}>
            <TextInput
              value={src}
              onChangeText={value => {
                const next = [...sources];
                next[idx] = value;
                setSources(next);
              }}
              style={styles.input}
            />
            <Text style={styles.remove} onPress={() => setSources(sources.filter((_, i) => i !== idx))}>
              Remove
            </Text>
          </View>
        ))}
        <DMButton title="Add Source" onPress={() => setSources([...sources, ''])} style={{ marginTop: 12 }} />
      </View>

      <DMButton title="Save" onPress={save} />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20 },
  card: {
    backgroundColor: colors.backgroundAlt,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    marginBottom: 20,
  },
  label: { color: colors.text, fontWeight: '700', marginBottom: 8 },
  row: { flexDirection: 'row', marginBottom: 12 },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 10,
    color: colors.subtext,
  },
  chipActive: { borderColor: colors.accent, color: colors.accent },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    color: colors.text,
    marginBottom: 12,
  },
  sourceRow: { marginBottom: 12 },
  remove: { color: colors.danger, marginTop: 4 },
});
