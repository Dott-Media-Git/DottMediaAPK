import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { VictoryArea, VictoryChart, VictoryTheme } from 'victory-native';
import { colors } from '@constants/colors';
import { DMCard } from '@components/DMCard';
import { WebLeadStats, fetchWebLeadStats, subscribeWebLeadStats, resolveAnalyticsScopeId } from '@services/analytics';
import { useI18n } from '@context/I18nContext';
import { useAuth } from '@context/AuthContext';

export const WebLeadsAnalyticsScreen: React.FC = () => {
  const { t } = useI18n();
  const { state } = useAuth();
  const orgId = (state.user as any)?.orgId ?? state.crmData?.orgId;
  const analyticsScopeId = useMemo(
    () => resolveAnalyticsScopeId(state.user?.uid, orgId),
    [state.user?.uid, orgId]
  );
  const [stats, setStats] = useState<WebLeadStats | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let mounted = true;
    const unsub =
      subscribeWebLeadStats(
        analyticsScopeId,
        payload => {
          if (mounted) setStats(payload);
          if (mounted) setLoading(false);
        },
        error => console.warn('Realtime web lead stats failed', error)
      ) ?? null;

    if (!unsub) {
      const load = async () => {
        if (!state.user) {
          if (mounted) setStats(null);
          return;
        }
        setLoading(true);
        try {
          const payload = await fetchWebLeadStats(state.user.uid, analyticsScopeId);
          if (mounted) setStats(payload);
        } finally {
          if (mounted) setLoading(false);
        }
      };
      load();
    }

    return () => {
      mounted = false;
      unsub?.();
    };
  }, [analyticsScopeId, state.user]);

  const series = useMemo(
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
      <DMCard title={t('Web Widget Leads')} subtitle={t('Traffic converting via Dotti widget')}>
        <View style={styles.grid}>
          <Stat label={t('Chat messages')} value={stats?.messages} />
          <Stat label={t('Leads captured')} value={stats?.leads} />
          <Stat label={t('Conversion rate')} value={stats ? `${Math.round(stats.conversionRate * 100)}%` : undefined} />
        </View>
      </DMCard>

      <DMCard title={t('Widget volume')} subtitle={t('Total web widget messages')}>
        {loading ? (
          <ActivityIndicator color={colors.accent} />
        ) : series.length === 0 ? (
          <Text style={styles.empty}>{t('No web widget activity yet.')}</Text>
        ) : (
          <VictoryChart theme={VictoryTheme.material} domainPadding={{ x: 12, y: 8 }}>
            <VictoryArea
              style={{
                data: {
                  fill: 'rgba(11,92,255,0.35)',
                  stroke: '#0b5cff',
                  strokeWidth: 3,
                },
              }}
              data={series}
              x="label"
              y="value"
            />
          </VictoryChart>
        )}
      </DMCard>

      <DMCard title={t('Activation snippet')}>
        <Text style={styles.code}>{`<script src="https://api.dott-media.com/widget.js"></script>
<script>
  DottiWidget.init({ api: '${process.env.EXPO_PUBLIC_API_URL ?? 'https://api.dott-media.com'}/widget/webhook' });
</script>`}</Text>
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
  grid: {
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
    marginTop: 4,
  },
  code: {
    fontFamily: 'Courier New',
    fontSize: 12,
    color: colors.subtext,
    backgroundColor: '#050b1a',
    padding: 12,
    borderRadius: 12,
  },
  empty: {
    color: colors.subtext,
    fontStyle: 'italic',
  },
});
