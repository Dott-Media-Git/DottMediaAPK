import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Image,
  Linking,
  Modal,
  Platform,
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
import { schedulePost, uploadMediaFiles, type UploadedMediaFile } from '@services/social';
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

const IMAGE_URL_PATTERN = /\.(png|jpe?g|gif|webp|avif|svg)(\?|#|$)/i;
const VIDEO_URL_PATTERN = /\.(mp4|mov|webm|mkv|m4v)(\?|#|$)/i;
const URL_PATTERN = /(https?:\/\/[^\s]+)/gi;

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
  const [pickerMode, setPickerMode] = useState<'date' | 'time'>('date');
  const [imageUrlInput, setImageUrlInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [noticeMessage, setNoticeMessage] = useState('');
  const [mediaUploading, setMediaUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const noticeOffset = useRef(new Animated.Value(-120)).current;
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const webFileInputRef = useRef<any>(null);
  const webDateInputRef = useRef<any>(null);
  const webTimeInputRef = useRef<any>(null);

  useEffect(() => {
    return () => {
      if (noticeTimerRef.current) {
        clearTimeout(noticeTimerRef.current);
      }
    };
  }, []);

  const addImage = () => {
    if (!imageUrlInput.trim()) {
      showNotice(t('Add an image URL first, or drag and drop an image below.'));
      return;
    }
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
  const isWeb = Platform.OS === 'web';
  const preferredDateLabel = date.toLocaleDateString();
  const preferredTimeLabel = date.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
  const webDateInputStyle = {
    width: '100%',
    minHeight: '46px',
    border: `1px solid ${colors.border}`,
    borderRadius: '12px',
    padding: '0 12px',
    backgroundColor: colors.card,
    color: colors.text,
    outline: 'none',
    fontSize: '15px',
  } as const;

  const formatDateInputValue = (value: Date) => {
    const year = value.getFullYear();
    const month = `${value.getMonth() + 1}`.padStart(2, '0');
    const day = `${value.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const formatTimeInputValue = (value: Date) => {
    const hours = `${value.getHours()}`.padStart(2, '0');
    const minutes = `${value.getMinutes()}`.padStart(2, '0');
    return `${hours}:${minutes}`;
  };

  const updateScheduledDate = (value: string) => {
    if (!value) return;
    const [year, month, day] = value.split('-').map(Number);
    if (![year, month, day].every(Number.isFinite)) return;
    setDate(prev => {
      const next = new Date(prev);
      next.setFullYear(year, month - 1, day);
      return next;
    });
  };

  const updateScheduledTime = (value: string) => {
    if (!value) return;
    const [hours, minutes] = value.split(':').map(Number);
    if (![hours, minutes].every(Number.isFinite)) return;
    setDate(prev => {
      const next = new Date(prev);
      next.setHours(hours, minutes, 0, 0);
      return next;
    });
  };

  const showNotice = (message: string) => {
    setNoticeMessage(message);
    if (noticeTimerRef.current) {
      clearTimeout(noticeTimerRef.current);
    }
    noticeOffset.stopAnimation();
    Animated.spring(noticeOffset, {
      toValue: 0,
      useNativeDriver: true,
      damping: 18,
      stiffness: 170,
      mass: 0.8,
    }).start();
    noticeTimerRef.current = setTimeout(() => {
      Animated.timing(noticeOffset, {
        toValue: -120,
        duration: 220,
        useNativeDriver: true,
      }).start(() => setNoticeMessage(''));
    }, 2600);
  };

  const assignUploadedVideoUrl = (url: string) => {
    if (hasYoutube) setYoutubeVideoUrl(url);
    if (hasTikTok) setTiktokVideoUrl(url);
    if (hasReels) setReelsVideoUrl(url);
    if (hasOptionalVideoPlatforms || (!hasYoutube && !hasTikTok && !hasReels)) {
      setVideoUrl(url);
    }
  };

  const isLikelyImageUrl = (url: string) => IMAGE_URL_PATTERN.test(url);
  const isLikelyVideoUrl = (url: string) => VIDEO_URL_PATTERN.test(url);

  const applyUploadedMedia = (uploadedFiles: UploadedMediaFile[]) => {
    const uploadedImages = uploadedFiles.filter(file => file.kind === 'image');
    const uploadedVideos = uploadedFiles.filter(file => file.kind === 'video');

    if (uploadedImages.length) {
      setImages(prev => [...prev, ...uploadedImages.map(file => file.url)]);
    }
    if (uploadedVideos.length) {
      assignUploadedVideoUrl(uploadedVideos[0].url);
      if (uploadedVideos.length > 1) {
        showNotice(t('Only the first uploaded video is used for this scheduled post.'));
      }
    }
    if (uploadedImages.length || uploadedVideos.length) {
      showNotice(
        t('Media added: {{images}} image(s), {{videos}} video(s).', {
          images: uploadedImages.length,
          videos: uploadedVideos.length,
        }),
      );
    }
  };

  const uploadDroppedFiles = async (files: any[]) => {
    if (!files.length) return;
    setMediaUploading(true);
    try {
      const response = await uploadMediaFiles(files as File[]);
      applyUploadedMedia(response.files ?? []);
    } catch (error: any) {
      showNotice(error?.message ?? t('Unable to upload media right now.'));
    } finally {
      setMediaUploading(false);
    }
  };

  const applyPastedUrls = (rawText: string) => {
    const urls = (rawText.match(URL_PATTERN) ?? []).map(value => value.trim());
    if (!urls.length) {
      showNotice(t('Paste a valid image or video URL, or drop a media file.'));
      return;
    }
    const imageUrls: string[] = [];
    let assignedVideo = false;

    urls.forEach(url => {
      if (isLikelyVideoUrl(url) || (!isLikelyImageUrl(url) && !assignedVideo && (hasVideoPlatform || hasOptionalVideoPlatforms))) {
        if (!assignedVideo) {
          assignUploadedVideoUrl(url);
          assignedVideo = true;
        }
        return;
      }
      imageUrls.push(url);
    });

    if (imageUrls.length) {
      setImages(prev => [...prev, ...imageUrls]);
    }

    if (!imageUrls.length && !assignedVideo) {
      showNotice(t('Paste a valid image or video URL, or drop a media file.'));
      return;
    }

    showNotice(
      t('Media added: {{images}} image(s), {{videos}} video(s).', {
        images: imageUrls.length,
        videos: assignedVideo ? 1 : 0,
      }),
    );
  };

  const togglePlatform = (platform: string) => {
    setSelectedPlatforms(prev =>
      prev.includes(platform) ? prev.filter(p => p !== platform) : [...prev, platform],
    );
  };

  const validateSchedule = () => {
    if (!state.user) return false;
    if (needsImages && !images.length) {
      if (imageOnlyPlatforms.length === 0 && hasOptionalVideoPlatforms) {
        showNotice(t('Add a video URL first, or drag and drop a video below.'));
      } else {
        showNotice(t('Add an image URL first, or drag and drop an image below.'));
      }
      return false;
    }
    if (hasYoutube && !youtubeVideoUrl.trim()) {
      showNotice(t('Add a YouTube video URL first, or drop a video below.'));
      return false;
    }
    if (hasTikTok && !tiktokVideoUrl.trim()) {
      showNotice(t('Add a TikTok video URL first, or drop a video below.'));
      return false;
    }
    if (hasReels && !reelsVideoUrl.trim()) {
      showNotice(t('Add an Instagram Reels video URL first, or drop a video below.'));
      return false;
    }
    if (!normalizedCaption) {
      showNotice(t('Add a caption first.'));
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

  const openFilePicker = () => {
    if (!isWeb) return;
    webFileInputRef.current?.click?.();
  };

  const openWebSchedulePicker = (kind: 'date' | 'time') => {
    if (!isWeb) return;
    const inputRef = kind === 'date' ? webDateInputRef : webTimeInputRef;
    inputRef.current?.showPicker?.();
    inputRef.current?.focus?.();
    inputRef.current?.click?.();
  };

  const handleWebFileChange = async (event: any) => {
    const files = Array.from(event?.target?.files ?? []);
    if (files.length) {
      await uploadDroppedFiles(files);
    }
    if (event?.target) {
      event.target.value = '';
    }
  };

  const handleWebDrop = async (event: any) => {
    event.preventDefault();
    setDragActive(false);
    const files = Array.from(event?.dataTransfer?.files ?? []);
    if (files.length) {
      await uploadDroppedFiles(files);
      return;
    }
    const text = event?.dataTransfer?.getData?.('text') ?? '';
    if (text.trim()) {
      applyPastedUrls(text);
    }
  };

  const handleWebPaste = async (event: any) => {
    const files = Array.from(event?.clipboardData?.files ?? []);
    if (files.length) {
      event.preventDefault();
      await uploadDroppedFiles(files);
      return;
    }
    const text = event?.clipboardData?.getData?.('text') ?? '';
    if (text.trim()) {
      event.preventDefault();
      applyPastedUrls(text);
    }
  };

  return (
    <>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.noticeBanner,
          {
            opacity: noticeMessage ? 1 : 0,
            transform: [{ translateY: noticeOffset }],
          },
        ]}
      >
        <Text style={styles.noticeText}>{noticeMessage}</Text>
      </Animated.View>
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

          <Text style={styles.label}>{t('Preferred Schedule')}</Text>
          <Text style={styles.helper}>{t('Choose the exact date and time you want this post to go out.')}</Text>
          {isWeb ? (
            <View style={styles.scheduleGrid}>
              <View style={styles.scheduleField}>
                <Text style={styles.scheduleFieldLabel}>{t('Preferred Date')}</Text>
                <TouchableOpacity style={styles.schedulePreviewButton} onPress={() => openWebSchedulePicker('date')}>
                  <Text style={styles.schedulePreviewValue}>{preferredDateLabel}</Text>
                  <Text style={styles.schedulePreviewAction}>{t('Change')}</Text>
                </TouchableOpacity>
                {React.createElement('input', {
                  ref: webDateInputRef,
                  type: 'date',
                  value: formatDateInputValue(date),
                  onChange: (event: any) => updateScheduledDate(event?.target?.value ?? ''),
                  style: webDateInputStyle,
                })}
              </View>
              <View style={styles.scheduleField}>
                <Text style={styles.scheduleFieldLabel}>{t('Preferred Time')}</Text>
                <TouchableOpacity style={styles.schedulePreviewButton} onPress={() => openWebSchedulePicker('time')}>
                  <Text style={styles.schedulePreviewValue}>{preferredTimeLabel}</Text>
                  <Text style={styles.schedulePreviewAction}>{t('Change')}</Text>
                </TouchableOpacity>
                {React.createElement('input', {
                  ref: webTimeInputRef,
                  type: 'time',
                  value: formatTimeInputValue(date),
                  onChange: (event: any) => updateScheduledTime(event?.target?.value ?? ''),
                  style: webDateInputStyle,
                })}
              </View>
            </View>
          ) : (
            <View style={styles.scheduleGrid}>
              <View style={styles.scheduleField}>
                <Text style={styles.scheduleFieldLabel}>{t('Preferred Date')}</Text>
                <TouchableOpacity
                  style={styles.dateInput}
                  onPress={() => {
                    setPickerMode('date');
                    setShowPicker(true);
                  }}
                >
                  <Text style={styles.dateText}>{preferredDateLabel}</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.scheduleField}>
                <Text style={styles.scheduleFieldLabel}>{t('Preferred Time')}</Text>
                <TouchableOpacity
                  style={styles.dateInput}
                  onPress={() => {
                    setPickerMode('time');
                    setShowPicker(true);
                  }}
                >
                  <Text style={styles.dateText}>{preferredTimeLabel}</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
          {showPicker && !isWeb && (
            <DateTimePicker
              value={date}
              mode={pickerMode}
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

          <Text style={styles.label}>{t('Media Upload')}</Text>
          <View
            {...(isWeb
              ? ({
                  onDragOver: (event: any) => {
                    event.preventDefault();
                    setDragActive(true);
                  },
                  onDragLeave: () => setDragActive(false),
                  onDrop: handleWebDrop,
                  onPaste: handleWebPaste,
                  tabIndex: 0,
                } as any)
              : {})}
            style={[styles.mediaDropZone, dragActive && styles.mediaDropZoneActive]}
          >
            <Text style={styles.mediaDropZoneTitle}>
              {mediaUploading ? t('Uploading media...') : t('Drag and drop images or a video here')}
            </Text>
            <Text style={styles.mediaDropZoneText}>
              {t('You can also paste a media URL here, or browse and upload files directly.')}
            </Text>
            {isWeb ? (
              <>
                <DMButton
                  title={t('Browse Files')}
                  onPress={openFilePicker}
                  disabled={mediaUploading}
                  style={styles.mediaDropZoneButton}
                />
                {React.createElement('input', {
                  ref: webFileInputRef,
                  type: 'file',
                  multiple: true,
                  accept: 'image/*,video/*',
                  style: { display: 'none' },
                  onChange: handleWebFileChange,
                })}
              </>
            ) : (
              <Text style={styles.mediaDropZoneText}>
                {t('Paste image or video URLs into the fields below.')}
              </Text>
            )}
          </View>

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
                <Text style={styles.previewMetaLabel}>{t('Preferred Date')}</Text>
                <Text style={styles.previewMetaValue}>{preferredDateLabel}</Text>
                <Text style={styles.previewMetaLabel}>{t('Preferred Time')}</Text>
                <Text style={styles.previewMetaValue}>{preferredTimeLabel}</Text>
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
  noticeBanner: {
    position: 'absolute',
    top: 14,
    left: 18,
    right: 18,
    zIndex: 20,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.accent,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  noticeText: {
    color: colors.text,
    fontWeight: '700',
    textAlign: 'center',
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
  scheduleGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 6,
    marginBottom: 4,
  },
  scheduleField: {
    flexGrow: 1,
    minWidth: 180,
  },
  scheduleFieldLabel: {
    color: colors.subtext,
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 6,
  },
  schedulePreviewButton: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.backgroundAlt,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  schedulePreviewValue: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  schedulePreviewAction: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  dateInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: colors.card,
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
  mediaDropZone: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    borderRadius: 18,
    padding: 16,
    backgroundColor: colors.card,
    marginBottom: 12,
  },
  mediaDropZoneActive: {
    borderColor: colors.accent,
    backgroundColor: colors.surface,
  },
  mediaDropZoneTitle: {
    color: colors.text,
    fontWeight: '800',
    marginBottom: 6,
  },
  mediaDropZoneText: {
    color: colors.subtext,
    lineHeight: 18,
  },
  mediaDropZoneButton: {
    marginTop: 12,
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
