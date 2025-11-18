import React, { useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { VictoryBar, VictoryChart, VictoryTheme } from 'victory-native';
import { DMCard } from '@components/DMCard';
import { DMButton } from '@components/DMButton';
import { colors } from '@constants/colors';
import { useAuth } from '@context/AuthContext';
import { fetchAnalytics, DashboardAnalytics, fetchOutboundStats, OutboundStats } from '@services/analytics';

type ChartMetric = 'leads' | 'engagement' | 'conversions' | 'feedbackScore';

const buildPlaceholderHistory = (base: {
  leads: number;
  engagement: number;
  conversions: number;
  feedbackScore: number;
}): DashboardAnalytics['history'] => {
  return Array.from({ length: 7 }).map((_, index) => {
    const day = new Date();
    day.setDate(day.getDate() - (6 - index));
    const pad = (value: number) => Math.max(1, Math.round(value + (Math.random() - 0.5) * 5));
    return {
      date: day.toISOString().slice(0, 10),
      leads: pad(base.leads),
      engagement: Math.min(100, pad(base.engagement)),
      conversions: Math.max(1, Math.round(base.conversions + (Math.random() - 0.5) * 2)),
      feedbackScore: Number((base.feedbackScore + (Math.random() - 0.5) * 0.4).toFixed(1))
    };
  });
};

const fallbackAnalytics = (): DashboardAnalytics => {
  const base = {
    leads: 12,
    engagement: 45,
    conversions: 4,
    feedbackScore: 4.5
  };
  return {
    ...base,
    jobBreakdown: {
      active: 1,
      queued: 0,
      failed: 0
    },
    recentJobs: [],
    history: buildPlaceholderHistory(base)
  };
};

const fallbackOutboundStats = (): OutboundStats => ({
  prospectsContacted: 0,
  replies: 0,
  positiveReplies: 0,
  conversions: 0,
  demoBookings: 0,
  conversionRate: 0
});

const formatDateLabel = (date: string) => {
  const parsed = new Date(date);
  if (!Number.isNaN(parsed.getTime())) {
    return `${parsed.getMonth() + 1}/${parsed.getDate()}`;
  }
  return date.slice(5);
};

export const DashboardScreen: React.FC = () => {
  const { state } = useAuth();
  const [analytics, setAnalytics] = useState<DashboardAnalytics>(() => {
    if (state.crmData) {
      const base = state.crmData.analytics;
      return {
        ...base,
        jobBreakdown: { active: 1, queued: 0, failed: 0 },
        recentJobs: [],
        history: buildPlaceholderHistory(base)
      };
    }
    return fallbackAnalytics();
  });
  const [loading, setLoading] = useState(false);
  const [chartMetric, setChartMetric] = useState<ChartMetric>('leads');
  const [outboundStats, setOutboundStats] = useState<OutboundStats>(() => fallbackOutboundStats());

  const heroStats = [
    { label: 'Leads', value: analytics.leads },
    { label: 'Engagement', value: `${analytics.engagement}%` },
    { label: 'Conversions', value: analytics.conversions },
    { label: 'Feedback', value: `${analytics.feedbackScore}/5` }
  ];
  const jobWidgets = [
    { label: 'Active automations', value: analytics.jobBreakdown.active, tone: colors.success },
    { label: 'Queued', value: analytics.jobBreakdown.queued, tone: colors.warning },
    { label: 'Attention needed', value: analytics.jobBreakdown.failed, tone: colors.danger }
  ];

  useEffect(() => {
    let isMounted = true;
    const loadAnalytics = async () => {
      if (!state.user) return;
      setLoading(true);
      try {
        const response = await fetchAnalytics(state.user.uid);
        if (response && isMounted) {
          setAnalytics({
            ...response,
            history:
              response.history && response.history.length > 0
                ? response.history
                : buildPlaceholderHistory(response)
          });
        } else if (isMounted && state.crmData) {
          const crmAnalytics = state.crmData.analytics;
          setAnalytics(prev => {
            const next = {
              ...prev,
              leads: crmAnalytics.leads,
              engagement: crmAnalytics.engagement,
              conversions: crmAnalytics.conversions,
              feedbackScore: crmAnalytics.feedbackScore
            };
            return {
              ...next,
              history: buildPlaceholderHistory(next)
            };
          });
        }
      } catch (error) {
        console.warn('Failed to refresh analytics', error);
      } finally {
        if (isMounted) setLoading(false);
      }
    };
    loadAnalytics();
    return () => {
      isMounted = false;
    };
  }, [state.user?.uid, state.crmData]);

  useEffect(() => {
    let mounted = true;
    const loadOutbound = async () => {
      try {
        const stats = await fetchOutboundStats();
        if (stats && mounted) {
          setOutboundStats(stats);
        }
      } catch (error) {
        console.warn('Failed to refresh outbound stats', error);
      }
    };
    loadOutbound();
    const interval = setInterval(loadOutbound, 60000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const historySeries = useMemo(
    () =>
      analytics.history && analytics.history.length > 0
        ? analytics.history
        : buildPlaceholderHistory(analytics),
    [analytics]
  );

  const sources = [
    { label: 'Web', weight: 0.24, bias: 4 },
    { label: 'Facebook', weight: 0.2, bias: 3 },
    { label: 'Instagram', weight: 0.18, bias: 2 },
    { label: 'WhatsApp', weight: 0.16, bias: 2 },
    { label: 'Threads', weight: 0.12, bias: 1 },
    { label: 'LinkedIn', weight: 0.1, bias: 1 }
  ];

  const sourceActivity = useMemo(() => {
    const base =
      chartMetric === 'feedbackScore'
        ? analytics.feedbackScore * 10
        : chartMetric === 'engagement'
        ? analytics.engagement
        : chartMetric === 'conversions'
        ? analytics.conversions
        : analytics.leads;
    return sources.map(source => ({
      source: source.label,
      value: Math.max(1, Math.round(base * source.weight + source.bias))
    }));
  }, [analytics, chartMetric]);

  const logItems =
    analytics.recentJobs && analytics.recentJobs.length > 0
      ? analytics.recentJobs.map(job => {
          const label = job.scenarioId ? `Scenario ${job.scenarioId}` : `Job ${job.jobId}`;
          return `${label} marked ${job.status}`;
        })
      : [
          'AI content calendar deployed',
          'Instagram campaign synced',
          'Lead nurture flow optimized',
          'Weekly report sent to stakeholders'
        ];

  const handleDrilldown = (metric: ChartMetric) => {
    const metricMap: Record<ChartMetric, string> = {
      leads: `You're averaging ${analytics.leads} new leads per automation cycle. Activate or duplicate high-performing scenarios to scale.`,
      engagement: `Engagement is at ${analytics.engagement}%. Test fresh creatives or prompts to push beyond current reach.`,
      conversions: `Conversions are currently ${analytics.conversions}. Tighten your follow-up cadence or revise offers for better results.`,
      feedbackScore: `Your feedback score is ${analytics.feedbackScore}/5. Keep replying quickly to maintain sentiment.`
    };
    Alert.alert('Metric details', metricMap[metric]);
  };

  const metricButtons = [
    { key: 'leads', label: 'Leads', value: `${analytics.leads}` },
    { key: 'engagement', label: 'Engagement', value: `${analytics.engagement}%` },
    { key: 'conversions', label: 'Conversions', value: `${analytics.conversions}` }
  ] as const;

  const outboundMetrics = useMemo(
    () => [
      {
        label: 'Prospects contacted',
        value: outboundStats.prospectsContacted.toString()
      },
      {
        label: 'Replies',
        value: outboundStats.replies.toString(),
        hint: `${outboundStats.positiveReplies} positive`
      },
      {
        label: 'Conversions',
        value: outboundStats.conversions.toString()
      },
      {
        label: 'Demo bookings',
        value: outboundStats.demoBookings.toString()
      },
      {
        label: 'Conversion rate',
        value: `${Math.round(outboundStats.conversionRate * 100)}%`,
        hint: 'of contacted prospects'
      }
    ],
    [outboundStats]
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <LinearGradient colors={[colors.accent, colors.accentSecondary]} style={styles.hero}>
        <Text style={styles.heroEyebrow}>Live cockpit</Text>
        <Text style={styles.heroTitle}>Analytics overview</Text>
        <Text style={styles.heroSubtitle}>
          High-impact gradients and typography inspired by dott-media.com, now wrapped around realtime CRM signals.
        </Text>
        <View style={styles.heroStatRow}>
          {heroStats.map(stat => (
            <View key={stat.label} style={styles.heroStat}>
              <Text style={styles.heroStatLabel}>{stat.label}</Text>
              <Text style={styles.heroStatValue}>{stat.value}</Text>
            </View>
          ))}
        </View>
      </LinearGradient>
        <View style={styles.kpiRow}>
          {jobWidgets.map((widget, index) => (
            <View
              key={widget.label}
              style={[styles.kpiItem, index === jobWidgets.length - 1 && styles.kpiItemLast]}
          >
            <Text style={[styles.kpiLabel, { color: widget.tone }]}>{widget.label}</Text>
            <Text style={styles.kpiValue}>{widget.value}</Text>
          </View>
          ))}
        </View>
        <DMCard title="Outbound Pipeline" subtitle="Prospecting + booking overview">
          <View style={styles.outboundGrid}>
            {outboundMetrics.map((metric, index) => (
              <View
                key={metric.label}
                style={[styles.outboundMetric, (index + 1) % 2 === 0 && styles.outboundMetricLast]}
              >
                <Text style={styles.outboundLabel}>{metric.label}</Text>
                <Text style={styles.outboundValue}>{metric.value}</Text>
                {metric.hint ? <Text style={styles.outboundHint}>{metric.hint}</Text> : null}
              </View>
            ))}
          </View>
        </DMCard>
        <DMCard title="Daily Reviews" subtitle={loading ? 'Refreshing data...' : 'Pulse across the last 24h'}>
        <View style={styles.kpiRow}>
          <View style={styles.kpiItem}>
            <Text style={styles.kpiLabel}>Leads</Text>
            <Text style={styles.kpiValue}>{analytics.leads}</Text>
          </View>
          <View style={styles.kpiItem}>
            <Text style={styles.kpiLabel}>Engagement</Text>
            <Text style={styles.kpiValue}>{analytics.engagement}%</Text>
          </View>
        </View>
        <View style={styles.kpiRow}>
          <View style={styles.kpiItem}>
            <Text style={styles.kpiLabel}>Conversions</Text>
            <Text style={styles.kpiValue}>{analytics.conversions}</Text>
          </View>
          <View style={styles.kpiItem}>
            <Text style={styles.kpiLabel}>Feedback</Text>
            <Text style={styles.kpiValue}>{analytics.feedbackScore}/5</Text>
          </View>
        </View>
        <View style={styles.metricSummaryRow}>
          {metricButtons.map(button => (
            <TouchableOpacity
              key={button.key}
              style={styles.metricSummaryChip}
              onPress={() => handleDrilldown(button.key)}
            >
              <Text style={styles.metricsubtitle}>{button.label}</Text>
              <Text style={styles.metricSummaryValue}>{button.label.split('•')[1]?.trim() ?? ''}</Text>
              <Text style={styles.metricSummaryHint}>Tap for insights</Text>
            </TouchableOpacity>
          ))}
        </View>
      </DMCard>
      <DMCard title="Activity Heatmap" subtitle={`Top channels by ${chartMetric === 'feedbackScore' ? 'sentiment' : chartMetric}`}>
        <View style={styles.chartMetricRow}>
          {(['leads', 'engagement', 'conversions', 'feedbackScore'] as const).map(metric => (
            <TouchableOpacity
              key={metric}
              style={[
                styles.metricChip,
                chartMetric === metric && styles.metricChipActive
              ]}
              onPress={() => setChartMetric(metric)}
            >
              <Text
                style={[
                  styles.metricChipText,
                  chartMetric === metric && styles.metricChipTextActive
                ]}
              >
                {metric === 'feedbackScore'
                  ? 'Feedback'
                  : metric.charAt(0).toUpperCase() + metric.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <VictoryChart theme={VictoryTheme.material} domainPadding={{ x: 20, y: 12 }}>
          <VictoryBar
            style={{ data: { fill: colors.accent } }}
            data={sourceActivity}
            x="source"
            y="value"
            barWidth={24}
          />
        </VictoryChart>
      </DMCard>
      <DMCard title="Automation Log" subtitle="Recent events across your CRM scenarios">
        {logItems.map(item => (
          <Text key={item} style={styles.logItem}>
            {item}
          </Text>
        ))}
      </DMCard>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background
  },
  content: {
    padding: 20,
    paddingBottom: 40
  },
  hero: {
    borderRadius: 32,
    padding: 24,
    marginBottom: 20
  },
  heroEyebrow: {
    color: colors.text,
    textTransform: 'uppercase',
    letterSpacing: 1.6,
    fontSize: 12
  },
  heroTitle: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '800',
    marginTop: 6,
    marginBottom: 4
  },
  heroSubtitle: {
    color: colors.background,
    opacity: 0.9,
    lineHeight: 20
  },
  heroStatRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 18,
    justifyContent: 'space-between'
  },
  heroStat: {
    width: '48%',
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderRadius: 18,
    padding: 12,
    marginBottom: 12
  },
  heroStatLabel: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5
  },
  heroStatValue: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '700',
    marginTop: 4
  },
  kpiRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16
  },
  kpiItem: {
    flex: 1,
    backgroundColor: colors.cardOverlay,
    borderRadius: 20,
    padding: 16,
    marginRight: 12,
    borderWidth: 1,
    borderColor: colors.border
  },
  kpiItemLast: {
    marginRight: 0
  },
  kpiLabel: {
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.6
  },
  kpiValue: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 22,
    marginTop: 6
  },
  chartMetricRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 12
  },
  metricChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.backgroundAlt,
    borderWidth: 1,
    borderColor: colors.border,
    marginRight: 8,
    marginBottom: 8
  },
  metricChipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
    shadowColor: colors.accent,
    shadowOpacity: 0.4,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 }
  },
  metricChipText: {
    color: colors.subtext,
    fontSize: 12,
    textTransform: 'capitalize'
  },
  metricChipTextActive: {
    color: colors.background
  },
  metricSummaryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 12
  },
  metricSummaryChip: {
    flex: 1,
    minWidth: '46%',
    backgroundColor: colors.backgroundAlt,
    borderRadius: 18,
    padding: 14,
    marginRight: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border
  },
  metricsubtitle: {
    color: colors.subtext,
    fontSize: 12,
    marginBottom: 4
  },
  metricSummaryValue: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '600'
  },
  metricSummaryHint: {
    color: colors.subtext,
    fontSize: 12,
    marginTop: 4
  },
  outboundGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 8
  },
  outboundMetric: {
    width: '48%',
    backgroundColor: colors.backgroundAlt,
    borderRadius: 18,
    padding: 14,
    marginBottom: 12,
    marginRight: 12,
    borderWidth: 1,
    borderColor: colors.border
  },
  outboundMetricLast: {
    marginRight: 0
  },
  outboundLabel: {
    color: colors.subtext,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5
  },
  outboundValue: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '700',
    marginTop: 6
  },
  outboundHint: {
    color: colors.subtext,
    fontSize: 12,
    marginTop: 4
  },
  logItem: {
    color: colors.subtext,
    marginBottom: 8
  }
});
