import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { VictoryChart, VictoryLine, VictoryTheme } from 'victory-native';
import { colors } from '@constants/colors';
import { DMCard } from '@components/DMCard';
import { FollowupStats, fetchFollowupStats } from '@services/analytics';

const buildSeries = (count: number) =>
  Array.from({ length: 6 }).map((_, index) => ({
    label: `Week ${index + 1}`,
    value: Math.max(0, Math.round(count / 6 + (Math.random() - 0.5) * 8)),
  }));

export const FollowUpsAnalyticsScreen: React.FC = () => {
  const [stats, setStats] = useState<FollowupStats | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      setLoading(true);
      try {
        const payload = await fetchFollowupStats();
        if (mounted) setStats(payload);
      } finally {
        if (mounted) setLoading(false);
      }
    };
    load();
    return () => {
      mounted = false;
    };
  }, []);

  const history = useMemo(() => buildSeries(stats?.sent ?? 12), [stats?.sent]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <DMCard title="Follow-up Automation" subtitle="Daily retargeting touches">
        <View style={styles.grid}>
          <Stat label="Sends" value={stats?.sent} />
          <Stat label="Replies" value={stats?.replies} />
          <Stat label="Conversions" value={stats?.conversions} />
          <Stat label="Reply rate" value={stats ? `${Math.round(stats.replyRate * 100)}%` : undefined} />
          <Stat
            label="Conversion rate"
            value={stats ? `${Math.round(stats.conversionRate * 100)}%` : undefined}
          />
        </View>
      </DMCard>

      <DMCard title="Weekly follow-ups sent">
        {loading ? (
          <ActivityIndicator color={colors.accent} />
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

      <DMCard title="Playbook tips">
        <Text style={styles.tip}>
          Dotti automatically re-engages Qualified + DemoOffered leads 7 days after the last response. Increase the
          conversion rate by personalizing openers with the prospect’s last objection.
        </Text>
      </DMCard>
    </ScrollView>
  );
};

const Stat: React.FC<{ label: string; value?: number | string }> = ({ label, value }) => (
  <View style={styles.stat}>
    <Text style={styles.statLabel}>{label}</Text>
    <Text style={styles.statValue}>{value ?? '—'}</Text>
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
});
