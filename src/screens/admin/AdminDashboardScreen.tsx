import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { VictoryAxis, VictoryBar, VictoryChart, VictoryLine, VictoryTheme } from 'victory-native';
import { colors } from '@constants/colors';
import { DMCard } from '@components/DMCard';
import { useAuth } from '@context/AuthContext';
import { useI18n } from '@context/I18nContext';
import { fetchAdminMetrics, type AdminMetrics } from '@services/admin/metricsService';

const ADMIN_EMAILS = ['brasioxirin@gmail.com'];

const emptyMetrics: AdminMetrics = {
  summary: {
    totalClients: 0,
    activeSessions: 0,
    newSignupsThisWeek: 0,
    connectedClients: 0,
  },
  signupsByDay: [],
  connectedPlatforms: {},
  topActiveAccounts: [],
  autopostSuccessRate: {},
  weeklyPostVolume: [],
  aiResponsesSent: 0,
  companyKpis: {
    totalAiMessages: 0,
    imageGenerations: 0,
    crmCampaigns: 0,
    leadConversions: 0,
  },
  liveFeed: [],
  updatedAt: '',
};

const SectionHeader: React.FC<{ title: string; subtitle?: string }> = ({ title, subtitle }) => (
  <View style={styles.sectionHeader}>
    <Text style={styles.sectionTitle}>{title}</Text>
    {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
  </View>
);

const StatCard: React.FC<{ label: string; value: string | number; hint?: string }> = ({ label, value, hint }) => (
  <View style={styles.statCard}>
    <Text style={styles.statLabel}>{label}</Text>
    <Text style={styles.statValue}>{value}</Text>
    {hint ? <Text style={styles.statHint}>{hint}</Text> : null}
  </View>
);

const ProgressBar: React.FC<{ value: number; color: string }> = ({ value, color }) => (
  <View style={styles.progressTrack}>
    <View style={[styles.progressFill, { width: `${Math.max(0, Math.min(value, 100))}%`, backgroundColor: color }]} />
  </View>
);

const formatShortDate = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return `${parsed.getMonth() + 1}/${parsed.getDate()}`;
};

const formatTime = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
};

