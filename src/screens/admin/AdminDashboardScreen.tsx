import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as VictoryNative from 'victory-native';
import { colors } from '@constants/colors';
import { DMCard } from '@components/DMCard';
import { useAuth } from '@context/AuthContext';
import { useI18n } from '@context/I18nContext';
import {
  fetchAdminLiveSocial,
  fetchAdminMetrics,
  type AdminLiveSocialAccount,
  type AdminMetrics,
} from '@services/admin/metricsService';
import {
  fetchComplianceReports,
  runComplianceIssueNow,
  runComplianceCheck,
  runGlobalAutomationNow,
  type ComplianceReport,
  type ComplianceState,
} from '@services/admin/complianceService';
import { peekCachedValue, writeCachedValue } from '@services/localCache';

const VictoryAxis = (VictoryNative as any).VictoryAxis as React.ComponentType<any>;
const VictoryBar = (VictoryNative as any).VictoryBar as React.ComponentType<any>;
const VictoryChart = (VictoryNative as any).VictoryChart as React.ComponentType<any>;
const VictoryLine = (VictoryNative as any).VictoryLine as React.ComponentType<any>;
const VictoryTheme = (VictoryNative as any).VictoryTheme;

const ADMIN_EMAILS = ['brasioxirin@gmail.com'];
const ADMIN_METRICS_CACHE_KEY = 'dott.admin.metrics.v1';
const ADMIN_METRICS_CACHE_MAX_AGE_MS = 1000 * 60 * 20;

