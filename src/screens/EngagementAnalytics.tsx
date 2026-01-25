import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { VictoryBar, VictoryChart, VictoryPie, VictoryTheme } from 'victory-native';
import { DMCard } from '@components/DMCard';
import { colors } from '@constants/colors';
import { EngagementStats, fetchEngagementStats, resolveAnalyticsScopeId } from '@services/analytics';
import { useI18n } from '@context/I18nContext';
import { useAuth } from '@context/AuthContext';

const keywords = ['price', 'cost', 'crm', 'automation', 'ai', 'demo'];

export const EngagementAnalyticsScreen: React.FC = () => {
  const { t } = useI18n();
  const { state } = useAuth();
  const orgId = (state.user as any)?.orgId ?? state.crmData?.orgId;
  const analyticsScopeId = useMemo(
    () => resolveAnalyticsScopeId(state.user?.uid, orgId),
    [state.user?.uid, orgId]
  );
  const [stats, setStats] = useState<EngagementStats | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      if (!state.user) {
        if (mounted) setStats(null);
        return;
      }
      setLoading(true);
      try {
        const payload = await fetchEngagementStats(state.user.uid, analyticsScopeId);
        if (mounted) setStats(payload);
      } finally {
        if (mounted) setLoading(false);
      }
    };
    load();
    return () => {
      mounted = false;
    };
  }, [analyticsScopeId, state.user]);

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
            labels={({ datum }) => `${datum.x}\n${Math.round(datum.y)}`}
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
