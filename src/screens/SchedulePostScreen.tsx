import React, { useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { DMButton } from '@components/DMButton';
import { colors } from '@constants/colors';
import { schedulePost } from '@services/social';
import { useAuth } from '@context/AuthContext';
import { useI18n } from '@context/I18nContext';

const PLATFORM_OPTIONS = ['instagram', 'instagram_reels', 'facebook', 'linkedin', 'twitter', 'youtube', 'tiktok'] as const;

export const SchedulePostScreen: React.FC = () => {
  const { state } = useAuth();
  const { t } = useI18n();
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(['instagram']);
  const [caption, setCaption] = useState('');
  const [hashtags, setHashtags] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [videoUrl, setVideoUrl] = useState('');
  const [youtubeVideoUrl, setYoutubeVideoUrl] = useState('');
  const [tiktokVideoUrl, setTiktokVideoUrl] = useState('');
  const [reelsVideoUrl, setReelsVideoUrl] = useState('');
  const [videoTitle, setVideoTitle] = useState('');
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
  const hasYoutube = selectedPlatforms.includes('youtube');
  const hasTikTok = selectedPlatforms.includes('tiktok');
  const hasReels = selectedPlatforms.includes('instagram_reels');
  const hasOptionalVideoPlatforms = selectedPlatforms.some(
    platform => platform === 'facebook' || platform === 'linkedin',
  );
  const hasGenericVideo = videoUrl.trim().length > 0;
  const hasVideoPlatform = hasYoutube || hasTikTok || hasReels;
  const imageOnlyPlatforms = selectedPlatforms.filter(
    platform =>
      platform !== 'youtube' &&
      platform !== 'tiktok' &&
      platform !== 'instagram_reels' &&
      platform !== 'facebook' &&
      platform !== 'linkedin',
  );
  const needsImages = imageOnlyPlatforms.length > 0 || (hasOptionalVideoPlatforms && !hasGenericVideo);

  const togglePlatform = (platform: string) => {
    setSelectedPlatforms(prev =>
      prev.includes(platform) ? prev.filter(p => p !== platform) : [...prev, platform],
    );
  };

  const submit = async () => {
    if (!state.user) return;
    if (needsImages && !images.length) {
      if (imageOnlyPlatforms.length === 0 && hasOptionalVideoPlatforms) {
        Alert.alert(t('Add video URL'), t('Please add a video URL.'));
      } else {
        Alert.alert(t('Add images'), t('Please add at least one image URL generated earlier.'));
      }
      return;
    }
    if (hasYoutube && !youtubeVideoUrl.trim()) {
      Alert.alert(t('Add video URL'), t('Please add a YouTube video URL.'));
      return;
    }
    if (hasTikTok && !tiktokVideoUrl.trim()) {
      Alert.alert(t('Add video URL'), t('Please add a TikTok video URL.'));
      return;
    }
    if (hasReels && !reelsVideoUrl.trim()) {
      Alert.alert(t('Add video URL'), t('Please add an Instagram Reels video URL.'));
      return;
    }
    if (!caption.trim()) {
      Alert.alert(t('Add caption'));
      return;
    }
    setLoading(true);
    try {
      await schedulePost({
        userId: state.user.uid,
        platforms: selectedPlatforms,
        images,
        videoUrl: videoUrl.trim() || undefined,
        youtubeVideoUrl: youtubeVideoUrl.trim() || undefined,
        tiktokVideoUrl: tiktokVideoUrl.trim() || undefined,
        instagramReelsVideoUrl: reelsVideoUrl.trim() || undefined,
        videoTitle: videoTitle.trim() || undefined,
        caption,
        hashtags,
        scheduledFor: date.toISOString(),
        timesPerDay,
      });
      Alert.alert(t('Scheduled'), t('Posts added to queue.'));
      setCaption('');
      setHashtags('');
      setImages([]);
      setVideoUrl('');
      setYoutubeVideoUrl('');
      setTiktokVideoUrl('');
      setReelsVideoUrl('');
      setVideoTitle('');
    } catch (error: any) {
      Alert.alert(t('Failed'), error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <Text style={styles.label}>{t('Platforms')}</Text>
        <View style={styles.row}>
          {PLATFORM_OPTIONS.map(platform => (
            <TouchableOpacity
              key={platform}
              style={[styles.chip, selectedPlatforms.includes(platform) && styles.chipActive]}
              onPress={() => togglePlatform(platform)}
            >
              <Text style={styles.chipText}>
                {platform === 'twitter'
                  ? 'X'
                  : platform === 'instagram_reels'
                    ? 'Instagram Reels'
                    : platform === 'youtube'
                      ? 'YouTube'
                      : platform === 'tiktok'
                        ? 'TikTok'
                        : t(platform.charAt(0).toUpperCase() + platform.slice(1))}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>{t('Schedule Date & Time')}</Text>
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

        <Text style={styles.label}>{t('Times per day')}</Text>
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
        <Text style={styles.helper}>{t('Total posts scheduled today: {{count}}/5', { count: summary })}</Text>

        {hasVideoPlatform && (
          <>
            {hasYoutube && (
              <>
                <Text style={styles.label}>{t('YouTube Video URL')}</Text>
                <TextInput
                  value={youtubeVideoUrl}
                  onChangeText={setYoutubeVideoUrl}
                  placeholder={t('Paste YouTube video URL')}
                  placeholderTextColor={colors.subtext}
                  style={styles.input}
                />
                <Text style={styles.label}>{t('YouTube Title (optional)')}</Text>
                <TextInput
                  value={videoTitle}
                  onChangeText={setVideoTitle}
                  placeholder={t('Optional video title')}
                  placeholderTextColor={colors.subtext}
                  style={styles.input}
                />
              </>
            )}
            {hasTikTok && (
              <>
                <Text style={styles.label}>{t('TikTok Video URL')}</Text>
                <TextInput
                  value={tiktokVideoUrl}
                  onChangeText={setTiktokVideoUrl}
                  placeholder={t('Paste TikTok video URL')}
                  placeholderTextColor={colors.subtext}
                  style={styles.input}
                />
              </>
            )}
            {hasReels && (
              <>
                <Text style={styles.label}>{t('Instagram Reels Video URL')}</Text>
                <TextInput
                  value={reelsVideoUrl}
                  onChangeText={setReelsVideoUrl}
                  placeholder={t('Paste Instagram Reels video URL')}
                  placeholderTextColor={colors.subtext}
                  style={styles.input}
                />
              </>
            )}
          </>
        )}
        {hasOptionalVideoPlatforms && (
          <>
            <Text style={styles.label}>{t('Video URL')}</Text>
            <TextInput
              value={videoUrl}
              onChangeText={setVideoUrl}
              placeholder={t('Paste video URL')}
              placeholderTextColor={colors.subtext}
              style={styles.input}
            />
          </>
        )}

        <Text style={styles.label}>{t('Images')}</Text>
        <TextInput
          value={imageUrlInput}
          onChangeText={setImageUrlInput}
          placeholder={t('Paste image URL')}
          placeholderTextColor={colors.subtext}
          style={styles.input}
        />
        <DMButton title={t('Add Image')} onPress={addImage} style={{ marginBottom: 12 }} />
        {images.map(url => (
          <Text key={url} style={styles.imageRow}>
            • {url}
          </Text>
        ))}

        <Text style={styles.label}>{t('Caption')}</Text>
        <TextInput
          value={caption}
          onChangeText={setCaption}
          placeholder={t('Use caption from content generator...')}
          placeholderTextColor={colors.subtext}
          multiline
          style={[styles.input, { minHeight: 80 }]}
        />
        <Text style={styles.label}>{t('Hashtags')}</Text>
        <TextInput
          value={hashtags}
          onChangeText={setHashtags}
          placeholder="#hashtags"
          placeholderTextColor={colors.subtext}
          multiline
          style={[styles.input, { minHeight: 60 }]}
        />
        <DMButton title={loading ? t('Scheduling...') : t('Schedule')} onPress={submit} disabled={loading} />
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
