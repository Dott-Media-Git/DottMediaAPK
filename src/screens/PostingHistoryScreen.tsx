import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { VictoryAxis, VictoryChart, VictoryLine, VictoryScatter, VictoryTheme } from 'victory-native';
import { colors } from '@constants/colors';
import { useAuth } from '@context/AuthContext';
import { fetchSocialHistory, type SocialHistory, type SocialPost } from '@services/social';
import { useI18n } from '@context/I18nContext';

const getTimestampSeconds = (timestamp?: { seconds?: number; _seconds?: number }) => {
  if (!timestamp) return undefined;
  const seconds = timestamp.seconds ?? timestamp._seconds;
  return typeof seconds === 'number' ? seconds : undefined;
};

const getPostSeconds = (post: SocialPost) =>
  getTimestampSeconds((post.postedAt ?? post.createdAt ?? post.scheduledFor) as { seconds?: number; _seconds?: number });

const isVideoPost = (post: SocialPost) => {
  if (post.videoUrl) return true;
  const platform = post.platform?.toLowerCase();
  return platform === 'youtube' || platform === 'tiktok' || platform === 'instagram_reels';
};

const isImagePost = (post: SocialPost) => {
  if (isVideoPost(post)) return false;
  const imageUrls = (post as SocialPost & { imageUrls?: string[] }).imageUrls;
  if (Array.isArray(imageUrls)) return imageUrls.length > 0;
  return true;
};

