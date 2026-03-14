import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { VictoryAxis, VictoryBar, VictoryChart, VictoryLabel, VictoryTheme } from 'victory-native';
import { DMCard } from '@components/DMCard';
import { colors } from '@constants/colors';
import { useAuth } from '@context/AuthContext';
import { useI18n } from '@context/I18nContext';
import { buildDashboardCacheKey, readDashboardCache, writeDashboardCache } from '@services/dashboardCache';
import {
  ActivityHeatmapDaily,
  fetchAnalytics,
  DashboardAnalytics,
  fetchOrgDashboardAnalytics,
  fetchActivityHeatmap,
  fetchOutboundStats,
  fetchLiveSocialStats,
  LiveSocialStats,
  OutboundStats,
  subscribeLiveActivityHeatmap,
  subscribeOrgDashboardAnalytics,
  subscribeOutboundStats,
  subscribeAnalytics,
  resolveAnalyticsScopeId
} from '@services/analytics';

type ChartMetric = 'views' | 'interactions' | 'outbound' | 'conversions';
type ReviewRangeKey = '7d' | '14d' | '30d' | '365d';
type HeatmapGrouping = 'day' | 'month' | 'year';

const REVIEW_RANGE_OPTIONS: Array<{ key: ReviewRangeKey; label: string; shortLabel: string; days: number }> = [
  { key: '7d', label: 'Last 7 days', shortLabel: '7 days', days: 7 },
  { key: '14d', label: '2 weeks', shortLabel: '2 weeks', days: 14 },
  { key: '30d', label: '1 month', shortLabel: '1 month', days: 30 },
  { key: '365d', label: '1 year', shortLabel: '1 year', days: 365 },
];

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
  responders: 0,
  replies: 0,
  positiveReplies: 0,
  conversions: 0,
  demoBookings: 0,
  conversionRate: 0
};

const emptyLiveSocialStats: LiveSocialStats = {
  generatedAt: new Date(0).toISOString(),
  lookbackHours: 72,
  summary: {
    views: 0,
    interactions: 0,
    engagementRate: 0,
    conversions: 0,
  },
  web: {
    visitors: 0,
    interactions: 0,
    redirectClicks: 0,
    engagementRate: 0,
  },
  platforms: {
    facebook: { connected: false, views: 0, interactions: 0, engagementRate: 0, conversions: 0, postsAnalyzed: 0 },
    instagram: { connected: false, views: 0, interactions: 0, engagementRate: 0, conversions: 0, postsAnalyzed: 0 },
    threads: { connected: false, views: 0, interactions: 0, engagementRate: 0, conversions: 0, postsAnalyzed: 0 },
    x: { connected: false, views: 0, interactions: 0, engagementRate: 0, conversions: 0, postsAnalyzed: 0 },
    web: { connected: false, views: 0, interactions: 0, engagementRate: 0, conversions: 0, postsAnalyzed: 0 },
  },
};

const parseChartDate = (date: string) => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return new Date(`${date}T12:00:00`);
  }
  return new Date(date);
};

const toDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const buildDateWindow = (count: number) => {
  const days: string[] = [];
  const today = new Date();
  today.setHours(12, 0, 0, 0);

  for (let index = count - 1; index >= 0; index -= 1) {
    const current = new Date(today);
    current.setDate(today.getDate() - index);
    days.push(toDateKey(current));
  }

  return days;
};

const getHoursSinceMidnight = () => {
  const now = new Date();
  return Math.max(1, now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600);
};

const formatDateLabel = (date: string) => {
  const parsed = parseChartDate(date);
  if (!Number.isNaN(parsed.getTime())) {
    return `${parsed.getMonth() + 1}/${parsed.getDate()}`;
  }
  return date.slice(5);
};

const formatDayOfWeek = (date: string, locale?: string) => {
  const parsed = parseChartDate(date);
  if (Number.isNaN(parsed.getTime())) return 'Day';
  return parsed.toLocaleDateString(locale ?? undefined, { weekday: 'short' });
};

const formatMonthLabel = (date: string, locale?: string) => {
  const parsed = parseChartDate(date);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleDateString(locale ?? undefined, { month: 'short' });
};

const getHeatmapGrouping = (days: number): HeatmapGrouping => {
  if (days >= 365) return 'year';
  if (days >= 30) return 'month';
  return 'day';
};

const buildChartScale = (values: number[]) => {
  const maxValue = values.reduce((max, value) => Math.max(max, value), 0);
  if (maxValue <= 0) {
    return { top: 100, ticks: [0, 100] };
  }

  const step = 100;
  const top = Math.max(step, Math.ceil(maxValue / step) * step);
  const ticks = Array.from({ length: Math.ceil(top / step) + 1 }, (_, index) => index * step);
  return { top, ticks };
};

const normalizeLower = (value: unknown) => String(value ?? '').toLowerCase();

