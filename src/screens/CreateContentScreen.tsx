import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
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
import { DMButton } from '@components/DMButton';
import { colors } from '@constants/colors';
import { generateContent, runAutoPostNow, type GeneratedSocialContent } from '@services/social';
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

const GENERATED_VIDEO_PLATFORMS = new Set([
  'twitter',
  'threads',
  'facebook',
  'facebook_story',
  'instagram_story',
  'instagram_reels',
  'linkedin',
  'tiktok',
  'youtube',
]);

const HASHTAG_REGEX = /#[A-Za-z0-9_]+/;

const formatPlatformLabel = (platform: string) => {
  if (platform === 'twitter') return 'X';
  if (platform === 'instagram_reels') return 'Instagram Reels';
  if (platform === 'instagram_story') return 'Instagram Story';
  if (platform === 'facebook_story') return 'Facebook Story';
  if (platform === 'youtube') return 'YouTube';
  if (platform === 'tiktok') return 'TikTok';
  return platform.charAt(0).toUpperCase() + platform.slice(1);
};

const formatHashtags = (raw?: string) => {
  if (!raw) return '';
  return raw
    .split(/[,\n]/g)
    .map(token => token.trim())
    .filter(Boolean)
    .map(token => (token.startsWith('#') ? token : `#${token.replace(/^#+/, '')}`))
    .join(' ');
};

const buildPlatformPreviewText = (platform: string, content: GeneratedSocialContent) => {
  const captions: Record<string, string> = {
    instagram: content.caption_instagram,
    instagram_reels: content.caption_instagram,
    instagram_story: content.caption_instagram,
    threads: content.caption_instagram,
    tiktok: content.caption_instagram,
    facebook: content.caption_linkedin,
    facebook_story: content.caption_instagram,
    linkedin: content.caption_linkedin,
    twitter: content.caption_x,
    youtube: content.caption_linkedin,
  };
  const caption = (captions[platform] ?? content.caption_linkedin ?? content.caption_instagram ?? '').trim();
  const hashtags =
    platform === 'instagram' ||
    platform === 'instagram_reels' ||
    platform === 'instagram_story' ||
    platform === 'facebook_story' ||
    platform === 'threads' ||
    platform === 'tiktok'
      ? formatHashtags(content.hashtags_instagram)
      : formatHashtags(content.hashtags_generic);

  if (!hashtags || HASHTAG_REGEX.test(caption)) {
    return caption;
  }
  return platform === 'twitter' ? `${caption} ${hashtags}`.trim() : [caption, hashtags].filter(Boolean).join('\n\n');
};

