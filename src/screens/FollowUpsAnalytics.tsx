import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { VictoryChart, VictoryLine, VictoryTheme } from 'victory-native';
import { colors } from '@constants/colors';
import { DMCard } from '@components/DMCard';
import { FollowupStats, fetchFollowupStats, resolveAnalyticsScopeId } from '@services/analytics';
import { useI18n } from '@context/I18nContext';
import { useAuth } from '@context/AuthContext';

export const FollowUpsAnalyticsScreen: React.FC = () => {
  const { t } = useI18n();
  const { state } = useAuth();
  const orgId = (state.user as any)?.orgId ?? state.crmData?.orgId;
  const analyticsScopeId = useMemo(
    () => resolveAnalyticsScopeId(state.user?.uid, orgId),
    [state.user?.uid, orgId]
  );
  const [stats, setStats] = useState<FollowupStats | null>(null);
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
        const payload = await fetchFollowupStats(state.user.uid, analyticsScopeId);
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
              value: stats.sent
            }
          ]
        : [],
    [stats, t]
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <DMCard title={t('Follow-up Automation')} subtitle={t('Daily retargeting touches')}>
        <View style={styles.grid}>
          <Stat label={t('Sends')} value={stats?.sent} />
          <Stat label={t('Replies')} value={stats?.replies} />
          <Stat label={t('Conversions')} value={stats?.conversions} />
          <Stat label={t('Reply rate')} value={stats ? `${Math.round(stats.replyRate * 100)}%` : undefined} />
          <Stat
            label={t('Conversion rate')}
            value={stats ? `${Math.round(stats.conversionRate * 100)}%` : undefined}
          />
        </View>
      </DMCard>

      <DMCard title={t('Follow-up volume')} subtitle={t('Total automated follow-ups')}>
        {loading ? (
          <ActivityIndicator color={colors.accent} />
        ) : history.length === 0 ? (
          <Text style={styles.empty}>{t('No follow-up activity yet.')}</Text>
        ) : (
          <VictoryChart theme={VictoryTheme.material} domainPadding={{ x: 12, y: 10 }}>
            <VictoryLine
              interpolation="monotoneX"
              style={{ data: { stroke: colors.accent, strokeWidth: 3 } }}
              data={history}
              x="label"
              y="value"
            />
          </VictoryChart>
        )}
      </DMCard>

      <DMCard title={t('Playbook tips')}>
        <Text style={styles.tip}>
          {t(
            "Dotti automatically re-engages Qualified + DemoOffered leads 7 days after the last response. Increase the conversion rate by personalizing openers with the prospect's last objection."
          )}
        </Text>
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
  tip: {
    color: colors.subtext,
    lineHeight: 20,
  },
  empty: {
    color: colors.subtext,
    fontStyle: 'italic',
  },
});