export const DashboardScreen: React.FC = () => {
  const { state } = useAuth();
  const { t, locale } = useI18n();
  const { width: viewportWidth } = useWindowDimensions();
  const orgId = (state.user as any)?.orgId ?? state.crmData?.orgId;
  const isBwinbetAccount = useMemo(() => {
    const primary = normalizeLower(state.user?.email);
    const crmEmail = normalizeLower(state.crmData?.email);
    return primary.includes('bwinbet') || crmEmail.includes('bwinbet');
  }, [state.crmData?.email, state.user?.email]);
  const analyticsScopeId = useMemo(
    () => resolveAnalyticsScopeId(state.user?.uid, orgId),
    [state.user?.uid, orgId]
  );
  const dashboardCacheKey = useMemo(
    () => buildDashboardCacheKey(state.user?.uid, analyticsScopeId),
    [state.user?.uid, analyticsScopeId],
  );
  const [analytics, setAnalytics] = useState<DashboardAnalytics>(() =>
    createEmptyAnalytics(state.crmData?.analytics)
  );
  const [loading, setLoading] = useState(false);
  const [chartMetric, setChartMetric] = useState<ChartMetric>('views');
  const [outboundStats, setOutboundStats] = useState<OutboundStats>(() => emptyOutboundStats);
  const [liveSocialStats, setLiveSocialStats] = useState<LiveSocialStats>(() => emptyLiveSocialStats);
  const [todayLiveSocialStats, setTodayLiveSocialStats] = useState<LiveSocialStats>(() => emptyLiveSocialStats);
  const [activityHeatmapRows, setActivityHeatmapRows] = useState<ActivityHeatmapDaily[]>([]);
  const [activityHeatmapRestRows, setActivityHeatmapRestRows] = useState<ActivityHeatmapDaily[]>([]);
  const [liveSocialLoading, setLiveSocialLoading] = useState(false);
  const [selectedRangeKey, setSelectedRangeKey] = useState<ReviewRangeKey>('7d');
  const [rangeMenuOpen, setRangeMenuOpen] = useState(false);
  const [cacheReady, setCacheReady] = useState(false);
  const [hasCachedSnapshot, setHasCachedSnapshot] = useState(false);
  const selectedRange = useMemo(
    () => REVIEW_RANGE_OPTIONS.find(option => option.key === selectedRangeKey) ?? REVIEW_RANGE_OPTIONS[0],
    [selectedRangeKey],
  );

  useEffect(() => {
    let active = true;
    setCacheReady(false);
    setHasCachedSnapshot(false);
    void readDashboardCache(dashboardCacheKey)
      .then(snapshot => {
        if (!active) return;
        if (snapshot) {
          setAnalytics(createEmptyAnalytics(snapshot.analytics));
          setOutboundStats(snapshot.outboundStats);
          setLiveSocialStats(snapshot.liveSocialStats);
          setTodayLiveSocialStats(snapshot.todayLiveSocialStats);
          setActivityHeatmapRows(snapshot.activityHeatmapRows);
          setActivityHeatmapRestRows(snapshot.activityHeatmapRestRows);
          setHasCachedSnapshot(true);
        }
      })
      .finally(() => {
        if (active) {
          setCacheReady(true);
        }
      });
    return () => {
      active = false;
    };
  }, [dashboardCacheKey]);

  useEffect(() => {
    if (!cacheReady || !state.user?.uid) return;
    void writeDashboardCache(dashboardCacheKey, {
      analytics,
      outboundStats,
      liveSocialStats,
      todayLiveSocialStats,
      activityHeatmapRows,
      activityHeatmapRestRows,
    });
  }, [
    activityHeatmapRestRows,
    activityHeatmapRows,
    analytics,
    cacheReady,
    dashboardCacheKey,
    liveSocialStats,
    outboundStats,
    state.user?.uid,
    todayLiveSocialStats,
  ]);

  useEffect(() => {
    let isMounted = true;
    let unsubscribe: (() => void) | null = null;
    const refreshRestAnalytics = async () => {
      if (!state.user?.uid) return false;
      try {
        const response = orgId
          ? await fetchOrgDashboardAnalytics(analyticsScopeId, state.user?.uid)
          : await fetchAnalytics(state.user.uid);
        if (response && isMounted) {
          setAnalytics(createEmptyAnalytics(response));
          return true;
        }
      } catch (error) {
        console.warn('Failed to refresh analytics', error);
      } finally {
        if (isMounted) setLoading(false);
      }
      return false;
    };

    const loadAnalytics = async () => {
      if (!state.user) return;
      if (!hasCachedSnapshot) {
        setLoading(true);
      }
      if (orgId) {
        unsubscribe =
          subscribeOrgDashboardAnalytics(
            analyticsScopeId,
            payload => {
              if (!isMounted) return;
              setAnalytics(createEmptyAnalytics(payload));
              setLoading(false);
            },
            error => {
              console.warn('Realtime org analytics failed', error);
              void refreshRestAnalytics();
            },
            state.user?.uid
          ) ?? null;

        await refreshRestAnalytics();
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
            void refreshRestAnalytics();
          },
          analyticsScopeId
        ) ?? null;

      const loaded = await refreshRestAnalytics();
      if (!loaded && !unsubscribe && isMounted && state.crmData) {
        setAnalytics(createEmptyAnalytics(state.crmData.analytics));
      }
    };
    loadAnalytics();
    return () => {
      isMounted = false;
      if (unsubscribe) unsubscribe();
    };
  }, [analyticsScopeId, hasCachedSnapshot, orgId, state.user?.uid, state.crmData]);

  useEffect(() => {
    if (!state.user?.uid) {
      setOutboundStats(emptyOutboundStats);
      return;
    }
    let mounted = true;
    let outboundUnsub: (() => void) | null = null;
    const refreshRestOutbound = async () => {
      const stats = await fetchOutboundStats(state.user?.uid, analyticsScopeId);
      if (stats && mounted) setOutboundStats(stats);
    };

    outboundUnsub =
      subscribeOutboundStats(
        analyticsScopeId,
        stats => mounted && setOutboundStats(stats),
        error => {
          console.warn('Realtime outbound stats failed', error);
          void refreshRestOutbound();
        },
        state.user?.uid
      ) ?? null;

    void refreshRestOutbound();

    return () => {
      mounted = false;
      outboundUnsub?.();
    };
  }, [analyticsScopeId, state.user?.uid]);

  useEffect(() => {
    if (!state.user?.uid) {
      setActivityHeatmapRows([]);
      setActivityHeatmapRestRows([]);
      return;
    }
    let active = true;
    let timer: ReturnType<typeof setInterval> | null = null;
    const refreshRestActivityHeatmap = async () => {
      const rows = await fetchActivityHeatmap(state.user?.uid, analyticsScopeId, selectedRange.days);
      if (!active) return;
      setActivityHeatmapRestRows(rows);
    };
    const unsubscribe =
      subscribeLiveActivityHeatmap(
        analyticsScopeId,
        rows => {
          if (!active) return;
          setActivityHeatmapRows(rows);
          if (!rows.length) {
            void refreshRestActivityHeatmap();
          }
        },
        error => {
          console.warn('Realtime activity heatmap subscription failed', error);
          if (active) {
            setActivityHeatmapRows([]);
            void refreshRestActivityHeatmap();
          }
        },
        state.user?.uid,
        selectedRange.days,
      ) ?? null;
    void refreshRestActivityHeatmap();
    timer = setInterval(() => {
      void refreshRestActivityHeatmap();
    }, 120000);
    return () => {
      active = false;
      if (timer) clearInterval(timer);
      unsubscribe?.();
    };
  }, [analyticsScopeId, selectedRange.days, state.user?.uid]);

  useEffect(() => {
    let mounted = true;
    let timer: ReturnType<typeof setInterval> | null = null;

    const refreshLiveSocial = async () => {
      if (!state.user?.uid) return;
      if (!hasCachedSnapshot) {
        setLiveSocialLoading(true);
      }
      try {
        const [rollingStats, todayStats] = await Promise.all([
          fetchLiveSocialStats(state.user.uid, analyticsScopeId, 72),
          fetchLiveSocialStats(state.user.uid, analyticsScopeId, getHoursSinceMidnight()),
        ]);
        if (mounted && rollingStats) {
          setLiveSocialStats(rollingStats);
        }
        if (mounted && todayStats) {
          setTodayLiveSocialStats(todayStats);
        }
      } finally {
        if (mounted) setLiveSocialLoading(false);
      }
    };

    if (state.user?.uid) {
      void refreshLiveSocial();
      timer = setInterval(() => {
        void refreshLiveSocial();
      }, 120000);
    }

    return () => {
      mounted = false;
      if (timer) clearInterval(timer);
    };
  }, [analyticsScopeId, hasCachedSnapshot, state.user?.uid]);

  const historySeries = useMemo(
    () => analytics.history ?? [],
    [analytics]
  );

  const formatCount = (value: number) => {
    const rounded = Number.isFinite(value) ? Math.round(value) : 0;
    return rounded.toLocaleString();
  };

  const formatAxisCount = (value: number) => {
    if (value >= 1000000) return `${(value / 1000000).toFixed(value % 1000000 === 0 ? 0 : 1)}M`;
    if (value >= 1000) return `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}K`;
    return formatCount(value);
  };

  const heroStats = [
    { label: t('Interactions'), value: formatCount(liveSocialStats.summary.interactions) },
    { label: t('Outbound'), value: formatCount(outboundStats.prospectsContacted) },
    { label: t('Views'), value: formatCount(liveSocialStats.summary.views) },
    {
      label: isBwinbetAccount ? t('Bet button clicks') : t('Conversions'),
      value: isBwinbetAccount ? formatCount(liveSocialStats.web.redirectClicks) : formatCount(outboundStats.conversions),
    }
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

  const todayDateKey = toDateKey(new Date());

  const dailyReviewStats = useMemo(() => {
    const summary = {
      views: Number(todayLiveSocialStats.summary.views ?? 0),
      interactions: Number(todayLiveSocialStats.summary.interactions ?? 0),
      outbound: 0,
      conversions: Number(todayLiveSocialStats.summary.conversions ?? 0),
      redirectClicks: Number(todayLiveSocialStats.web.redirectClicks ?? 0),
    };

    const applyHeatmapRow = (row?: Partial<ActivityHeatmapDaily>) => {
      if (!row) return;
      summary.views = Math.max(summary.views, Number(row.views ?? 0));
      summary.interactions = Math.max(summary.interactions, Number(row.interactions ?? 0));
      summary.outbound = Math.max(summary.outbound, Number(row.outbound ?? 0));
      summary.conversions = Math.max(summary.conversions, Number(row.conversions ?? 0));
    };

    applyHeatmapRow(activityHeatmapRows.find(row => row.date === todayDateKey));
    applyHeatmapRow(activityHeatmapRestRows.find(row => row.date === todayDateKey));

    const todayHistory = historySeries.find(row => row.date === todayDateKey);
    if (todayHistory) {
      summary.views = Math.max(summary.views, Number(todayHistory.leads ?? 0));
      summary.interactions = Math.max(summary.interactions, Number(todayHistory.engagement ?? 0));
      summary.outbound = Math.max(summary.outbound, Number(todayHistory.conversions ?? 0));
      summary.conversions = Math.max(summary.conversions, Number(todayHistory.conversions ?? 0));
    }

    return summary;
  }, [activityHeatmapRestRows, activityHeatmapRows, historySeries, todayDateKey, todayLiveSocialStats]);

  const handleDrilldown = (metric: ChartMetric) => {
    const dailyConversionValue = isBwinbetAccount ? dailyReviewStats.redirectClicks : dailyReviewStats.conversions;
    const metricMap: Record<ChartMetric, string> = {
      views: t('Today so far, visibility is {{value}} views across connected channels.', {
        value: formatCount(dailyReviewStats.views),
      }),
      interactions: t('Today so far, interaction volume is {{value}}. Keep content cadence consistent to sustain engagement.', {
        value: formatCount(dailyReviewStats.interactions),
      }),
      outbound: t('Today so far, outbound activity is {{value}}. Keep reply handling fast for best conversion.', {
        value: formatCount(dailyReviewStats.outbound),
      }),
      conversions: isBwinbetAccount
        ? t('Today so far, bet button clicks are at {{value}}. Keep pairing stronger CTAs with current match moments.', {
            value: formatCount(dailyConversionValue),
          })
        : t(
            'Today so far, conversions are at {{value}}. Tighten your follow-up cadence or revise offers for better results.',
            { value: formatCount(dailyConversionValue) }
          )
    };
    Alert.alert(t('Metric details'), metricMap[metric]);
  };

  const metricButtons = useMemo(
    () =>
      [
        {
          key: 'views' as const,
          label: t('Views'),
          value: formatCount(dailyReviewStats.views),
          hint: t('Today across connected channels'),
        },
        {
          key: 'interactions' as const,
          label: t('Interactions'),
          value: formatCount(dailyReviewStats.interactions),
          hint: t('Today across connected channels'),
        },
        {
          key: 'outbound' as const,
          label: t('Outbound'),
          value: formatCount(dailyReviewStats.outbound),
          hint: t('Today so far'),
        },
        {
          key: 'conversions' as const,
          label: isBwinbetAccount ? t('Bet button clicks') : t('Conversions'),
          value: formatCount(isBwinbetAccount ? dailyReviewStats.redirectClicks : dailyReviewStats.conversions),
          hint: t('Today so far'),
        },
      ],
    [dailyReviewStats, isBwinbetAccount, t]
  );

  const outboundMetrics = useMemo(
    () => [
      {
        label: t('Prospects contacted'),
        value: outboundStats.prospectsContacted.toString()
      },
      {
        label: t('People responding'),
        value: outboundStats.responders.toString(),
        hint: t('unique responders')
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

  const livePlatformRows = useMemo(
    () =>
      [
        { key: 'facebook', label: 'Facebook', ...liveSocialStats.platforms.facebook },
        { key: 'instagram', label: 'Instagram', ...liveSocialStats.platforms.instagram },
        { key: 'threads', label: 'Threads', ...liveSocialStats.platforms.threads },
        { key: 'x', label: 'X', ...liveSocialStats.platforms.x },
        { key: 'web', label: 'Web', ...liveSocialStats.platforms.web },
      ].filter(
        row =>
          row.connected ||
          row.postsAnalyzed > 0 ||
          row.views > 0 ||
          row.interactions > 0 ||
          row.conversions > 0,
      ),
    [liveSocialStats],
  );

  const channelPerformanceRows = useMemo(
    () =>
      livePlatformRows.map(row => ({
        key: row.key,
        label: row.label,
        interactions: row.interactions,
        engagementRate: row.engagementRate,
        conversions: row.conversions ?? 0,
      })),
    [livePlatformRows],
  );

  const liveUpdatedLabel = useMemo(() => {
    const parsed = new Date(liveSocialStats.generatedAt);
    if (Number.isNaN(parsed.getTime())) return t('Live data');
    return `${t('Updated')}: ${parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }, [liveSocialStats.generatedAt, t]);

  const heatmapGrouping = useMemo<HeatmapGrouping>(
    () => getHeatmapGrouping(selectedRange.days),
    [selectedRange.days],
  );

  const heatmapSeries = useMemo(
    () => {
      const liveByDate = new Map(
        activityHeatmapRows.map(day => [
          day.date,
          {
            views: Number(day.views ?? 0),
            interactions: Number(day.interactions ?? 0),
            outbound: Number(day.outbound ?? 0),
            conversions: Number(day.conversions ?? 0),
          },
        ]),
      );

      const restByDate = new Map(
        activityHeatmapRestRows.map(day => [
          day.date,
          {
            views: Number(day.views ?? 0),
            interactions: Number(day.interactions ?? 0),
            outbound: Number(day.outbound ?? 0),
            conversions: Number(day.conversions ?? 0),
          },
        ]),
      );

      const historyByDate = new Map(
        historySeries.map(day => [
          day.date,
          {
            views: Number(day.leads ?? 0),
            interactions: Number(day.engagement ?? 0),
            outbound: Number(day.conversions ?? 0),
            conversions: Number(day.conversions ?? 0),
          },
        ]),
      );

      const dailySeries = buildDateWindow(selectedRange.days).map((date, index, arr) => {
        const live = liveByDate.get(date);
        const rest = restByDate.get(date);
        const fallback = historyByDate.get(date);
        const isToday = index === arr.length - 1;
        const todayLive = isToday
          ? {
              views: Number(todayLiveSocialStats.summary.views ?? 0),
              interactions: Number(todayLiveSocialStats.summary.interactions ?? 0),
              conversions: Number(todayLiveSocialStats.summary.conversions ?? 0),
            }
          : null;
        const merged = {
          views: Math.max(
            Number(live?.views ?? 0),
            Number(rest?.views ?? 0),
            Number(fallback?.views ?? 0),
            Number(todayLive?.views ?? 0),
          ),
          interactions: Math.max(
            Number(live?.interactions ?? 0),
            Number(rest?.interactions ?? 0),
            Number(fallback?.interactions ?? 0),
            Number(todayLive?.interactions ?? 0),
          ),
          outbound: Math.max(
            Number(live?.outbound ?? 0),
            Number(rest?.outbound ?? 0),
            Number(fallback?.outbound ?? 0),
          ),
          conversions: Math.max(
            Number(live?.conversions ?? 0),
            Number(rest?.conversions ?? 0),
            Number(fallback?.conversions ?? 0),
            Number(todayLive?.conversions ?? 0),
          ),
        };

        return {
          date,
          label: isToday ? t('Today') : formatDayOfWeek(date, locale),
          isToday,
          bucketKey: date,
          value:
            chartMetric === 'views'
              ? merged.views
              : chartMetric === 'interactions'
                ? merged.interactions
                : chartMetric === 'outbound'
                  ? merged.outbound
                  : merged.conversions,
        };
      });

      if (heatmapGrouping === 'day') {
        return dailySeries;
      }

      const grouped = new Map<
        string,
        {
          date: string;
          label: string;
          isToday: boolean;
          bucketKey: string;
          value: number;
        }
      >();

      dailySeries.forEach(item => {
        const parsed = parseChartDate(item.date);
        if (Number.isNaN(parsed.getTime())) return;
        const bucketKey =
          heatmapGrouping === 'year'
            ? `${parsed.getFullYear()}`
            : `${parsed.getFullYear()}-${`${parsed.getMonth() + 1}`.padStart(2, '0')}`;
        const label =
          heatmapGrouping === 'year'
            ? `${parsed.getFullYear()}`
            : parsed.toLocaleDateString(locale ?? undefined, { month: 'short', year: 'numeric' });
        const existing = grouped.get(bucketKey);
        if (existing) {
          existing.value += item.value;
          existing.isToday = existing.isToday || item.isToday;
          existing.date = item.date;
          return;
        }
        grouped.set(bucketKey, {
          date: item.date,
          label,
          isToday: item.isToday,
          bucketKey,
          value: item.value,
        });
      });

      return Array.from(grouped.values()).sort((a, b) => `${a.date}`.localeCompare(`${b.date}`));
    },
    [
      activityHeatmapRestRows,
      activityHeatmapRows,
      chartMetric,
      heatmapGrouping,
      historySeries,
      locale,
      selectedRange.days,
      t,
      todayLiveSocialStats,
    ]
  );

  const heatmapChartData = useMemo(
    () => heatmapSeries.map((item, index) => ({ ...item, index })),
    [heatmapSeries],
  );

  const heatmapTickValues = useMemo(() => {
    if (heatmapGrouping !== 'day') {
      return heatmapChartData.map(item => item.index);
    }
    return heatmapChartData.map(item => item.index);
  }, [heatmapChartData, heatmapGrouping]);

  const chartWidth = useMemo(() => {
    const base = Math.max(viewportWidth - 88, 320);
    if (heatmapGrouping === 'day') {
      if (selectedRange.days <= 7) return base;
      return Math.max(base, heatmapChartData.length * 54);
    }
    if (heatmapGrouping === 'month') {
      return Math.max(base, heatmapChartData.length * 140);
    }
    return Math.max(base, heatmapChartData.length * 180);
  }, [heatmapChartData.length, heatmapGrouping, selectedRange.days, viewportWidth]);

  const barWidth =
    heatmapGrouping === 'year' ? 56 : heatmapGrouping === 'month' ? 44 : selectedRange.days <= 7 ? 30 : 24;
  const showHeatmapValueLabels = heatmapGrouping !== 'day' || selectedRange.days <= 14;

  const heatmapScale = useMemo(
    () => buildChartScale(heatmapSeries.map(item => item.value)),
    [heatmapSeries]
  );

  const formatHeatmapTick = (index: number) => {
    const item = heatmapChartData[index];
    if (!item) return '';
    if (heatmapGrouping === 'year') return item.label;
    if (heatmapGrouping === 'month') return item.label;
    if (item.isToday) return t('Today');
    return formatDayOfWeek(item.date, locale);
  };

  const heatmapSubtitle = useMemo(() => {
    const metricLabel = t(chartMetric.charAt(0).toUpperCase() + chartMetric.slice(1));
    if (heatmapGrouping === 'year') {
      return t('Live {{metric}} grouped by year', { metric: metricLabel });
    }
    if (heatmapGrouping === 'month') {
      return t('Live {{metric}} grouped by month', { metric: metricLabel });
    }
    return t('Last {{count}} days of {{metric}}', {
      count: Math.min(heatmapSeries.length, selectedRange.days),
      metric: metricLabel,
    });
  }, [chartMetric, heatmapGrouping, heatmapSeries.length, selectedRange.days, t]);

  return (
    <>
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <LinearGradient colors={[colors.accent, colors.accentSecondary]} style={styles.hero}>
        <Text style={styles.heroEyebrow}>{t('Live cockpit')}</Text>
        <Text style={styles.heroTitle}>{t('Analytics overview')}</Text>
        <Text style={styles.heroSubtitle}>
          {t('Realtime CRM signals across your connected channels.')}
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
      <DMCard
        title={t('Live Social Performance')}
        subtitle={
          liveSocialLoading
            ? t('Pulling latest social metrics...')
            : t('Meta + X across the last {{hours}}h', { hours: liveSocialStats.lookbackHours })
        }
      >
        <View style={styles.liveSummaryRow}>
          <View style={styles.liveSummaryItem}>
            <Text style={styles.liveSummaryLabel}>{t('Views')}</Text>
            <Text style={styles.liveSummaryValue}>{formatCount(liveSocialStats.summary.views)}</Text>
          </View>
          <View style={[styles.liveSummaryItem, styles.liveSummaryItemLast]}>
            <Text style={styles.liveSummaryLabel}>{t('Interactions')}</Text>
            <Text style={styles.liveSummaryValue}>{formatCount(liveSocialStats.summary.interactions)}</Text>
          </View>
        </View>
        <View style={styles.liveSummaryRow}>
          <View style={styles.liveSummaryItem}>
            <Text style={styles.liveSummaryLabel}>{t('Engagement')}</Text>
            <Text style={styles.liveSummaryValue}>{liveSocialStats.summary.engagementRate.toFixed(2)}%</Text>
          </View>
          <View style={[styles.liveSummaryItem, styles.liveSummaryItemLast]}>
            <Text style={styles.liveSummaryLabel}>{t('Conversions')}</Text>
            <Text style={styles.liveSummaryValue}>{formatCount(liveSocialStats.summary.conversions)}</Text>
          </View>
        </View>
        {isBwinbetAccount ? (
          <View style={styles.liveSummaryRow}>
            <View style={styles.liveSummaryItem}>
              <Text style={styles.liveSummaryLabel}>{t('Web visitors')}</Text>
              <Text style={styles.liveSummaryValue}>{formatCount(liveSocialStats.web.visitors)}</Text>
            </View>
            <View style={[styles.liveSummaryItem, styles.liveSummaryItemLast]}>
              <Text style={styles.liveSummaryLabel}>{t('Bet button clicks')}</Text>
              <Text style={styles.liveSummaryValue}>{formatCount(liveSocialStats.web.redirectClicks)}</Text>
            </View>
          </View>
        ) : null}
        {livePlatformRows.length ? (
          <View style={styles.livePlatformList}>
            {livePlatformRows.map(row => (
              <View key={row.key} style={styles.livePlatformRow}>
                <View style={styles.livePlatformHeader}>
                  <Text style={styles.livePlatformName}>{row.label}</Text>
                  <Text style={styles.livePlatformPosts}>
                    {row.key === 'web'
                      ? t('{{count}} visits', { count: row.views })
                      : t('{{count}} posts', { count: row.postsAnalyzed })}
                  </Text>
                </View>
                <Text style={styles.livePlatformMetrics}>
                  {t('Views')}: {formatCount(row.views)} | {t('Interactions')}: {formatCount(row.interactions)} | {t('Engagement')}:{' '}
                  {row.engagementRate.toFixed(2)}% | {t('Conversions')}: {formatCount(row.conversions)}
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={styles.emptyState}>{t('No connected social channels with live metrics yet.')}</Text>
        )}
        {isBwinbetAccount ? (
          <View style={styles.channelMatrix}>
            <Text style={styles.channelMatrixTitle}>{t('Channel Performance (Interactions, Engagement, Conversions)')}</Text>
            {channelPerformanceRows.map(row => (
              <View key={`matrix-${row.key}`} style={styles.channelMatrixRow}>
                <Text style={styles.channelMatrixName}>{row.label}</Text>
                <Text style={styles.channelMatrixValue}>
                  {t('Interactions')}: {formatCount(row.interactions)} | {t('Engagement')}: {row.engagementRate.toFixed(2)}% | {t('Conversions')}:{' '}
                  {formatCount(row.conversions)}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
        <Text style={styles.liveUpdatedAt}>{liveUpdatedLabel}</Text>
      </DMCard>
      <DMCard title={t('Daily Reviews')} subtitle={loading ? t('Refreshing data...') : t('Live statistics for today so far')}>
        <View style={styles.kpiRow}>
          <View style={styles.kpiItem}>
            <Text style={styles.kpiLabel}>{t('Views')}</Text>
            <Text style={styles.kpiValue}>{formatCount(dailyReviewStats.views)}</Text>
          </View>
          <View style={styles.kpiItem}>
            <Text style={styles.kpiLabel}>{t('Interactions')}</Text>
            <Text style={styles.kpiValue}>{formatCount(dailyReviewStats.interactions)}</Text>
          </View>
        </View>
        <View style={styles.kpiRow}>
          <View style={styles.kpiItem}>
            <Text style={styles.kpiLabel}>{t('Outbound')}</Text>
            <Text style={styles.kpiValue}>{formatCount(dailyReviewStats.outbound)}</Text>
          </View>
          <View style={styles.kpiItem}>
            <Text style={styles.kpiLabel}>{isBwinbetAccount ? t('Bet button clicks') : t('Conversions')}</Text>
            <Text style={styles.kpiValue}>
              {isBwinbetAccount
                ? formatCount(dailyReviewStats.redirectClicks)
                : formatCount(dailyReviewStats.conversions)}
            </Text>
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
        headerRight={
          <TouchableOpacity style={styles.rangeButton} onPress={() => setRangeMenuOpen(true)}>
            <Text style={styles.rangeButtonText}>{t(selectedRange.shortLabel)}</Text>
            <Ionicons name="chevron-down" size={16} color={colors.text} />
          </TouchableOpacity>
        }
        subtitle={heatmapSubtitle}
      >
        <View style={styles.chartMetricRow}>
          {(['views', 'interactions', 'outbound', 'conversions'] as const).map(metric => (
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
                {t(metric.charAt(0).toUpperCase() + metric.slice(1))}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chartScroller}>
          <View style={[styles.chartFrame, { width: chartWidth }]}>
            <VictoryChart
              width={chartWidth}
              animate={{ duration: 500 }}
              theme={VictoryTheme.material}
              height={300}
              domain={{ y: [0, heatmapScale.top * 1.12] }}
              domainPadding={{ x: heatmapGrouping === 'day' ? 18 : 28, y: 18 }}
              padding={{ top: 42, bottom: 52, left: 54, right: 22 }}
            >
              <VictoryAxis
                tickValues={heatmapTickValues}
                tickFormat={tick => formatHeatmapTick(Number(tick))}
                style={{
                  axis: { stroke: colors.border },
                  tickLabels: { fill: colors.subtext, fontSize: selectedRange.days > 30 ? 10 : 11, padding: 10 },
                  grid: { stroke: 'transparent' }
                }}
              />
              <VictoryAxis
                dependentAxis
                tickValues={heatmapScale.ticks}
                tickFormat={tick => formatAxisCount(Number(tick))}
                style={{
                  axis: { stroke: colors.border },
                  tickLabels: { fill: colors.subtext, fontSize: 11, padding: 6 },
                  grid: { stroke: 'rgba(155, 169, 202, 0.16)', strokeDasharray: '4,6' }
                }}
              />
              <VictoryBar
                cornerRadius={{ top: 10, bottom: 4 }}
                style={{
                  data: {
                    fill: ({ datum }) =>
                      datum.isToday ? colors.accentSecondary : colors.accent,
                  },
                  labels: {
                    fill: colors.text,
                    fontSize: selectedRange.days > 30 ? 8 : 10,
                    fontWeight: '700',
                  },
                }}
                data={heatmapChartData}
                x="index"
                y="value"
                labels={({ datum }) =>
                  datum.value > 0 && (showHeatmapValueLabels || datum.isToday) ? formatCount(datum.value) : ''
                }
                labelComponent={<VictoryLabel dy={-10} />}
                barWidth={barWidth}
              />
            </VictoryChart>
          </View>
        </ScrollView>
      </DMCard>
      <DMCard title={t('Automation Log')} subtitle={t('Recent events across your CRM scenarios')}>
        {logItems.map(item => (
          <Text key={item} style={styles.logItem}>
            {item}
          </Text>
        ))}
      </DMCard>
    </ScrollView>
    <Modal visible={rangeMenuOpen} transparent animationType="fade">
      <Pressable style={styles.modalBackdrop} onPress={() => setRangeMenuOpen(false)}>
        <Pressable style={styles.modalCard} onPress={() => undefined}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{t('Activity range')}</Text>
            <TouchableOpacity onPress={() => setRangeMenuOpen(false)} style={styles.modalClose}>
              <Ionicons name="close" size={18} color={colors.text} />
            </TouchableOpacity>
          </View>
          {REVIEW_RANGE_OPTIONS.map(option => {
            const active = option.key === selectedRangeKey;
            return (
              <TouchableOpacity
                key={option.key}
                style={[styles.modalOption, active && styles.modalOptionActive]}
                onPress={() => {
                  setSelectedRangeKey(option.key);
                  setRangeMenuOpen(false);
                }}
              >
                <Text style={[styles.modalOptionText, active && styles.modalOptionTextActive]}>
                  {t(option.label)}
                </Text>
                {active ? <Ionicons name="checkmark" size={18} color={colors.accent} /> : null}
              </TouchableOpacity>
            );
          })}
        </Pressable>
      </Pressable>
    </Modal>
    </>
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
    color: colors.text,
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
  rangeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: colors.border,
  },
  rangeButtonText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
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
  chartFrame: {
    backgroundColor: colors.cardOverlay,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    paddingTop: 8,
    overflow: 'hidden'
  },
  chartScroller: {
    paddingBottom: 4,
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
  liveSummaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  liveSummaryItem: {
    flex: 1,
    backgroundColor: colors.backgroundAlt,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    marginRight: 10,
  },
  liveSummaryItemLast: {
    marginRight: 0,
  },
  liveSummaryLabel: {
    color: colors.subtext,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  liveSummaryValue: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '700',
    marginTop: 6,
  },
  livePlatformList: {
    marginTop: 4,
  },
  livePlatformRow: {
    backgroundColor: colors.backgroundAlt,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    marginBottom: 10,
  },
  livePlatformHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  livePlatformName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  livePlatformPosts: {
    color: colors.subtext,
    fontSize: 11,
  },
  livePlatformMetrics: {
    color: colors.subtext,
    fontSize: 12,
    lineHeight: 18,
  },
  liveUpdatedAt: {
    color: colors.subtext,
    fontSize: 11,
    marginTop: 6,
  },
  channelMatrix: {
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 10,
  },
  channelMatrixTitle: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 8,
  },
  channelMatrixRow: {
    backgroundColor: colors.backgroundAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  channelMatrixName: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 2,
  },
  channelMatrixValue: {
    color: colors.subtext,
    fontSize: 12,
    lineHeight: 18,
  },
  emptyState: {
    color: colors.subtext,
    marginTop: 8,
    lineHeight: 18
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(8, 10, 16, 0.72)',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    borderRadius: 24,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  modalTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
  },
  modalClose: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  modalOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'rgba(255,255,255,0.03)',
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginTop: 10,
  },
  modalOptionActive: {
    borderColor: colors.accent,
    backgroundColor: 'rgba(0, 214, 255, 0.08)',
  },
  modalOptionText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  modalOptionTextActive: {
    color: colors.accent,
  },
  logItem: {
    color: colors.subtext,
    marginBottom: 8
  }
});

