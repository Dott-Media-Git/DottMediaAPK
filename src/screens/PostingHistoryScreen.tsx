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

const normalizePostedPlatform = (platform?: string) => {
  const raw = (platform ?? '').toLowerCase().trim();
  if (raw === 'instagram_story' || raw === 'instagram_reels') return 'instagram';
  if (raw === 'facebook_story') return 'facebook';
  if (raw === 'twitter') return 'x';
  return raw;
};

const isVideoPost = (post: SocialPost) => {
  if (post.videoUrl) return true;
  const platform = normalizePostedPlatform(post.platform);
  const rawPlatform = (post.platform ?? '').toLowerCase().trim();
  if (platform === 'youtube' || platform === 'tiktok' || rawPlatform === 'instagram_reels') return true;
  if (platform === 'x') {
    const caption = post.caption ?? '';
    return /(^|\n)\s*video[:\s]|video highlight|highlight clip|\bclip\b/i.test(caption);
  }
  return false;
};

const formatHoursMinutes = (value: Date | number) => {
  const date = value instanceof Date ? value : new Date(value);
  const hours = `${date.getHours()}`.padStart(2, '0');
  const minutes = `${date.getMinutes()}`.padStart(2, '0');
  return `${hours}:${minutes}`;
};

const buildCumulativeSeries = (posts: SocialPost[], start: Date, end: Date, zeroLine = false) => {
  if (posts.length === 0) {
    return zeroLine ? [{ x: start, y: 0 }, { x: end, y: 0 }] : [];
  }
  const sorted = [...posts].sort((a, b) => (getPostSeconds(a) ?? 0) - (getPostSeconds(b) ?? 0));
  const points: Array<{ x: Date; y: number }> = [{ x: start, y: 0 }];
  let cumulative = 0;
  sorted.forEach(post => {
    const seconds = getPostSeconds(post);
    if (!seconds) return;
    cumulative += 1;
    points.push({ x: new Date(seconds * 1000), y: cumulative });
  });
  return points;
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
  const now = new Date();
  const hasServerToday = Boolean(history.todaySummary);

  const postedToday = useMemo(
    () => {
      if (hasServerToday) {
        return (history.todayPosts ?? []).filter(post => post.status === 'posted');
      }
      return history.posts.filter(post => {
        if (post.status !== 'posted') return false;
        const seconds = getPostSeconds(post);
        return typeof seconds === 'number' && seconds >= todaySeconds;
      });
    },
    [hasServerToday, history.posts, history.todayPosts, todaySeconds],
  );

  const videoPostsToday = useMemo(() => postedToday.filter(isVideoPost), [postedToday]);
  const postedTodayCount = useMemo(
    () => (typeof history.todaySummary?.totalPosted === 'number' ? history.todaySummary.totalPosted : postedToday.length),
    [history.todaySummary?.totalPosted, postedToday.length],
  );
  const videoPostsTodayCount = useMemo(
    () => (typeof history.todaySummary?.videoPosts === 'number' ? history.todaySummary.videoPosts : videoPostsToday.length),
    [history.todaySummary?.videoPosts, videoPostsToday.length],
  );

  const pendingPosts = useMemo(
    () => history.posts.filter(post => post.status === 'pending'),
    [history.posts],
  );

  const platformSummary = useMemo(() => {
    const counts: Record<string, number> = {
      facebook: 0,
      instagram: 0,
      linkedin: 0,
      threads: 0,
      youtube: 0,
      tiktok: 0,
      x: 0,
    };
    const sourceSummary = history.todaySummary?.perPlatform;
    if (sourceSummary && Object.keys(sourceSummary).length > 0) {
      Object.entries(sourceSummary).forEach(([platformKey, count]) => {
        const normalized = normalizePostedPlatform(platformKey);
        if (normalized && Object.prototype.hasOwnProperty.call(counts, normalized)) {
          counts[normalized] += Number(count ?? 0);
        }
      });
      return counts;
    }
    postedToday.forEach(post => {
      const normalized = normalizePostedPlatform(post.platform);
      if (normalized && Object.prototype.hasOwnProperty.call(counts, normalized)) {
        counts[normalized] += 1;
      }
    });
    return counts;
  }, [history.todaySummary?.perPlatform, postedToday]);

  const frequencySeries = useMemo(
    () => buildCumulativeSeries(postedToday, new Date(today), now),
    [postedToday, today, now],
  );

  const platformCards = useMemo(
    () => [
      { key: 'facebook', label: t('Facebook'), color: colors.accentMuted, count: platformSummary.facebook ?? 0 },
      { key: 'instagram', label: t('Instagram'), color: colors.accentSecondary, count: platformSummary.instagram ?? 0 },
      { key: 'linkedin', label: t('LinkedIn'), color: colors.accent, count: platformSummary.linkedin ?? 0 },
      { key: 'threads', label: t('Threads'), color: '#9B5DE5', count: platformSummary.threads ?? 0 },
      { key: 'youtube', label: t('YouTube'), color: '#EF4444', count: platformSummary.youtube ?? 0 },
      { key: 'tiktok', label: t('TikTok'), color: '#14B8A6', count: platformSummary.tiktok ?? 0 },
      { key: 'x', label: t('X'), color: '#F59E0B', count: platformSummary.x ?? 0 },
    ],
    [platformSummary, t],
  );

  const platformFrequencySeries = useMemo(() => {
    const grouped = postedToday.reduce<Record<string, SocialPost[]>>((acc, post) => {
      const key = normalizePostedPlatform(post.platform);
      if (!key) return acc;
      if (!acc[key]) acc[key] = [];
      acc[key].push(post);
      return acc;
    }, {});
    return platformCards.map(card => ({
      ...card,
      data: buildCumulativeSeries(grouped[card.key] ?? [], new Date(today), now, true),
    }));
  }, [now, platformCards, postedToday, today]);

  const latestPostLabel = useMemo(() => {
    if (!postedToday.length) return t('No live posts yet today');
    const latest = Math.max(...postedToday.map(post => getPostSeconds(post) ?? 0));
    if (!latest) return t('No live posts yet today');
    return t('Last post at {{time}}', { time: formatHoursMinutes(new Date(latest * 1000)) });
  }, [postedToday, t]);

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
            <Text style={styles.totalBadgeText}>{postedTodayCount}</Text>
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
            {t('Videos posted today: {{count}}', { count: videoPostsTodayCount })}
          </Text>
        </View>
      </View>

      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>{t('Posting Frequency')}</Text>
          <Text style={styles.cardSubtitle}>{t('Live today')}</Text>
        </View>
        <Text style={styles.latestPostText}>{latestPostLabel}</Text>
        <View style={styles.legendRow}>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: colors.accent }]} />
            <Text style={styles.legendText}>{t('All posts')} ({postedTodayCount})</Text>
          </View>
          {platformCards.map(item => (
            <View key={`legend-${item.key}`} style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: item.color }]} />
              <Text style={styles.legendText}>
                {item.label} ({item.count})
              </Text>
            </View>
          ))}
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
                tickFormat={formatHoursMinutes}
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
              {platformFrequencySeries
                .filter(series => series.count > 0)
                .map(series => (
                  <VictoryLine
                    key={`line-${series.key}`}
                    data={series.data}
                    style={{ data: { stroke: series.color, strokeWidth: 2, opacity: 0.9 } }}
                  />
                ))}
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
  latestPostText: { color: colors.subtext, fontSize: 12, marginBottom: 8 },
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -6,
    marginBottom: 10,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 6,
    marginBottom: 8,
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
