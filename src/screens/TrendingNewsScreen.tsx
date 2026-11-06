import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Linking, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { DMCard } from '@components/DMCard';
import { DMButton } from '@components/DMButton';
import { DMTextInput } from '@components/DMTextInput';
import { colors } from '@constants/colors';
import { useAuth } from '@context/AuthContext';
import { useI18n } from '@context/I18nContext';
import {
  fetchTrendingNews,
  fetchTrendSources,
  fetchInstagramTrendConfig,
  saveInstagramTrendConfig,
  scanInstagramTrends,
  saveTrendSources,
  type TrendCandidate,
  type TrendSourceInput,
} from '@services/trends';
import { buildTrendingCacheKey, readTrendingCache, writeTrendingCache } from '@services/trendsCache';

export const TrendingNewsScreen: React.FC = () => {
  const { state } = useAuth();
  const { t } = useI18n();
  const [candidates, setCandidates] = useState<TrendCandidate[]>([]);
  const [scope, setScope] = useState<'global' | 'football'>('global');
  const [sources, setSources] = useState<TrendSourceInput[]>([]);
  const [connectedSources, setConnectedSources] = useState<string[]>([]);
  const [sourceUrl, setSourceUrl] = useState('');
  const [sourceLabel, setSourceLabel] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [savingSources, setSavingSources] = useState(false);
  const [instagramHashtags, setInstagramHashtags] = useState('');
  const [instagramCandidates, setInstagramCandidates] = useState<TrendCandidate[]>([]);
  const [instagramAccount, setInstagramAccount] = useState<{ id: string; username?: string } | undefined>();
  const [instagramLoading, setInstagramLoading] = useState(false);
  const [instagramSaving, setInstagramSaving] = useState(false);
  const [cacheReady, setCacheReady] = useState(false);
  const [hasCachedSnapshot, setHasCachedSnapshot] = useState(false);
  const cacheKey = useMemo(
    () => buildTrendingCacheKey(state.user?.uid),
    [state.user?.uid],
  );

  const loadAll = useCallback(async (options?: { silent?: boolean; force?: boolean }) => {
    if (!state.user) return;
    if (!options?.silent && (!hasCachedSnapshot || options?.force)) {
      setRefreshing(true);
    }
    try {
      const [trendData, sourceData, instagramConfig] = await Promise.all([
        fetchTrendingNews(state.user.uid),
        fetchTrendSources(state.user.uid),
        fetchInstagramTrendConfig(state.user.uid).catch(() => ({ enabled: false, hashtags: [] })),
      ]);
      const resolvedSources = sourceData.sources ?? [];
      const resolvedConnectedSources = Array.from(
        new Set(
          [
            ...(trendData.sources ?? []).map(source => source.label ?? source.url),
            ...resolvedSources.map(source => source.label ?? source.url),
            ...(trendData.candidates ?? []).flatMap(candidate => candidate.sources ?? []),
          ]
            .map(value => value?.trim())
            .filter(Boolean) as string[],
        ),
      );
      setCandidates(trendData.candidates ?? []);
      setScope(trendData.scope ?? 'global');
      setSources(resolvedSources);
      setConnectedSources(resolvedConnectedSources);
      setInstagramHashtags((instagramConfig.hashtags ?? []).map(value => `#${value}`).join(', '));
      setHasCachedSnapshot(true);
    } catch (error: any) {
      if (!hasCachedSnapshot) {
        Alert.alert(t('Error'), error.message ?? t('Failed to load trends'));
      } else {
        console.warn('Failed to refresh trends', error);
      }
    } finally {
      if (!options?.silent) {
        setRefreshing(false);
      }
    }
  }, [hasCachedSnapshot, state.user, t]);

  useFocusEffect(
    useCallback(() => {
      void loadAll({ silent: hasCachedSnapshot, force: !hasCachedSnapshot });
    }, [hasCachedSnapshot, loadAll])
  );

  React.useEffect(() => {
    let active = true;
    if (!state.user?.uid) {
      setCacheReady(true);
      setHasCachedSnapshot(false);
      return () => {
        active = false;
      };
    }
    setCacheReady(false);
    void readTrendingCache(cacheKey)
      .then(cached => {
        if (!active) return;
        if (cached) {
          setCandidates(cached.candidates ?? []);
          setScope(cached.scope ?? 'global');
          setSources(cached.sources ?? []);
          setConnectedSources(cached.connectedSources ?? []);
          setHasCachedSnapshot(true);
        } else {
          setHasCachedSnapshot(false);
          setConnectedSources([]);
        }
      })
      .finally(() => {
        if (active) {
          setCacheReady(true);
        }
      });
    return () => {
      active = false;
    };
  }, [cacheKey, state.user?.uid]);

  React.useEffect(() => {
    if (!state.user?.uid || !cacheReady) return;
    void writeTrendingCache(cacheKey, { scope, candidates, sources, connectedSources });
  }, [cacheKey, cacheReady, candidates, connectedSources, scope, sources, state.user?.uid]);

  const addSource = () => {
    const url = sourceUrl.trim();
    if (!url) return;
    const label = sourceLabel.trim();
    const next = [...sources, { url, ...(label ? { label } : {}) }];
    setSources(next);
    setSourceUrl('');
    setSourceLabel('');
  };

  const removeSource = (index: number) => {
    setSources(prev => prev.filter((_, idx) => idx !== index));
  };

  const handleSaveSources = async () => {
    if (!state.user) return;
    setSavingSources(true);
    try {
      const data = await saveTrendSources(state.user.uid, sources);
      setSources(data.sources ?? []);
      Alert.alert(t('Saved'), t('Sources updated.'));
    } catch (error: any) {
      Alert.alert(t('Error'), error.message ?? t('Failed to save sources'));
    } finally {
      setSavingSources(false);
    }
  };

  const parseInstagramHashtags = () =>
    instagramHashtags
      .split(/[\s,]+/)
      .map(value => value.replace(/^#+/, '').trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 5);

  const handleInstagramTrendSearch = async () => {
    if (!state.user) return;
    const hashtags = parseInstagramHashtags();
    if (!hashtags.length) {
      Alert.alert(t('Add a hashtag'), t('Enter at least one hashtag, such as #smallbusiness.'));
      return;
    }
    setInstagramLoading(true);
    setInstagramSaving(true);
    try {
      await saveInstagramTrendConfig(state.user.uid, { enabled: true, hashtags });
      const result = await scanInstagramTrends(state.user.uid, hashtags);
      setInstagramCandidates(result.candidates ?? []);
      setInstagramAccount(result.account);
      if (!result.candidates?.length) {
        Alert.alert(t('No public posts found'), t('Try another public hashtag.'));
      }
    } catch (error: any) {
      Alert.alert(t('Instagram trends unavailable'), error.message ?? t('Reconnect Facebook and try again.'));
    } finally {
      setInstagramLoading(false);
      setInstagramSaving(false);
    }
  };

  const scopeLabel = useMemo(() => {
    if (scope === 'football') {
      return t('Football focus enabled for this account.');
    }
    return t('Global news focus enabled for this account.');
  }, [scope, t]);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadAll({ force: true })} />}
    >
      <DMCard title={t('Your trending News')} subtitle={scopeLabel}>
        {connectedSources.length ? (
          <View style={styles.connectedSourcesWrap}>
            <Text style={styles.connectedSourcesLabel}>{t('Connected sources')}</Text>
            <View style={styles.connectedSourcesRow}>
              {connectedSources.map(source => (
                <View key={source} style={styles.connectedSourceChip}>
                  <Text style={styles.connectedSourceChipText} numberOfLines={1}>
                    {source}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}
        {candidates.length === 0 ? (
          <Text style={styles.emptyText}>{t('No trending topics yet. Pull to refresh.')}</Text>
        ) : (
          candidates.map((candidate, index) => (
            <View key={`${candidate.topic}-${index}`} style={styles.trendItem}>
              <Text style={styles.trendTitle}>{candidate.topic}</Text>
              {candidate.sampleTitles?.length ? (
                <Text style={styles.trendSamples} numberOfLines={2}>
                  {candidate.sampleTitles.join(' ? ')}
                </Text>
              ) : null}
              {candidate.sources?.length ? (
                <Text style={styles.trendSources} numberOfLines={1}>
                  {candidate.sources.join(', ')}
                </Text>
              ) : null}
            </View>
          ))
        )}
      </DMCard>

      <DMCard
        title={t('Instagram public trends')}
        subtitle={t('Discover public hashtag conversations to guide your next campaign.')}
      >
        <Text style={styles.helperText}>
          {t('Connect Facebook with an Instagram Professional Account, then search up to five public hashtags.')}
        </Text>
        <DMTextInput
          label={t('Hashtags')}
          value={instagramHashtags}
          onChangeText={setInstagramHashtags}
          placeholder={t('#smallbusiness, #marketing')}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <DMButton
          title={instagramSaving ? t('Searching...') : t('Search Instagram trends')}
          onPress={handleInstagramTrendSearch}
          loading={instagramLoading}
          style={styles.button}
        />
        {instagramAccount?.username ? (
          <Text style={styles.connectedInstagramText}>
            {t('Using Instagram Professional Account')}: @{instagramAccount.username}
          </Text>
        ) : null}
        {instagramCandidates.map((candidate, index) => (
          <View key={`${candidate.topic}-${index}`} style={styles.instagramTrendItem}>
            <Text style={styles.trendTitle}>{candidate.topic}</Text>
            {candidate.items?.slice(0, 3).map((item, itemIndex) => (
              <TouchableOpacity
                key={`${item.link ?? item.title}-${itemIndex}`}
                disabled={!item.link}
                onPress={() => item.link && Linking.openURL(item.link)}
                style={styles.instagramPostRow}
              >
                <Text style={styles.instagramPostTitle} numberOfLines={2}>
                  {item.title}
                </Text>
                {item.summary ? <Text style={styles.instagramPostSummary}>{item.summary}</Text> : null}
              </TouchableOpacity>
            ))}
          </View>
        ))}
      </DMCard>

      <DMCard
        title={t('News sources')}
        subtitle={t('Add trusted feeds for the AI to track alongside global sources.')}
      >
        {sources.length === 0 ? (
          <Text style={styles.emptyText}>{t('No custom sources added yet.')}</Text>
        ) : (
          sources.map((source, index) => (
            <View key={`${source.url}-${index}`} style={styles.sourceRow}>
              <View style={styles.sourceTextWrap}>
                <Text style={styles.sourceLabel} numberOfLines={1}>
                  {source.label ?? source.url}
                </Text>
                <Text style={styles.sourceUrl} numberOfLines={1}>
                  {source.url}
                </Text>
              </View>
              <TouchableOpacity onPress={() => removeSource(index)} style={styles.removeButton}>
                <Text style={styles.removeText}>{t('Remove')}</Text>
              </TouchableOpacity>
            </View>
          ))
        )}

        <View style={styles.formSpacer} />
        <DMTextInput
          label={t('Source label (optional)')}
          value={sourceLabel}
          onChangeText={setSourceLabel}
          placeholder={t('e.g. Reuters World')}
          autoCapitalize="words"
        />
        <DMTextInput
          label={t('Source URL')}
          value={sourceUrl}
          onChangeText={setSourceUrl}
          placeholder="https://example.com/rss"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <DMButton title={t('Add Source')} onPress={addSource} style={styles.button} />
        <DMButton
          title={savingSources ? t('Saving...') : t('Save Sources')}
          onPress={handleSaveSources}
          loading={savingSources}
          style={styles.button}
        />
      </DMCard>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  emptyText: {
    color: colors.subtext,
    fontSize: 13,
  },
  helperText: {
    color: colors.subtext,
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 10,
  },
  connectedInstagramText: {
    color: colors.success,
    fontSize: 12,
    marginTop: 10,
  },
  instagramTrendItem: {
    paddingTop: 14,
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  instagramPostRow: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  instagramPostTitle: {
    color: colors.text,
    fontSize: 12,
    lineHeight: 17,
  },
  instagramPostSummary: {
    color: colors.accentMuted,
    fontSize: 11,
    marginTop: 4,
  },
  connectedSourcesWrap: {
    marginBottom: 12,
  },
  connectedSourcesLabel: {
    color: colors.subtext,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  connectedSourcesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  connectedSourceChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.backgroundAlt,
    borderWidth: 1,
    borderColor: colors.border,
    maxWidth: '100%',
  },
  connectedSourceChipText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '600',
  },
  trendItem: {
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  trendTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  trendSamples: {
    color: colors.subtext,
    marginTop: 6,
    fontSize: 12,
  },
  trendSources: {
    color: colors.accentMuted,
    marginTop: 6,
    fontSize: 11,
  },
  sourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  sourceTextWrap: {
    flex: 1,
    paddingRight: 12,
  },
  sourceLabel: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  sourceUrl: {
    color: colors.subtext,
    fontSize: 11,
    marginTop: 4,
  },
  removeButton: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: colors.cardOverlay,
    borderWidth: 1,
    borderColor: colors.border,
  },
  removeText: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: '600',
  },
  formSpacer: {
    height: 8,
  },
  button: {
    marginTop: 10,
  },
});
