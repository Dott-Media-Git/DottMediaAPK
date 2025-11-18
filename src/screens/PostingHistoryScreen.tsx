import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View, RefreshControl } from 'react-native';
import { colors } from '@constants/colors';
import { fetchSocialHistory } from '@services/social';

type SocialPost = {
  id: string;
  platform: string;
  status: string;
  scheduledFor?: { seconds: number };
  postedAt?: { seconds: number };
  errorMessage?: string;
};

export const PostingHistoryScreen: React.FC = () => {
  const [history, setHistory] = useState<{ posts: SocialPost[]; summary: any; daily: any[] }>({
    posts: [],
    summary: { perPlatform: {}, byStatus: {} },
    daily: [],
  });
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    setRefreshing(true);
    try {
      const payload = await fetchSocialHistory();
      setHistory(payload);
    } catch (error) {
      console.warn('Failed to load history', error);
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const grouped = {
    pending: history.posts.filter(post => post.status === 'pending'),
    posted: history.posts.filter(post => post.status === 'posted'),
    skipped: history.posts.filter(post => post.status === 'skipped_limit'),
    failed: history.posts.filter(post => post.status === 'failed'),
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} />}
    >
      <View style={styles.summaryCard}>
        <Text style={styles.summaryTitle}>Posts by Status</Text>
        {Object.entries(history.summary.byStatus ?? {}).map(([status, value]) => (
          <Text key={status} style={styles.summaryItem}>
            {status}: {value as number}
          </Text>
        ))}
      </View>

      {(['pending', 'posted', 'skipped', 'failed'] as const).map(key => (
        <View key={key} style={styles.card}>
          <Text style={styles.cardTitle}>
            {key === 'pending'
              ? 'Upcoming Posts'
              : key === 'posted'
              ? 'Posted Today'
              : key === 'skipped'
              ? 'Skipped (Limit)'
              : 'Failed Posts'}
          </Text>
          {(grouped[key] ?? []).map(post => (
            <View key={post.id} style={styles.postRow}>
              <Text style={styles.postPlatform}>{post.platform.toUpperCase()}</Text>
              <Text style={styles.postCaption}>Status: {post.status}</Text>
              {post.errorMessage ? <Text style={styles.error}>{post.errorMessage}</Text> : null}
            </View>
          ))}
          {grouped[key]?.length === 0 && <Text style={styles.empty}>No items</Text>}
        </View>
      ))}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, paddingBottom: 80 },
  summaryCard: {
    backgroundColor: colors.backgroundAlt,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 16,
  },
  summaryTitle: { color: colors.text, fontWeight: '700', marginBottom: 8 },
  summaryItem: { color: colors.subtext },
  card: {
    backgroundColor: colors.backgroundAlt,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 16,
  },
  cardTitle: { color: colors.text, fontWeight: '700', marginBottom: 8 },
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
