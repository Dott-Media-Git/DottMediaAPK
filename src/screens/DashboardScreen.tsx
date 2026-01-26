import React, { useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { VictoryAxis, VictoryBar, VictoryChart, VictoryTheme } from 'victory-native';
import { DMCard } from '@components/DMCard';
import { colors } from '@constants/colors';
import { useAuth } from '@context/AuthContext';
import { useI18n } from '@context/I18nContext';
import {
  fetchAnalytics,
  DashboardAnalytics,
  fetchOrgDashboardAnalytics,
  fetchOutboundStats,
  OutboundStats,
  subscribeOrgDashboardAnalytics,
  subscribeOutboundStats,
  subscribeAnalytics,
  resolveAnalyticsScopeId
} from '@services/analytics';

type ChartMetric = 'leads' | 'engagement' | 'conversions' | 'feedbackScore';
type MetricSnapshot = DashboardAnalytics['history'][number];

const createEmptyAnalytics = (seed?: Partial<DashboardAnalytics>): DashboardAnalytics => ({
  leads: seed?.leads ?? 0,
  engagement: seed?.engagement ?? 0,
  conversions: seed?.conversions ?? 0,
  feedbackScore: seed?.feedbackScore ?? 0,
  jobBreakdown: seed?.jobBreakdown ?? {
    active: 0,
    queued: 0,
    failed: 0
  },
  recentJobs: seed?.recentJobs ?? [],
  history: seed?.history ?? []
});

const emptyOutboundStats: OutboundStats = {
  prospectsContacted: 0,
  replies: 0,
  positiveReplies: 0,
  conversions: 0,
  demoBookings: 0,
  conversionRate: 0
};

const formatDateLabel = (date: string) => {
  const parsed = new Date(date);
  if (!Number.isNaN(parsed.getTime())) {
    return `${parsed.getMonth() + 1}/${parsed.getDate()}`;
  }
  return date.slice(5);
};

const formatDayOfWeek = (date: string, locale?: string) => {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return 'Day';
  return parsed.toLocaleDateString(locale ?? undefined, { weekday: 'short' });
};

export const DashboardScreen: React.FC = () => {
  const { state } = useAuth();
  const { t, locale } = useI18n();
  const hasConnectedSocials = Boolean(state.crmData?.instagram || state.crmData?.facebook || state.crmData?.linkedin);
  const orgId = (state.user as any)?.orgId ?? state.crmData?.orgId;
  const analyticsScopeId = useMemo(
    () => resolveAnalyticsScopeId(state.user?.uid, orgId),
    [state.user?.uid, orgId]
  );
  const [analytics, setAnalytics] = useState<DashboardAnalytics>(() =>
    createEmptyAnalytics(state.crmData?.analytics)
  );
  const [loading, setLoading] = useState(false);
  const [chartMetric, setChartMetric] = useState<ChartMetric>('leads');
  const [outboundStats, setOutboundStats] = useState<OutboundStats>(() => emptyOutboundStats);

  useEffect(() => {
    let isMounted = true;
    let unsubscribe: (() => void) | null = null;
    const loadAnalytics = async () => {
      if (!state.user) return;
      setLoading(true);
      if (orgId) {
        unsubscribe =
          subscribeOrgDashboardAnalytics(
            analyticsScopeId,
            payload => {
              if (!isMounted) return;
              setAnalytics(createEmptyAnalytics(payload));
              setLoading(false);
            },
            error => console.warn('Realtime org analytics failed', error)
          ) ?? null;

        if (!unsubscribe) {
          try {
            const response = await fetchOrgDashboardAnalytics(analyticsScopeId);
            if (response && isMounted) {
              setAnalytics(createEmptyAnalytics(response));
            }
          } catch (error) {
            console.warn('Failed to refresh org analytics', error);
          } finally {
            if (isMounted) setLoading(false);
          }
        }
        return;
      }

      unsubscribe =
        subscribeAnalytics(
          state.user.uid,
          payload => {
            if (!isMounted) return;
            setAnalytics(createEmptyAnalytics(payload));
            setLoading(false);
          },
          error => {
            console.warn('Realtime analytics subscription failed', error);
          },
          analyticsScopeId
        ) ?? null;

      if (!unsubscribe) {
        try {
          const response = await fetchAnalytics(state.user.uid);
          if (response && isMounted) {
            setAnalytics(createEmptyAnalytics(response));
          } else if (isMounted && state.crmData) {
            setAnalytics(createEmptyAnalytics(state.crmData.analytics));
          }
        } catch (error) {
          console.warn('Failed to refresh analytics', error);
        } finally {
          if (isMounted) setLoading(false);
        }
      }
    };
    loadAnalytics();
    return () => {
      isMounted = false;
      if (unsubscribe) unsubscribe();
    };
  }, [analyticsScopeId, orgId, state.user?.uid, state.crmData]);

  useEffect(() => {
    let mounted = true;
    let outboundUnsub: (() => void) | null = null;

    if (!hasConnectedSocials) {
      setOutboundStats(emptyOutboundStats);
    } else {
      outboundUnsub =
        subscribeOutboundStats(
          analyticsScopeId,
          stats => mounted && setOutboundStats(stats),
          error => console.warn('Realtime outbound stats failed', error)
        ) ?? null;

      if (!outboundUnsub) {
        void fetchOutboundStats(state.user?.uid, analyticsScopeId).then(stats => {
          if (stats && mounted) setOutboundStats(stats);
        });
      }
    }

    return () => {
      mounted = false;
      outboundUnsub?.();
    };
  }, [analyticsScopeId, hasConnectedSocials, state.user?.uid]);

  const historySeries = useMemo(
    () => analytics.history ?? [],
    [analytics]
  );

  const latestHistoryPoint: MetricSnapshot = useMemo(() => {
    if (historySeries.length > 0) {
      return historySeries[historySeries.length - 1];
    }
    return {
      date: new Date().toISOString().slice(0, 10),
      leads: analytics.leads,
      engagement: analytics.engagement,
      conversions: analytics.conversions,
      feedbackScore: analytics.feedbackScore
    };
  }, [analytics, historySeries]);

  const previousHistoryPoint = useMemo<MetricSnapshot | null>(
    () => (historySeries.length > 1 ? historySeries[historySeries.length - 2] : null),
    [historySeries]
  );

  const heroStats = [
    { label: t('Leads'), value: latestHistoryPoint.leads },
    { label: t('Engagement'), value: `${latestHistoryPoint.engagement}%` },
    { label: t('Conversions'), value: latestHistoryPoint.conversions },
    { label: t('Feedback'), value: `${latestHistoryPoint.feedbackScore}/5` }
  ];

  const logItems =
    analytics.recentJobs && analytics.recentJobs.length > 0
      ? analytics.recentJobs.map(job => {
          const label = job.scenarioId
            ? t('Scenario {{id}}', { id: job.scenarioId })
            : t('Job {{id}}', { id: job.jobId });
          return t('{{label}} marked {{status}}', { label, status: job.status });
        })
      : [t('No recent activity yet')];

  const handleDrilldown = (metric: ChartMetric) => {
    const metricMap: Record<ChartMetric, string> = {
      leads: t(
        "You're averaging {{value}} new leads per automation cycle. Activate or duplicate high-performing scenarios to scale.",
        { value: latestHistoryPoint.leads }
      ),
      engagement: t(
        'Engagement is at {{value}}%. Test fresh creatives or prompts to push beyond current reach.',
        { value: latestHistoryPoint.engagement }
      ),
      conversions: t(
        'Conversions are currently {{value}}. Tighten your follow-up cadence or revise offers for better results.',
        { value: latestHistoryPoint.conversions }
      ),
      feedbackScore: t(
        'Your feedback score is {{value}}/5. Keep replying quickly to maintain sentiment.',
        { value: latestHistoryPoint.feedbackScore }
      )
    };
    Alert.alert(t('Metric details'), metricMap[metric]);
  };

  const metricButtons = useMemo(
    () => {
      const computeHint = (metric: ChartMetric) => {
        if (!previousHistoryPoint) return t('Live data');
        const delta = latestHistoryPoint[metric] - previousHistoryPoint[metric];
        if (Math.abs(delta) < 0.001) return t('No change vs prior day');
        const formattedDelta = Number.isInteger(delta) ? delta : Number(delta.toFixed(1));
        const suffix = metric === 'engagement' ? '%' : '';
        const value = `${delta > 0 ? '+' : ''}${formattedDelta}${suffix}`;
        return t('{{value}} vs prior day', { value });
      };

      return [
        { key: 'leads', label: t('Leads'), value: `${latestHistoryPoint.leads}`, hint: computeHint('leads') },
        {
          key: 'engagement',
          label: t('Engagement'),
          value: `${latestHistoryPoint.engagement}%`,
          hint: computeHint('engagement')
        },
        {
          key: 'conversions',
          label: t('Conversions'),
          value: `${latestHistoryPoint.conversions}`,
          hint: computeHint('conversions')
        }
      ] as const;
    },
    [latestHistoryPoint, previousHistoryPoint, t]
  );

  const outboundMetrics = useMemo(
    () => [
      {
        label: t('Prospects contacted'),
        value: outboundStats.prospectsContacted.toString()
      },
      {
        label: t('Replies'),
        value: outboundStats.replies.toString(),
        hint: t('{{count}} positive', { count: outboundStats.positiveReplies })
      },
      {
        label: t('Conversions'),
        value: outboundStats.conversions.toString()
      },
      {
        label: t('Demo bookings'),
        value: outboundStats.demoBookings.toString()
      },
      {
        label: t('Conversion rate'),
        value: `${Math.round(outboundStats.conversionRate * 100)}%`,
        hint: t('of contacted prospects')
      }
    ],
    [outboundStats, t]
  );

  const heatmapSeries = useMemo(
    () =>
      [...historySeries]
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
        .slice(-7)
        .map((day, index, arr) => ({
          label: index === arr.length - 1 ? t('Today') : formatDayOfWeek(day.date, locale),
          value:
            chartMetric === 'leads'
              ? day.leads
              : chartMetric === 'engagement'
              ? day.engagement
              : chartMetric === 'conversions'
              ? day.conversions
              : day.feedbackScore
        })),
    [chartMetric, historySeries]
  );

  const heatmapTicks = useMemo(() => {
    const maxValue = heatmapSeries.reduce((max, item) => Math.max(max, item.value), 0);
    const top = Math.max(100, Math.ceil(maxValue / 100) * 100);
    const steps = Math.max(1, top / 100);
    return Array.from({ length: steps + 1 }, (_, i) => i * 100);
  }, [heatmapSeries]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <LinearGradient colors={[colors.accent, colors.accentSecondary]} style={styles.hero}>
        <Text style={styles.heroEyebrow}>{t('Live cockpit')}</Text>
        <Text style={styles.heroTitle}>{t('Analytics overview')}</Text>
        <Text style={styles.heroSubtitle}>
          {t('High-impact gradients and typography inspired by dott-media.com, now wrapped around realtime CRM signals.')}
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
      <DMCard title={t('Outbound Pipeline')} subtitle={t('Prospecting + booking overview')}>
        {!hasConnectedSocials ? (
          <Text style={styles.emptyState}>{t('Connect a social account to unlock outbound metrics.')}</Text>
        ) : (
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
        )}
      </DMCard>
      <DMCard title={t('Daily Reviews')} subtitle={loading ? t('Refreshing data...') : t('Pulse across the last 24h')}>
        <View style={styles.kpiRow}>
          <View style={styles.kpiItem}>
            <Text style={styles.kpiLabel}>{t('Leads')}</Text>
            <Text style={styles.kpiValue}>{latestHistoryPoint.leads}</Text>
          </View>
          <View style={styles.kpiItem}>
            <Text style={styles.kpiLabel}>{t('Engagement')}</Text>
            <Text style={styles.kpiValue}>{latestHistoryPoint.engagement}%</Text>
          </View>
        </View>
        <View style={styles.kpiRow}>
          <View style={styles.kpiItem}>
            <Text style={styles.kpiLabel}>{t('Conversions')}</Text>
            <Text style={styles.kpiValue}>{latestHistoryPoint.conversions}</Text>
          </View>
          <View style={styles.kpiItem}>
            <Text style={styles.kpiLabel}>{t('Feedback')}</Text>
            <Text style={styles.kpiValue}>{latestHistoryPoint.feedbackScore}/5</Text>
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
              <Text style={styles.metricSummaryValue}>{button.value}</Text>
              <Text style={styles.metricSummaryHint}>{button.hint ?? t('Tap for insights')}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </DMCard>
      <DMCard
        title={t('Activity Heatmap')}
        subtitle={t('Last {{count}} days of {{metric}}', {
          count: Math.min(heatmapSeries.length, 7),
          metric:
            chartMetric === 'feedbackScore'
              ? t('feedback')
              : t(chartMetric.charAt(0).toUpperCase() + chartMetric.slice(1))
        })}
      >
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
                  ? t('Feedback')
                  : t(metric.charAt(0).toUpperCase() + metric.slice(1))}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <VictoryChart theme={VictoryTheme.material} domainPadding={{ x: 20, y: 12 }}>
          <VictoryAxis
            style={{
              axis: { stroke: colors.border },
              tickLabels: { fill: colors.subtext },
              grid: { stroke: 'transparent' }
            }}
          />
          <VictoryAxis
            dependentAxis
            label={t('People')}
            tickValues={heatmapTicks}
            style={{
              axisLabel: { padding: 32, fill: colors.subtext },
              tickLabels: { fill: colors.subtext },
              grid: { stroke: 'transparent' }
            }}
          />
          <VictoryBar
            style={{ data: { fill: colors.accent } }}
            data={heatmapSeries}
            x="label"
            y="value"
            barWidth={24}
          />
        </VictoryChart>
      </DMCard>
      <DMCard title={t('Automation Log')} subtitle={t('Recent events across your CRM scenarios')}>
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
  emptyState: {
    color: colors.subtext,
    marginTop: 8,
    lineHeight: 18
  },
  logItem: {
    color: colors.subtext,
    marginBottom: 8
  }
});