const emptyMetrics: AdminMetrics = {
  summary: {
    totalClients: 0,
    activeSessions: 0,
    newSignupsThisWeek: 0,
    connectedClients: 0,
  },
  clients: [],
  activeClients: [],
  packageBreakdown: [],
  packageGrowth: [],
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

const emptyComplianceState: ComplianceState = {
  lastCheckAt: null,
  lastAlertAt: null,
  lastIssueCount: 0,
  lastRemediatedCount: 0,
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

const normalizeLower = (value: unknown) => String(value ?? '').toLowerCase();

const knownAccountNames: Record<string, string> = {
  '1zvY9nNyXMcfxdPQEyx0bIdK7r53': 'Bwin / Ball Analytics',
  tCE1FQ1cOFgdupOXP23mPUMQRAz1: 'SheCare Doctor',
  '80bYIeiuukNFtUvXTUobXmfC7pu1': 'Dott HR',
  cMPZQccGggbhZe9dbvtxFmBehP02: 'Dott Media',
  LVR7p3WzdFM51ds92Kacf6S40og2: 'Dott Energy',
  acmVetCcOiTHeGk5D7eDYieamDF3: 'Car Marketplace',
  D1iNgjLKNRaQhH35M0NmGfw1LVD2: 'Staysphere',
  vzdH1DnfFLVjlY8bBgC26WACmmw2: 'Gamers 4 Life',
};

export const AdminDashboardScreen: React.FC = () => {
  const { state } = useAuth();
  const { t } = useI18n();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const [metrics, setMetrics] = useState<AdminMetrics>(
    () => peekCachedValue<AdminMetrics>(ADMIN_METRICS_CACHE_KEY, ADMIN_METRICS_CACHE_MAX_AGE_MS) ?? emptyMetrics,
  );
  const [hasCachedMetrics, setHasCachedMetrics] = useState(
    () => Boolean(peekCachedValue<AdminMetrics>(ADMIN_METRICS_CACHE_KEY, ADMIN_METRICS_CACHE_MAX_AGE_MS)),
  );
  const [complianceReports, setComplianceReports] = useState<ComplianceReport[]>([]);
  const [complianceState, setComplianceState] = useState<ComplianceState>(emptyComplianceState);
  const [liveSocialRows, setLiveSocialRows] = useState<AdminLiveSocialAccount[]>([]);
  const [liveSocialUpdatedAt, setLiveSocialUpdatedAt] = useState('');
  const [expandedLiveSocialUserId, setExpandedLiveSocialUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [liveSocialLoading, setLiveSocialLoading] = useState(false);
  const [complianceLoading, setComplianceLoading] = useState(false);
  const [globalRunLoading, setGlobalRunLoading] = useState(false);
  const [manualRunKey, setManualRunKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [liveSocialError, setLiveSocialError] = useState<string | null>(null);
  const [complianceError, setComplianceError] = useState<string | null>(null);
  const [showTotalClients, setShowTotalClients] = useState(false);
  const [showActiveClients, setShowActiveClients] = useState(false);

  const isAdminUser = useMemo(() => {
    const email = normalizeLower(state.user?.email);
    return ADMIN_EMAILS.includes(email) || Boolean((state.user as any)?.isAdmin);
  }, [state.user]);

  const refresh = useCallback(async () => {
    if (!hasCachedMetrics) {
      setLoading(true);
    }
    setError(null);
    try {
      const payload = await fetchAdminMetrics();
      setMetrics(payload);
      setHasCachedMetrics(true);
      void writeCachedValue(ADMIN_METRICS_CACHE_KEY, payload);
    } catch (err: any) {
      setError(err?.message ?? t('Unable to load admin metrics.'));
    } finally {
      setLoading(false);
    }

    try {
      setComplianceError(null);
      const compliancePayload = await fetchComplianceReports();
      setComplianceReports(compliancePayload.reports);
      setComplianceState(compliancePayload.state);
    } catch (err: any) {
      setComplianceError(err?.message ?? t('Unable to load compliance reports.'));
    }
  }, [hasCachedMetrics, t]);

  const runCompliance = useCallback(async () => {
    setComplianceLoading(true);
    setComplianceError(null);
    try {
      await runComplianceCheck();
      const payload = await fetchComplianceReports();
      setComplianceReports(payload.reports);
      setComplianceState(payload.state);
    } catch (err: any) {
      setComplianceError(err?.message ?? t('Unable to run compliance check.'));
    } finally {
      setComplianceLoading(false);
    }
  }, [t]);

  const refreshCompliance = useCallback(async () => {
    const payload = await fetchComplianceReports();
    setComplianceReports(payload.reports);
    setComplianceState(payload.state);
  }, []);

  const refreshLiveSocial = useCallback(async () => {
    setLiveSocialLoading(true);
    setLiveSocialError(null);
    try {
      const payload = await fetchAdminLiveSocial(720);
      const rows = payload.rows ?? [];
      setLiveSocialRows(rows);
      setLiveSocialUpdatedAt(payload.generatedAt ?? '');
      setExpandedLiveSocialUserId(current => (current && rows.some(row => row.userId === current) ? current : null));
    } catch (err: any) {
      setLiveSocialError(err?.message ?? t('Unable to load live social stats.'));
    } finally {
      setLiveSocialLoading(false);
    }
  }, [t]);

  const runGlobalNow = useCallback(async () => {
    setGlobalRunLoading(true);
    setComplianceError(null);
    try {
      await runGlobalAutomationNow();
      await Promise.all([refreshCompliance(), refreshLiveSocial()]);
    } catch (err: any) {
      setComplianceError(err?.message ?? t('Unable to run global automation now.'));
    } finally {
      setGlobalRunLoading(false);
    }
  }, [refreshCompliance, refreshLiveSocial, t]);

  const runIssueNow = useCallback(async (issue: ComplianceReport['issues'][number], key: string) => {
    setManualRunKey(key);
    setComplianceError(null);
    try {
      await runComplianceIssueNow(issue);
      await refreshCompliance();
    } catch (err: any) {
      setComplianceError(err?.message ?? t('Unable to rerun this issue.'));
    } finally {
      setManualRunKey(null);
    }
  }, [refreshCompliance, t]);

  useEffect(() => {
    if (!isAdminUser) return;
    void refresh();
    const interval = setInterval(refresh, 30000);
    return () => clearInterval(interval);
  }, [isAdminUser, refresh]);

  useEffect(() => {
    if (!isAdminUser) return;
    void refreshLiveSocial();
    const interval = setInterval(refreshLiveSocial, 120000);
    return () => clearInterval(interval);
  }, [isAdminUser, refreshLiveSocial]);

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
  const packageBreakdown = metrics.packageBreakdown ?? [];
  const packageGrowthRows = metrics.packageGrowth ?? [];
  const packageGrowthSeries = packageBreakdown
    .filter(pkg => pkg.total > 0)
    .slice(0, 5)
    .map(pkg => ({
      packageId: pkg.packageId,
      packageName: pkg.packageName,
      total: pkg.total,
      data: packageGrowthRows.length
        ? packageGrowthRows.map(point => ({ x: formatShortDate(String(point.date)), y: Number(point[pkg.packageId] ?? 0) }))
        : [{ x: t('Now'), y: pkg.total }],
    }));

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
  const latestCompliance = complianceReports[0];
  const criticalIssues = latestCompliance?.issues.filter(issue => issue.severity === 'critical').length ?? 0;
  const warningIssues = latestCompliance?.issues.filter(issue => issue.severity !== 'critical').length ?? 0;
  const latestIssues = latestCompliance?.issues.slice(0, 8) ?? [];
  const formatNumber = (value: unknown) => {
    const numeric = Number(value ?? 0);
    return Number.isFinite(numeric) ? numeric.toLocaleString() : '0';
  };
  const liveSocialTotals = liveSocialRows.reduce(
    (acc, row) => {
      acc.views += Number(row.stats?.summary.views ?? 0);
      acc.interactions += Number(row.stats?.summary.interactions ?? 0);
      acc.conversions += Number(row.stats?.summary.conversions ?? 0);
      return acc;
    },
    { views: 0, interactions: 0, conversions: 0 },
  );
  const loadedLiveSocialAccounts = liveSocialRows.filter(row => row.status === 'ok').length;

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
        title={t('Compliance Watchdog')}
        subtitle={t('Posting schedule health, repair actions, and current alerts')}
        style={styles.cardShadow}
      >
        <View style={styles.complianceHeader}>
          <View style={styles.complianceSummary}>
            <StatCard label={t('Latest issues')} value={complianceState.lastIssueCount} />
            <StatCard label={t('Repaired accounts')} value={complianceState.lastRemediatedCount} />
          </View>
          <View style={styles.complianceButtonGroup}>
            <Pressable
              accessibilityRole="button"
              onPress={runCompliance}
              disabled={complianceLoading}
              style={({ pressed }) => [
                styles.complianceButton,
                pressed && !complianceLoading ? styles.complianceButtonPressed : null,
                complianceLoading ? styles.complianceButtonDisabled : null,
              ]}
            >
              <Text style={styles.complianceButtonText}>
                {complianceLoading ? t('Running...') : t('Run check')}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={runGlobalNow}
              disabled={globalRunLoading}
              style={({ pressed }) => [
                styles.complianceButton,
                styles.globalRunButton,
                pressed && !globalRunLoading ? styles.complianceButtonPressed : null,
                globalRunLoading ? styles.complianceButtonDisabled : null,
              ]}
            >
              <Text style={styles.complianceButtonText}>
                {globalRunLoading ? t('Running...') : t('Global Run')}
              </Text>
            </Pressable>
          </View>
        </View>
        {complianceError ? <Text style={styles.errorText}>{complianceError}</Text> : null}
        <View style={styles.complianceMetaGrid}>
          <View style={styles.complianceMeta}>
            <Text style={styles.complianceMetaLabel}>{t('Last check')}</Text>
            <Text style={styles.complianceMetaValue}>{complianceState.lastCheckAt ? formatTime(complianceState.lastCheckAt) : t('Never')}</Text>
          </View>
          <View style={styles.complianceMeta}>
            <Text style={styles.complianceMetaLabel}>{t('Last report')}</Text>
            <Text style={styles.complianceMetaValue}>{latestCompliance?.createdAt ? formatTime(latestCompliance.createdAt) : t('None')}</Text>
          </View>
          <View style={styles.complianceMeta}>
            <Text style={styles.complianceMetaLabel}>{t('Critical')}</Text>
            <Text style={[styles.complianceMetaValue, criticalIssues > 0 ? styles.dangerText : null]}>{criticalIssues}</Text>
          </View>
          <View style={styles.complianceMeta}>
            <Text style={styles.complianceMetaLabel}>{t('Warnings')}</Text>
            <Text style={[styles.complianceMetaValue, warningIssues > 0 ? styles.warningText : null]}>{warningIssues}</Text>
          </View>
        </View>
        {!latestCompliance ? (
          <Text style={styles.emptyText}>{t('No watchdog reports have been written yet.')}</Text>
        ) : latestIssues.length === 0 ? (
          <Text style={styles.emptyText}>{t('The latest watchdog report has no issues.')}</Text>
        ) : (
          latestIssues.map((issue, index) => {
            const issueKey = `${latestCompliance.id}-${issue.userId}-${issue.channel}-${index}`;
            return (
            <View key={issueKey} style={styles.complianceIssueRow}>
              <View
                style={[
                  styles.complianceSeverity,
                  issue.severity === 'critical' ? styles.complianceSeverityCritical : styles.complianceSeverityWarning,
                ]}
              />
              <View style={styles.complianceIssueBody}>
                <View style={styles.complianceIssueTitleRow}>
                  <Text style={styles.complianceIssueTitle}>{issue.account}</Text>
                  <Text style={styles.complianceIssueChannel}>{issue.channel}</Text>
                </View>
                <Text style={styles.complianceIssueReason}>{issue.reason}</Text>
                <Text style={styles.complianceIssueAction}>{issue.action}</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={() => runIssueNow(issue, issueKey)}
                disabled={manualRunKey === issueKey}
                style={({ pressed }) => [
                  styles.manualRunButton,
                  pressed && manualRunKey !== issueKey ? styles.complianceButtonPressed : null,
                  manualRunKey === issueKey ? styles.complianceButtonDisabled : null,
                ]}
              >
                <Text style={styles.manualRunButtonText}>
                  {manualRunKey === issueKey ? t('Running') : t('Manual Run')}
                </Text>
              </Pressable>
            </View>
          );
          })
        )}
      </DMCard>

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
        <View style={styles.clientDropdownWrap}>
          <Pressable
            accessibilityRole="button"
            onPress={() => setShowTotalClients(value => !value)}
            style={({ pressed }) => [styles.dropdownToggle, pressed ? styles.dropdownTogglePressed : null]}
          >
            <Text style={styles.dropdownToggleText}>{t('Total clients list')}</Text>
            <Text style={styles.dropdownToggleMeta}>{metrics.clients.length}</Text>
          </Pressable>
          {showTotalClients ? (
            <View style={styles.clientList}>
              {metrics.clients.length === 0 ? (
                <Text style={styles.emptyText}>{t('No clients found yet.')}</Text>
              ) : (
                metrics.clients.map(client => (
                  <View key={client.userId} style={styles.clientListRow}>
                    <View style={styles.clientListIdentity}>
                      <Text style={styles.accountName}>{client.name || client.email || client.userId}</Text>
                      <Text style={styles.feedTime}>{client.email || client.userId}</Text>
                    </View>
                    <Text style={styles.packagePill}>{client.packageName}</Text>
                  </View>
                ))
              )}
            </View>
          ) : null}

          <Pressable
            accessibilityRole="button"
            onPress={() => setShowActiveClients(value => !value)}
            style={({ pressed }) => [styles.dropdownToggle, pressed ? styles.dropdownTogglePressed : null]}
          >
            <Text style={styles.dropdownToggleText}>{t('Active clients list')}</Text>
            <Text style={styles.dropdownToggleMeta}>{metrics.activeClients.length}</Text>
          </Pressable>
          {showActiveClients ? (
            <View style={styles.clientList}>
              {metrics.activeClients.length === 0 ? (
                <Text style={styles.emptyText}>{t('No clients have been active in the last 24 hours.')}</Text>
              ) : (
                metrics.activeClients.map(client => (
                  <View key={client.userId} style={styles.clientListRow}>
                    <View style={styles.clientListIdentity}>
                      <Text style={styles.accountName}>{client.name || client.email || client.userId}</Text>
                      <Text style={styles.feedTime}>{client.email || client.userId}</Text>
                    </View>
                    <Text style={styles.packagePill}>{client.packageName}</Text>
                  </View>
                ))
              )}
            </View>
          ) : null}
        </View>
      </DMCard>

      <DMCard
        title={t('Packages & Growth')}
        subtitle={t('Clients per package and package adoption over time')}
        style={styles.cardShadow}
      >
        <View style={styles.packageGrid}>
          {packageBreakdown.map(pkg => (
            <View key={pkg.packageId} style={styles.packageCard}>
              <Text style={styles.statLabel}>{pkg.packageName}</Text>
              <Text style={styles.statValue}>{pkg.total}</Text>
              <Text style={styles.statHint}>{t('{{count}} active', { count: pkg.active })}</Text>
            </View>
          ))}
        </View>
        <SectionHeader title={t('Package growth')} subtitle={t('Cumulative users by package')} />
        {packageGrowthSeries.length === 0 ? (
          <Text style={styles.emptyText}>{t('Package growth appears once clients are loaded.')}</Text>
        ) : (
          <>
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
              {packageGrowthSeries.map((pkg, index) => (
                <VictoryLine
                  key={pkg.packageId}
                  data={pkg.data}
                  interpolation="monotoneX"
                  style={{
                    data: {
                      stroke: ['#0EA5E9', '#22C55E', '#F59E0B', '#EC4899', '#8B5CF6'][index % 5],
                      strokeWidth: 3,
                    },
                  }}
                />
              ))}
            </VictoryChart>
            <View style={styles.packageLegend}>
              {packageGrowthSeries.map((pkg, index) => (
                <View key={pkg.packageId} style={styles.packageLegendItem}>
                  <View style={[styles.packageLegendDot, { backgroundColor: ['#0EA5E9', '#22C55E', '#F59E0B', '#EC4899', '#8B5CF6'][index % 5] }]} />
                  <Text style={styles.feedTime}>{pkg.packageName}</Text>
                </View>
              ))}
            </View>
          </>
        )}
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
                fill: ({ datum }: { datum: any }) => datum.color ?? colors.accent,
              },
            }}
            barWidth={16}
          />
        </VictoryChart>
      </DMCard>

      <DMCard
        title={t('Live Account Social Stats')}
        subtitle={liveSocialLoading && !liveSocialRows.length ? t('Pulling live Meta stats...') : t('Last 30 days from connected accounts')}
        style={styles.cardShadow}
      >
        {liveSocialError ? <Text style={styles.errorText}>{liveSocialError}</Text> : null}
        <View style={styles.liveSocialSummaryLine}>
          <Text style={styles.liveSocialSummaryText}>
            {t('{{accounts}} accounts live', { accounts: loadedLiveSocialAccounts })} | {formatNumber(liveSocialTotals.views)} {t('views')} |{' '}
            {formatNumber(liveSocialTotals.interactions)} {t('interactions')} | {formatNumber(liveSocialTotals.conversions)} {t('conversions')}
          </Text>
          {liveSocialLoading ? <ActivityIndicator color={colors.accent} /> : null}
        </View>
        {liveSocialRows.length === 0 ? (
          <Text style={styles.emptyText}>{t('No live account stats loaded yet.')}</Text>
        ) : (
          liveSocialRows.map(row => {
            const stats = row.stats;
            const isExpanded = expandedLiveSocialUserId === row.userId;
            const platforms = stats?.platforms;
            const channelParts = [
              platforms?.facebook?.connected
                ? `FB ${formatNumber(platforms.facebook.views)} views / ${formatNumber(platforms.facebook.interactions)} int.`
                : '',
              platforms?.instagram?.connected
                ? `IG ${formatNumber(platforms.instagram.views)} views / ${formatNumber(platforms.instagram.interactions)} int.`
                : '',
              platforms?.threads?.connected
                ? `Threads ${formatNumber(platforms.threads.views)} views / ${formatNumber(platforms.threads.interactions)} int.`
                : '',
              platforms?.linkedin?.connected
                ? `LinkedIn ${formatNumber(platforms.linkedin.views)} views / ${formatNumber(platforms.linkedin.interactions)} int.`
                : '',
              platforms?.x?.connected
                ? `X ${formatNumber(platforms.x.views)} views / ${formatNumber(platforms.x.interactions)} int.`
                : '',
            ].filter(Boolean);
            return (
              <Pressable
                key={row.userId}
                style={styles.liveSocialAccountRow}
                onPress={() => setExpandedLiveSocialUserId(current => (current === row.userId ? null : row.userId))}
              >
                <View style={styles.liveSocialAccountHeader}>
                  <View style={styles.liveSocialAccountNameWrap}>
                    <Text style={styles.accountName}>{row.label}</Text>
                    <Text style={styles.feedTime}>{row.email ?? row.scopeId ?? row.userId}</Text>
                  </View>
                  {stats ? (
                    <Text style={styles.liveSocialCompactStats}>
                      {formatNumber(stats.summary.views)} {t('views')} | {formatNumber(stats.summary.interactions)} {t('int.')} |{' '}
                      {Number(stats.summary.engagementRate ?? 0).toFixed(2)}%
                    </Text>
                  ) : null}
                  <Text style={[styles.liveSocialStatus, row.status === 'ok' ? styles.liveSocialStatusOk : styles.liveSocialStatusError]}>
                    {row.status === 'ok' ? t('Live') : t('Error')}
                  </Text>
                </View>
                {stats && isExpanded ? (
                  <>
                    <View style={styles.liveSocialMetricGrid}>
                      <View style={styles.liveSocialMetric}>
                        <Text style={styles.statLabel}>{t('Views')}</Text>
                        <Text style={styles.liveSocialMetricValue}>{formatNumber(stats.summary.views)}</Text>
                      </View>
                      <View style={styles.liveSocialMetric}>
                        <Text style={styles.statLabel}>{t('Interactions')}</Text>
                        <Text style={styles.liveSocialMetricValue}>{formatNumber(stats.summary.interactions)}</Text>
                      </View>
                      <View style={styles.liveSocialMetric}>
                        <Text style={styles.statLabel}>{t('Engagement')}</Text>
                        <Text style={styles.liveSocialMetricValue}>{Number(stats.summary.engagementRate ?? 0).toFixed(2)}%</Text>
                      </View>
                    </View>
                    <Text style={styles.liveSocialChannels}>{channelParts.length ? channelParts.join(' | ') : t('No connected live channels reported.')}</Text>
                  </>
                ) : null}
                {!stats ? (
                  <Text style={styles.errorText}>{row.error ?? t('Unable to load this account.')}</Text>
                ) : null}
              </Pressable>
            );
          })
        )}
        <Text style={styles.feedTime}>
          {liveSocialUpdatedAt ? `${t('Updated')} ${formatTime(liveSocialUpdatedAt)}` : t('Waiting for live refresh')}
        </Text>
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
                  <Text style={styles.accountName}>
                    {account.name ?? knownAccountNames[account.userId] ?? account.email ?? account.userId}
                  </Text>
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
  clientDropdownWrap: {
    marginTop: 6,
  },
  dropdownToggle: {
    minHeight: 46,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  dropdownTogglePressed: {
    opacity: 0.82,
  },
  dropdownToggleText: {
    color: colors.text,
    fontWeight: '700',
  },
  dropdownToggleMeta: {
    minWidth: 34,
    textAlign: 'center',
    color: colors.text,
    fontWeight: '800',
    backgroundColor: colors.backgroundAlt,
    borderRadius: 999,
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  clientList: {
    borderWidth: 1,
    borderColor: colors.border,
    borderTopWidth: 0,
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
    padding: 10,
    backgroundColor: colors.backgroundAlt,
  },
  clientListRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  clientListIdentity: {
    flex: 1,
    minWidth: 0,
  },
  packagePill: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: '800',
    backgroundColor: 'rgba(14,165,233,0.12)',
    borderRadius: 999,
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  packageGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  packageCard: {
    width: '48%',
    minHeight: 92,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.backgroundAlt,
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
  },
  packageLegend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 2,
  },
  packageLegendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  packageLegendDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
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
  liveSocialSummaryLine: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
    backgroundColor: colors.backgroundAlt,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  liveSocialSummaryText: {
    flex: 1,
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
  },
  liveSocialAccountRow: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
    backgroundColor: colors.background,
  },
  liveSocialAccountHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
  },
  liveSocialAccountNameWrap: {
    flex: 1,
  },
  liveSocialCompactStats: {
    color: colors.subtext,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 3,
    textAlign: 'right',
  },
  liveSocialStatus: {
    fontSize: 11,
    fontWeight: '700',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: 'hidden',
  },
  liveSocialStatusOk: {
    color: colors.success,
    backgroundColor: 'rgba(34,197,94,0.12)',
  },
  liveSocialStatusError: {
    color: colors.danger,
    backgroundColor: 'rgba(239,68,68,0.12)',
  },
  liveSocialMetricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  liveSocialMetric: {
    flex: 1,
    minWidth: 110,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 10,
    backgroundColor: colors.backgroundAlt,
  },
  liveSocialMetricValue: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
    marginTop: 4,
  },
  liveSocialChannels: {
    color: colors.subtext,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 10,
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
  dangerText: {
    color: colors.danger,
  },
  warningText: {
    color: colors.warning,
  },
  complianceHeader: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
  },
  complianceSummary: {
    flex: 1,
    minWidth: 260,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  complianceButtonGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'flex-end',
  },
  complianceButton: {
    minWidth: 120,
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  complianceButtonPressed: {
    opacity: 0.86,
  },
  complianceButtonDisabled: {
    opacity: 0.5,
  },
  globalRunButton: {
    backgroundColor: colors.success,
  },
  complianceButtonText: {
    color: colors.text,
    fontWeight: '800',
  },
  complianceMetaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  complianceMeta: {
    width: '48%',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.backgroundAlt,
    borderRadius: 12,
    padding: 10,
    marginBottom: 10,
  },
  complianceMetaLabel: {
    color: colors.subtext,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  complianceMetaValue: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    marginTop: 4,
  },
  complianceIssueRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 12,
    marginTop: 12,
  },
  complianceSeverity: {
    width: 6,
    borderRadius: 4,
    marginRight: 10,
  },
  complianceSeverityCritical: {
    backgroundColor: colors.danger,
  },
  complianceSeverityWarning: {
    backgroundColor: colors.warning,
  },
  complianceIssueBody: {
    flex: 1,
  },
  manualRunButton: {
    alignSelf: 'center',
    borderRadius: 8,
    backgroundColor: colors.accent,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginLeft: 10,
  },
  manualRunButtonText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '800',
  },
  complianceIssueTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
    flexWrap: 'wrap',
  },
  complianceIssueTitle: {
    color: colors.text,
    fontWeight: '800',
    flexShrink: 1,
  },
  complianceIssueChannel: {
    color: colors.subtext,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  complianceIssueReason: {
    color: colors.text,
    marginTop: 5,
    lineHeight: 19,
  },
  complianceIssueAction: {
    color: colors.subtext,
    marginTop: 4,
    fontSize: 12,
    lineHeight: 18,
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
