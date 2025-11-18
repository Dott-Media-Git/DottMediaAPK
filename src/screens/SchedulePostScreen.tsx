import React, { useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { DMButton } from '@components/DMButton';
import { colors } from '@constants/colors';
import { schedulePost } from '@services/social';
import { useAuth } from '@context/AuthContext';

const PLATFORM_OPTIONS = ['instagram', 'facebook', 'linkedin', 'twitter'] as const;

export const SchedulePostScreen: React.FC = () => {
  const { state } = useAuth();
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(['instagram']);
  const [caption, setCaption] = useState('');
  const [hashtags, setHashtags] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [timesPerDay, setTimesPerDay] = useState(1);
  const [date, setDate] = useState(new Date());
  const [showPicker, setShowPicker] = useState(false);
  const [imageUrlInput, setImageUrlInput] = useState('');
  const [loading, setLoading] = useState(false);

  const addImage = () => {
    if (!imageUrlInput.trim()) return;
    setImages(prev => [...prev, imageUrlInput.trim()]);
    setImageUrlInput('');
  };

  const summary = useMemo(() => Math.min(timesPerDay * selectedPlatforms.length, 5), [timesPerDay, selectedPlatforms]);

  const togglePlatform = (platform: string) => {
    setSelectedPlatforms(prev =>
      prev.includes(platform) ? prev.filter(p => p !== platform) : [...prev, platform],
    );
  };

  const submit = async () => {
    if (!state.user) return;
    if (!images.length) {
      Alert.alert('Add images', 'Please add at least one image URL generated earlier.');
      return;
    }
    if (!caption.trim()) {
      Alert.alert('Add caption');
      return;
    }
    setLoading(true);
    try {
      await schedulePost({
        userId: state.user.uid,
        platforms: selectedPlatforms,
        images,
        caption,
        hashtags,
        scheduledFor: date.toISOString(),
        timesPerDay,
      });
      Alert.alert('Scheduled', 'Posts added to queue.');
      setCaption('');
      setHashtags('');
      setImages([]);
    } catch (error: any) {
      Alert.alert('Failed', error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <Text style={styles.label}>Platforms</Text>
        <View style={styles.row}>
          {PLATFORM_OPTIONS.map(platform => (
            <TouchableOpacity
              key={platform}
              style={[styles.chip, selectedPlatforms.includes(platform) && styles.chipActive]}
              onPress={() => togglePlatform(platform)}
            >
              <Text style={styles.chipText}>
                {platform === 'twitter' ? 'X' : platform.charAt(0).toUpperCase() + platform.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>Schedule Date & Time</Text>
        <TouchableOpacity style={styles.dateInput} onPress={() => setShowPicker(true)}>
          <Text style={styles.dateText}>{date.toLocaleString()}</Text>
        </TouchableOpacity>
        {showPicker && (
          <DateTimePicker
            value={date}
            mode="datetime"
            onChange={(_, selected) => {
              setShowPicker(false);
              if (selected) setDate(selected);
            }}
          />
        )}

        <Text style={styles.label}>Times per day</Text>
        <View style={styles.row}>
          {[1, 2, 3, 4, 5].map(value => (
            <TouchableOpacity
              key={value}
              style={[styles.chip, timesPerDay === value && styles.chipActive]}
              onPress={() => setTimesPerDay(value)}
            >
              <Text style={styles.chipText}>{value}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={styles.helper}>Total posts scheduled today: {summary}/5</Text>

        <Text style={styles.label}>Images</Text>
        <TextInput
          value={imageUrlInput}
          onChangeText={setImageUrlInput}
          placeholder="Paste image URL"
          placeholderTextColor={colors.subtext}
          style={styles.input}
        />
        <DMButton title="Add Image" onPress={addImage} style={{ marginBottom: 12 }} />
        {images.map(url => (
          <Text key={url} style={styles.imageRow}>
            • {url}
          </Text>
        ))}

        <Text style={styles.label}>Caption</Text>
        <TextInput
          value={caption}
          onChangeText={setCaption}
          placeholder="Use caption from content generator..."
          placeholderTextColor={colors.subtext}
          multiline
          style={[styles.input, { minHeight: 80 }]}
        />
        <Text style={styles.label}>Hashtags</Text>
        <TextInput
          value={hashtags}
          onChangeText={setHashtags}
          placeholder="#hashtags"
          placeholderTextColor={colors.subtext}
          multiline
          style={[styles.input, { minHeight: 60 }]}
        />
        <DMButton title={loading ? 'Scheduling...' : 'Schedule'} onPress={submit} disabled={loading} />
      </View>
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
  },
  label: { color: colors.text, fontWeight: '700', marginTop: 12, marginBottom: 6 },
  row: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 8,
    marginBottom: 8,
  },
  chipActive: { borderColor: colors.accent, backgroundColor: 'rgba(139,93,255,0.2)' },
  chipText: { color: colors.text },
  dateInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 10,
  },
  dateText: { color: colors.text },
  helper: { color: colors.subtext, marginTop: 4 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    color: colors.text,
    marginBottom: 12,
  },
  imageRow: { color: colors.subtext, marginBottom: 4 },
});
