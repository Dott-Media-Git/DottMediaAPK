import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as VictoryNative from 'victory-native';
import { DMCard } from '@components/DMCard';
import { colors } from '@constants/colors';
import { EngagementStats, fetchEngagementStats, resolveAnalyticsScopeId } from '@services/analytics';
import { useI18n } from '@context/I18nContext';
import { useAuth } from '@context/AuthContext';
import { peekCachedValue, writeCachedValue } from '@services/localCache';

const VictoryBar = (VictoryNative as any).VictoryBar as React.ComponentType<any>;
const VictoryChart = (VictoryNative as any).VictoryChart as React.ComponentType<any>;
const VictoryPie = (VictoryNative as any).VictoryPie as React.ComponentType<any>;
const VictoryTheme = (VictoryNative as any).VictoryTheme;

const keywords = ['price', 'cost', 'crm', 'automation', 'ai', 'demo'];
const ENGAGEMENT_ANALYTICS_CACHE_MAX_AGE_MS = 1000 * 60 * 20;

const emptyEngagementStats: EngagementStats = {
  comments: 0,
  replies: 0,
  conversions: 0,
  conversionRate: 0,
};

export const EngagementAnalyticsScreen: React.FC = () => {
  const { t } = useI18n();
  const { state } = useAuth();
  const orgId = (state.user as any)?.orgId ?? state.crmData?.orgId;
  const analyticsScopeId = useMemo(
    () => resolveAnalyticsScopeId(state.user?.uid, orgId),
    [state.user?.uid, orgId]
  );
  const cacheKey = useMemo(
    () => `dott.analytics.engagement.v1:${analyticsScopeId ?? state.user?.uid ?? 'guest'}`,
    [analyticsScopeId, state.user?.uid],
  );
  const [stats, setStats] = useState<EngagementStats | null>(
    () => peekCachedValue<EngagementStats>(cacheKey, ENGAGEMENT_ANALYTICS_CACHE_MAX_AGE_MS) ?? null,
  );
  const [hasCachedStats, setHasCachedStats] = useState(
    () => Boolean(peekCachedValue<EngagementStats>(cacheKey, ENGAGEMENT_ANALYTICS_CACHE_MAX_AGE_MS)),
  );
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      if (!state.user) {
        if (mounted) setStats(null);
        return;
      }
      const cached = peekCachedValue<EngagementStats>(cacheKey, ENGAGEMENT_ANALYTICS_CACHE_MAX_AGE_MS);
      if (cached) {
        setStats(cached);
        setHasCachedStats(true);
      } else {
        setHasCachedStats(false);
      }
      if (!cached && !hasCachedStats) {
        setLoading(true);
      }
      try {
        const payload = await fetchEngagementStats(state.user.uid, analyticsScopeId);
        if (mounted) {
          const next = payload ?? emptyEngagementStats;
          setStats(next);
          setHasCachedStats(true);
          void writeCachedValue(cacheKey, next);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };
    load();
    return () => {
      mounted = false;
    };
  }, [analyticsScopeId, cacheKey, hasCachedStats, state.user]);

  const funnel = useMemo(
    () => [
      { label: t('Detected'), value: stats?.comments ?? 0 },
      { label: t('Replied'), value: stats?.replies ?? 0 },
      { label: t('Converted'), value: stats?.conversions ?? 0 },
    ],
    [stats, t],
  );

  const keywordSeries: Array<{ label: string; value: number }> = [];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <DMCard title={t('Content Engagement')} subtitle={t('Comments, mentions, and DM reactions')}>
        <View style={styles.row}>
          <Stat label={t('Comments with intent')} value={stats?.comments} />
          <Stat label={t('Replies sent')} value={stats?.replies} />
          <Stat label={t('Conversions')} value={stats?.conversions} />
          <Stat
            label={t('Conversion rate')}
            value={stats ? `${Math.round(stats.conversionRate * 100)}%` : undefined}
          />
        </View>
      </DMCard>

      <DMCard title={t('Comment funnel')}>
        {loading ? (
          <ActivityIndicator color={colors.accent} />
        ) : (
          <VictoryChart theme={VictoryTheme.material} domainPadding={{ x: 30, y: 12 }}>
            <VictoryBar
              data={funnel}
              x="label"
              y="value"
              style={{ data: { fill: colors.accent } }}
              barWidth={32}
            />
          </VictoryChart>
        )}
      </DMCard>

      <DMCard title={t('Hot keywords listening')}>
        {keywordSeries.length === 0 ? (
          <Text style={styles.empty}>{t('No keyword data yet.')}</Text>
        ) : (
          <VictoryPie
            innerRadius={60}
            colorScale={['#0b5cff', '#1ccad8', '#f7931a', '#7c83fd', '#83ffe6', '#f25f5c']}
            style={{ labels: { fill: colors.text, fontSize: 12 } }}
            data={keywordSeries.map(point => ({
              x: point.label.toUpperCase(),
              y: point.value,
            }))}
            labels={({ datum }: { datum: any }) => `${datum.x}\n${Math.round(datum.y)}`}
          />
        )}
        <Text style={styles.note}>{t('Listening for: {{keywords}}.', { keywords: keywords.join(', ') })}</Text>
      </DMCard>
    </ScrollView>
  );
};

const Stat: React.FC<{ label: string; value?: number | string }> = ({ label, value }) => (
  <View style={styles.stat}>
    <Text style={styles.statLabel}>{label}</Text>
    <Text style={styles.statValue}>{value ?? '0'}</Text>
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, paddingBottom: 60 },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  stat: {
    width: '47%',
    backgroundColor: colors.backgroundAlt,
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statLabel: {
    color: colors.subtext,
    fontSize: 12,
    textTransform: 'uppercase',
  },
  statValue: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '700',
    marginTop: 6,
  },
  note: {
    color: colors.subtext,
    marginTop: 12,
    fontSize: 13,
  },
  empty: {
    color: colors.subtext,
    fontStyle: 'italic',
    marginBottom: 12,
  },
});