export const PostingHistoryScreen: React.FC = () => {
  const { state } = useAuth();
  const { t } = useI18n();
  const [history, setHistory] = useState<SocialHistory>({
    posts: [],
    summary: { perPlatform: {}, byStatus: {} },
    daily: [],
  });
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!state.user) return;
      if (!options?.silent) {
        setRefreshing(true);
      }
      try {
        const payload = await fetchSocialHistory({ noCache: true });
        setHistory(payload);
      } catch (error) {
        console.warn('Failed to load history', error);
      } finally {
        if (!options?.silent) {
          setRefreshing(false);
        }
      }
    },
    [state.user]
  );

  useEffect(() => {
    if (!state.user) return;
    const interval = setInterval(() => {
      load({ silent: true }).catch(() => undefined);
    }, 30000);
    return () => clearInterval(interval);
  }, [load, state.user]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todaySeconds = Math.floor(today.getTime() / 1000);

  const postedToday = useMemo(
    () =>
      history.posts.filter(post => {
        if (post.status !== 'posted') return false;
        const seconds = getPostSeconds(post);
        return typeof seconds === 'number' && seconds >= todaySeconds;
      }),
    [history.posts, todaySeconds],
  );

  const videoPostsToday = useMemo(() => postedToday.filter(isVideoPost), [postedToday]);
  const imagePostsToday = useMemo(() => postedToday.filter(isImagePost), [postedToday]);

  const pendingPosts = useMemo(
    () => history.posts.filter(post => post.status === 'pending'),
    [history.posts],
  );

  const platformSummary = useMemo(() => {
    const counts: Record<string, number> = { facebook: 0, instagram: 0, linkedin: 0 };
    postedToday.forEach(post => {
      const platform = post.platform?.toLowerCase();
      if (platform && Object.prototype.hasOwnProperty.call(counts, platform)) {
        counts[platform] += 1;
      }
    });
    return counts;
  }, [postedToday]);

  const frequencySeries = useMemo(() => {
    if (postedToday.length === 0) return [];
    const sorted = [...postedToday].sort((a, b) => (getPostSeconds(a) ?? 0) - (getPostSeconds(b) ?? 0));
    const points: Array<{ x: Date; y: number }> = [{ x: new Date(today), y: 0 }];
    let cumulative = 0;
    sorted.forEach(post => {
      const seconds = getPostSeconds(post);
      if (!seconds) return;
      cumulative += 1;
      points.push({ x: new Date(seconds * 1000), y: cumulative });
    });
    return points;
  }, [postedToday, today]);

  const videoFrequencySeries = useMemo(() => {
    if (videoPostsToday.length === 0) return [];
    const sorted = [...videoPostsToday].sort((a, b) => (getPostSeconds(a) ?? 0) - (getPostSeconds(b) ?? 0));
    const points: Array<{ x: Date; y: number }> = [{ x: new Date(today), y: 0 }];
    let cumulative = 0;
    sorted.forEach(post => {
      const seconds = getPostSeconds(post);
      if (!seconds) return;
      cumulative += 1;
      points.push({ x: new Date(seconds * 1000), y: cumulative });
    });
    return points;
  }, [videoPostsToday, today]);

  const imageFrequencySeries = useMemo(() => {
    if (imagePostsToday.length === 0) return [];
    const sorted = [...imagePostsToday].sort((a, b) => (getPostSeconds(a) ?? 0) - (getPostSeconds(b) ?? 0));
    const points: Array<{ x: Date; y: number }> = [{ x: new Date(today), y: 0 }];
    let cumulative = 0;
    sorted.forEach(post => {
      const seconds = getPostSeconds(post);
      if (!seconds) return;
      cumulative += 1;
      points.push({ x: new Date(seconds * 1000), y: cumulative });
    });
    return points;
  }, [imagePostsToday, today]);

  const platformCards = [
    { key: 'facebook', label: t('Facebook'), color: colors.accentMuted, count: platformSummary.facebook ?? 0 },
    { key: 'instagram', label: t('Instagram'), color: colors.accentSecondary, count: platformSummary.instagram ?? 0 },
    { key: 'linkedin', label: t('LinkedIn'), color: colors.accent, count: platformSummary.linkedin ?? 0 },
  ];

  const formatTime = (value: Date | number) => {
    const date = value instanceof Date ? value : new Date(value);
    const hours = `${date.getHours()}`.padStart(2, '0');
    const minutes = `${date.getMinutes()}`.padStart(2, '0');
    return `${hours}:${minutes}`;
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load()} />}
    >
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>{t('Posted Today')}</Text>
          <View style={styles.totalBadge}>
            <Text style={styles.totalBadgeText}>{postedToday.length}</Text>
          </View>
        </View>
        <View style={styles.platformGrid}>
          {platformCards.map(item => (
            <View key={item.key} style={styles.platformCard}>
              <View style={styles.platformLabelRow}>
                <View style={[styles.platformDot, { backgroundColor: item.color }]} />
                <Text style={styles.platformLabel}>{item.label}</Text>
              </View>
              <Text style={styles.platformCount}>{item.count}</Text>
            </View>
          ))}
        </View>
        <View style={styles.videoSummaryRow}>
          <View style={[styles.platformDot, { backgroundColor: colors.success }]} />
          <Text style={styles.videoSummaryText}>
            {t('Videos posted today: {{count}}', { count: videoPostsToday.length })}
          </Text>
        </View>
      </View>

      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>{t('Posting Frequency')}</Text>
          <Text style={styles.cardSubtitle}>{t('Live today')}</Text>
        </View>
        <View style={styles.legendRow}>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: colors.accent }]} />
            <Text style={styles.legendText}>{t('All posts')}</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: colors.success }]} />
            <Text style={styles.legendText}>{t('Videos')}</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: colors.warning }]} />
            <Text style={styles.legendText}>{t('Images')}</Text>
          </View>
        </View>
        {frequencySeries.length > 0 ? (
          <View style={styles.chartWrapper}>
            <VictoryChart
              theme={VictoryTheme.material}
              scale={{ x: 'time' }}
              domainPadding={{ x: 12, y: 10 }}
            >
              <VictoryAxis
                tickCount={4}
                tickFormat={formatTime}
                style={{
                  axis: { stroke: colors.border },
                  tickLabels: { fill: colors.subtext, fontSize: 10 },
                  grid: { stroke: 'transparent' }
                }}
              />
              <VictoryAxis
                dependentAxis
                tickCount={4}
                label={t('Posts')}
                style={{
                  axis: { stroke: colors.border },
                  axisLabel: { padding: 30, fill: colors.subtext, fontSize: 10 },
                  tickLabels: { fill: colors.subtext, fontSize: 10 },
                  grid: { stroke: colors.border, opacity: 0.3 }
                }}
              />
              <VictoryLine
                data={frequencySeries}
                style={{ data: { stroke: colors.accent, strokeWidth: 3 } }}
              />
              <VictoryScatter
                data={frequencySeries}
                size={3}
                style={{ data: { fill: colors.accentSecondary } }}
              />
              {videoFrequencySeries.length > 0 ? (
                <>
                  <VictoryLine
                    data={videoFrequencySeries}
                    style={{ data: { stroke: colors.success, strokeWidth: 3 } }}
                  />
                  <VictoryScatter
                    data={videoFrequencySeries}
                    size={3}
                    style={{ data: { fill: colors.success } }}
                  />
                </>
              ) : null}
              {imageFrequencySeries.length > 0 ? (
                <>
                  <VictoryLine
                    data={imageFrequencySeries}
                    style={{ data: { stroke: colors.warning, strokeWidth: 3 } }}
                  />
                  <VictoryScatter
                    data={imageFrequencySeries}
                    size={3}
                    style={{ data: { fill: colors.warning } }}
                  />
                </>
              ) : null}
            </VictoryChart>
          </View>
        ) : (
          <Text style={styles.empty}>{t('No posts yet today')}</Text>
        )}
      </View>

      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>{t('Upcoming Posts')}</Text>
        </View>
        {pendingPosts.map(post => (
          <View key={post.id} style={styles.postRow}>
            <Text style={styles.postPlatform}>{post.platform.toUpperCase()}</Text>
            <Text style={styles.postCaption}>{t('Status: {{status}}', { status: post.status })}</Text>
          </View>
        ))}
        {pendingPosts.length === 0 && <Text style={styles.empty}>{t('No items')}</Text>}
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
    marginBottom: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  cardTitle: { color: colors.text, fontWeight: '700' },
  cardSubtitle: { color: colors.subtext, fontSize: 12 },
  totalBadge: {
    backgroundColor: colors.cardOverlay,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  totalBadgeText: { color: colors.text, fontWeight: '700', fontSize: 12 },
  platformGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginRight: -12,
  },
  platformCard: {
    flexGrow: 1,
    flexBasis: '30%',
    minWidth: 120,
    backgroundColor: colors.cardOverlay,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: colors.border,
    marginRight: 12,
    marginBottom: 12,
  },
  platformLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  platformDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  platformLabel: { color: colors.subtext, fontSize: 12, fontWeight: '600' },
  platformCount: { color: colors.text, fontSize: 22, fontWeight: '700', marginTop: 10 },
  videoSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  videoSummaryText: { color: colors.subtext, fontSize: 12, fontWeight: '600' },
  legendRow: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 10,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: { color: colors.subtext, fontSize: 12, fontWeight: '600' },
  chartWrapper: {
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: colors.cardOverlay,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 8,
  },
  postRow: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: 8,
  },
  postPlatform: { color: colors.accent, fontWeight: '700' },
  postCaption: { color: colors.text },
  error: { color: colors.danger, fontSize: 12 },
  empty: { color: colors.subtext, fontStyle: 'italic' },
});
