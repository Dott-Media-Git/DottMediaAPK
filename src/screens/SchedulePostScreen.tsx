import React, { useMemo, useState } from 'react';
import {
  Alert,
  Image,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { DMButton } from '@components/DMButton';
import { colors } from '@constants/colors';
import { schedulePost } from '@services/social';
import { useAuth } from '@context/AuthContext';
import { useI18n } from '@context/I18nContext';

const PLATFORM_OPTIONS = [
  'instagram',
  'instagram_story',
  'instagram_reels',
  'threads',
  'facebook',
  'facebook_story',
  'linkedin',
  'twitter',
  'youtube',
  'tiktok',
] as const;

const formatPlatformLabel = (platform: string) => {
  if (platform === 'twitter') return 'X';
  if (platform === 'instagram_reels') return 'Instagram Reels';
  if (platform === 'instagram_story') return 'Instagram Story';
  if (platform === 'facebook_story') return 'Facebook Story';
  if (platform === 'youtube') return 'YouTube';
  if (platform === 'tiktok') return 'TikTok';
  return platform.charAt(0).toUpperCase() + platform.slice(1);
};

const formatHashtags = (raw: string) =>
  raw
    .split(/[,\n]/g)
    .map(token => token.trim())
    .filter(Boolean)
    .map(token => (token.startsWith('#') ? token : `#${token.replace(/^#+/, '')}`))
    .join(' ');

const truncateValue = (value: string, max = 88) => {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(max - 1, 1)).trimEnd()}...`;
};

const formatCountLabel = (count: number, singular: string, plural: string) =>
  count === 1 ? `1 ${singular}` : `${count} ${plural}`;

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
  const [previewVisible, setPreviewVisible] = useState(false);

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
    platform => platform === 'facebook' || platform === 'facebook_story' || platform === 'instagram_story' || platform === 'linkedin',
  );
  const hasGenericVideo = videoUrl.trim().length > 0;
  const hasVideoPlatform = hasYoutube || hasTikTok || hasReels;
  const imageOnlyPlatforms = selectedPlatforms.filter(
    platform =>
      platform !== 'youtube' &&
      platform !== 'tiktok' &&
      platform !== 'instagram_reels' &&
      platform !== 'facebook' &&
      platform !== 'facebook_story' &&
      platform !== 'instagram_story' &&
      platform !== 'linkedin',
  );
  const needsImages = imageOnlyPlatforms.length > 0 || (hasOptionalVideoPlatforms && !hasGenericVideo);

  const normalizedCaption = caption.trim();
  const normalizedHashtags = formatHashtags(hashtags);

  const togglePlatform = (platform: string) => {
    setSelectedPlatforms(prev =>
      prev.includes(platform) ? prev.filter(p => p !== platform) : [...prev, platform],
    );
  };

  const validateSchedule = () => {
    if (!state.user) return false;
    if (needsImages && !images.length) {
      if (imageOnlyPlatforms.length === 0 && hasOptionalVideoPlatforms) {
        Alert.alert(t('Add video URL'), t('Please add a video URL.'));
      } else {
        Alert.alert(t('Add images'), t('Please add at least one image URL generated earlier.'));
      }
      return false;
    }
    if (hasYoutube && !youtubeVideoUrl.trim()) {
      Alert.alert(t('Add video URL'), t('Please add a YouTube video URL.'));
      return false;
    }
    if (hasTikTok && !tiktokVideoUrl.trim()) {
      Alert.alert(t('Add video URL'), t('Please add a TikTok video URL.'));
      return false;
    }
    if (hasReels && !reelsVideoUrl.trim()) {
      Alert.alert(t('Add video URL'), t('Please add an Instagram Reels video URL.'));
      return false;
    }
    if (!normalizedCaption) {
      Alert.alert(t('Add caption'));
      return false;
    }
    return true;
  };

  const getPlatformMedia = (platform: string) => {
    if (platform === 'youtube') return youtubeVideoUrl.trim() ? [youtubeVideoUrl.trim()] : [];
    if (platform === 'tiktok') return tiktokVideoUrl.trim() ? [tiktokVideoUrl.trim()] : [];
    if (platform === 'instagram_reels') return reelsVideoUrl.trim() ? [reelsVideoUrl.trim()] : [];
    if (
      platform === 'facebook' ||
      platform === 'facebook_story' ||
      platform === 'instagram_story' ||
      platform === 'linkedin'
    ) {
      return videoUrl.trim() ? [videoUrl.trim()] : [];
    }
    return [];
  };

  const buildPreviewText = (platform: string) => {
    const joined = platform === 'twitter'
      ? [normalizedCaption, normalizedHashtags].filter(Boolean).join(' ')
      : [normalizedCaption, normalizedHashtags].filter(Boolean).join('\n\n');
    return joined;
  };

  const resetForm = () => {
    setCaption('');
    setHashtags('');
    setImages([]);
    setVideoUrl('');
    setYoutubeVideoUrl('');
    setTiktokVideoUrl('');
    setReelsVideoUrl('');
    setVideoTitle('');
  };

  const submit = async () => {
    if (!state.user) return;
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
        caption: normalizedCaption,
        hashtags: normalizedHashtags,
        scheduledFor: date.toISOString(),
        timesPerDay,
      });
      setPreviewVisible(false);
      Alert.alert(t('Scheduled'), t('Posts added to queue.'));
      resetForm();
    } catch (error: any) {
      Alert.alert(t('Failed'), error.message);
    } finally {
      setLoading(false);
    }
  };

  const openPreview = () => {
    if (!validateSchedule()) return;
    setPreviewVisible(true);
  };

  const openExternalPreview = async (url: string) => {
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert(t('Preview unavailable'), t('Unable to open this media preview right now.'));
    }
  };

  return (
    <>
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
                <Text style={styles.chipText}>{t(formatPlatformLabel(platform))}</Text>
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
              - {url}
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
          <DMButton
            title={loading ? t('Scheduling...') : t('Preview Schedule')}
            onPress={openPreview}
            disabled={loading}
            loading={loading}
          />
        </View>
      </ScrollView>

      <Modal visible={previewVisible} transparent animationType="fade" onRequestClose={() => setPreviewVisible(false)}>
        <View style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setPreviewVisible(false)} />
          <View style={styles.previewShell}>
            <View style={styles.previewHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.previewTitle}>{t('Preview Before Scheduling')}</Text>
                <Text style={styles.previewSubtitle}>
                  {t('Review the scheduled content and media before adding it to the queue.')}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setPreviewVisible(false)} style={styles.closeButton}>
                <Text style={styles.closeButtonText}>{t('Close')}</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.previewScroll} contentContainerStyle={styles.previewContent}>
              <View style={styles.previewStatsRow}>
                <View style={styles.previewStatCard}>
                  <Text style={styles.previewStatLabel}>{t('Platforms')}</Text>
                  <Text style={styles.previewStatValue}>{selectedPlatforms.length}</Text>
                  <Text style={styles.previewStatMeta}>
                    {formatCountLabel(selectedPlatforms.length, t('channel'), t('channels'))}
                  </Text>
                </View>
                <View style={styles.previewStatCard}>
                  <Text style={styles.previewStatLabel}>{t('Posts per day')}</Text>
                  <Text style={styles.previewStatValue}>{timesPerDay}</Text>
                  <Text style={styles.previewStatMeta}>
                    {t('Capped at {{count}} total scheduled posts today', { count: summary })}
                  </Text>
                </View>
                <View style={styles.previewStatCard}>
                  <Text style={styles.previewStatLabel}>{t('Media')}</Text>
                  <Text style={styles.previewStatValue}>
                    {videoUrl.trim() || youtubeVideoUrl.trim() || tiktokVideoUrl.trim() || reelsVideoUrl.trim()
                      ? t('Ready')
                      : images.length
                        ? t('Image')
                        : t('Text')}
                  </Text>
                  <Text style={styles.previewStatMeta}>
                    {videoUrl.trim() || youtubeVideoUrl.trim() || tiktokVideoUrl.trim() || reelsVideoUrl.trim()
                      ? t('Video supplied for selected channels')
                      : images.length
                        ? formatCountLabel(images.length, t('image'), t('images'))
                        : t('Caption-led schedule')}
                  </Text>
                </View>
              </View>

              <View style={styles.previewMetaCard}>
                <Text style={styles.previewMetaLabel}>{t('Schedule')}</Text>
                <Text style={styles.previewMetaValue}>{date.toLocaleString()}</Text>
                <Text style={styles.previewMetaLabel}>{t('Times per day')}</Text>
                <Text style={styles.previewMetaValue}>{timesPerDay}</Text>
              </View>

              <View style={styles.previewMetaCard}>
                <Text style={styles.previewMetaLabel}>{t('Selected Platforms')}</Text>
                <View style={styles.row}>
                  {selectedPlatforms.map(platform => (
                    <View key={platform} style={styles.previewChip}>
                      <Text style={styles.previewChipText}>{t(formatPlatformLabel(platform))}</Text>
                    </View>
                  ))}
                </View>
              </View>

              <View style={styles.previewMetaCard}>
                <Text style={styles.previewMetaLabel}>{t('Caption')}</Text>
                <Text style={styles.previewMetaValue}>{normalizedCaption}</Text>
                {normalizedHashtags ? (
                  <>
                    <Text style={[styles.previewMetaLabel, { marginTop: 12 }]}>{t('Hashtags')}</Text>
                    <Text style={styles.previewMetaValue}>{normalizedHashtags}</Text>
                  </>
                ) : null}
              </View>

              {images.length ? (
                <View style={styles.previewBlock}>
                  <Text style={styles.sectionTitle}>{t('Image Preview')}</Text>
                  <Text style={styles.previewSectionHint}>
                    {t('These are the attached visuals that will publish on image-first channels.')}
                  </Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    {images.map(url => (
                      <Image key={url} source={{ uri: url }} style={styles.previewImage} />
                    ))}
                  </ScrollView>
                </View>
              ) : null}

              {(videoUrl.trim() || youtubeVideoUrl.trim() || tiktokVideoUrl.trim() || reelsVideoUrl.trim()) ? (
                <View style={styles.previewMediaCard}>
                  <Text style={styles.previewMediaCardTitle}>{t('Video Attachments')}</Text>
                  <Text style={styles.previewMediaCardHint}>
                    {t('Each supplied video can be opened and checked before the schedule goes live.')}
                  </Text>
                  {[
                    ...getPlatformMedia('youtube'),
                    ...getPlatformMedia('tiktok'),
                    ...getPlatformMedia('instagram_reels'),
                    ...getPlatformMedia('facebook'),
                    ...getPlatformMedia('facebook_story'),
                    ...getPlatformMedia('instagram_story'),
                    ...getPlatformMedia('linkedin'),
                  ]
                    .filter((value, index, array) => array.indexOf(value) === index)
                    .map((url, index) => (
                      <TouchableOpacity
                        key={`preview-video-${url}`}
                        style={styles.previewLinkButton}
                        onPress={() => openExternalPreview(url)}
                      >
                        <Text style={styles.previewLinkButtonText}>
                          {t('Open video {{index}}', { index: index + 1 })}
                        </Text>
                        <Text style={styles.previewLinkMeta}>{truncateValue(url, 54)}</Text>
                      </TouchableOpacity>
                    ))}
                </View>
              ) : null}

              {selectedPlatforms.map(platform => {
                const mediaUrls = getPlatformMedia(platform);
                return (
                  <View key={platform} style={styles.previewPlatformCard}>
                    <View style={styles.previewPlatformHeader}>
                      <Text style={styles.previewPlatformTitle}>{t(formatPlatformLabel(platform))}</Text>
                      <View style={styles.previewPlatformTagPill}>
                        <Text style={styles.previewPlatformTag}>
                          {mediaUrls.length ? t('Video attached') : images.length ? t('Image set ready') : t('Caption only')}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.previewDetailRow}>
                      <View style={styles.previewMiniBadge}>
                        <Text style={styles.previewMiniBadgeText}>
                          {mediaUrls.length
                            ? formatCountLabel(mediaUrls.length, t('video'), t('videos'))
                            : images.length
                              ? formatCountLabel(images.length, t('image'), t('images'))
                              : t('Text only')}
                        </Text>
                      </View>
                      <View style={styles.previewMiniBadge}>
                        <Text style={styles.previewMiniBadgeText}>{t(formatPlatformLabel(platform))}</Text>
                      </View>
                    </View>
                    {platform === 'youtube' && videoTitle.trim() ? (
                      <Text style={styles.previewMetaValue}>{videoTitle.trim()}</Text>
                    ) : null}
                    {mediaUrls.length ? (
                      <View style={styles.previewMediaBox}>
                        <Text style={styles.previewMediaLabel}>{t('Attached Video')}</Text>
                        <Text style={styles.previewMediaHint}>
                          {t('Review the exact uploaded video for this platform.')}
                        </Text>
                        {mediaUrls.map((url, index) => (
                          <TouchableOpacity
                            key={`${platform}-${url}`}
                            style={styles.previewInlineLink}
                            onPress={() => openExternalPreview(url)}
                          >
                            <Text style={styles.previewInlineLinkText}>
                              {t('Open video {{index}}', { index: index + 1 })}
                            </Text>
                            <Text style={styles.previewUrl}>{truncateValue(url, 54)}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    ) : images.length ? (
                      <View style={styles.previewMediaBox}>
                        <Text style={styles.previewMediaLabel}>{t('Attached Creative')}</Text>
                        <Text style={styles.previewMediaHint}>
                          {t('This platform will use the uploaded image set shown above.')}
                        </Text>
                      </View>
                    ) : null}
                    <View style={styles.previewCaptionBox}>
                      <Text style={styles.previewMediaLabel}>{t('Caption')}</Text>
                      <Text style={styles.previewCaption}>{buildPreviewText(platform)}</Text>
                    </View>
                  </View>
                );
              })}
            </ScrollView>

            <View style={styles.previewFooter}>
              <DMButton
                title={loading ? t('Scheduling...') : t('Schedule')}
                onPress={submit}
                disabled={loading}
                loading={loading}
              />
            </View>
          </View>
        </View>
      </Modal>
    </>
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
  modalOverlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'center',
    padding: 18,
  },
  previewShell: {
    maxHeight: '92%',
    backgroundColor: colors.backgroundAlt,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 18,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  previewTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 4,
  },
  previewSubtitle: {
    color: colors.subtext,
    lineHeight: 18,
  },
  closeButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
  },
  closeButtonText: {
    color: colors.text,
    fontWeight: '600',
  },
  previewScroll: {
    maxHeight: '100%',
  },
  previewContent: {
    padding: 18,
    paddingBottom: 12,
  },
  previewStatsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 14,
  },
  previewStatCard: {
    flexGrow: 1,
    flexBasis: 0,
    minWidth: 110,
    padding: 14,
    borderRadius: 18,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  previewStatLabel: {
    color: colors.subtext,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  previewStatValue: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 4,
  },
  previewStatMeta: {
    color: colors.subtext,
    lineHeight: 17,
  },
  previewMetaCard: {
    padding: 14,
    borderRadius: 18,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 14,
  },
  previewMetaLabel: {
    color: colors.subtext,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
  },
  previewMetaValue: {
    color: colors.text,
    marginBottom: 8,
    lineHeight: 20,
  },
  previewChip: {
    backgroundColor: 'rgba(139,93,255,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(139,93,255,0.32)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginRight: 8,
    marginBottom: 8,
  },
  previewChipText: {
    color: colors.text,
    fontWeight: '600',
  },
  previewBlock: {
    marginBottom: 14,
  },
  previewSectionHint: {
    color: colors.subtext,
    marginTop: 6,
    marginBottom: 4,
    lineHeight: 18,
  },
  previewImage: {
    width: 220,
    height: 220,
    borderRadius: 18,
    marginRight: 12,
    marginTop: 10,
  },
  previewPlatformCard: {
    borderRadius: 18,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    marginBottom: 12,
  },
  previewPlatformHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    gap: 12,
  },
  previewDetailRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  previewMiniBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  previewMiniBadgeText: {
    color: colors.subtext,
    fontSize: 12,
    fontWeight: '700',
  },
  previewPlatformTitle: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 16,
  },
  previewPlatformTagPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(76,194,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(76,194,255,0.28)',
  },
  previewPlatformTag: {
    color: colors.accentMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  previewMediaCard: {
    backgroundColor: colors.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    marginBottom: 14,
  },
  previewMediaCardTitle: {
    color: colors.text,
    fontWeight: '800',
    fontSize: 16,
    marginBottom: 6,
  },
  previewMediaCardHint: {
    color: colors.subtext,
    lineHeight: 18,
    marginBottom: 10,
  },
  previewMediaBox: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
  },
  previewMediaLabel: {
    color: colors.subtext,
    fontWeight: '700',
    marginBottom: 8,
  },
  previewMediaHint: {
    color: colors.subtext,
    lineHeight: 18,
    marginBottom: 10,
  },
  previewInlineLink: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 10,
    marginTop: 8,
    backgroundColor: colors.card,
  },
  previewInlineLinkText: {
    color: colors.text,
    fontWeight: '700',
    marginBottom: 4,
  },
  previewLinkButton: {
    marginTop: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  previewLinkButtonText: {
    color: colors.text,
    fontWeight: '700',
    marginBottom: 4,
  },
  previewLinkMeta: {
    color: colors.subtext,
    lineHeight: 17,
  },
  previewUrl: {
    color: colors.accentMuted,
    lineHeight: 18,
  },
  previewCaptionBox: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 12,
  },
  previewCaption: {
    color: colors.text,
    lineHeight: 21,
  },
  previewFooter: {
    padding: 18,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.backgroundAlt,
  },
  sectionTitle: {
    color: colors.text,
    fontWeight: '700',
    marginTop: 12,
  },
});
