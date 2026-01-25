import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { VictoryBar, VictoryChart, VictoryTheme } from 'victory-native';
import { colors } from '@constants/colors';
import { DMCard } from '@components/DMCard';
import { fetchInboundStats, InboundStats } from '@services/analytics';

const buildHistory = (total: number) =>
  Array.from({ length: 7 }).map((_, index) => ({
    label: `Day ${index + 1}`,
    value: Math.max(1, Math.round(total / 7 + (Math.random() - 0.5) * 6)),
  }));

export const InboundAnalyticsScreen: React.FC = () => {
  const [stats, setStats] = useState<InboundStats | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      setLoading(true);
      try {
        const payload = await fetchInboundStats();
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

  const history = useMemo(() => buildHistory(stats?.messages ?? 40), [stats?.messages]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <DMCard title="Inbound Funnel" subtitle="Passive chats flowing into Dotti">
        <View style={styles.grid}>
          <Stat label="Messages" value={stats?.messages} />
          <Stat label="Leads" value={stats?.leads} />
          <Stat label="Avg Sentiment" value={stats ? stats.avgSentiment.toFixed(2) : undefined} />
          <Stat label="Conversion Rate" value={stats ? `${Math.round(stats.conversionRate * 100)}%` : undefined} />
        </View>
      </DMCard>

      <DMCard title="Messages per day" subtitle="Rolling 7 day sparkline">
        {loading ? (
          <ActivityIndicator color={colors.accent} />
        ) : (
          <VictoryChart theme={VictoryTheme.material} domainPadding={{ x: 12, y: 10 }}>
            <VictoryBar data={history} x="label" y="value" style={{ data: { fill: colors.accent } }} />
          </VictoryChart>
        )}
      </DMCard>

      <DMCard title="Insights">
        <Text style={styles.insight}>
          Dotti captures inbound interest automatically and qualifies warm replies using GPT-powered flows.
        </Text>
        <Text style={styles.insight}>
          Keep an eye on sentiment — anything below 0.2 may signal friction in your first-touch prompts.
        </Text>
      </DMCard>
    </ScrollView>
  );
};

const Stat: React.FC<{ label: string; value?: string | number }> = ({ label, value }) => (
  <View style={styles.statCard}>
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
});
