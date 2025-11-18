import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { VictoryBar, VictoryChart, VictoryPie, VictoryTheme } from 'victory-native';
import { DMCard } from '@components/DMCard';
import { colors } from '@constants/colors';
import { EngagementStats, fetchEngagementStats } from '@services/analytics';

const keywords = ['price', 'cost', 'crm', 'automation', 'ai', 'demo'];

export const EngagementAnalyticsScreen: React.FC = () => {
  const [stats, setStats] = useState<EngagementStats | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      setLoading(true);
      try {
        const payload = await fetchEngagementStats();
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

  const funnel = useMemo(
    () => [
      { label: 'Detected', value: stats?.comments ?? 0 },
      { label: 'Replied', value: stats?.replies ?? 0 },
      { label: 'Converted', value: stats?.conversions ?? 0 },
    ],
    [stats],
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <DMCard title="Content Engagement" subtitle="Comments, mentions, and DM reactions">
        <View style={styles.row}>
          <Stat label="Comments with intent" value={stats?.comments} />
          <Stat label="Replies sent" value={stats?.replies} />
          <Stat label="Conversions" value={stats?.conversions} />
          <Stat
            label="Conversion rate"
            value={stats ? `${Math.round(stats.conversionRate * 100)}%` : undefined}
          />
        </View>
      </DMCard>

      <DMCard title="Comment funnel">
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

      <DMCard title="Hot keywords listening">
        <VictoryPie
          innerRadius={60}
          colorScale={['#0b5cff', '#1ccad8', '#f7931a', '#7c83fd', '#83ffe6', '#f25f5c']}
          style={{ labels: { fill: colors.text, fontSize: 12 } }}
          data={keywords.map(keyword => ({
            x: keyword.toUpperCase(),
            y: Math.random() * 10 + 6,
          }))}
          labels={({ datum }) => `${datum.x}\n${Math.round(datum.y)}`}
        />
        <Text style={styles.note}>Listening for: {keywords.join(', ')}.</Text>
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
});
