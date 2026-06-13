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
import * as VictoryNative from 'victory-native';
import { DMCard } from '@components/DMCard';
import { colors } from '@constants/colors';
import { useAuth } from '@context/AuthContext';
import { useI18n } from '@context/I18nContext';
import { doc, onSnapshot } from 'firebase/firestore';
import { buildDashboardCacheKey, peekDashboardCache, readDashboardCache, writeDashboardCache } from '@services/dashboardCache';
import { realtimeDb } from '@services/firebase';
import { AdPerformance, fetchAdPerformance } from '@services/metaAds';
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

const VictoryAxis = (VictoryNative as any).VictoryAxis as React.ComponentType<any>;
const VictoryBar = (VictoryNative as any).VictoryBar as React.ComponentType<any>;
const VictoryChart = (VictoryNative as any).VictoryChart as React.ComponentType<any>;
const VictoryLabel = (VictoryNative as any).VictoryLabel as React.ComponentType<any>;
const VictoryTheme = (VictoryNative as any).VictoryTheme;

type ChartMetric = 'views' | 'interactions' | 'outbound' | 'conversions';
type ReviewRangeKey = '7d' | '14d' | '30d' | '365d';
type HeatmapGrouping = 'day' | 'month' | 'year';
const LIVE_SOCIAL_ROLLING_DAYS = 30;
const LIVE_SOCIAL_ROLLING_HOURS = LIVE_SOCIAL_ROLLING_DAYS * 24;
const BWIN_ACCOUNT_CLOSURE_AT = '2026-05-08T08:00:00+03:00';

type AccountClosureState = {
  enabled?: boolean;
  visibleToClient?: boolean;
  shutdownAt?: string;
  message?: string;
  status?: string;
};

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
  lookbackHours: LIVE_SOCIAL_ROLLING_HOURS,
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

const emptyAdPerformance: AdPerformance = {
  generatedAt: new Date(0).toISOString(),
  lookbackDays: 30,
  currency: 'USD',
  summary: {
    spend: 0,
    impressions: 0,
    reach: 0,
    clicks: 0,
    inlineLinkClicks: 0,
    messages: 0,
    leads: 0,
    active: 0,
    paused: 0,
    failed: 0,
    other: 0,
    ctr: 0,
  },
  rows: [],
};

const getHoursSinceDateStart = (dateKey: string) => {
  const parsed = parseChartDate(dateKey);
  if (Number.isNaN(parsed.getTime())) return 1;
  parsed.setHours(0, 0, 0, 0);
  return Math.max(1, (Date.now() - parsed.getTime()) / (60 * 60 * 1000));
};

const buildLiveSocialDayRows = (dates: string[], snapshots: LiveSocialStats[]): ActivityHeatmapDaily[] =>
  dates.map((date, index) => {
    const current = snapshots[index] ?? emptyLiveSocialStats;
    const next = snapshots[index + 1] ?? emptyLiveSocialStats;
    return {
      date,
      views: Math.max(0, Number(current.summary.views ?? 0) - Number(next.summary.views ?? 0)),
      interactions: Math.max(
        0,
        Number(current.summary.interactions ?? 0) - Number(next.summary.interactions ?? 0),
      ),
      outbound: 0,
      conversions: Math.max(
        0,
        Number(current.web.redirectClicks ?? current.summary.conversions ?? 0) -
          Number(next.web.redirectClicks ?? next.summary.conversions ?? 0),
      ),
      redirectClicks: Math.max(
        0,
        Number(current.web.redirectClicks ?? 0) - Number(next.web.redirectClicks ?? 0),
      ),
    };
  });

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

const scoreHeatmapRows = (rows: ActivityHeatmapDaily[]) =>
  rows.reduce(
    (acc, row) =>
      acc +
      Number(row.views ?? 0) +
      Number(row.interactions ?? 0) +
      Number(row.outbound ?? 0) +
      Number(row.conversions ?? 0) +
      Number(row.redirectClicks ?? 0),
    0,
  );

const normalizeLower = (value: unknown) => String(value ?? '').toLowerCase();

const isBwinAccount = (
  email?: string | null,
  company?: string | null,
  uid?: string | null,
  crmEmail?: string | null,
) => {
  const normalizedEmail = normalizeLower(email);
  const normalizedCompany = normalizeLower(company);
  const normalizedCrmEmail = normalizeLower(crmEmail);
  return (
    uid === '1zvY9nNyXMcfxdPQEyx0bIdK7r53' ||
    normalizedEmail.includes('bwinbet') ||
    normalizedCrmEmail.includes('bwinbet') ||
    normalizedCompany.includes('bwinbet')
  );
};

