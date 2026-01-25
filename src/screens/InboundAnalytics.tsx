import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { VictoryBar, VictoryChart, VictoryTheme } from 'victory-native';
import { colors } from '@constants/colors';
import { DMCard } from '@components/DMCard';
import { fetchInboundStats, InboundStats, resolveAnalyticsScopeId } from '@services/analytics';
import { useI18n } from '@context/I18nContext';
import { useAuth } from '@context/AuthContext';

export const InboundAnalyticsScreen: React.FC = () => {
  const { t } = useI18n();
  const { state } = useAuth();
  const orgId = (state.user as any)?.orgId ?? state.crmData?.orgId;
  const analyticsScopeId = useMemo(
    () => resolveAnalyticsScopeId(state.user?.uid, orgId),
    [state.user?.uid, orgId]
  );
  const [stats, setStats] = useState<InboundStats | null>(null);
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
        const payload = await fetchInboundStats(state.user.uid, analyticsScopeId);
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

  const history = useMemo(
    () =>
      stats
        ? [
            {
              label: t('Total'),
              value: stats.messages
            }
          ]
        : [],
    [stats, t]
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <DMCard title={t('Inbound Funnel')} subtitle={t('Passive chats flowing into Dotti')}>
        <View style={styles.grid}>
          <Stat label={t('Messages')} value={stats?.messages} />
          <Stat label={t('Leads')} value={stats?.leads} />
          <Stat label={t('Avg Sentiment')} value={stats ? stats.avgSentiment.toFixed(2) : undefined} />
          <Stat label={t('Conversion Rate')} value={stats ? `${Math.round(stats.conversionRate * 100)}%` : undefined} />
        </View>
      </DMCard>

      <DMCard title={t('Message volume')} subtitle={t('Total inbound messages')}>
        {loading ? (
          <ActivityIndicator color={colors.accent} />
        ) : history.length === 0 ? (
          <Text style={styles.empty}>{t('No inbound activity yet.')}</Text>
        ) : (
          <VictoryChart theme={VictoryTheme.material} domainPadding={{ x: 12, y: 10 }}>
            <VictoryBar data={history} x="label" y="value" style={{ data: { fill: colors.accent } }} />
          </VictoryChart>
        )}
      </DMCard>

      <DMCard title={t('Insights')}>
        <Text style={styles.insight}>
          {t('Dotti captures inbound interest automatically and qualifies warm replies using GPT-powered flows.')}
        </Text>
        <Text style={styles.insight}>
          {t('Keep an eye on sentiment - anything below 0.2 may signal friction in your first-touch prompts.')}
        </Text>
      </DMCard>
    </ScrollView>
  );
};

const Stat: React.FC<{ label: string; value?: string | number }> = ({ label, value }) => (
  <View style={styles.statCard}>
    <Text style={styles.statLabel}>{label}</Text>
    <Text style={styles.statValue}>{value ?? '0'}</Text>
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, paddingBottom: 60 },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  statCard: {
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
    marginTop: 4,
  },
  insight: {
    color: colors.subtext,
    marginBottom: 12,
    lineHeight: 20,
  },
  empty: {
    color: colors.subtext,
    fontStyle: 'italic',
  },
});
