import React, { useCallback, useMemo, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
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
  saveTrendSources,
  type TrendCandidate,
  type TrendSourceInput,
} from '@services/trends';

export const TrendingNewsScreen: React.FC = () => {
  const { state } = useAuth();
  const { t } = useI18n();
  const [candidates, setCandidates] = useState<TrendCandidate[]>([]);
  const [scope, setScope] = useState<'global' | 'football'>('global');
  const [sources, setSources] = useState<TrendSourceInput[]>([]);
  const [sourceUrl, setSourceUrl] = useState('');
  const [sourceLabel, setSourceLabel] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [savingSources, setSavingSources] = useState(false);

  const loadTrends = useCallback(async () => {
    if (!state.user) return;
    setRefreshing(true);
    try {
      const data = await fetchTrendingNews(state.user.uid);
      setCandidates(data.candidates ?? []);
      setScope(data.scope ?? 'global');
    } catch (error: any) {
      Alert.alert(t('Error'), error.message ?? t('Failed to load trends'));
    } finally {
      setRefreshing(false);
    }
  }, [state.user, t]);

  const loadSources = useCallback(async () => {
    if (!state.user) return;
    try {
      const data = await fetchTrendSources(state.user.uid);
      setSources(data.sources ?? []);
    } catch (error: any) {
      Alert.alert(t('Error'), error.message ?? t('Failed to load sources'));
    }
  }, [state.user, t]);

  useFocusEffect(
    useCallback(() => {
      void loadTrends();
      void loadSources();
    }, [loadTrends, loadSources])
  );

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
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={loadTrends} />}
    >
      <DMCard title={t('Your trending News')} subtitle={scopeLabel}>
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