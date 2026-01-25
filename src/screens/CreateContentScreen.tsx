import React, { useState } from 'react';
import { Alert, Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { DMButton } from '@components/DMButton';
import { colors } from '@constants/colors';
import { generateContent, runAutoPostNow } from '@services/social';
import { useAuth } from '@context/AuthContext';
import { useI18n } from '@context/I18nContext';

const PLATFORM_OPTIONS = [
  'instagram',
  'instagram_story',
  'instagram_reels',
  'facebook',
  'facebook_story',
  'linkedin',
  'twitter',
  'youtube',
  'tiktok',
] as const;

export const CreateContentScreen: React.FC = () => {
  const { state } = useAuth();
  const { t } = useI18n();
  const [prompt, setPrompt] = useState('');
  const [businessType, setBusinessType] = useState(state.crmData?.businessGoals ?? 'growth marketing');
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
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [postingNow, setPostingNow] = useState(false);
  const [lastPostTime, setLastPostTime] = useState<Date | null>(null);

  const hasYoutube = selectedPlatforms.includes('youtube');
  const hasTikTok = selectedPlatforms.includes('tiktok');
  const hasReels = selectedPlatforms.includes('instagram_reels');

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

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      Alert.alert(t('Prompt required'));
      return;
    }
    if (lastPostTime && Date.now() - lastPostTime.getTime() < 3 * 60 * 60 * 1000) {
      const nextRun = new Date(lastPostTime.getTime() + 3 * 60 * 60 * 1000);
      Alert.alert(
        t('Auto-post scheduled'),
        t('The bot just posted. Next auto post will go out around {{time}}.', {
          time: nextRun.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        })
      );
    }
    setLoading(true);
    try {
      const response = await generateContent({ prompt, businessType });
      setResult(response.content);
    } catch (error: any) {
      Alert.alert(t('Generation failed'), error.message);
    } finally {
      setLoading(false);
    }
  };

  const handlePostNow = async () => {
    if (!prompt.trim()) {
      Alert.alert(t('Prompt required'), t('Add a prompt before posting now.'));
      return;
    }
    if (!selectedPlatforms.length) {
      Alert.alert(t('Platforms'), t('Select at least one platform.'));
      return;
    }
    if (hasYoutube && !youtubeVideoUrls.length && !youtubeVideoUrlInput.trim()) {
      Alert.alert(t('Add video URL'), t('Please add a YouTube video URL.'));
      return;
    }
    if (hasTikTok && !tiktokVideoUrls.length && !tiktokVideoUrlInput.trim()) {
      Alert.alert(t('Add video URL'), t('Please add a TikTok video URL.'));
      return;
    }
    if (hasReels && !reelsVideoUrls.length && !reelsVideoUrlInput.trim()) {
      Alert.alert(t('Add video URL'), t('Please add an Instagram Reels video URL.'));
      return;
    }
    setPostingNow(true);
    try {
      await runAutoPostNow({
        prompt,
        businessType,
        platforms: selectedPlatforms,
        youtubeVideoUrl: youtubeVideoUrls.length ? undefined : youtubeVideoUrlInput.trim() || undefined,
        youtubeVideoUrls: youtubeVideoUrls.length ? youtubeVideoUrls : undefined,
        tiktokVideoUrl: tiktokVideoUrls.length ? undefined : tiktokVideoUrlInput.trim() || undefined,
        tiktokVideoUrls: tiktokVideoUrls.length ? tiktokVideoUrls : undefined,
        instagramReelsVideoUrl: reelsVideoUrls.length ? undefined : reelsVideoUrlInput.trim() || undefined,
        instagramReelsVideoUrls: reelsVideoUrls.length ? reelsVideoUrls : undefined,
        videoTitle: videoTitle.trim() || undefined,
      });
      const postedAt = new Date();
      setLastPostTime(postedAt);
      Alert.alert(t('Posted'), t('Bot is posting now. Next auto post will go out in ~3 hours.'));
    } catch (error: any) {
      Alert.alert(t('Post failed'), error.message ?? t('Unable to post right now.'));
    } finally {
      setPostingNow(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <Text style={styles.label}>{t('Prompt')}</Text>
        <TextInput
          style={styles.input}
          value={prompt}
          onChangeText={setPrompt}
          placeholder={t('Describe the campaign idea...')}
          placeholderTextColor={colors.subtext}
          multiline
        />
        <Text style={styles.label}>{t('Business Type / Tone')}</Text>
        <TextInput
          style={styles.input}
          value={businessType}
          onChangeText={setBusinessType}
          placeholder={t('e.g. AI agency, SaaS marketing')}
          placeholderTextColor={colors.subtext}
        />
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
                    : platform === 'instagram_story'
                      ? 'Instagram Story'
                      : platform === 'facebook_story'
                        ? 'Facebook Story'
                    : platform === 'youtube'
                      ? 'YouTube'
                      : platform === 'tiktok'
                        ? 'TikTok'
                        : t(platform.charAt(0).toUpperCase() + platform.slice(1))}
              </Text>
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
          disabled={loading}
        />
        <DMButton
          title={postingNow ? t('Posting...') : t('Post Now')}
          onPress={handlePostNow}
          disabled={postingNow}
          loading={postingNow}
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
  videoRow: { color: colors.subtext, marginBottom: 6 }
});