const formatClosureCountdown = (remainingMs: number) => {
  if (remainingMs <= 0) return 'Account closed';
  const totalSeconds = Math.floor(remainingMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m ${seconds}s`;
  return `${hours}h ${minutes}m ${seconds}s`;
};

const hasLiveDashboardSignal = (
  analytics: DashboardAnalytics,
  outboundStats: OutboundStats,
  liveSocialStats: LiveSocialStats,
  todayLiveSocialStats: LiveSocialStats,
  activityHeatmapRows: ActivityHeatmapDaily[],
  activityHeatmapRestRows: ActivityHeatmapDaily[],
) => {
  if ((analytics.history?.length ?? 0) > 0) return true;
  if (Number(analytics.leads ?? 0) > 0) return true;
  if (Number(analytics.engagement ?? 0) > 0) return true;
  if (Number(analytics.conversions ?? 0) > 0) return true;
  if (Number(outboundStats.prospectsContacted ?? 0) > 0) return true;
  if (Number(outboundStats.conversions ?? 0) > 0) return true;
  if (Number(liveSocialStats.summary.views ?? 0) > 0) return true;
  if (Number(liveSocialStats.summary.interactions ?? 0) > 0) return true;
  if (Number(liveSocialStats.web.redirectClicks ?? 0) > 0) return true;
  if (Number(todayLiveSocialStats.summary.views ?? 0) > 0) return true;
  if (Number(todayLiveSocialStats.summary.interactions ?? 0) > 0) return true;
  if (Number(todayLiveSocialStats.web.redirectClicks ?? 0) > 0) return true;
  if (activityHeatmapRows.some(row => Number(row.views ?? 0) > 0 || Number(row.interactions ?? 0) > 0)) return true;
  if (activityHeatmapRestRows.some(row => Number(row.views ?? 0) > 0 || Number(row.interactions ?? 0) > 0)) return true;
  return false;
};

export const DashboardScreen: React.FC = () => {
  const { state } = useAuth();
  const { t, locale } = useI18n();
  const { width: viewportWidth } = useWindowDimensions();
  const orgId = (state.user as any)?.orgId ?? state.crmData?.orgId;
  const isBwinbetAccount = useMemo(() => {
    return isBwinAccount(
      state.user?.email,
      state.crmData?.companyName,
      state.user?.uid,
      state.crmData?.email,
    );
  }, [state.crmData?.companyName, state.crmData?.email, state.user?.email, state.user?.uid]);
  const analyticsScopeId = useMemo(
    () => resolveAnalyticsScopeId(state.user?.uid, orgId),
    [state.user?.uid, orgId]
  );
  const dashboardCacheKey = useMemo(
    () => buildDashboardCacheKey(state.user?.uid, analyticsScopeId),
    [state.user?.uid, analyticsScopeId],
  );
  const initialDashboardSnapshot = useMemo(
    () => (dashboardCacheKey ? peekDashboardCache(dashboardCacheKey) : null),
    [dashboardCacheKey],
  );
  const initialHasCachedSnapshot = useMemo(
    () =>
      Boolean(
        initialDashboardSnapshot &&
          hasLiveDashboardSignal(
            createEmptyAnalytics(initialDashboardSnapshot.analytics),
            initialDashboardSnapshot.outboundStats,
            initialDashboardSnapshot.liveSocialStats,
            initialDashboardSnapshot.todayLiveSocialStats,
            initialDashboardSnapshot.activityHeatmapRows,
            initialDashboardSnapshot.activityHeatmapRestRows,
          ),
      ),
    [initialDashboardSnapshot],
  );
  const [analytics, setAnalytics] = useState<DashboardAnalytics>(() =>
    createEmptyAnalytics(initialDashboardSnapshot?.analytics ?? state.crmData?.analytics)
  );
  const [loading, setLoading] = useState(false);
  const [chartMetric, setChartMetric] = useState<ChartMetric>('views');
  const [outboundStats, setOutboundStats] = useState<OutboundStats>(() => initialDashboardSnapshot?.outboundStats ?? emptyOutboundStats);
  const [liveSocialStats, setLiveSocialStats] = useState<LiveSocialStats>(() => initialDashboardSnapshot?.liveSocialStats ?? emptyLiveSocialStats);
  const [todayLiveSocialStats, setTodayLiveSocialStats] = useState<LiveSocialStats>(() => initialDashboardSnapshot?.todayLiveSocialStats ?? emptyLiveSocialStats);
  const [activityHeatmapRows, setActivityHeatmapRows] = useState<ActivityHeatmapDaily[]>(() => initialDashboardSnapshot?.activityHeatmapRows ?? []);
  const [activityHeatmapRestRows, setActivityHeatmapRestRows] = useState<ActivityHeatmapDaily[]>(() => initialDashboardSnapshot?.activityHeatmapRestRows ?? []);
  const [rollingPerformanceRows, setRollingPerformanceRows] = useState<ActivityHeatmapDaily[]>(() => initialDashboardSnapshot?.rollingPerformanceRows ?? initialDashboardSnapshot?.activityHeatmapRestRows ?? []);
  const [dailyLiveSocialRows, setDailyLiveSocialRows] = useState<ActivityHeatmapDaily[]>(() => initialDashboardSnapshot?.dailyLiveSocialRows ?? []);
  const [liveSocialLoading, setLiveSocialLoading] = useState(false);
  const [adPerformance, setAdPerformance] = useState<AdPerformance>(emptyAdPerformance);
  const [adPerformanceLoading, setAdPerformanceLoading] = useState(false);
  const [selectedRangeKey, setSelectedRangeKey] = useState<ReviewRangeKey>('7d');
  const [rangeMenuOpen, setRangeMenuOpen] = useState(false);
  const [cacheReady, setCacheReady] = useState(false);
  const [hasCachedSnapshot, setHasCachedSnapshot] = useState(initialHasCachedSnapshot);
  const [closureState, setClosureState] = useState<AccountClosureState | null>(null);
  const [closureNow, setClosureNow] = useState(() => Date.now());
  const selectedRange = useMemo(
    () => REVIEW_RANGE_OPTIONS.find(option => option.key === selectedRangeKey) ?? REVIEW_RANGE_OPTIONS[0],
    [selectedRangeKey],
  );
  const heatmapGrouping = useMemo<HeatmapGrouping>(
    () => getHeatmapGrouping(selectedRange.days),
    [selectedRange.days],
  );

  useEffect(() => {
    if (!isBwinbetAccount || !state.user?.uid || !realtimeDb) {
      setClosureState(null);
      return;
    }
    const ref = doc(realtimeDb, 'users', state.user.uid);
    return onSnapshot(
      ref,
      (snap: any) => {
        setClosureState((snap.data()?.accountClosure ?? null) as AccountClosureState | null);
      },
      () => {
        setClosureState(null);
      },
    );
  }, [isBwinbetAccount, state.user?.uid]);

  useEffect(() => {
    if (!isBwinbetAccount) return;
    const timer = setInterval(() => setClosureNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [isBwinbetAccount]);

  useEffect(() => {
    let active = true;
    setCacheReady(false);
    setHasCachedSnapshot(false);
    void readDashboardCache(dashboardCacheKey)
      .then(snapshot => {
        if (!active) return;
        if (snapshot) {
          const cachedAnalytics = createEmptyAnalytics(snapshot.analytics);
          const cachedOutboundStats = snapshot.outboundStats;
          const cachedLiveSocialStats = snapshot.liveSocialStats;
          const cachedTodayLiveSocialStats = snapshot.todayLiveSocialStats;
          const cachedHeatmapRows = snapshot.activityHeatmapRows;
          const cachedHeatmapRestRows = snapshot.activityHeatmapRestRows;
          const cachedRollingPerformanceRows = snapshot.rollingPerformanceRows ?? cachedHeatmapRestRows;
          const cachedDailyLiveSocialRows = snapshot.dailyLiveSocialRows ?? [];
          if (
            hasLiveDashboardSignal(
              cachedAnalytics,
              cachedOutboundStats,
              cachedLiveSocialStats,
              cachedTodayLiveSocialStats,
              cachedHeatmapRows,
              cachedHeatmapRestRows,
            )
          ) {
            setAnalytics(cachedAnalytics);
            setOutboundStats(cachedOutboundStats);
            setLiveSocialStats(cachedLiveSocialStats);
            setTodayLiveSocialStats(cachedTodayLiveSocialStats);
            setActivityHeatmapRows(cachedHeatmapRows);
            setActivityHeatmapRestRows(cachedHeatmapRestRows);
            setRollingPerformanceRows(cachedRollingPerformanceRows);
            setDailyLiveSocialRows(cachedDailyLiveSocialRows);
            setHasCachedSnapshot(true);
          }
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
      rollingPerformanceRows,
      dailyLiveSocialRows,
    });
  }, [
    activityHeatmapRestRows,
    activityHeatmapRows,
    analytics,
    cacheReady,
    dailyLiveSocialRows,
    dashboardCacheKey,
    liveSocialStats,
    outboundStats,
    rollingPerformanceRows,
    state.user?.uid,
    todayLiveSocialStats,
  ]);

  useEffect(() => {
    if (!state.user?.uid || heatmapGrouping !== 'day') {
      setDailyLiveSocialRows(prev => (prev.length ? [] : prev));
      return;
    }

    let active = true;
    const targetDays = Math.max(Math.min(selectedRange.days, 14), 7);
    const dateWindow = buildDateWindow(targetDays);
    const timer = setTimeout(() => {
      void Promise.all(
        dateWindow.map(date =>
          fetchLiveSocialStats(state.user?.uid, analyticsScopeId, getHoursSinceDateStart(date)),
        ),
      )
        .then(snapshots => {
          if (!active) return;
          setDailyLiveSocialRows(buildLiveSocialDayRows(dateWindow, snapshots));
        })
        .catch(error => {
          console.warn('Daily live social heatmap fetch failed', error);
        });
    }, 150);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [analyticsScopeId, heatmapGrouping, selectedRange.days, state.user?.uid]);

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
    if (!state.user?.uid) {
      setRollingPerformanceRows([]);
      return;
    }
    let active = true;
    let timer: ReturnType<typeof setInterval> | null = null;

    const refreshRollingPerformance = async () => {
      const rows = await fetchActivityHeatmap(state.user?.uid, analyticsScopeId, LIVE_SOCIAL_ROLLING_DAYS);
      if (!active) return;
      setRollingPerformanceRows(rows);
    };

    void refreshRollingPerformance();
    timer = setInterval(() => {
      void refreshRollingPerformance();
    }, 120000);

    return () => {
      active = false;
      if (timer) clearInterval(timer);
    };
  }, [analyticsScopeId, state.user?.uid]);

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
          fetchLiveSocialStats(state.user.uid, analyticsScopeId, LIVE_SOCIAL_ROLLING_HOURS),
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

  useEffect(() => {
    if (!state.user?.uid) {
      setAdPerformance(emptyAdPerformance);
      return;
    }
    let mounted = true;
    let timer: ReturnType<typeof setInterval> | null = null;

    const refreshAdPerformance = async () => {
      setAdPerformanceLoading(true);
      try {
        const response = await fetchAdPerformance(12);
        if (mounted && response.performance) {
          setAdPerformance(response.performance);
        }
      } catch (error) {
        console.warn('Failed to refresh ad performance', error);
      } finally {
        if (mounted) setAdPerformanceLoading(false);
      }
    };

    void refreshAdPerformance();
    timer = setInterval(() => {
      void refreshAdPerformance();
    }, 120000);

    return () => {
      mounted = false;
      if (timer) clearInterval(timer);
    };
  }, [state.user?.uid]);

  const historySeries = useMemo(
    () => analytics.history ?? [],
    [analytics]
  );

  const safeNumber = (value: unknown) => {
    const numeric = Number(value ?? 0);
    return Number.isFinite(numeric) ? numeric : 0;
  };

  const formatCount = (value: unknown) => {
    const rounded = Math.round(safeNumber(value));
    return rounded.toLocaleString();
  };

  const formatMoney = (value: unknown, currency = 'USD') =>
    new Intl.NumberFormat(locale ?? undefined, {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 2,
    }).format(safeNumber(value));

  const formatAxisCount = (value: number) => {
    if (value >= 1000000) return `${(value / 1000000).toFixed(value % 1000000 === 0 ? 0 : 1)}M`;
    if (value >= 1000) return `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}K`;
    return formatCount(value);
  };

  const todayDateKey = toDateKey(new Date());

  const rollingPerformanceSummary = useMemo(() => {
    const byDate = new Map<
      string,
      { date: string; views: number; interactions: number; outbound: number; conversions: number; redirectClicks: number }
    >();

    const mergeRow = (row?: Partial<ActivityHeatmapDaily> & { date?: string }) => {
      const date = `${row?.date ?? ''}`.trim();
      if (!date) return;
      const existing =
        byDate.get(date) ??
        { date, views: 0, interactions: 0, outbound: 0, conversions: 0, redirectClicks: 0 };
      existing.views = Math.max(existing.views, Number(row?.views ?? 0));
      existing.interactions = Math.max(existing.interactions, Number(row?.interactions ?? 0));
      existing.outbound = Math.max(existing.outbound, Number(row?.outbound ?? 0));
      existing.conversions = Math.max(existing.conversions, Number(row?.conversions ?? 0));
      existing.redirectClicks = Math.max(existing.redirectClicks, Number(row?.redirectClicks ?? 0));
      byDate.set(date, existing);
    };

    rollingPerformanceRows.forEach(mergeRow);
    mergeRow({
      date: todayDateKey,
      views: Number(todayLiveSocialStats.summary.views ?? 0),
      interactions: Number(todayLiveSocialStats.summary.interactions ?? 0),
      conversions: Number(todayLiveSocialStats.summary.conversions ?? 0),
      redirectClicks: Number(todayLiveSocialStats.web.redirectClicks ?? 0),
    });

    const rows = Array.from(byDate.values()).filter(
      row =>
        row.views > 0 ||
        row.interactions > 0 ||
        row.outbound > 0 ||
        row.conversions > 0 ||
        row.redirectClicks > 0,
    );

    const totals = rows.reduce(
      (acc, row) => {
        acc.views += Number(row.views ?? 0);
        acc.interactions += Number(row.interactions ?? 0);
        acc.outbound += Number(row.outbound ?? 0);
        acc.conversions += Number(row.conversions ?? 0);
        acc.redirectClicks += Number(row.redirectClicks ?? 0);
        return acc;
      },
      { views: 0, interactions: 0, outbound: 0, conversions: 0, redirectClicks: 0 },
    );

    const summaryViews = totals.views > 0 ? totals.views : Number(liveSocialStats.summary.views ?? 0);
    const summaryInteractions =
      totals.interactions > 0 ? totals.interactions : Number(liveSocialStats.summary.interactions ?? 0);
    const summaryRedirectClicks =
      totals.redirectClicks > 0 ? totals.redirectClicks : Number(liveSocialStats.web.redirectClicks ?? 0);
    const summaryConversions =
      summaryRedirectClicks > 0
        ? summaryRedirectClicks
        : totals.conversions > 0
          ? totals.conversions
          : Number(liveSocialStats.summary.conversions ?? 0);

    return {
      availableDays: rows.length,
      views: summaryViews,
      interactions: summaryInteractions,
      outbound: totals.outbound,
      conversions: summaryConversions,
      redirectClicks: summaryRedirectClicks,
      engagementRate:
        summaryViews > 0 ? Number(((summaryInteractions / summaryViews) * 100).toFixed(2)) : 0,
    };
  }, [liveSocialStats.summary.conversions, liveSocialStats.summary.interactions, liveSocialStats.summary.views, liveSocialStats.web.redirectClicks, rollingPerformanceRows, todayDateKey, todayLiveSocialStats]);

  const liveSocialSubtitle = useMemo(() => {
    if (liveSocialLoading && rollingPerformanceSummary.availableDays === 0) {
      return t('Pulling latest social metrics...');
    }
    return t('Rolling live total across the last {{days}} days', { days: LIVE_SOCIAL_ROLLING_DAYS });
  }, [liveSocialLoading, rollingPerformanceSummary.availableDays, t]);

  const liveSocialSummaryCard = useMemo(() => {
    const apiViews = Number(liveSocialStats.summary.views ?? 0);
    const apiInteractions = Number(liveSocialStats.summary.interactions ?? 0);
    const apiConversions = Number(liveSocialStats.summary.conversions ?? 0);
    const apiRedirectClicks = Number(liveSocialStats.web.redirectClicks ?? 0);
    const apiEngagementRate = Number(liveSocialStats.summary.engagementRate ?? 0);
    const hasApiSignal =
      apiViews > 0 || apiInteractions > 0 || apiConversions > 0 || apiRedirectClicks > 0;

    if (hasApiSignal) {
      return {
        views: apiViews,
        interactions: apiInteractions,
        conversions: apiConversions,
        redirectClicks: apiRedirectClicks,
        engagementRate: apiEngagementRate,
      };
    }

    return {
      views: rollingPerformanceSummary.views,
      interactions: rollingPerformanceSummary.interactions,
      conversions: rollingPerformanceSummary.conversions,
      redirectClicks: rollingPerformanceSummary.redirectClicks,
      engagementRate: rollingPerformanceSummary.engagementRate,
    };
  }, [liveSocialStats, rollingPerformanceSummary]);

  const effectiveClosureState = useMemo<AccountClosureState | null>(() => {
    if (!isBwinbetAccount) return null;
    return closureState ?? {
      enabled: true,
      visibleToClient: true,
      shutdownAt: BWIN_ACCOUNT_CLOSURE_AT,
      message:
        'All Bwin social posting, reels, stories, and automated replies will pause on Friday, May 8, 2026 at 8:00 AM Africa/Kampala unless reopened.',
      status: 'scheduled',
    };
  }, [closureState, isBwinbetAccount]);

  const closureShutdownAt = effectiveClosureState?.shutdownAt ? new Date(effectiveClosureState.shutdownAt) : null;
  const closureRemainingMs = closureShutdownAt ? closureShutdownAt.getTime() - closureNow : 0;
  const showClosureCard = Boolean(
    isBwinbetAccount &&
      effectiveClosureState?.enabled !== false &&
      effectiveClosureState?.visibleToClient !== false,
  );

  const heroStats = [
    { label: t('Interactions'), value: formatCount(liveSocialSummaryCard.interactions) },
    { label: t('Outbound'), value: formatCount(outboundStats.prospectsContacted) },
    { label: t('Views'), value: formatCount(liveSocialSummaryCard.views) },
    {
      label: isBwinbetAccount ? t('Bet button clicks') : t('Conversions'),
      value: isBwinbetAccount
        ? formatCount(liveSocialSummaryCard.redirectClicks)
        : formatCount(liveSocialSummaryCard.conversions),
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
      summary.redirectClicks = Math.max(summary.redirectClicks, Number(row.redirectClicks ?? 0));
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

  const recentAdRows = useMemo(
    () => adPerformance.rows.slice(0, 5),
    [adPerformance.rows],
  );

  const displayAdSummary = useMemo(() => {
    const summary = adPerformance.summary;
    const normalizedSummary = {
      spend: safeNumber(summary.spend),
      impressions: safeNumber(summary.impressions),
      reach: safeNumber(summary.reach),
      clicks: safeNumber(summary.clicks),
      inlineLinkClicks: safeNumber(summary.inlineLinkClicks),
      messages: safeNumber(summary.messages),
      leads: safeNumber(summary.leads),
      active: safeNumber(summary.active),
      paused: safeNumber(summary.paused),
      failed: safeNumber(summary.failed),
      other: safeNumber(summary.other),
      ctr: safeNumber(summary.ctr),
    };
    const hasSummarySignal =
      normalizedSummary.spend > 0 ||
      normalizedSummary.impressions > 0 ||
      normalizedSummary.reach > 0 ||
      normalizedSummary.clicks > 0 ||
      normalizedSummary.inlineLinkClicks > 0 ||
      normalizedSummary.messages > 0 ||
      normalizedSummary.leads > 0;
    if (hasSummarySignal || !adPerformance.rows.length) return normalizedSummary;

    const derived = adPerformance.rows.reduce(
      (acc, row) => {
        acc.spend += safeNumber(row.spend);
        acc.impressions += safeNumber(row.impressions);
        acc.reach += safeNumber(row.reach);
        acc.clicks += safeNumber(row.clicks);
        acc.inlineLinkClicks += safeNumber(row.inlineLinkClicks);
        acc.messages += safeNumber(row.messages);
        acc.leads += safeNumber(row.leads);
        const status = String(row.effectiveStatus || row.status || '').toUpperCase();
        if (status === 'ACTIVE') acc.active += 1;
        else if (status.includes('PAUSED')) acc.paused += 1;
        else if (status === 'FAILED' || row.errorMessage) acc.failed += 1;
        else acc.other += 1;
        return acc;
      },
      {
        spend: 0,
        impressions: 0,
        reach: 0,
        clicks: 0,
        inlineLinkClicks: 0,
        messages: 0,
        leads: 0,
        active: 0,
        paused: 0,
        failed: 0,
        other: 0,
        ctr: 0,
      },
    );
    derived.ctr = derived.impressions > 0 ? Number(((derived.clicks / derived.impressions) * 100).toFixed(2)) : 0;
    return derived;
  }, [adPerformance.rows, adPerformance.summary]);

  const adPerformanceResults = useMemo(
    () => displayAdSummary.messages || displayAdSummary.leads,
    [displayAdSummary.leads, displayAdSummary.messages],
  );

  const adMessagingConversations = useMemo(
    () => displayAdSummary.messages,
    [displayAdSummary.messages],
  );

  const adPerformanceSubtitle = useMemo(() => {
    if (adPerformanceLoading && !adPerformance.rows.length) {
      return t('Pulling Meta ad insights...');
    }
    return t('Last {{days}} days from connected Meta ads', { days: adPerformance.lookbackDays || 30 });
  }, [adPerformance.lookbackDays, adPerformance.rows.length, adPerformanceLoading, t]);

  const adPerformanceUpdatedAt = useMemo(() => {
    const parsed = new Date(adPerformance.generatedAt);
    if (Number.isNaN(parsed.getTime())) return t('Live data');
    return `${t('Updated')} ${parsed.toLocaleString(locale ?? undefined)}`;
  }, [adPerformance.generatedAt, locale, t]);

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

  const heatmapSeries = useMemo(
    () => {
      const primaryHeatmapRows =
        scoreHeatmapRows(activityHeatmapRestRows) > 0 ? activityHeatmapRestRows : activityHeatmapRows;

      const baseByDate = new Map(
        primaryHeatmapRows.map(day => [
          day.date,
          {
            views: Number(day.views ?? 0),
            interactions: Number(day.interactions ?? 0),
            outbound: Number(day.outbound ?? 0),
            conversions: Number(day.conversions ?? 0),
          },
        ]),
      );

      const socialByDate = new Map(
        dailyLiveSocialRows.map(day => [
          day.date,
          {
            views: Number(day.views ?? 0),
            interactions: Number(day.interactions ?? 0),
            outbound: Number(day.outbound ?? 0),
            conversions: Number(day.conversions ?? 0),
          },
        ]),
      );

      const dailySeries = buildDateWindow(selectedRange.days).map((date, index, arr) => {
        const base = baseByDate.get(date);
        const social = socialByDate.get(date);
        const isToday = index === arr.length - 1;
        const todayLive = isToday
          ? {
              views: Number(todayLiveSocialStats.summary.views ?? 0),
              interactions: Number(todayLiveSocialStats.summary.interactions ?? 0),
              conversions: Number(todayLiveSocialStats.summary.conversions ?? 0),
            }
          : null;
        const merged = {
          views: Math.max(Number(base?.views ?? 0), Number(social?.views ?? 0), Number(todayLive?.views ?? 0)),
          interactions: Math.max(
            Number(base?.interactions ?? 0),
            Number(social?.interactions ?? 0),
            Number(todayLive?.interactions ?? 0),
          ),
          outbound: Number(base?.outbound ?? 0),
          conversions: Math.max(Number(base?.conversions ?? 0), Number(todayLive?.conversions ?? 0)),
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
      dailyLiveSocialRows,
      heatmapGrouping,
      locale,
      selectedRange.days,
      t,
      todayLiveSocialStats,
    ]
  );

  const heatmapChartData = useMemo(
    () => heatmapSeries.map((item, index) => ({ ...item, index, xPosition: index + 1 })),
    [heatmapSeries],
  );

  const heatmapTickValues = useMemo(() => {
    return heatmapChartData.map(item => item.xPosition);
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
    heatmapGrouping === 'year' ? 52 : heatmapGrouping === 'month' ? 40 : selectedRange.days <= 7 ? 24 : 20;
  const showHeatmapValueLabels = heatmapGrouping !== 'day' || selectedRange.days <= 14;

  const heatmapScale = useMemo(
    () => buildChartScale(heatmapSeries.map(item => item.value)),
    [heatmapSeries]
  );

  const formatHeatmapTick = (tickValue: number) => {
    const item = heatmapChartData.find(entry => entry.xPosition === tickValue);
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
      {showClosureCard ? (
        <DMCard title="Bwin Account Closure" subtitle="Countdown to automation shutdown">
          <View style={styles.closureCountdownWrap}>
            <Text style={styles.closureCountdownValue}>{formatClosureCountdown(closureRemainingMs)}</Text>
            <Text style={styles.closureCountdownLabel}>
              {closureRemainingMs > 0
                ? 'Time remaining until all Bwin posting, reels, stories, and replies pause.'
                : 'Bwin posting, reels, stories, and replies are now paused.'}
            </Text>
          </View>
          <View style={styles.closureMetaRow}>
            <Text style={styles.closureMetaLabel}>Shutdown time</Text>
            <Text style={styles.closureMetaValue}>
              {closureShutdownAt ? closureShutdownAt.toLocaleString() : 'Friday, May 8, 2026 8:00 AM'}
            </Text>
          </View>
          <Text style={styles.closureMessage}>
            {effectiveClosureState?.message ??
              'All Bwin social posting, reels, stories, and automated replies will pause at the scheduled shutdown time.'}
          </Text>
        </DMCard>
      ) : null}
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
        subtitle={liveSocialSubtitle}
      >
        <View style={styles.liveSummaryRow}>
          <View style={styles.liveSummaryItem}>
            <Text style={styles.liveSummaryLabel}>{t('Views')}</Text>
            <Text style={styles.liveSummaryValue}>{formatCount(liveSocialSummaryCard.views)}</Text>
          </View>
          <View style={[styles.liveSummaryItem, styles.liveSummaryItemLast]}>
            <Text style={styles.liveSummaryLabel}>{t('Interactions')}</Text>
            <Text style={styles.liveSummaryValue}>{formatCount(liveSocialSummaryCard.interactions)}</Text>
          </View>
        </View>
        <View style={styles.liveSummaryRow}>
          <View style={styles.liveSummaryItem}>
            <Text style={styles.liveSummaryLabel}>{t('Engagement')}</Text>
            <Text style={styles.liveSummaryValue}>{liveSocialSummaryCard.engagementRate.toFixed(2)}%</Text>
          </View>
          <View style={[styles.liveSummaryItem, styles.liveSummaryItemLast]}>
            <Text style={styles.liveSummaryLabel}>{t('Conversions')}</Text>
            <Text style={styles.liveSummaryValue}>{formatCount(liveSocialSummaryCard.conversions)}</Text>
          </View>
        </View>
        <Text style={styles.liveSnapshotHint}>
          {t('Channel rows below reflect the rolling last {{days}} days of connected-channel performance.', { days: LIVE_SOCIAL_ROLLING_DAYS })}
        </Text>
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
                      : row.key === 'threads'
                        ? t('Account stats')
                      : t('{{count}} posts', { count: row.postsAnalyzed })}
                  </Text>
                </View>
                <Text style={styles.livePlatformMetrics}>
                  {t('Views')}: {formatCount(row.views)} | {t('Interactions')}: {formatCount(row.interactions)} | {t('Engagement')}:{' '}
                  {row.engagementRate.toFixed(2)}% | {t('Conversions')}: {formatCount(row.conversions)}
                  {row.key === 'threads' && Number((row as any).followers ?? 0) > 0
                    ? ` | ${t('Followers')}: ${formatCount(Number((row as any).followers ?? 0))}`
                    : ''}
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
      <DMCard title={t('Ads Performance')} subtitle={adPerformanceSubtitle}>
        <View style={styles.liveSummaryRow}>
          <View style={styles.liveSummaryItem}>
            <Text style={styles.liveSummaryLabel}>{t('Spend')}</Text>
            <Text style={styles.liveSummaryValue}>
              {formatMoney(displayAdSummary.spend, adPerformance.currency)}
            </Text>
          </View>
          <View style={[styles.liveSummaryItem, styles.liveSummaryItemLast]}>
            <Text style={styles.liveSummaryLabel}>{t('Impressions')}</Text>
            <Text style={styles.liveSummaryValue}>{formatCount(displayAdSummary.impressions)}</Text>
          </View>
        </View>
        <View style={styles.liveSummaryRow}>
          <View style={styles.liveSummaryItem}>
            <Text style={styles.liveSummaryLabel}>{t('Clicks')}</Text>
            <Text style={styles.liveSummaryValue}>{formatCount(displayAdSummary.clicks)}</Text>
          </View>
          <View style={[styles.liveSummaryItem, styles.liveSummaryItemLast]}>
            <Text style={styles.liveSummaryLabel}>{t('CTR')}</Text>
            <Text style={styles.liveSummaryValue}>{safeNumber(displayAdSummary.ctr).toFixed(2)}%</Text>
          </View>
        </View>
        <View style={styles.liveSummaryRow}>
          <View style={styles.liveSummaryItem}>
            <Text style={styles.liveSummaryLabel}>{t('Reach')}</Text>
            <Text style={styles.liveSummaryValue}>{formatCount(displayAdSummary.reach)}</Text>
          </View>
          <View style={[styles.liveSummaryItem, styles.liveSummaryItemLast]}>
            <Text style={styles.liveSummaryLabel}>{t('Results')}</Text>
            <Text style={styles.liveSummaryValue}>{formatCount(adPerformanceResults)}</Text>
          </View>
        </View>
        <View style={styles.liveSummaryRow}>
          <View style={styles.liveSummaryItem}>
            <Text style={styles.liveSummaryLabel}>{t('Messaging conversations')}</Text>
            <Text style={styles.liveSummaryValue}>{formatCount(adMessagingConversations)}</Text>
          </View>
          <View style={[styles.liveSummaryItem, styles.liveSummaryItemLast]}>
            <Text style={styles.liveSummaryLabel}>{t('Link clicks')}</Text>
            <Text style={styles.liveSummaryValue}>{formatCount(displayAdSummary.inlineLinkClicks)}</Text>
          </View>
        </View>
        <View style={styles.adStatusRow}>
          <Text style={styles.adStatusPill}>{t('Active')}: {formatCount(displayAdSummary.active)}</Text>
          <Text style={styles.adStatusPill}>{t('Paused')}: {formatCount(displayAdSummary.paused)}</Text>
          <Text style={styles.adStatusPill}>{t('Failed')}: {formatCount(displayAdSummary.failed)}</Text>
        </View>
        {recentAdRows.length ? (
          <View style={styles.livePlatformList}>
            {recentAdRows.map(row => {
              const status = row.effectiveStatus || row.status || 'UNKNOWN';
              const platform = String(row.platform ?? 'meta').replace(/_/g, ' ');
              const results = row.messages || row.leads;
              return (
                <View key={row.id} style={styles.livePlatformRow}>
                  <View style={styles.livePlatformHeader}>
                    <Text style={styles.livePlatformName}>{platform}</Text>
                    <Text style={styles.livePlatformPosts}>{status}</Text>
                  </View>
                  <Text style={styles.livePlatformMetrics}>
                    {t('Spend')}: {formatMoney(row.spend, adPerformance.currency)} | {t('Impressions')}: {formatCount(row.impressions)} |{' '}
                    {t('Clicks')}: {formatCount(row.clicks)} | {t('Messaging conversations')}: {formatCount(row.messages)} |{' '}
                    {t('Results')}: {formatCount(results)} | {t('CTR')}: {safeNumber(row.ctr).toFixed(2)}%
                  </Text>
                  {row.errorMessage ? <Text style={styles.adErrorText}>{row.errorMessage}</Text> : null}
                </View>
              );
            })}
          </View>
        ) : (
          <Text style={styles.emptyState}>{t('No boosted ad performance has been recorded yet.')}</Text>
        )}
        <Text style={styles.liveUpdatedAt}>
          {adPerformanceUpdatedAt}
        </Text>
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
              theme={VictoryTheme.material}
              height={300}
              domain={{ y: [0, heatmapScale.top * 1.12] }}
              domainPadding={{ x: heatmapGrouping === 'day' ? 28 : 34, y: 18 }}
              padding={{ top: 42, bottom: 52, left: 68, right: 28 }}
            >
              <VictoryAxis
                tickValues={heatmapTickValues}
                tickFormat={(tick: number | string) => formatHeatmapTick(Number(tick))}
                style={{
                  axis: { stroke: colors.border },
                  tickLabels: { fill: colors.subtext, fontSize: selectedRange.days > 30 ? 10 : 11, padding: 10 },
                  grid: { stroke: 'transparent' }
                }}
              />
              <VictoryAxis
                dependentAxis
                tickValues={heatmapScale.ticks}
                tickFormat={(tick: number | string) => formatAxisCount(Number(tick))}
                style={{
                  axis: { stroke: colors.border },
                  tickLabels: { fill: colors.subtext, fontSize: 11, padding: 6 },
                  grid: { stroke: 'rgba(155, 169, 202, 0.16)', strokeDasharray: '4,6' }
                }}
              />
              <VictoryBar
                cornerRadius={{ top: 12, bottom: 6 }}
                style={{
                  data: {
                    fill: ({ datum }: { datum: any }) =>
                      datum.isToday ? colors.accentSecondary : colors.accent,
                    stroke: ({ datum }: { datum: any }) =>
                      datum.isToday ? 'rgba(255,255,255,0.42)' : 'rgba(255,255,255,0.24)',
                    strokeWidth: 1.5,
                    opacity: 0.96,
                  },
                  labels: {
                    fill: colors.text,
                    fontSize: selectedRange.days > 30 ? 8 : 10,
                    fontWeight: '700',
                  },
                }}
                data={heatmapChartData}
                x="xPosition"
                y="value"
                labels={({ datum }: { datum: any }) =>
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
  closureCountdownWrap: {
    backgroundColor: colors.backgroundAlt,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    marginTop: 4,
    marginBottom: 12,
  },
  closureCountdownValue: {
    color: colors.accent,
    fontSize: 30,
    fontWeight: '800',
  },
  closureCountdownLabel: {
    color: colors.subtext,
    lineHeight: 20,
    marginTop: 6,
  },
  closureMetaRow: {
    marginBottom: 8,
  },
  closureMetaLabel: {
    color: colors.subtext,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  closureMetaValue: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    marginTop: 4,
  },
  closureMessage: {
    color: colors.text,
    lineHeight: 20,
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
  rangeSummaryRow: {
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  rangeSummaryLabel: {
    color: colors.subtext,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
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
  rangeButtonInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.backgroundAlt,
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
  liveSnapshotHint: {
    color: colors.subtext,
    fontSize: 11,
    marginBottom: 10,
    lineHeight: 17,
  },
  adStatusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  adStatusPill: {
    color: colors.subtext,
    backgroundColor: colors.backgroundAlt,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 12,
    fontWeight: '700',
  },
  adErrorText: {
    color: colors.danger,
    fontSize: 11,
    lineHeight: 16,
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