const truncateValue = (value: string, max = 88) => {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(max - 1, 1)).trimEnd()}...`;
};

const formatCountLabel = (count: number, singular: string, plural: string) =>
  count === 1 ? `1 ${singular}` : `${count} ${plural}`;

const formatGenerationFailureNotice = (assetType: 'image' | 'video', _rawMessage?: string) => {
  const label = assetType === 'image' ? 'Image' : 'Video';
  return `${label} generation is unavailable right now. add credits and try again.`;
};

export const CreateContentScreen: React.FC = () => {
  const { state } = useAuth();
  const { t } = useI18n();
  const [prompt, setPrompt] = useState('');
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([
    'instagram',
    'instagram_story',
    'facebook',
    'facebook_story',
    'linkedin',
  ]);
  const [youtubeVideoUrlInput, setYoutubeVideoUrlInput] = useState('');
  const [youtubeVideoUrls, setYoutubeVideoUrls] = useState<string[]>([]);
  const [tiktokVideoUrlInput, setTiktokVideoUrlInput] = useState('');
  const [tiktokVideoUrls, setTiktokVideoUrls] = useState<string[]>([]);
  const [reelsVideoUrlInput, setReelsVideoUrlInput] = useState('');
  const [reelsVideoUrls, setReelsVideoUrls] = useState<string[]>([]);
  const [videoTitle, setVideoTitle] = useState('');
  const [result, setResult] = useState<GeneratedSocialContent | null>(null);
  const [previewContent, setPreviewContent] = useState<GeneratedSocialContent | null>(null);
  const [previewPrompt, setPreviewPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [postingNow, setPostingNow] = useState(false);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [lastPostTime, setLastPostTime] = useState<Date | null>(null);
  const [noticeMessage, setNoticeMessage] = useState('');
  const noticeOffset = useRef(new Animated.Value(-120)).current;
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasYoutube = selectedPlatforms.includes('youtube');
  const hasTikTok = selectedPlatforms.includes('tiktok');
  const hasReels = selectedPlatforms.includes('instagram_reels');
  const normalizedPrompt = prompt.trim();
  const businessType = (state.crmData?.businessGoals ?? 'growth marketing').trim();
  const previewIsFresh = Boolean(previewContent) && previewPrompt === normalizedPrompt;
  const shouldGenerateVideo = selectedPlatforms.some(platform => GENERATED_VIDEO_PLATFORMS.has(platform));
  const previewImageCount = previewContent?.images?.length ?? 0;
  const previewHasVideo = Boolean(previewContent?.video_url?.trim());

  const invalidatePreview = () => {
    setResult(null);
    setPreviewContent(null);
    setPreviewPrompt('');
  };

  useEffect(() => {
    return () => {
      if (noticeTimerRef.current) {
        clearTimeout(noticeTimerRef.current);
      }
    };
  }, []);

  const handlePromptChange = (value: string) => {
    setPrompt(value);
    invalidatePreview();
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

  const showPromptNotice = () => {
    showNotice(t('Enter a prompt first.'));
  };

  const addYoutubeVideoUrl = () => {
    const trimmed = youtubeVideoUrlInput.trim();
    if (!trimmed) return;
    setYoutubeVideoUrls(prev => [...prev, trimmed]);
    setYoutubeVideoUrlInput('');
  };

  const addTikTokVideoUrl = () => {
    const trimmed = tiktokVideoUrlInput.trim();
    if (!trimmed) return;
    setTiktokVideoUrls(prev => [...prev, trimmed]);
    setTiktokVideoUrlInput('');
  };

  const addReelsVideoUrl = () => {
    const trimmed = reelsVideoUrlInput.trim();
    if (!trimmed) return;
    setReelsVideoUrls(prev => [...prev, trimmed]);
    setReelsVideoUrlInput('');
  };

  const togglePlatform = (platform: string) => {
    setSelectedPlatforms(prev =>
      prev.includes(platform) ? prev.filter(item => item !== platform) : [...prev, platform],
    );
  };

  const validatePostNow = () => {
    if (!normalizedPrompt) {
      showPromptNotice();
      return false;
    }
    if (!selectedPlatforms.length) {
      Alert.alert(t('Platforms'), t('Select at least one platform.'));
      return false;
    }
    return true;
  };

  const requestGeneratedContent = async (mode: 'generate' | 'preview') => {
    if (!normalizedPrompt) {
      showPromptNotice();
      return null;
    }

    if (mode === 'generate') {
      setLoading(true);
    } else {
      setPreviewLoading(true);
    }

    try {
      const response = await generateContent({
        userId: state.user?.uid,
        prompt: normalizedPrompt,
        businessType,
        generateVideo: shouldGenerateVideo,
      });
      const content = response.content as GeneratedSocialContent;
      setResult(content);
      setPreviewContent(content);
      setPreviewPrompt(normalizedPrompt);

      const warnings: string[] = [];
      if (!content.images?.length && content.image_error) {
        warnings.push(formatGenerationFailureNotice('image', content.image_error));
      }
      if (shouldGenerateVideo && !content.video_url && content.video_error) {
        warnings.push(formatGenerationFailureNotice('video', content.video_error));
      }
      if (warnings.length) {
        showNotice(warnings.join('\n'));
      }

      return content;
    } catch (error: any) {
      const rawMessage = error?.message ?? '';
      const combinedMessage =
        shouldGenerateVideo && rawMessage
          ? `${formatGenerationFailureNotice('image', rawMessage)}\n${formatGenerationFailureNotice('video', rawMessage)}`
          : formatGenerationFailureNotice('image', rawMessage);
      showNotice(combinedMessage);
      return null;
    } finally {
      if (mode === 'generate') {
        setLoading(false);
      } else {
        setPreviewLoading(false);
      }
    }
  };

  const ensurePreviewContent = async () => {
    if (previewIsFresh && previewContent) {
      return previewContent;
    }
    return requestGeneratedContent('preview');
  };

  const handleGenerate = async () => {
    await requestGeneratedContent('generate');
  };

  const handleOpenPreview = async () => {
    if (!validatePostNow()) return;
    if (lastPostTime && Date.now() - lastPostTime.getTime() < 3 * 60 * 60 * 1000) {
      const nextRun = new Date(lastPostTime.getTime() + 3 * 60 * 60 * 1000);
      Alert.alert(
        t('Auto-post scheduled'),
        t('The bot just posted. Next auto post will go out around {{time}}.', {
          time: nextRun.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        })
      );
    }

    const content = await ensurePreviewContent();
    if (!content) return;
    setPreviewVisible(true);
  };

  const handlePostNow = async () => {
    const content = await ensurePreviewContent();
    if (!content) return;
    const generatedVideoUrl = content.video_url?.trim() || undefined;
    const youtubeVideoUrl = youtubeVideoUrls.length
      ? undefined
      : youtubeVideoUrlInput.trim() || (hasYoutube ? generatedVideoUrl : undefined);
    const tiktokVideoUrl = tiktokVideoUrls.length
      ? undefined
      : tiktokVideoUrlInput.trim() || (hasTikTok ? generatedVideoUrl : undefined);
    const instagramReelsVideoUrl = reelsVideoUrls.length
      ? undefined
      : reelsVideoUrlInput.trim() || (hasReels ? generatedVideoUrl : undefined);

    setPostingNow(true);
    try {
      await runAutoPostNow({
        prompt: normalizedPrompt,
        businessType,
        platforms: selectedPlatforms,
        videoUrl: generatedVideoUrl,
        youtubeVideoUrl,
        youtubeVideoUrls: youtubeVideoUrls.length ? youtubeVideoUrls : undefined,
        tiktokVideoUrl,
        tiktokVideoUrls: tiktokVideoUrls.length ? tiktokVideoUrls : undefined,
        instagramReelsVideoUrl,
        instagramReelsVideoUrls: reelsVideoUrls.length ? reelsVideoUrls : undefined,
        videoTitle: videoTitle.trim() || undefined,
        generatedContent: content,
      });
      const postedAt = new Date();
      setLastPostTime(postedAt);
      setPreviewVisible(false);
      Alert.alert(t('Posted'), t('Bot is posting now. Next auto post will go out in ~3 hours.'));
    } catch (error: any) {
      Alert.alert(t('Post failed'), error.message ?? t('Unable to post right now.'));
    } finally {
      setPostingNow(false);
    }
  };

  const getVideoUrlsForPlatform = (platform: string, content?: GeneratedSocialContent | null) => {
    if (platform === 'youtube') {
      if (youtubeVideoUrls.length) return youtubeVideoUrls;
      if (youtubeVideoUrlInput.trim()) return [youtubeVideoUrlInput.trim()];
      return content?.video_url ? [content.video_url] : [];
    }
    if (platform === 'tiktok') {
      if (tiktokVideoUrls.length) return tiktokVideoUrls;
      if (tiktokVideoUrlInput.trim()) return [tiktokVideoUrlInput.trim()];
      return content?.video_url ? [content.video_url] : [];
    }
    if (platform === 'instagram_reels') {
      if (reelsVideoUrls.length) return reelsVideoUrls;
      if (reelsVideoUrlInput.trim()) return [reelsVideoUrlInput.trim()];
      return content?.video_url ? [content.video_url] : [];
    }
    if (GENERATED_VIDEO_PLATFORMS.has(platform) && content?.video_url) {
      return [content.video_url];
    }
    return [];
  };

  const openExternalPreview = async (url: string) => {
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert(t('Preview unavailable'), t('Unable to open this media preview right now.'));
    }
  };

  const buildMediaStatus = (platform: string, videoCount: number) => {
    if (videoCount) return t('Video attached');
    if (platform === 'instagram_story' || platform === 'facebook_story') {
      return previewImageCount ? t('Story creative ready') : t('Story copy only');
    }
    if (previewImageCount) return t('Image set ready');
    return t('Caption only');
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
          <Text style={styles.label}>{t('Prompt')}</Text>
          <TextInput
            style={styles.input}
            value={prompt}
            onChangeText={handlePromptChange}
            placeholder={t('Describe the campaign idea...')}
            placeholderTextColor={colors.subtext}
            multiline
          />
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

          {(hasYoutube || hasTikTok || hasReels) && (
            <>
              {hasYoutube && (
                <>
                  <Text style={styles.label}>{t('YouTube Video URLs')}</Text>
                  <TextInput
                    style={styles.input}
                    value={youtubeVideoUrlInput}
                    onChangeText={setYoutubeVideoUrlInput}
                    placeholder={t('Paste YouTube video URL')}
                    placeholderTextColor={colors.subtext}
                  />
                  <DMButton title={t('Add YouTube Video')} onPress={addYoutubeVideoUrl} style={{ marginBottom: 12 }} />
                  {youtubeVideoUrls.map(url => (
                    <Text key={url} style={styles.videoRow}>
                      - {url}
                    </Text>
                  ))}
                  <Text style={styles.label}>{t('YouTube Title (optional)')}</Text>
                  <TextInput
                    style={styles.input}
                    value={videoTitle}
                    onChangeText={setVideoTitle}
                    placeholder={t('Optional video title')}
                    placeholderTextColor={colors.subtext}
                  />
                </>
              )}
              {hasTikTok && (
                <>
                  <Text style={styles.label}>{t('TikTok Video URLs')}</Text>
                  <TextInput
                    style={styles.input}
                    value={tiktokVideoUrlInput}
                    onChangeText={setTiktokVideoUrlInput}
                    placeholder={t('Paste TikTok video URL')}
                    placeholderTextColor={colors.subtext}
                  />
                  <DMButton title={t('Add TikTok Video')} onPress={addTikTokVideoUrl} style={{ marginBottom: 12 }} />
                  {tiktokVideoUrls.map(url => (
                    <Text key={url} style={styles.videoRow}>
                      - {url}
                    </Text>
                  ))}
                </>
              )}
              {hasReels && (
                <>
                  <Text style={styles.label}>{t('Instagram Reels Video URLs')}</Text>
                  <TextInput
                    style={styles.input}
                    value={reelsVideoUrlInput}
                    onChangeText={setReelsVideoUrlInput}
                    placeholder={t('Paste Instagram Reels video URL')}
                    placeholderTextColor={colors.subtext}
                  />
                  <DMButton title={t('Add Reels Video')} onPress={addReelsVideoUrl} style={{ marginBottom: 12 }} />
                  {reelsVideoUrls.map(url => (
                    <Text key={url} style={styles.videoRow}>
                      - {url}
                    </Text>
                  ))}
                </>
              )}
            </>
          )}
          <DMButton
            title={loading ? t('Generating...') : t('Generate Content')}
            onPress={handleGenerate}
            disabled={loading || previewLoading || postingNow}
          />
          <DMButton
            title={previewLoading ? t('Preparing Preview...') : t('Preview Post')}
            onPress={handleOpenPreview}
            disabled={loading || previewLoading || postingNow}
            loading={previewLoading}
            style={{ marginTop: 10 }}
          />
        </View>

        {result && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>{t('Images')}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {result.images?.map((url: string) => (
                <Image key={url} source={{ uri: url }} style={styles.image} />
              ))}
            </ScrollView>

            {result.image_error ? <Text style={styles.errorText}>{result.image_error}</Text> : null}
            {result.video_error ? <Text style={styles.errorText}>{result.video_error}</Text> : null}
            {result.video_url ? (
              <>
                <Text style={styles.sectionTitle}>{t('AI Video')}</Text>
                <Text style={styles.captionText}>{result.video_url}</Text>
              </>
            ) : null}

            <Text style={styles.sectionTitle}>{t('Captions')}</Text>
            <Text style={styles.captionLabel}>{t('Instagram')}</Text>
            <Text style={styles.captionText}>{result.caption_instagram}</Text>
            <Text style={styles.captionLabel}>{t('LinkedIn')}</Text>
            <Text style={styles.captionText}>{result.caption_linkedin}</Text>
            <Text style={styles.captionLabel}>{t('X / Twitter')}</Text>
            <Text style={styles.captionText}>{result.caption_x}</Text>

            <Text style={styles.captionLabel}>{t('Hashtags (IG)')}</Text>
            <Text style={styles.captionText}>{result.hashtags_instagram}</Text>
            <Text style={styles.captionLabel}>{t('Hashtags (Generic)')}</Text>
            <Text style={styles.captionText}>{result.hashtags_generic}</Text>
          </View>
        )}
      </ScrollView>

      <Modal visible={previewVisible} transparent animationType="fade" onRequestClose={() => setPreviewVisible(false)}>
        <View style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setPreviewVisible(false)} />
          <View style={styles.previewShell}>
            <View style={styles.previewHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.previewTitle}>{t('Preview Before Posting')}</Text>
                <Text style={styles.previewSubtitle}>
                  {t('Review the content below before you send it live to your selected channels.')}
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
                  <Text style={styles.previewStatLabel}>{t('Images')}</Text>
                  <Text style={styles.previewStatValue}>{previewImageCount}</Text>
                  <Text style={styles.previewStatMeta}>
                    {previewImageCount ? formatCountLabel(previewImageCount, t('frame'), t('frames')) : t('No image set')}
                  </Text>
                </View>
                <View style={styles.previewStatCard}>
                  <Text style={styles.previewStatLabel}>{t('Video')}</Text>
                  <Text style={styles.previewStatValue}>{previewHasVideo ? t('Ready') : t('Off')}</Text>
                  <Text style={styles.previewStatMeta}>
                    {previewHasVideo ? t('AI video attached') : t('Generated only when needed')}
                  </Text>
                </View>
              </View>

              <View style={styles.previewMetaCard}>
                <Text style={styles.previewMetaLabel}>{t('Prompt')}</Text>
                <Text style={styles.previewMetaValue}>{previewPrompt || normalizedPrompt}</Text>
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

              {previewContent?.images?.length ? (
                <View style={styles.previewBlock}>
                  <Text style={styles.sectionTitle}>{t('Creative Preview')}</Text>
                  <Text style={styles.previewSectionHint}>
                    {t('Primary generated visuals that will anchor the post across image-first channels.')}
                  </Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    {previewContent.images.map(url => (
                      <Image key={url} source={{ uri: url }} style={styles.previewImage} />
                    ))}
                  </ScrollView>
                </View>
              ) : null}

              {previewContent?.image_error ? (
                <View style={styles.previewWarning}>
                  <Text style={styles.previewWarningText}>{previewContent.image_error}</Text>
                </View>
              ) : null}
              {previewContent?.video_error ? (
                <View style={styles.previewWarning}>
                  <Text style={styles.previewWarningText}>{previewContent.video_error}</Text>
                </View>
              ) : null}
              {previewContent?.video_url ? (
                <View style={styles.previewMediaCard}>
                  <View style={styles.previewMediaCardHeader}>
                    <View>
                      <Text style={styles.previewMediaCardTitle}>{t('AI Video Preview')}</Text>
                      <Text style={styles.previewMediaCardHint}>
                        {t('This generated video will be used automatically on the selected video channels.')}
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={styles.previewLinkButton}
                      onPress={() => openExternalPreview(previewContent.video_url!)}
                    >
                      <Text style={styles.previewLinkButtonText}>{t('Open video')}</Text>
                      <Text style={styles.previewLinkMeta}>{truncateValue(previewContent.video_url, 40)}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : null}

              {selectedPlatforms.map(platform => {
                const previewText = previewContent ? buildPlatformPreviewText(platform, previewContent) : '';
                const videoUrls = getVideoUrlsForPlatform(platform, previewContent);
                return (
                  <View key={platform} style={styles.previewPlatformCard}>
                    <View style={styles.previewPlatformHeader}>
                      <Text style={styles.previewPlatformTitle}>{t(formatPlatformLabel(platform))}</Text>
                      <View style={styles.previewPlatformTagPill}>
                        <Text style={styles.previewPlatformTag}>{buildMediaStatus(platform, videoUrls.length)}</Text>
                      </View>
                    </View>
                    <View style={styles.previewDetailRow}>
                      <View style={styles.previewMiniBadge}>
                        <Text style={styles.previewMiniBadgeText}>
                          {videoUrls.length
                            ? formatCountLabel(videoUrls.length, t('video'), t('videos'))
                            : previewImageCount
                              ? formatCountLabel(previewImageCount, t('image'), t('images'))
                              : t('Text only')}
                        </Text>
                      </View>
                      <View style={styles.previewMiniBadge}>
                        <Text style={styles.previewMiniBadgeText}>{t(formatPlatformLabel(platform))}</Text>
                      </View>
                    </View>
                    {videoUrls.length ? (
                      <View style={styles.previewMediaBox}>
                        <Text style={styles.previewMediaLabel}>{t('Attached Video')}</Text>
                        <Text style={styles.previewMediaHint}>
                          {t('Review the video asset before sending it live to this channel.')}
                        </Text>
                        {videoUrls.map((url, index) => (
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
                    ) : previewImageCount ? (
                      <View style={styles.previewMediaBox}>
                        <Text style={styles.previewMediaLabel}>{t('Attached Creative')}</Text>
                        <Text style={styles.previewMediaHint}>
                          {t('This platform will use the generated image set shown above.')}
                        </Text>
                      </View>
                    ) : null}
                    <View style={styles.previewCaptionBox}>
                      <Text style={styles.previewMediaLabel}>{t('Caption')}</Text>
                      <Text style={styles.previewCaption}>{previewText || t('No caption available yet.')}</Text>
                    </View>
                  </View>
                );
              })}
            </ScrollView>

            <View style={styles.previewFooter}>
              <DMButton
                title={postingNow ? t('Posting...') : t('Post Now')}
                onPress={handlePostNow}
                disabled={postingNow}
                loading={postingNow}
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
    marginBottom: 18
  },
  label: { color: colors.text, fontWeight: '700', marginBottom: 6 },
  row: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 12 },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 8,
    marginBottom: 8
  },
  chipActive: { borderColor: colors.accent, backgroundColor: 'rgba(139,93,255,0.2)' },
  chipText: { color: colors.text },
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
  captionText: { color: colors.text, marginTop: 4, lineHeight: 20 },
  videoRow: { color: colors.subtext, marginBottom: 6 },
  errorText: {
    color: colors.warning,
    marginTop: 10,
    lineHeight: 18,
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
    marginBottom: 10,
  },
  previewMetaValue: {
    color: colors.text,
    lineHeight: 21,
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
  previewWarning: {
    borderRadius: 16,
    backgroundColor: 'rgba(251,191,36,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.35)',
    padding: 12,
    marginBottom: 14,
  },
  previewWarningText: {
    color: colors.warning,
    lineHeight: 18,
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
  previewMediaCardHeader: {
    gap: 12,
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
    marginTop: 12,
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
});
