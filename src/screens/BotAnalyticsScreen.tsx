import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { VictoryBar, VictoryChart, VictoryLegend, VictoryLine, VictoryPie, VictoryTheme } from 'victory-native';
import { colors } from '@constants/colors';
import { fetchBotAnalytics, subscribeBotAnalytics } from '@services/botStats';
import { fetchSocialHistory } from '@services/social';
import { fetchOutboundStats, OutboundStats, resolveAnalyticsScopeId } from '@services/analytics';
import type { BotAnalytics, PlatformMetric, PlatformName } from '@models/bot';
import { emptyBotAnalytics } from '@constants/botAnalytics';
import { notifyLeadAlerts } from '@services/notifications';
import { useI18n } from '@context/I18nContext';
import { useAuth } from '@context/AuthContext';

const SectionHeader: React.FC<{ title: string; subtitle?: string }> = ({ title, subtitle }) => (
  <View style={styles.sectionHeader}>
    <Text style={styles.sectionTitle}>{title}</Text>
    {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
  </View>
);

const platformColors: Record<PlatformName, string> = {
  whatsapp: '#44D7B6',
  facebook: '#1877F2',
  instagram: '#F77737',
  threads: '#8E3FFC',
  linkedin: '#0A66C2',
  web: '#00B4D8'
};

const formatPercentage = (value: number) => `${(value * 100).toFixed(1)}%`;

export const BotAnalyticsScreen: React.FC = () => {
  const { t } = useI18n();
  const { state } = useAuth();
  const [analytics, setAnalytics] = useState<BotAnalytics>(emptyBotAnalytics);
  const [loading, setLoading] = useState(false);
  const [socialSummary, setSocialSummary] = useState<{ postsAttempted?: number; postsPosted?: number } | null>(null);
  const [outboundStats, setOutboundStats] = useState<OutboundStats | null>(null);
  const lastAlertPendingRef = useRef<number>(0);
  const hasConnectedSocials = Boolean(state.crmData?.instagram || state.crmData?.facebook || state.crmData?.linkedin);
  const orgId = (state.user as any)?.orgId ?? state.crmData?.orgId;
  const analyticsScopeId = useMemo(
    () => resolveAnalyticsScopeId(state.user?.uid, orgId),
    [state.user?.uid, orgId]
  );

  useEffect(() => {
    let mounted = true;
    if (!hasConnectedSocials) {
      setAnalytics(emptyBotAnalytics);
      setLoading(false);
      return () => {
        mounted = false;
      };
    }
    const unsub =
      subscribeBotAnalytics(
        analyticsScopeId,
        payload => {
          if (!mounted) return;
          setAnalytics(payload);
          const pending = payload.leadInsights?.followUp.pending ?? 0;
          if (pending !== lastAlertPendingRef.current) {
            notifyLeadAlerts({ pendingFollowUps: pending, hotLeads: 0 });
            lastAlertPendingRef.current = pending;
          }
          setLoading(false);
        },
        error => {
          console.warn('Realtime bot analytics failed', error);
        }
      ) ?? null;

    if (!unsub) {
      const load = async () => {
        setLoading(true);
        try {
          const payload = await fetchBotAnalytics(state.user?.uid, analyticsScopeId);
          if (!mounted) return;
          setAnalytics(payload);
        } finally {
          if (mounted) setLoading(false);
        }
      };
      void load();
    }

    return () => {
      mounted = false;
      unsub?.();
    };
  }, [analyticsScopeId, hasConnectedSocials, state.user?.uid]);

  useEffect(() => {
    const loadSocial = async () => {
      try {
        const history = await fetchSocialHistory();
        setSocialSummary(history.daily?.[0]);
      } catch (error) {
        console.warn('Failed to fetch social summary', error);
      }
    };
    loadSocial();
  }, []);

  useEffect(() => {
    let mounted = true;
    if (!hasConnectedSocials) {
      setOutboundStats(null);
      return () => {
        mounted = false;
      };
    }
    const load = async () => {
      const stats = await fetchOutboundStats(state.user?.uid, analyticsScopeId);
      if (mounted) setOutboundStats(stats);
    };
    load();
    const interval = setInterval(load, 15000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [analyticsScopeId, hasConnectedSocials, state.user?.uid]);

  const summaryStats = [
    { label: t('Messages Today'), value: analytics.summary.totalMessagesToday },
    { label: t('New Leads'), value: analytics.summary.newLeadsToday },
    { label: t('Avg Response'), value: `${analytics.summary.avgResponseTime}s` },
    { label: t('Conversion'), value: formatPercentage(analytics.summary.conversionRate) },
    { label: t('Sentiment'), value: analytics.summary.avgSentiment.toFixed(1) },
    { label: t('Active Users'), value: analytics.activeUsers }
  ];
  const leadInsights = analytics.leadInsights ?? emptyBotAnalytics.leadInsights!;
  const topConversations = analytics.topConversations ?? emptyBotAnalytics.topConversations;

  const renderPlatformMetric = (metric: PlatformMetric) => (
    <View key={metric.platform} style={[styles.platformCard, { borderColor: platformColors[metric.platform] }]}>
      <Text style={styles.platformName}>{metric.platform.toUpperCase()}</Text>
      <Text style={styles.platformValue}>{t('{{count}} msgs', { count: metric.messages })}</Text>
      <Text style={styles.platformDetail}>
        {t('{{count}} leads - {{rate}}', { count: metric.leads, rate: formatPercentage(metric.conversionRate) })}
      </Text>
      <Text style={styles.platformDetail}>
        {t('{{time}}s avg reply - Sentiment {{value}}', {
          time: metric.avgResponseTime,
          value: metric.avgSentiment.toFixed(1)
        })}
      </Text>
    </View>
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <SectionHeader
        title={t('Dott-Media Multi-Channel Pulse')}
        subtitle={t('Unified insights for WhatsApp, Facebook, Instagram, Threads & LinkedIn')}
      />
      <View style={styles.summaryGrid}>
        {summaryStats.map(stat => (
          <View key={stat.label} style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>{stat.label}</Text>
            <Text style={styles.summaryValue}>{stat.value}</Text>
          </View>
        ))}
      </View>
      {socialSummary && (
        <View style={styles.socialCard}>
          <Text style={styles.sectionSubtitle}>{t('Social Posts Today')}</Text>
          <Text style={styles.socialValue}>
            {t('{{posted}}/{{attempted}} posted', {
              posted: socialSummary.postsPosted ?? 0,
              attempted: socialSummary.postsAttempted ?? 0
            })}
          </Text>
        </View>
      )}

      <View style={styles.card}>
        <SectionHeader title={t('Outbound Snapshot')} subtitle={t('Prospecting to booked demos')} />
        {outboundStats ? (
          <View style={styles.outboundRow}>
            <MiniStat label={t('Contacted')} value={outboundStats.prospectsContacted} />
            <MiniStat label={t('Replies')} value={outboundStats.replies} />
            <MiniStat label={t('Conversions')} value={outboundStats.conversions} />
            <MiniStat label={t('Demos')} value={outboundStats.demoBookings} />
          </View>
        ) : (
          <ActivityIndicator color={colors.accent} />
        )}
      </View>

      {loading ? (
        <ActivityIndicator color={colors.accent} style={styles.loader} />
      ) : (
        <>
          <View style={styles.card}>
            <SectionHeader title={t('Daily Message Volume')} subtitle={t('Rolling 7-day total')} />
            <VictoryChart theme={VictoryTheme.material} domainPadding={10}>
              <VictoryLine
                interpolation="monotoneX"
                style={{ data: { stroke: colors.accent, strokeWidth: 3 } }}
                data={analytics.charts.dailyMessages.map(point => ({ x: point.label, y: point.value }))}
              />
            </VictoryChart>
          </View>

          <View style={styles.card}>
            <SectionHeader title={t('Weekly Messages by Platform')} subtitle={t('Dotti activity split')} />
            <VictoryChart theme={VictoryTheme.material} domainPadding={8}>
              {analytics.charts.weeklyMessagesByPlatform.map(dataset => (
                <VictoryLine
                  key={dataset.platform}
                  data={dataset.series.map(point => ({ x: point.label, y: point.value }))}
                  style={{
                    data: { stroke: platformColors[dataset.platform], strokeWidth: 2 }
                  }}
                />
              ))}
              <VictoryLegend
                x={30}
                y={0}
                gutter={16}
                orientation="horizontal"
                style={{ labels: { fill: colors.subtext, fontSize: 10 } }}
                data={analytics.charts.weeklyMessagesByPlatform.map(dataset => ({
                  name: dataset.platform.toUpperCase(),
                  symbol: { fill: platformColors[dataset.platform] }
                }))}
              />
            </VictoryChart>
          </View>

          <View style={styles.row}>
            <View style={[styles.card, styles.rowCard]}>
              <SectionHeader title={t('Leads by Platform')} />
              <VictoryChart theme={VictoryTheme.material} domainPadding={15}>
                <VictoryBar
                  data={analytics.charts.leadsByPlatform.map(point => ({ x: point.label.toUpperCase(), y: point.value }))}
                  style={{
                    data: {
                      fill: ({ datum }) => platformColors[datum.x.toLowerCase() as PlatformName] ?? colors.accent
                    }
                  }}
                />
              </VictoryChart>
            </View>
            <View style={[styles.card, styles.rowCard]}>
              <SectionHeader title={t('Category Breakdown')} />
              <VictoryPie
                innerRadius={55}
                data={analytics.categoryBreakdown.map(point => ({ x: point.label, y: point.value }))}
                colorScale={['#7C83FD', '#96BAFF', '#7DEDFF', '#88C0D0']}
                style={{ labels: { fill: colors.text, fontSize: 12 } }}
                labels={({ datum }) => `${datum.x}\n${Math.round(datum.y)}`}
              />
            </View>
          </View>

          <View style={styles.card}>
            <SectionHeader title={t('Platform Signals')} subtitle={t('Response time - sentiment - conversion')} />
            <View>{analytics.platformMetrics.map(renderPlatformMetric)}</View>
          </View>

          <View style={styles.card}>
            <SectionHeader title={t('Conversion Trend')} subtitle={t('New leads captured per day')} />
            <VictoryChart theme={VictoryTheme.material} domainPadding={10}>
              <VictoryLine
                interpolation="monotoneX"
                style={{ data: { stroke: colors.success, strokeWidth: 3 } }}
                data={leadInsights.conversionTrend.map(point => ({ x: point.label, y: point.value }))}
              />
            </VictoryChart>
          </View>

          <View style={styles.row}>
            <View style={[styles.card, styles.rowCard]}>
              <SectionHeader title={t('Intent Breakdown')} />
              <VictoryPie
                innerRadius={55}
                data={leadInsights.intentBreakdown.map(point => ({ x: point.label, y: point.value }))}
                colorScale={['#5E81AC', '#81A1C1', '#88C0D0', '#EBCB8B']}
                style={{ labels: { fill: colors.text, fontSize: 12 } }}
                labels={({ datum }) => `${datum.x}\n${Math.round(datum.y)}`}
              />
            </View>
            <View style={[styles.card, styles.rowCard]}>
              <SectionHeader title={t('Response Mix')} />
              <VictoryPie
                innerRadius={55}
                data={leadInsights.responseMix.map(point => ({ x: point.label, y: point.value }))}
                colorScale={['#F7B32B', '#F78154', '#5BC0EB', '#9BC53D', '#E55934']}
                style={{ labels: { fill: colors.text, fontSize: 12 } }}
                labels={({ datum }) => `${datum.x}\n${Math.round(datum.y)}`}
              />
            </View>
          </View>

          <View style={styles.card}>
            <SectionHeader title={t('Follow-Up Performance')} subtitle={t('Sequencer + outreach snapshot')} />
            <View style={styles.metricsRow}>
              <View style={styles.metricBlock}>
                <Text style={styles.metricLabel}>{t('Follow-ups Sent')}</Text>
                <Text style={styles.metricValue}>{leadInsights.followUp.sent}</Text>
                <Text style={styles.metricHint}>
                  {t('Pending {{count}} | Success {{rate}}%', {
                    count: leadInsights.followUp.pending,
                    rate: Math.round(leadInsights.followUp.successRate * 100)
                  })}
                </Text>
              </View>
              <View style={styles.metricBlock}>
                <Text style={styles.metricLabel}>{t('Outreach')}</Text>
                <Text style={styles.metricValue}>{leadInsights.outreach.sent}</Text>
                <Text style={styles.metricHint}>
                  {t('Replies {{count}} | {{rate}}% reply rate', {
                    count: leadInsights.outreach.replies,
                    rate: Math.round(leadInsights.outreach.replyRate * 100)
                  })}
                </Text>
              </View>
              <View style={[styles.metricBlock, styles.metricBlockLast]}>
                <Text style={styles.metricLabel}>{t('Bookings')}</Text>
                <Text style={styles.metricValue}>{leadInsights.roi.bookings}</Text>
                <Text style={styles.metricHint}>
                  {t('Learning Eff. {{rate}}%', {
                    rate: (leadInsights.roi.learningEfficiency * 100).toFixed(0)
                  })}
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.card}>
            <SectionHeader title={t('Top Conversations')} subtitle={t('Latest multi-channel DMs')} />
            {topConversations.length === 0 ? (
              <Text style={styles.empty}>{t('Conversations will appear once the unified webhook receives traffic.')}</Text>
            ) : (
              topConversations.map(convo => (
                <View key={convo.conversationId} style={styles.convo}>
                  <Text style={styles.convoTitle}>
                    {convo.meta.name ?? convo.channel_user_id} | {convo.platform.toUpperCase()}
                  </Text>
                  <Text style={styles.convoMeta}>
                    {convo.intent_category} | {t('Sentiment')} {convo.sentiment_score.toFixed(1)} |{' '}
                    {new Date(convo.created_at).toLocaleString()}
                  </Text>
                  {convo.messages.slice(0, 2).map(message => (
                    <Text key={message.timestamp} style={styles.message}>
                      <Text style={styles.messageRole}>
                        {message.role === 'assistant' ? t('Dotti') : t('Client')}:{' '}
                      </Text>
                      {message.content}
                    </Text>
                  ))}
                </View>
              ))
            )}
          </View>
        </>
      )}
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
    paddingBottom: 120
  },
  sectionHeader: {
    marginBottom: 12
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '700'
  },
  sectionSubtitle: {
    color: colors.subtext,
    marginTop: 4
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between'
  },
  summaryCard: {
    width: '48%',
    backgroundColor: colors.backgroundAlt,
    borderRadius: 18,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: colors.border
  },
  summaryLabel: {
    color: colors.subtext,
    fontSize: 12,
    letterSpacing: 0.6,
    textTransform: 'uppercase'
  },
  summaryValue: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '700',
    marginTop: 6
  },
  loader: {
    marginVertical: 36
  },
  card: {
    backgroundColor: colors.backgroundAlt,
    borderRadius: 24,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: 18
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between'
  },
  rowCard: {
    width: '48%'
  },
  platformCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    marginBottom: 12
  },
  platformName: {
    color: colors.subtext,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.8
  },
  platformValue: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '700',
    marginTop: 4
  },
  platformDetail: {
    color: colors.subtext,
    fontSize: 12,
    marginTop: 4
  },
  metricsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between'
  },
  metricBlock: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 12,
    marginRight: 12
  },
  metricBlockLast: {
    marginRight: 0
  },
  metricLabel: {
    color: colors.subtext,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.6
  },
  metricValue: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '700',
    marginTop: 6
  },
  metricHint: {
    color: colors.subtext,
    fontSize: 12,
    marginTop: 4
  },
  outboundRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12
  },
  miniStat: {
    flexBasis: '47%',
    backgroundColor: colors.background,
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border
  },
  miniLabel: {
    color: colors.subtext,
    fontSize: 12,
    textTransform: 'uppercase'
  },
  miniValue: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '700',
    marginTop: 4
  },
  empty: {
    color: colors.subtext,
    fontStyle: 'italic'
  },
  socialCard: {
    backgroundColor: colors.backgroundAlt,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    marginBottom: 16
  },
  socialValue: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '700',
    marginTop: 6
  },
  convo: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 12,
    marginTop: 12
  },
  convoTitle: {
    color: colors.text,
    fontWeight: '700'
  },
  convoMeta: {
    color: colors.subtext,
    fontSize: 12,
    marginBottom: 8
  },
  message: {
    color: colors.text,
    marginBottom: 4
  },
  messageRole: {
    fontWeight: '700'
  }
});

const MiniStat: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <View style={styles.miniStat}>
    <Text style={styles.miniLabel}>{label}</Text>
    <Text style={styles.miniValue}>{value}</Text>
  </View>
);
