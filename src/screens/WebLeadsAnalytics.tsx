import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { VictoryArea, VictoryChart, VictoryTheme } from 'victory-native';
import { colors } from '@constants/colors';
import { DMCard } from '@components/DMCard';
import { WebLeadStats, fetchWebLeadStats } from '@services/analytics';

const buildAreaSeries = (count: number) =>
  Array.from({ length: 7 }).map((_, index) => ({
    label: index + 1,
    value: Math.max(1, Math.round(count / 7 + (Math.random() - 0.5) * 4)),
  }));

export const WebLeadsAnalyticsScreen: React.FC = () => {
  const [stats, setStats] = useState<WebLeadStats | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      setLoading(true);
      try {
        const payload = await fetchWebLeadStats();
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

  const series = useMemo(() => buildAreaSeries(stats?.messages ?? 20), [stats?.messages]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <DMCard title="Web Widget Leads" subtitle="Traffic converting via Dotti widget">
        <View style={styles.grid}>
          <Stat label="Chat messages" value={stats?.messages} />
          <Stat label="Leads captured" value={stats?.leads} />
          <Stat label="Conversion rate" value={stats ? `${Math.round(stats.conversionRate * 100)}%` : undefined} />
        </View>
      </DMCard>

      <DMCard title="Daily widget volume">
        {loading ? (
          <ActivityIndicator color={colors.accent} />
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

      <DMCard title="Activation snippet">
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
  code: {
    fontFamily: 'Courier New',
    fontSize: 12,
    color: colors.subtext,
    backgroundColor: '#050b1a',
    padding: 12,
    borderRadius: 12,
  },
});