export const AdminDashboardScreen: React.FC = () => {
  const { state } = useAuth();
  const { t } = useI18n();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const [metrics, setMetrics] = useState<AdminMetrics>(emptyMetrics);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isAdminUser = useMemo(() => {
    const email = state.user?.email?.toLowerCase() ?? '';
    return ADMIN_EMAILS.includes(email) || Boolean((state.user as any)?.isAdmin);
  }, [state.user]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchAdminMetrics();
      setMetrics(payload);
    } catch (err: any) {
      setError(err?.message ?? t('Unable to load admin metrics.'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!isAdminUser) return;
    void refresh();
    const interval = setInterval(refresh, 30000);
    return () => clearInterval(interval);
  }, [isAdminUser, refresh]);

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 500,
      useNativeDriver: true,
    }).start();
  }, [fadeAnim]);

  if (!isAdminUser) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyTitle}>{t('Admin access required')}</Text>
        <Text style={styles.emptySubtitle}>{t('Ask support to enable admin permissions for this account.')}</Text>
      </View>
    );
  }

  const signupsSeries =
    metrics.signupsByDay.length > 0
      ? metrics.signupsByDay.map(point => ({ x: formatShortDate(point.date), y: point.count }))
      : [{ x: t('Now'), y: 0 }];

  const weeklyPostsSeries =
    metrics.weeklyPostVolume.length > 0
      ? metrics.weeklyPostVolume.map(point => ({ x: formatShortDate(point.date), y: point.count }))
      : [{ x: t('Now'), y: 0 }];

  const connectedPlatforms = [
    { key: 'instagram', label: 'Instagram', color: '#F77737' },
    { key: 'facebook', label: 'Facebook', color: '#1877F2' },
    { key: 'linkedin', label: 'LinkedIn', color: '#0A66C2' },
    { key: 'twitter', label: 'X / Twitter', color: '#94A3B8' },
    { key: 'tiktok', label: 'TikTok', color: colors.text },
    { key: 'youtube', label: 'YouTube', color: '#FF0033' },
    { key: 'whatsapp', label: 'WhatsApp', color: '#22C55E' },
  ];

  const platformSeries = connectedPlatforms.map(platform => ({
    x: platform.label,
    y: metrics.connectedPlatforms?.[platform.key] ?? 0,
    color: platform.color,
  }));

  const topAccounts = metrics.topActiveAccounts.length ? metrics.topActiveAccounts : [];
  const autopostPlatforms = [
    { key: 'instagram', label: 'Instagram', color: '#F77737' },
    { key: 'instagram_story', label: 'Instagram Story', color: '#F77737' },
    { key: 'facebook', label: 'Facebook', color: '#1877F2' },
    { key: 'facebook_story', label: 'Facebook Story', color: '#1877F2' },
    { key: 'linkedin', label: 'LinkedIn', color: '#0A66C2' },
  ];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Animated.View style={[styles.heroWrap, { opacity: fadeAnim, transform: [{ translateY: fadeAnim.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }]}>
        <LinearGradient colors={[colors.accent, colors.accentSecondary]} style={styles.hero}>
          <Text style={styles.heroEyebrow}>{t('Admin control room')}</Text>
          <Text style={styles.heroTitle}>{t('Dott Media HQ')}</Text>
          <Text style={styles.heroSubtitle}>
            {t('Live client activity, autopost performance, and AI usage metrics in one view.')}
          </Text>
          <View style={styles.heroStats}>
            <View style={styles.heroStat}>
              <Text style={styles.heroStatLabel}>{t('Total clients')}</Text>
              <Text style={styles.heroStatValue}>{metrics.summary.totalClients}</Text>
            </View>
            <View style={styles.heroStat}>
              <Text style={styles.heroStatLabel}>{t('Active sessions')}</Text>
              <Text style={styles.heroStatValue}>{metrics.summary.activeSessions}</Text>
            </View>
            <View style={styles.heroStat}>
              <Text style={styles.heroStatLabel}>{t('AI responses')}</Text>
              <Text style={styles.heroStatValue}>{metrics.aiResponsesSent}</Text>
            </View>
            <View style={styles.heroStat}>
              <Text style={styles.heroStatLabel}>{t('Weekly posts')}</Text>
              <Text style={styles.heroStatValue}>
                {metrics.weeklyPostVolume.reduce((sum, item) => sum + item.count, 0)}
              </Text>
            </View>
          </View>
        </LinearGradient>
      </Animated.View>

      {loading ? <ActivityIndicator color={colors.accent} style={{ marginBottom: 16 }} /> : null}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <DMCard
        title={t('Client Accounts Overview')}
        subtitle={t('Realtime visibility into client growth and connections')}
        style={styles.cardShadow}
      >
        <View style={styles.statGrid}>
          <StatCard label={t('Total clients')} value={metrics.summary.totalClients} />
          <StatCard label={t('Active in 24h')} value={metrics.summary.activeSessions} />
          <StatCard label={t('New this week')} value={metrics.summary.newSignupsThisWeek} />
          <StatCard
            label={t('Connected accounts')}
            value={metrics.summary.connectedClients}
            hint={t('Clients with at least one social linked')}
          />
        </View>
        <SectionHeader title={t('New signups')} subtitle={t('Last 7 days')} />
        <VictoryChart theme={VictoryTheme.material} domainPadding={14}>
          <VictoryAxis
            style={{
              axis: { stroke: colors.border },
              tickLabels: { fill: colors.subtext, fontSize: 10 },
              grid: { stroke: 'transparent' },
            }}
          />
          <VictoryAxis
            dependentAxis
            style={{
              axis: { stroke: colors.border },
              tickLabels: { fill: colors.subtext, fontSize: 10 },
              grid: { stroke: 'transparent' },
            }}
          />
          <VictoryBar
            data={signupsSeries}
            style={{ data: { fill: colors.accent } }}
            barWidth={18}
          />
        </VictoryChart>
      </DMCard>

      <DMCard
        title={t('Connected Platforms')}
        subtitle={t('How many clients are linked per channel')}
        style={styles.cardShadow}
      >
        <VictoryChart theme={VictoryTheme.material} domainPadding={14}>
          <VictoryAxis
            style={{
              axis: { stroke: colors.border },
              tickLabels: { fill: colors.subtext, fontSize: 9 },
              grid: { stroke: 'transparent' },
            }}
          />
          <VictoryAxis
            dependentAxis
            style={{
              axis: { stroke: colors.border },
              tickLabels: { fill: colors.subtext, fontSize: 10 },
              grid: { stroke: 'transparent' },
            }}
          />
          <VictoryBar
            data={platformSeries}
            style={{
              data: {
                fill: ({ datum }) => datum.color ?? colors.accent,
              },
            }}
            barWidth={16}
          />
        </VictoryChart>
      </DMCard>

      <DMCard
        title={t('Performance & Engagement')}
        subtitle={t('Autopost efficiency and most active clients')}
        style={styles.cardShadow}
      >
        <View style={styles.rowSplit}>
          <View style={styles.columnCard}>
            <SectionHeader title={t('Top active accounts')} />
            {topAccounts.length === 0 ? (
              <Text style={styles.emptyText}>{t('No recent posting activity yet.')}</Text>
            ) : (
              topAccounts.map(account => (
                <View key={account.userId} style={styles.accountRow}>
                  <Text style={styles.accountName}>{account.name ?? account.email ?? account.userId}</Text>
                  <Text style={styles.accountCount}>{t('{{count}} posts', { count: account.posts })}</Text>
                </View>
              ))
            )}
          </View>
          <View style={styles.columnCard}>
            <SectionHeader title={t('Autopost success')} subtitle={t('Instagram, Facebook, Stories, LinkedIn')} />
            {autopostPlatforms.map(platform => {
              const entry = metrics.autopostSuccessRate?.[platform.key];
              const rate = Math.round(((entry?.rate ?? 0) * 100) || 0);
              return (
                <View key={platform.key} style={styles.autopostRow}>
                  <View style={styles.autopostHeader}>
                    <Text style={styles.autopostLabel}>{platform.label}</Text>
                    <Text style={styles.autopostValue}>{rate}%</Text>
                  </View>
                  <ProgressBar value={rate} color={platform.color} />
                  <Text style={styles.autopostMeta}>
                    {t('{{posted}} posted / {{attempted}} attempts', {
                      posted: entry?.posted ?? 0,
                      attempted: entry?.attempted ?? 0,
                    })}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>
        <SectionHeader title={t('Weekly post volume')} subtitle={t('All platforms')} />
        <VictoryChart theme={VictoryTheme.material} domainPadding={10}>
          <VictoryAxis
            style={{
              axis: { stroke: colors.border },
              tickLabels: { fill: colors.subtext, fontSize: 10 },
              grid: { stroke: 'transparent' },
            }}
          />
          <VictoryAxis
            dependentAxis
            style={{
              axis: { stroke: colors.border },
              tickLabels: { fill: colors.subtext, fontSize: 10 },
              grid: { stroke: 'transparent' },
            }}
          />
          <VictoryLine
            data={weeklyPostsSeries}
            interpolation="monotoneX"
            style={{ data: { stroke: colors.success, strokeWidth: 3 } }}
          />
        </VictoryChart>
      </DMCard>

      <DMCard
        title={t('Company KPIs')}
        subtitle={t('AI usage and CRM pipeline signals')}
        style={styles.cardShadow}
      >
        <View style={styles.statGrid}>
          <StatCard label={t('AI messages sent')} value={metrics.companyKpis.totalAiMessages} />
          <StatCard label={t('Image generations')} value={metrics.companyKpis.imageGenerations} />
          <StatCard label={t('CRM campaigns')} value={metrics.companyKpis.crmCampaigns} />
          <StatCard label={t('Lead conversions')} value={metrics.companyKpis.leadConversions} />
        </View>
      </DMCard>

      <DMCard
        title={t('Live Feed')}
        subtitle={t('Logins, posts, and reply activity')}
        style={styles.cardShadow}
      >
        {metrics.liveFeed.length === 0 ? (
          <Text style={styles.emptyText}>{t('Live events will appear once activity starts flowing in.')}</Text>
        ) : (
          metrics.liveFeed.map(item => (
            <View key={item.id} style={styles.feedRow}>
              <View style={[styles.feedDot, item.type === 'post' && styles.feedDotPost, item.type === 'reply' && styles.feedDotReply]} />
              <View style={styles.feedBody}>
                <Text style={styles.feedLabel}>{item.label}</Text>
                <Text style={styles.feedTime}>{formatTime(item.timestamp)}</Text>
              </View>
            </View>
          ))
        )}
      </DMCard>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: 20,
    paddingBottom: 60,
  },
  heroWrap: {
    marginBottom: 18,
  },
  hero: {
    borderRadius: 28,
    padding: 22,
  },
  heroEyebrow: {
    color: colors.text,
    textTransform: 'uppercase',
    letterSpacing: 1.4,
    fontSize: 11,
  },
  heroTitle: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '800',
    marginTop: 6,
  },
  heroSubtitle: {
    color: colors.background,
    opacity: 0.9,
    marginTop: 6,
    lineHeight: 20,
  },
  heroStats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginTop: 16,
  },
  heroStat: {
    width: '48%',
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderRadius: 16,
    padding: 12,
    marginBottom: 12,
  },
  heroStatLabel: {
    color: colors.text,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  heroStatValue: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '700',
    marginTop: 6,
  },
  sectionHeader: {
    marginBottom: 10,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  sectionSubtitle: {
    color: colors.subtext,
    marginTop: 4,
  },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  statCard: {
    width: '48%',
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.backgroundAlt,
    marginBottom: 12,
  },
  statLabel: {
    color: colors.subtext,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  statValue: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '700',
    marginTop: 6,
  },
  statHint: {
    color: colors.subtext,
    fontSize: 11,
    marginTop: 6,
  },
  rowSplit: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 12,
    flexWrap: 'wrap',
  },
  columnCard: {
    flex: 1,
    minWidth: 260,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    padding: 12,
    backgroundColor: colors.background,
  },
  accountRow: {
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  accountName: {
    color: colors.text,
    fontWeight: '600',
  },
  accountCount: {
    color: colors.subtext,
    marginTop: 4,
    fontSize: 12,
  },
  autopostRow: {
    marginBottom: 12,
  },
  autopostHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  autopostLabel: {
    color: colors.text,
    fontWeight: '600',
  },
  autopostValue: {
    color: colors.text,
    fontWeight: '700',
  },
  autopostMeta: {
    color: colors.subtext,
    fontSize: 11,
    marginTop: 6,
  },
  progressTrack: {
    height: 6,
    borderRadius: 4,
    backgroundColor: colors.border,
    overflow: 'hidden',
    marginTop: 6,
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
  },
  feedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  feedDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.accent,
    marginRight: 10,
  },
  feedDotPost: {
    backgroundColor: colors.success,
  },
  feedDotReply: {
    backgroundColor: colors.warning,
  },
  feedBody: {
    flex: 1,
  },
  feedLabel: {
    color: colors.text,
    fontWeight: '600',
  },
  feedTime: {
    color: colors.subtext,
    fontSize: 11,
    marginTop: 4,
  },
  emptyText: {
    color: colors.subtext,
    fontStyle: 'italic',
  },
  errorText: {
    color: colors.danger,
    marginBottom: 12,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: colors.background,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '700',
  },
  emptySubtitle: {
    color: colors.subtext,
    marginTop: 8,
    textAlign: 'center',
  },
  cardShadow: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 8,
  },
});
