import OpenAI from 'openai';
import { config } from '../config';
import { firestore } from '../db/firestore';
import {
  AnalyticsService,
  getActivityHeatmap,
  getEngagementStats,
  getFollowupStats,
  getInboundStats,
  getOutboundStats,
  getWebLeadStats,
  getWebTrafficStats,
  type ActivityHeatmapDaily,
  type AnalyticsSummary,
  type EngagementStats,
  type FollowupStats,
  type InboundStats,
  type OutboundStats,
  type WebLeadStats,
  type WebTrafficStats,
} from './analyticsService';
import { SocialAnalyticsService } from '../packages/services/socialAnalyticsService';
import { AssistantStrategyService } from './assistantStrategyService';
import { KnowledgeBaseService } from './knowledgeBaseService';
import { getLiveSocialMetrics, type LiveSocialMetrics } from './liveSocialMetricsService';
import { metaAdsControlService, type MetaAdsAction } from './metaAdsControlService';
import { supabaseFallbackService } from './supabaseFallbackService';

const assistantAI = new OpenAI({
  apiKey: config.assistantAI.apiKey,
  baseURL: config.assistantAI.baseURL,
  timeout: Number(process.env.ASSISTANT_AI_TIMEOUT_MS ?? 20_000),
  maxRetries: 1,
});
const analyticsService = new AnalyticsService();
const socialAnalyticsService = new SocialAnalyticsService();
const strategyService = new AssistantStrategyService();
const knowledgeBase = new KnowledgeBaseService();

const extractOpenAIError = (error: unknown) => {
  const err = error as {
    status?: number;
    code?: string;
    message?: string;
    response?: { status?: number; data?: { error?: { code?: string; message?: string } } };
    error?: { code?: string; message?: string };
  };
  const status = err?.status ?? err?.response?.status;
  const code = err?.code ?? err?.error?.code ?? err?.response?.data?.error?.code;
  const message = err?.message ?? err?.error?.message ?? err?.response?.data?.error?.message;
  return { status, code, message };
};

const buildAssistantErrorText = (kind: 'billing' | 'auth' | 'generic') => {
  if (kind === 'billing') {
    return `AI is temporarily offline because ${config.assistantAI.provider} credits or usage limits are exhausted. Please try again shortly.`;
  }
  if (kind === 'auth') {
    return `AI is temporarily offline due to a ${config.assistantAI.provider} authentication issue. Please check the API key and try again.`;
  }
  return 'I encountered a temporary issue connecting to my brain. Please try again shortly.';
};

type Locale = string;

const LOCALE_RESPONSE_LANGUAGE: Record<string, string> = {
  en: 'English',
  zh: 'Simplified Chinese',
  es: 'Spanish',
  ar: 'Arabic',
  pt: 'Portuguese (Brazil)',
  fr: 'French',
  ja: 'Japanese',
  ru: 'Russian',
  de: 'German',
  ko: 'Korean',
  hi: 'Hindi',
  it: 'Italian',
  tr: 'Turkish',
  vi: 'Vietnamese',
  th: 'Thai',
  nl: 'Dutch',
  pl: 'Polish',
  sv: 'Swedish',
  no: 'Norwegian',
  da: 'Danish',
  fi: 'Finnish',
  el: 'Greek',
  he: 'Hebrew',
  cs: 'Czech',
  hu: 'Hungarian',
  ro: 'Romanian',
  bg: 'Bulgarian',
  uk: 'Ukrainian',
  id: 'Indonesian',
  ms: 'Malay',
  tl: 'Filipino',
  fa: 'Persian',
  ur: 'Urdu',
  bn: 'Bengali',
  ta: 'Tamil',
  te: 'Telugu',
  mr: 'Marathi',
  gu: 'Gujarati',
  pa: 'Punjabi',
  kn: 'Kannada',
  ml: 'Malayalam',
  sw: 'Swahili',
  ha: 'Hausa',
  yo: 'Yoruba',
  zu: 'Zulu',
  af: 'Afrikaans',
  sr: 'Serbian',
  hr: 'Croatian',
  sk: 'Slovak',
  sl: 'Slovenian',
  lt: 'Lithuanian',
  lv: 'Latvian',
  et: 'Estonian',
  ca: 'Catalan',
  ne: 'Nepali',
};

type AssistantContext = {
  userId?: string;
  userEmail?: string;
  company?: string;
  orgId?: string;
  businessGoals?: string;
  targetAudience?: string;
  currentScreen?: string;
  subscriptionStatus?: string;
  connectedChannels?: string[];
  locale?: Locale;
  assistantTone?: string;
  assistantVoice?: string;
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  analytics?: {
    leads?: number;
    engagement?: number;
    conversions?: number;
    feedbackScore?: number;
  };
};

type AssistantAccountSnapshot = {
  company?: string;
  orgId?: string;
  email?: string;
  phone?: string;
  businessGoals?: string;
  targetAudience?: string;
  subscriptionStatus?: string;
  connectedChannels: string[];
  analyticsSummary: AnalyticsSummary;
  liveSocial: LiveSocialMetrics;
  outbound: OutboundStats;
  inbound: InboundStats;
  engagement: EngagementStats;
  followups: FollowupStats;
  webLeads: WebLeadStats;
  webTraffic: WebTrafficStats;
  activityHeatmap: ActivityHeatmapDaily[];
  socialDaily: Array<Record<string, unknown>>;
  postingHistory: Array<Record<string, unknown>>;
  socialAccounts: Record<string, unknown>;
  adsAccount: Record<string, unknown>;
  metricHistory: Record<string, Array<{ date: string; counters: Record<string, unknown> }>>;
};

const emptyLiveSocialMetrics = (): LiveSocialMetrics => ({
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
});

const emptyAnalyticsSummary = (): AnalyticsSummary => ({
  leads: 0,
  engagement: 0,
  conversions: 0,
  feedbackScore: 0,
  jobBreakdown: {
    active: 0,
    queued: 0,
    failed: 0,
  },
  recentJobs: [],
  history: [],
});

const emptyOutboundStats = (): OutboundStats => ({
  prospectsContacted: 0,
  responders: 0,
  replies: 0,
  positiveReplies: 0,
  conversions: 0,
  demoBookings: 0,
  conversionRate: 0,
});

const emptyInboundStats = (): InboundStats => ({
  messages: 0,
  leads: 0,
  avgSentiment: 0,
  conversionRate: 0,
});

const emptyEngagementStats = (): EngagementStats => ({
  comments: 0,
  replies: 0,
  conversions: 0,
  conversionRate: 0,
});

const emptyFollowupStats = (): FollowupStats => ({
  sent: 0,
  replies: 0,
  conversions: 0,
  replyRate: 0,
  conversionRate: 0,
});

const emptyWebLeadStats = (): WebLeadStats => ({
  leads: 0,
  messages: 0,
  conversionRate: 0,
});

const emptyWebTrafficStats = (): WebTrafficStats => ({
  visitors: 0,
  interactions: 0,
  redirectClicks: 0,
  engagementRate: 0,
  sourceVisitors: {},
  sourceInteractions: {},
  sourceRedirectClicks: {},
  placementVisitors: {},
  placementInteractions: {},
  placementRedirectClicks: {},
  sourcePlacementRedirectClicks: {},
});

export class AssistantService {
  private shouldProvideWeeklySummary(question: string) {
    const normalized = question.toLowerCase();
    const weekMention =
      /\b(week|weekly|this week|last week|semaine|hebdo|cette semaine|semaine derniere|woche|diese woche|letzte woche|woechentlich)\b/.test(
        normalized
      );
    const metricMention =
      /\b(performance|summary|stats|kpi|metrics|engagement|leads|conversions|resume|statistiques|metriques|leistung|zusammenfassung|statistiken|kennzahlen|metriken|konversionen)\b/.test(
        normalized
      );
    const zhWeekMention = /本周|上周|每周|周报|本星期|上星期/.test(normalized);
    const zhMetricMention = /绩效|表现|统计|指标|数据|参与度|线索|转化/.test(normalized);
    const arWeekMention = /اسبوع|أسبوع|الاسبوع|الأسبوع|هذا الاسبوع|هذا الأسبوع|الاسبوع الماضي|الأسبوع الماضي/.test(
      normalized
    );
    const arMetricMention = /اداء|الأداء|مؤشر|مؤشرات|احصائيات|احصاء|مقاييس|تفاعل|عملاء محتملين|تحويلات/.test(
      normalized
    );
    const esWeekMention = /semana|semanal|esta semana|la semana pasada/.test(normalized);
    const esMetricMention =
      /rendimiento|resumen|estadisticas|estadísticas|kpi|metricas|métricas|engagement|interaccion|interacción|leads|conversiones/.test(
        normalized
      );
    const ptWeekMention = /semana|semanal|esta semana|semana passada/.test(normalized);
    const ptMetricMention =
      /desempenho|resumo|estatisticas|estatísticas|kpi|metricas|métricas|engajamento|leads|conversoes|conversões/.test(
        normalized
      );
    const idWeekMention = /minggu|minggu ini|minggu lalu|mingguan/.test(normalized);
    const idMetricMention = /kinerja|ringkasan|statistik|kpi|metrik|engagement|interaksi|leads|konversi/.test(
      normalized
    );
    const jaWeekMention = /今週|先週|週間/.test(normalized);
    const jaMetricMention = /パフォーマンス|概要|統計|kpi|指標|エンゲージメント|リード|コンバージョン/.test(
      normalized
    );
    const ruWeekMention = /недел|на этой неделе|прошлой неделе|еженедельно/.test(normalized);
    const ruMetricMention = /производительност|сводка|статистик|kpi|метрик|вовлеченност|лид|конверс/.test(
      normalized
    );
    const koWeekMention = /이번 주|이번주|지난주|주간/.test(normalized);
    const koMetricMention = /성과|요약|통계|kpi|지표|참여|리드|전환/.test(normalized);
    return (
      (weekMention && metricMention) ||
      (zhWeekMention && zhMetricMention) ||
      (arWeekMention && arMetricMention) ||
      (esWeekMention && esMetricMention) ||
      (ptWeekMention && ptMetricMention) ||
      (idWeekMention && idMetricMention) ||
      (jaWeekMention && jaMetricMention) ||
      (ruWeekMention && ruMetricMention) ||
      (koWeekMention && koMetricMention)
    );
  }

  private shouldDraftStrategy(question: string) {
    const normalized = question.toLowerCase();
    return (
      /\b(strategy|growth strategy|marketing plan|growth plan|campaign plan|strategy plan|action plan|go to market|g2m)\b/.test(
        normalized,
      ) ||
      (/\b(solution|solutions|recommendation|recommendations)\b/.test(normalized) &&
        /\b(grow|growth|improve|performance|account|business|marketing)\b/.test(normalized))
    );
  }

  private shouldApplyStrategy(question: string) {
    const normalized = question.toLowerCase();
    const approve = /\b(approve|approved|accept|apply|implement|go ahead|activate|start|do it)\b/.test(normalized);
    const mentionsStrategy = /\b(strategy|plan|draft)\b/.test(normalized);
    const hasId = /strat-[a-z0-9]{6}/i.test(normalized);
    const referencesLatestDraft = /\b(this|that|it)\b/.test(normalized);
    return approve && (mentionsStrategy || hasId || referencesLatestDraft);
  }

  private extractStrategyId(question: string) {
    const match = question.match(/strat-[a-z0-9]{6}/i);
    return match ? match[0].toUpperCase() : undefined;
  }

  private shouldSendMonthlyReport(question: string) {
    const normalized = question.toLowerCase();
    const hasReport = /\b(report|summary|recap)\b/.test(normalized);
    const hasMonthly = /\b(month|monthly)\b/.test(normalized);
    const hasEmail = /\b(email|send)\b/.test(normalized);
    return (hasReport && hasMonthly) || (hasReport && hasEmail);
  }

  private extractEmailAddresses(question: string): string[] {
    const emails = Array.from(
      new Set(
        (question.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).map(email => email.toLowerCase())
      )
    );
    return emails;
  }

  private normalizeAssistantTone(value?: string) {
    const normalized = `${value ?? ''}`.trim().toLowerCase();
    if (normalized.includes('fresh')) return 'fresh';
    if (normalized.includes('friendly')) return 'friendly';
    if (normalized.includes('formal')) return 'formal';
    if (normalized.includes('casual')) return 'casual';
    if (normalized.includes('playful')) return 'playful';
    return '';
  }

  private normalizeAssistantVoice(value?: string) {
    const normalized = `${value ?? ''}`.trim().toLowerCase();
    if (normalized.includes('female') || normalized.includes('woman')) return 'female';
    if (normalized.includes('male') || normalized.includes('man')) return 'male';
    if (normalized.includes('any') || normalized.includes('neutral')) return 'neutral';
    return '';
  }

  private buildPersonalityPrompt(context: AssistantContext) {
    const tone = this.normalizeAssistantTone(context.assistantTone);
    const voice = this.normalizeAssistantVoice(context.assistantVoice);
    const parts: string[] = [];

    if (tone === 'fresh') {
      parts.push('Use a fresh, upbeat tone that feels modern, approachable, and energetic. Keep the response light, optimistic, and easy to read.');
    } else if (tone === 'friendly') {
      parts.push('Use a friendly, warm tone that feels helpful and encouraging.');
    } else if (tone === 'formal') {
      parts.push('Use a professional, polished tone with clear, businesslike language.');
    } else if (tone === 'casual') {
      parts.push('Use a casual, conversational tone that feels relaxed and easygoing.');
    }

    if (voice === 'female') {
      parts.push('Adopt a womanly voice with empathy, gentle confidence, and thoughtful phrasing.');
    } else if (voice === 'male') {
      parts.push('Adopt a manly voice with confident, direct phrasing and constructive energy.');
    }

    return parts.filter(Boolean).join(' ');
  }

  private resolveLocale(value?: string): Locale {
    if (value && LOCALE_RESPONSE_LANGUAGE[value]) return value;
    return 'en';
  }

  private computeAverage(values: number[]) {
    if (!values.length) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  private formatDelta(label: string, current: number, previous: number, unit: string, locale: Locale) {
    const diff = current - previous;
    const absDiff = Math.abs(diff);
    const roundedCurrent = Number.isInteger(current) ? current : Number(current.toFixed(1));
    const formattedCurrent = unit ? `${roundedCurrent}${unit}` : `${roundedCurrent}`;
    const words =
      locale === 'fr'
        ? { up: 'en hausse de', down: 'en baisse de', flat: 'stable a', now: 'actuel', from: 'en hausse de 0 a' }
        : locale === 'de'
          ? { up: 'gestiegen um', down: 'gesunken um', flat: 'stabil bei', now: 'jetzt', from: 'gestiegen von 0 auf' }
          : locale === 'es'
            ? { up: 'subió', down: 'bajó', flat: 'estable en', now: 'ahora', from: 'subió de 0 a' }
            : locale === 'pt'
              ? { up: 'subiu', down: 'caiu', flat: 'estável em', now: 'agora', from: 'subiu de 0 para' }
              : locale === 'id'
                ? { up: 'naik', down: 'turun', flat: 'stabil di', now: 'sekarang', from: 'naik dari 0 ke' }
                : locale === 'ja'
                  ? { up: '増加', down: '減少', flat: '横ばい', now: '現在', from: '0から増加して' }
                  : locale === 'ru'
                    ? { up: 'рост', down: 'снижение', flat: 'без изменений на', now: 'сейчас', from: 'выросло с 0 до' }
                    : locale === 'ko'
                      ? { up: '증가', down: '감소', flat: '유지', now: '현재', from: '0에서 증가하여' }
                      : locale === 'ar'
            ? { up: 'ارتفاع', down: 'انخفاض', flat: 'ثابت عند', now: 'الان', from: 'ارتفع من 0 الى' }
            : locale === 'zh'
              ? { up: '上升', down: '下降', flat: '持平为', now: '当前', from: '从 0 上升到' }
              : { up: 'up', down: 'down', flat: 'flat at', now: 'now', from: 'up from 0 to' };

    if (previous === 0) {
      if (current === 0) {
        return `${label} ${words.flat} ${formattedCurrent}`;
      }
      return `${label} ${words.from} ${formattedCurrent}`;
    }
    if (diff > 0) {
      return `${label} ${words.up} ${Number(absDiff.toFixed(1))}${unit} (${words.now} ${formattedCurrent})`;
    }
    if (diff < 0) {
      return `${label} ${words.down} ${Number(absDiff.toFixed(1))}${unit} (${words.now} ${formattedCurrent})`;
    }
    return `${label} ${words.flat} ${formattedCurrent}`;
  }

  private formatWholeNumber(value: number) {
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.max(0, Number(value ?? 0)));
  }

  private isBettingBrand(snapshot: Pick<AssistantAccountSnapshot, 'company' | 'businessGoals'>) {
    const haystack = `${snapshot.company ?? ''} ${snapshot.businessGoals ?? ''}`.toLowerCase();
    return haystack.includes('bwin') || haystack.includes('bet');
  }

  private getConversionLabel(snapshot: Pick<AssistantAccountSnapshot, 'company' | 'businessGoals'>) {
    return this.isBettingBrand(snapshot) ? 'bet button clicks' : 'conversions';
  }

  private async safeResolve<T>(label: string, action: () => Promise<T>, fallback: T) {
    try {
      const timeoutMs = Number(process.env.ASSISTANT_CONTEXT_TIMEOUT_MS ?? 1_500);
      return await Promise.race([
        action(),
        new Promise<T>((resolve) => setTimeout(() => resolve(fallback), timeoutMs)),
      ]);
    } catch (error) {
      console.warn(`[assistant] failed to load ${label}`, (error as Error).message);
      return fallback;
    }
  }

  private resolveConnectedChannels(userData: Record<string, any> | undefined, fallback: string[] = []) {
    const accounts = (userData?.socialAccounts ?? {}) as Record<string, any>;
    const detected = [
      accounts.facebook?.accessToken && accounts.facebook?.pageId ? 'facebook' : null,
      accounts.instagram?.accessToken && accounts.instagram?.accountId ? 'instagram' : null,
      accounts.threads?.accessToken && accounts.threads?.accountId ? 'threads' : null,
      accounts.linkedin?.accessToken && accounts.linkedin?.urn ? 'linkedin' : null,
      accounts.twitter?.accessToken && accounts.twitter?.accessSecret ? 'x' : null,
      accounts.tiktok?.accessToken && (accounts.tiktok?.openId || accounts.tiktok?.accountId) ? 'tiktok' : null,
      accounts.youtube?.accessToken && (accounts.youtube?.refreshToken || accounts.youtube?.channelId) ? 'youtube' : null,
      accounts.whatsapp?.accessToken && accounts.whatsapp?.phoneNumberId ? 'whatsapp' : null,
    ].filter(Boolean) as string[];

    if (detected.length) {
      return Array.from(new Set(detected));
    }
    return Array.from(new Set(fallback.filter(Boolean)));
  }

  private buildPlatformHighlights(snapshot: AssistantAccountSnapshot) {
    const platforms = Object.entries(snapshot.liveSocial.platforms)
      .filter(([name, stats]) => name !== 'web' && stats.connected)
      .map(([name, stats]) => ({
        name,
        views: Number(stats.views ?? 0),
        interactions: Number(stats.interactions ?? 0),
        conversions: Number(stats.conversions ?? 0),
      }))
      .sort((a, b) => b.views - a.views)
      .slice(0, 3);

    if (!platforms.length) {
      return 'No connected social channels are currently returning live metrics.';
    }

    return platforms
      .map(
        platform =>
          `${platform.name}: ${this.formatWholeNumber(platform.views)} views, ${this.formatWholeNumber(
            platform.interactions,
          )} interactions, ${this.formatWholeNumber(platform.conversions)} ${this.getConversionLabel(snapshot)}`,
      )
      .join('; ');
  }

  private buildPostingActivitySummary(rows: Array<Record<string, unknown>>) {
    if (!rows.length) {
      return 'Posting activity in the last 7 days is not available yet.';
    }
    type PostingActivityTotals = {
      posted: number;
      failed: number;
      skipped: number;
      platformCounts: Record<string, number>;
    };
    const totals: PostingActivityTotals = rows.reduce<PostingActivityTotals>(
      (acc: PostingActivityTotals, row) => {
        acc.posted += Number(row.postsPosted ?? 0);
        acc.failed += Number(row.postsFailed ?? 0);
        acc.skipped += Number(row.postsSkipped ?? 0);
        const perPlatform = (row.perPlatform ?? {}) as Record<string, number>;
        Object.entries(perPlatform).forEach(([platform, count]) => {
          acc.platformCounts[platform] = (acc.platformCounts[platform] ?? 0) + Number(count ?? 0);
        });
        return acc;
      },
      {
        posted: 0,
        failed: 0,
        skipped: 0,
        platformCounts: {} as Record<string, number>,
      } satisfies PostingActivityTotals,
    );

    const topPlatforms = Object.entries(totals.platformCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([platform, count]) => `${platform} ${this.formatWholeNumber(Number(count))}`)
      .join(', ');

    return `Posting in the last 7 days: ${this.formatWholeNumber(totals.posted)} posted, ${this.formatWholeNumber(
      totals.failed,
    )} failed, ${this.formatWholeNumber(totals.skipped)} skipped.${topPlatforms ? ` Top channels: ${topPlatforms}.` : ''}`;
  }

  private buildDailyReviewSummary(snapshot: AssistantAccountSnapshot) {
    const todayKey = new Date().toISOString().slice(0, 10);
    const todayRow = snapshot.activityHeatmap.find(row => row.date === todayKey);
    if (!todayRow) {
      return 'Today has no recorded activity yet.';
    }
    return `Today so far: ${this.formatWholeNumber(todayRow.views)} views, ${this.formatWholeNumber(
      todayRow.interactions,
    )} interactions, ${this.formatWholeNumber(todayRow.outbound)} outbound actions, ${this.formatWholeNumber(
      todayRow.conversions,
    )} ${this.getConversionLabel(snapshot)}.`;
  }

  private buildWeeklyPerformanceSummary(snapshot: AssistantAccountSnapshot) {
    const weekRows = snapshot.activityHeatmap.slice(-7);
    if (!weekRows.length) {
      return 'Weekly performance is still warming up; I do not have enough recent live activity yet.';
    }
    const totals = weekRows.reduce(
      (acc, row) => {
        acc.views += Number(row.views ?? 0);
        acc.interactions += Number(row.interactions ?? 0);
        acc.outbound += Number(row.outbound ?? 0);
        acc.conversions += Number(row.conversions ?? 0);
        return acc;
      },
      { views: 0, interactions: 0, outbound: 0, conversions: 0 },
    );
    return `This week so far: ${this.formatWholeNumber(totals.views)} views, ${this.formatWholeNumber(
      totals.interactions,
    )} interactions, ${this.formatWholeNumber(totals.outbound)} outbound actions, ${this.formatWholeNumber(
      totals.conversions,
    )} ${this.getConversionLabel(snapshot)}.`;
  }

  private buildMetricInsight(snapshot: AssistantAccountSnapshot, metric?: string) {
    const conversionLabel = this.getConversionLabel(snapshot);
    switch (metric) {
      case 'views':
        return `Live views across connected channels are ${this.formatWholeNumber(
          snapshot.liveSocial.summary.views,
        )} over the last ${snapshot.liveSocial.lookbackHours} hours. ${this.buildPlatformHighlights(snapshot)}`;
      case 'interactions':
        return `Live interactions are ${this.formatWholeNumber(
          snapshot.liveSocial.summary.interactions,
        )} with an engagement rate of ${snapshot.liveSocial.summary.engagementRate.toFixed(2)}%. ${this.buildPlatformHighlights(
          snapshot,
        )}`;
      case 'outbound':
        return `Outbound activity has sent ${this.formatWholeNumber(
          snapshot.outbound.prospectsContacted,
        )} messages, produced ${this.formatWholeNumber(snapshot.outbound.replies)} replies, and ${this.formatWholeNumber(
          snapshot.outbound.conversions,
        )} conversions.`;
      case 'conversions':
        return `Current ${conversionLabel} are ${this.formatWholeNumber(
          snapshot.liveSocial.summary.conversions || snapshot.webTraffic.redirectClicks || snapshot.outbound.conversions,
        )}. Web redirect clicks are ${this.formatWholeNumber(snapshot.webTraffic.redirectClicks)} and outbound conversions are ${this.formatWholeNumber(snapshot.outbound.conversions)}.`;
      default:
        return [
          this.buildDailyReviewSummary(snapshot),
          this.buildWeeklyPerformanceSummary(snapshot),
          `Live social summary: ${this.formatWholeNumber(snapshot.liveSocial.summary.views)} views, ${this.formatWholeNumber(
            snapshot.liveSocial.summary.interactions,
          )} interactions, ${this.formatWholeNumber(snapshot.liveSocial.summary.conversions)} ${conversionLabel}.`,
          `Outbound: ${this.formatWholeNumber(snapshot.outbound.prospectsContacted)} contacted, ${this.formatWholeNumber(
            snapshot.outbound.replies,
          )} replies, ${this.formatWholeNumber(snapshot.outbound.conversions)} conversions.`,
        ].join(' ');
    }
  }

  private async loadMetricHistory(userId: string, scopeId?: string) {
    const metrics = ['dashboardDaily', 'webTraffic', 'outbound', 'engagement'] as const;
    const entries = await Promise.all(metrics.map(async metric => {
      const [userRows, scopedRows] = await Promise.all([
        supabaseFallbackService.getMetricDailyRows(metric, { userId }, 30),
        scopeId
          ? supabaseFallbackService.getMetricDailyRows(metric, { userId, scopeId }, 30)
          : Promise.resolve([]),
      ]);
      const byDate = new Map(userRows.map(row => [row.date, row]));
      scopedRows.forEach(row => byDate.set(row.date, row));
      return [metric, [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-30)] as const;
    }));
    return Object.fromEntries(entries);
  }

  private async loadAccountSnapshot(context: AssistantContext): Promise<AssistantAccountSnapshot | null> {
    if (!context.userId) {
      return null;
    }

    const [supabaseProfile, supabaseUser] = await Promise.all([
      this.safeResolve('Supabase profile', () => supabaseFallbackService.getProfile(context.userId!), null),
      this.safeResolve('Supabase user', () => supabaseFallbackService.getUser(context.userId!), null),
    ]);
    const [profileSnap, userSnap] = await Promise.all([
      supabaseProfile ? Promise.resolve(null) : this.safeResolve('Firebase profile fallback', () => firestore.collection('profiles').doc(context.userId!).get(), null),
      supabaseUser ? Promise.resolve(null) : this.safeResolve('Firebase user fallback', () => firestore.collection('users').doc(context.userId!).get(), null),
    ]);

    const profileData = supabaseProfile
      ? ({ ...(supabaseProfile.data as Record<string, any>), crmData: supabaseProfile.crmData, user: supabaseProfile.userData, subscriptionStatus: supabaseProfile.subscriptionStatus } as Record<string, any>)
      : ((profileSnap?.data() as Record<string, any> | undefined) ?? {});
    const crmData = (profileData.crmData as Record<string, any> | undefined) ?? {};
    const userData = supabaseUser
      ? ({ ...(supabaseUser.data as Record<string, any>), email: supabaseUser.email, name: supabaseUser.name } as Record<string, any>)
      : ((userSnap?.data() as Record<string, any> | undefined) ?? {});
    const scopeId =
      context.orgId?.trim() || `${crmData.orgId ?? ''}`.trim() || `${userData.orgId ?? ''}`.trim() || undefined;
    const analyticsScope = {
      userId: context.userId,
      scopeId,
    };

    const [
      analyticsSummary,
      liveSocial,
      outbound,
      inbound,
      engagement,
      followups,
      webLeads,
      webTraffic,
      activityHeatmap,
      socialDaily,
      scheduledPosts,
      socialLogs,
      storedSocialAccounts,
      adsAccount,
      metricHistory,
    ] = await Promise.all([
      this.safeResolve('analytics summary', () => analyticsService.getSummary(context.userId!), emptyAnalyticsSummary()),
      this.safeResolve('live social metrics', () => getLiveSocialMetrics(context.userId!, { scope: analyticsScope, lookbackHours: 30 * 24 }), emptyLiveSocialMetrics()),
      this.safeResolve('outbound stats', () => getOutboundStats(analyticsScope), emptyOutboundStats()),
      this.safeResolve('inbound stats', () => getInboundStats(analyticsScope), emptyInboundStats()),
      this.safeResolve('engagement stats', () => getEngagementStats(analyticsScope), emptyEngagementStats()),
      this.safeResolve('follow-up stats', () => getFollowupStats(analyticsScope), emptyFollowupStats()),
      this.safeResolve('web lead stats', () => getWebLeadStats(analyticsScope), emptyWebLeadStats()),
      this.safeResolve('web traffic stats', () => getWebTrafficStats(analyticsScope), emptyWebTrafficStats()),
      this.safeResolve('activity heatmap', () => getActivityHeatmap(analyticsScope, 30), [] as ActivityHeatmapDaily[]),
      this.safeResolve('social daily', () => socialAnalyticsService.getDailySummary(context.userId!, 30), [] as Array<Record<string, unknown>>),
      this.safeResolve('scheduled posting history', () => supabaseFallbackService.getPostsByUser(context.userId!, 150), []),
      this.safeResolve('social posting logs', () => supabaseFallbackService.getSocialLogsByUser(context.userId!, 150), []),
      this.safeResolve('connected social accounts', () => supabaseFallbackService.getSocialAccounts(context.userId!), null),
      this.safeResolve('Meta Ads account status', () => metaAdsControlService.getConnectionStatus(context.userId!), {
        mcpConnected: false,
        graphConnected: false,
        accountCount: 0,
        selectedAdAccountId: null,
        provider: 'none',
      }),
      this.safeResolve('complete 30-day metric history', () => this.loadMetricHistory(context.userId!, scopeId), {}),
    ]);

    const socialAccounts = (storedSocialAccounts?.socialAccounts && typeof storedSocialAccounts.socialAccounts === 'object')
      ? storedSocialAccounts.socialAccounts as Record<string, unknown>
      : {};
    const storedChannels = Object.entries(socialAccounts)
      .filter(([, value]) => Boolean(value && (typeof value !== 'object' || (value as Record<string, unknown>).connected !== false)))
      .map(([platform]) => platform.toLowerCase());
    const connectedChannels = Array.from(new Set([
      ...this.resolveConnectedChannels(userData, context.connectedChannels),
      ...storedChannels,
    ]));
    const postingHistory = [
      ...scheduledPosts.map(post => ({ source: 'scheduled_posts', ...post })),
      ...socialLogs.map(log => ({ source: 'social_logs', ...log })),
    ].slice(0, 250) as Array<Record<string, unknown>>;

    return {
      company: context.company ?? crmData.companyName ?? userData.name,
      orgId: scopeId,
      email: context.userEmail ?? crmData.email ?? userData.email,
      phone: crmData.phone,
      businessGoals: context.businessGoals ?? crmData.businessGoals,
      targetAudience: context.targetAudience ?? crmData.targetAudience,
      subscriptionStatus: context.subscriptionStatus ?? profileData.subscriptionStatus,
      connectedChannels,
      analyticsSummary,
      liveSocial,
      outbound,
      inbound,
      engagement,
      followups,
      webLeads,
      webTraffic,
      activityHeatmap,
      socialDaily,
      postingHistory,
      socialAccounts,
      adsAccount: adsAccount as Record<string, unknown>,
      metricHistory,
    };
  }

  private buildAccountContextBlock(snapshot: AssistantAccountSnapshot) {
    const conversionLabel = this.getConversionLabel(snapshot);
    const automationLine = snapshot.analyticsSummary.recentJobs.length
      ? snapshot.analyticsSummary.recentJobs
          .slice(0, 4)
          .map(job => `${job.status}${job.updatedAt ? ` (${job.updatedAt})` : ''}`)
          .join(', ')
      : 'none';

    return [
      snapshot.company ? `Account company: ${snapshot.company}` : '',
      snapshot.email ? `Primary email: ${snapshot.email}` : '',
      snapshot.phone ? `Primary phone: ${snapshot.phone}` : '',
      snapshot.businessGoals ? `Business goals: ${snapshot.businessGoals}` : '',
      snapshot.targetAudience ? `Target audience: ${snapshot.targetAudience}` : '',
      snapshot.subscriptionStatus ? `Subscription status: ${snapshot.subscriptionStatus}` : '',
      `Connected channels: ${snapshot.connectedChannels.length ? snapshot.connectedChannels.join(', ') : 'none connected'}`,
      `Connected social account details: ${Object.keys(snapshot.socialAccounts).length ? JSON.stringify(snapshot.socialAccounts) : 'none stored'}.`,
      `Meta Ads account: ${JSON.stringify(snapshot.adsAccount)}.`,
      `Dashboard daily metrics (up to 30 days, oldest to newest): ${JSON.stringify(snapshot.analyticsSummary.history.slice(-30))}.`,
      `Complete account metric history by category (up to 30 days): ${JSON.stringify(snapshot.metricHistory)}.`,
      this.buildDailyReviewSummary(snapshot),
      this.buildWeeklyPerformanceSummary(snapshot),
      `Live social performance (last ${snapshot.liveSocial.lookbackHours}h): ${this.formatWholeNumber(
        snapshot.liveSocial.summary.views,
      )} views, ${this.formatWholeNumber(snapshot.liveSocial.summary.interactions)} interactions, engagement rate ${snapshot.liveSocial.summary.engagementRate.toFixed(
        2,
      )}%, ${this.formatWholeNumber(snapshot.liveSocial.summary.conversions)} ${conversionLabel}.`,
      `Top platform view: ${this.buildPlatformHighlights(snapshot)}`,
      `Outbound engine: ${this.formatWholeNumber(snapshot.outbound.prospectsContacted)} contacted, ${this.formatWholeNumber(
        snapshot.outbound.replies,
      )} replies, ${this.formatWholeNumber(snapshot.outbound.positiveReplies)} positive replies, ${this.formatWholeNumber(
        snapshot.outbound.conversions,
      )} conversions, ${this.formatWholeNumber(snapshot.outbound.demoBookings)} demos booked.`,
      `Inbound and engagement: ${this.formatWholeNumber(snapshot.inbound.messages)} inbound messages, ${this.formatWholeNumber(
        snapshot.inbound.leads,
      )} qualified leads, ${this.formatWholeNumber(snapshot.engagement.comments)} comments, ${this.formatWholeNumber(
        snapshot.engagement.replies,
      )} replies sent, ${this.formatWholeNumber(snapshot.engagement.conversions)} engagement conversions.`,
      `Follow-ups and web: ${this.formatWholeNumber(snapshot.followups.sent)} follow-ups sent, ${this.formatWholeNumber(
        snapshot.followups.replies,
      )} replies, ${this.formatWholeNumber(snapshot.webTraffic.visitors)} website visitors, ${this.formatWholeNumber(
        snapshot.webTraffic.redirectClicks,
      )} web redirect clicks, ${this.formatWholeNumber(snapshot.webLeads.leads)} web leads.`,
      this.buildPostingActivitySummary(snapshot.socialDaily),
      `Posting history (latest ${Math.min(snapshot.postingHistory.length, 40)} records): ${JSON.stringify(snapshot.postingHistory.slice(0, 40))}.`,
      `Automation/job status: active ${this.formatWholeNumber(snapshot.analyticsSummary.jobBreakdown.active)}, queued ${this.formatWholeNumber(
        snapshot.analyticsSummary.jobBreakdown.queued,
      )}, failed ${this.formatWholeNumber(snapshot.analyticsSummary.jobBreakdown.failed)}. Recent jobs: ${automationLine}.`,
    ]
      .filter(Boolean)
      .join('\n');
  }

  private async buildWeeklySummary(userId: string, locale: Locale) {
    const copy =
      locale === 'fr'
        ? {
            weekSoFar: (current: { engagement: number; leads: number; conversions: number }) =>
              `Cette semaine jusqu ici : engagement ${current.engagement}%, leads ${current.leads}, conversions ${current.conversions}.`,
            weeklyPerformance: (engagementLine: string, leadsLine: string, conversionsLine: string) =>
              `Performance hebdomadaire : ${engagementLine}. ${leadsLine}. ${conversionsLine}.`,
            socialThisWeek: (posted: number, failed: number, skipped: number) =>
              `Activite sociale cette semaine : ${posted} posts publies, ${failed} en echec, ${skipped} ignores.`,
            socialActivity: (postedLine: string, failedLine: string) =>
              `Activite sociale : ${postedLine}. ${failedLine}.`,
            noActivity:
              'Pas d activite en direct cette semaine. Une fois les posts ou automations executes, je resumerai la performance ici.',
            noCrmData: 'Pas encore de donnees CRM.',
            needPriorWeek: "J'ai besoin d'une semaine complete precedente pour comparer les tendances.",
            labels: {
              engagement: 'Engagement',
              leads: 'Leads',
              conversions: 'Conversions',
              posts: 'Posts',
              failures: 'Echecs',
            },
          }
        : locale === 'de'
          ? {
              weekSoFar: (current: { engagement: number; leads: number; conversions: number }) =>
                `Diese Woche bisher: Engagement ${current.engagement}%, Leads ${current.leads}, Conversions ${current.conversions}.`,
              weeklyPerformance: (engagementLine: string, leadsLine: string, conversionsLine: string) =>
                `Wochenleistung: ${engagementLine}. ${leadsLine}. ${conversionsLine}.`,
              socialThisWeek: (posted: number, failed: number, skipped: number) =>
                `Social-Aktivitat diese Woche: ${posted} Posts veroffentlicht, ${failed} fehlgeschlagen, ${skipped} ubersprungen.`,
              socialActivity: (postedLine: string, failedLine: string) =>
                `Social-Aktivitat: ${postedLine}. ${failedLine}.`,
              noActivity:
                'Diese Woche noch keine Live-Aktivitat. Sobald Posts oder Automationen laufen, fasse ich die Performance hier zusammen.',
              noCrmData: 'Noch keine CRM-Performance-Daten.',
              needPriorWeek: 'Ich brauche mindestens eine komplette Vorwoche, um Trends zu vergleichen.',
              labels: {
                engagement: 'Engagement',
                leads: 'Leads',
                conversions: 'Konversionen',
                posts: 'Posts',
                failures: 'Fehlschlage',
              },
            }
          : locale === 'es'
            ? {
                weekSoFar: (current: { engagement: number; leads: number; conversions: number }) =>
                  `Esta semana hasta ahora: engagement ${current.engagement}%, leads ${current.leads}, conversiones ${current.conversions}.`,
                weeklyPerformance: (engagementLine: string, leadsLine: string, conversionsLine: string) =>
                  `Rendimiento semanal: ${engagementLine}. ${leadsLine}. ${conversionsLine}.`,
                socialThisWeek: (posted: number, failed: number, skipped: number) =>
                  `Actividad social esta semana: ${posted} publicaciones, ${failed} fallidas, ${skipped} omitidas.`,
                socialActivity: (postedLine: string, failedLine: string) =>
                  `Actividad social: ${postedLine}. ${failedLine}.`,
                noActivity:
                  'Sin actividad en vivo esta semana. Cuando se publiquen posts o automaciones, resumiré el rendimiento aquí.',
                noCrmData: 'Aún no hay datos de CRM.',
                needPriorWeek: 'Necesito una semana completa previa para comparar tendencias.',
                labels: {
                  engagement: 'Engagement',
                  leads: 'Leads',
                  conversions: 'Conversiones',
                  posts: 'Publicaciones',
                  failures: 'Fallos',
                },
              }
            : locale === 'pt'
              ? {
                  weekSoFar: (current: { engagement: number; leads: number; conversions: number }) =>
                    `Esta semana até agora: engajamento ${current.engagement}%, leads ${current.leads}, conversões ${current.conversions}.`,
                  weeklyPerformance: (engagementLine: string, leadsLine: string, conversionsLine: string) =>
                    `Performance semanal: ${engagementLine}. ${leadsLine}. ${conversionsLine}.`,
                  socialThisWeek: (posted: number, failed: number, skipped: number) =>
                    `Atividade social nesta semana: ${posted} posts publicados, ${failed} com falha, ${skipped} ignorados.`,
                  socialActivity: (postedLine: string, failedLine: string) =>
                    `Atividade social: ${postedLine}. ${failedLine}.`,
                  noActivity:
                    'Sem atividade ao vivo nesta semana. Quando posts ou automações rodarem, resumo a performance aqui.',
                  noCrmData: 'Ainda sem dados de CRM.',
                  needPriorWeek: 'Preciso de uma semana completa anterior para comparar tendências.',
                  labels: {
                    engagement: 'Engajamento',
                    leads: 'Leads',
                    conversions: 'Conversões',
                    posts: 'Posts',
                    failures: 'Falhas',
                  },
                }
              : locale === 'id'
                ? {
                    weekSoFar: (current: { engagement: number; leads: number; conversions: number }) =>
                      `Minggu ini sejauh ini: engagement ${current.engagement}%, leads ${current.leads}, konversi ${current.conversions}.`,
                    weeklyPerformance: (engagementLine: string, leadsLine: string, conversionsLine: string) =>
                      `Performa mingguan: ${engagementLine}. ${leadsLine}. ${conversionsLine}.`,
                    socialThisWeek: (posted: number, failed: number, skipped: number) =>
                      `Aktivitas sosial minggu ini: ${posted} posting, ${failed} gagal, ${skipped} dilewati.`,
                    socialActivity: (postedLine: string, failedLine: string) =>
                      `Aktivitas sosial: ${postedLine}. ${failedLine}.`,
                    noActivity:
                      'Belum ada aktivitas live minggu ini. Setelah posting atau automasi berjalan, saya rangkum performa di sini.',
                    noCrmData: 'Belum ada data CRM.',
                    needPriorWeek: 'Saya perlu satu minggu penuh sebelumnya untuk membandingkan tren.',
                    labels: {
                      engagement: 'Engagement',
                      leads: 'Leads',
                      conversions: 'Konversi',
                      posts: 'Posting',
                      failures: 'Gagal',
                    },
                  }
                : locale === 'ja'
                  ? {
                      weekSoFar: (current: { engagement: number; leads: number; conversions: number }) =>
                        `今週これまで: エンゲージメント ${current.engagement}%、リード ${current.leads}、コンバージョン ${current.conversions}。`,
                      weeklyPerformance: (engagementLine: string, leadsLine: string, conversionsLine: string) =>
                        `週次パフォーマンス: ${engagementLine}。${leadsLine}。${conversionsLine}。`,
                      socialThisWeek: (posted: number, failed: number, skipped: number) =>
                        `今週のソーシャル活動: 投稿 ${posted}件、失敗 ${failed}件、スキップ ${skipped}件。`,
                      socialActivity: (postedLine: string, failedLine: string) =>
                        `ソーシャル活動: ${postedLine}。${failedLine}。`,
                      noActivity:
                        '今週はライブ活動がありません。投稿や自動化が実行されたら、ここで要約します。',
                      noCrmData: 'CRMデータがまだありません。',
                      needPriorWeek: '傾向比較には前週のフルデータが必要です。',
                      labels: {
                        engagement: 'エンゲージメント',
                        leads: 'リード',
                        conversions: 'コンバージョン',
                        posts: '投稿',
                        failures: '失敗',
                      },
                    }
                  : locale === 'ru'
                    ? {
                        weekSoFar: (current: { engagement: number; leads: number; conversions: number }) =>
                          `На этой неделе: вовлеченность ${current.engagement}%, лиды ${current.leads}, конверсии ${current.conversions}.`,
                        weeklyPerformance: (engagementLine: string, leadsLine: string, conversionsLine: string) =>
                          `Недельная эффективность: ${engagementLine}. ${leadsLine}. ${conversionsLine}.`,
                        socialThisWeek: (posted: number, failed: number, skipped: number) =>
                          `Социальная активность на этой неделе: ${posted} публикаций, ${failed} сбоев, ${skipped} пропущено.`,
                        socialActivity: (postedLine: string, failedLine: string) =>
                          `Социальная активность: ${postedLine}. ${failedLine}.`,
                        noActivity:
                          'На этой неделе нет активности вживую. Когда посты или автоматизации запустятся, я резюмирую здесь.',
                        noCrmData: 'Пока нет данных CRM.',
                        needPriorWeek: 'Нужна полная предыдущая неделя для сравнения трендов.',
                        labels: {
                          engagement: 'Вовлеченность',
                          leads: 'Лиды',
                          conversions: 'Конверсии',
                          posts: 'Посты',
                          failures: 'Сбои',
                        },
                      }
                    : locale === 'ko'
                      ? {
                          weekSoFar: (current: { engagement: number; leads: number; conversions: number }) =>
                            `이번 주 현재: 참여도 ${current.engagement}%, 리드 ${current.leads}, 전환 ${current.conversions}.`,
                          weeklyPerformance: (engagementLine: string, leadsLine: string, conversionsLine: string) =>
                            `주간 성과: ${engagementLine}. ${leadsLine}. ${conversionsLine}.`,
                          socialThisWeek: (posted: number, failed: number, skipped: number) =>
                            `이번 주 소셜 활동: 게시물 ${posted}건, 실패 ${failed}건, 건너뜀 ${skipped}건.`,
                          socialActivity: (postedLine: string, failedLine: string) =>
                            `소셜 활동: ${postedLine}. ${failedLine}.`,
                          noActivity:
                            '이번 주 라이브 활동이 없습니다. 게시물이나 자동화가 실행되면 여기서 요약합니다.',
                          noCrmData: 'CRM 데이터가 아직 없습니다.',
                          needPriorWeek: '트렌드 비교를 위해 지난주 전체 데이터가 필요합니다.',
                          labels: {
                            engagement: '참여도',
                            leads: '리드',
                            conversions: '전환',
                            posts: '게시물',
                            failures: '실패',
                          },
                        }
                      : locale === 'ar'
            ? {
                weekSoFar: (current: { engagement: number; leads: number; conversions: number }) =>
                  `هذا الاسبوع حتى الان: التفاعل ${current.engagement}%, العملاء المحتملون ${current.leads}, التحويلات ${current.conversions}.`,
                weeklyPerformance: (engagementLine: string, leadsLine: string, conversionsLine: string) =>
                  `اداء الاسبوع: ${engagementLine}. ${leadsLine}. ${conversionsLine}.`,
                socialThisWeek: (posted: number, failed: number, skipped: number) =>
                  `النشاط الاجتماعي هذا الاسبوع: ${posted} منشور، ${failed} فشل، ${skipped} تم تخطيه.`,
                socialActivity: (postedLine: string, failedLine: string) =>
                  `النشاط الاجتماعي: ${postedLine}. ${failedLine}.`,
                noActivity: 'لا يوجد نشاط مباشر هذا الاسبوع. عند تشغيل المنشورات او الاتمتة، ساعرض الملخص هنا.',
                noCrmData: 'لا توجد بيانات CRM بعد.',
                needPriorWeek: 'احتاج اسبوعا سابقا كاملا لمقارنة الاتجاهات.',
                labels: {
                  engagement: 'التفاعل',
                  leads: 'العملاء المحتملون',
                  conversions: 'التحويلات',
                  posts: 'المنشورات',
                  failures: 'الاخفاقات',
                },
              }
            : locale === 'zh'
              ? {
                  weekSoFar: (current: { engagement: number; leads: number; conversions: number }) =>
                    `本周截至目前：互动率 ${current.engagement}%，线索 ${current.leads}，转化 ${current.conversions}。`,
                  weeklyPerformance: (engagementLine: string, leadsLine: string, conversionsLine: string) =>
                    `周度表现：${engagementLine}。${leadsLine}。${conversionsLine}。`,
                  socialThisWeek: (posted: number, failed: number, skipped: number) =>
                    `本周社媒活动：发布 ${posted} 条，失败 ${failed} 条，跳过 ${skipped} 条。`,
                  socialActivity: (postedLine: string, failedLine: string) => `社媒活动：${postedLine}。${failedLine}。`,
                  noActivity: '本周还没有实时活动。一旦发布或自动化运行，我会在这里汇总表现。',
                  noCrmData: '暂无 CRM 表现数据。',
                  needPriorWeek: '需要至少完整的上一周数据来对比趋势。',
                  labels: {
                    engagement: '互动率',
                    leads: '线索',
                    conversions: '转化',
                    posts: '帖子',
                    failures: '失败',
                  },
                }
              : {
                  weekSoFar: (current: { engagement: number; leads: number; conversions: number }) =>
                    `This week so far: engagement ${current.engagement}%, leads ${current.leads}, conversions ${current.conversions}.`,
                  weeklyPerformance: (engagementLine: string, leadsLine: string, conversionsLine: string) =>
                    `Weekly performance: ${engagementLine}. ${leadsLine}. ${conversionsLine}.`,
                  socialThisWeek: (posted: number, failed: number, skipped: number) =>
                    `Social activity this week: ${posted} posts published, ${failed} failed, ${skipped} skipped.`,
                  socialActivity: (postedLine: string, failedLine: string) =>
                    `Social activity: ${postedLine}. ${failedLine}.`,
                  noActivity:
                    'No live activity yet this week. Once posts or automations run, I will summarize performance here.',
                  noCrmData: 'No CRM performance data yet.',
                  needPriorWeek: 'I need at least one full prior week to compare trends.',
                  labels: {
                    engagement: 'Engagement',
                    leads: 'Leads',
                    conversions: 'Conversions',
                    posts: 'Posts',
                    failures: 'Failures',
                  },
                };

    const [summary, socialRows] = await Promise.all([
      analyticsService.getSummary(userId),
      socialAnalyticsService.getDailySummary(userId, 14),
    ]);

    const history = Array.isArray(summary.history) ? summary.history : [];
    const analyticsSorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
    const last7 = analyticsSorted.slice(-7);
    const prev7 = analyticsSorted.slice(-14, -7);

    const analyticsTotals = {
      leads: last7.reduce((sum, day) => sum + day.leads, 0),
      engagement: last7.reduce((sum, day) => sum + day.engagement, 0),
      conversions: last7.reduce((sum, day) => sum + day.conversions, 0),
    };
    const hasAnalyticsData = last7.length > 0 && (analyticsTotals.leads > 0 || analyticsTotals.engagement > 0 || analyticsTotals.conversions > 0);

    const analyticsLine = hasAnalyticsData
      ? (() => {
          const current = {
            leads: Math.round(analyticsTotals.leads),
            engagement: Number(this.computeAverage(last7.map(day => day.engagement)).toFixed(1)),
            conversions: Math.round(analyticsTotals.conversions),
          };
          if (!prev7.length) {
            return copy.weekSoFar(current);
          }
          const previous = {
            leads: Math.round(prev7.reduce((sum, day) => sum + day.leads, 0)),
            engagement: Number(this.computeAverage(prev7.map(day => day.engagement)).toFixed(1)),
            conversions: Math.round(prev7.reduce((sum, day) => sum + day.conversions, 0)),
          };
          const engagementLine = this.formatDelta(
            copy.labels.engagement,
            current.engagement,
            previous.engagement,
            '%',
            locale
          );
          const leadsLine = this.formatDelta(copy.labels.leads, current.leads, previous.leads, '', locale);
          const conversionsLine = this.formatDelta(copy.labels.conversions, current.conversions, previous.conversions, '', locale);
          return copy.weeklyPerformance(engagementLine, leadsLine, conversionsLine);
        })()
      : null;

    const socialSorted = [...(socialRows ?? [])].sort((a: any, b: any) => `${a?.date ?? ''}`.localeCompare(`${b?.date ?? ''}`));
    const socialLast7 = socialSorted.slice(-7);
    const socialPrev7 = socialSorted.slice(-14, -7);

    const sumSocial = (rows: Array<Record<string, unknown>>, key: string) =>
      rows.reduce((sum, row) => sum + Number(row[key] ?? 0), 0);

    const socialCurrent = {
      attempted: sumSocial(socialLast7, 'postsAttempted'),
      posted: sumSocial(socialLast7, 'postsPosted'),
      failed: sumSocial(socialLast7, 'postsFailed'),
      skipped: sumSocial(socialLast7, 'postsSkipped'),
    };
    const socialPrevious = {
      attempted: sumSocial(socialPrev7, 'postsAttempted'),
      posted: sumSocial(socialPrev7, 'postsPosted'),
      failed: sumSocial(socialPrev7, 'postsFailed'),
      skipped: sumSocial(socialPrev7, 'postsSkipped'),
    };

    const hasSocialData =
      socialCurrent.attempted + socialCurrent.posted + socialCurrent.failed + socialCurrent.skipped > 0 ||
      socialPrevious.attempted + socialPrevious.posted + socialPrevious.failed + socialPrevious.skipped > 0;

    const socialLine = hasSocialData
      ? (() => {
          if (!socialPrev7.length) {
            return copy.socialThisWeek(socialCurrent.posted, socialCurrent.failed, socialCurrent.skipped);
          }
          const postedLine = this.formatDelta(copy.labels.posts, socialCurrent.posted, socialPrevious.posted, '', locale);
          const failedLine = this.formatDelta(copy.labels.failures, socialCurrent.failed, socialPrevious.failed, '', locale);
          return copy.socialActivity(postedLine, failedLine);
        })()
      : null;

    const lines = [analyticsLine, socialLine].filter(Boolean) as string[];
    if (!lines.length) {
      return copy.noActivity;
    }
    if (!hasAnalyticsData && socialLine) {
      lines.unshift(copy.noCrmData);
    } else if (hasAnalyticsData && !prev7.length) {
      lines.push(copy.needPriorWeek);
    }
    return lines.join(' ');
  }

  async answer(question: string, context: AssistantContext) {
    const locale = this.resolveLocale(context.locale);
    const accountSnapshot = await this.loadAccountSnapshot(context);

    if (context.userId && this.shouldSendMonthlyReport(question)) {
      try {
        const emails = this.extractEmailAddresses(question);
        const result = await strategyService.sendMonthlyReport({
          userId: context.userId,
          email: context.userEmail ?? null,
          emails: emails.length ? emails : undefined,
          company: context.company,
        });
        return { type: 'text', text: result.message };
      } catch (error) {
        console.error('Monthly report failed', error);
      }
    }

    if (context.userId && this.shouldApplyStrategy(question)) {
      try {
        const strategyId = this.extractStrategyId(question);
        const result = await strategyService.applyStrategy(context.userId, strategyId);
        return { type: 'text', text: result.message };
      } catch (error) {
        console.error('Strategy apply failed', error);
      }
    }

    if (context.userId && this.shouldDraftStrategy(question)) {
      try {
        const result = await strategyService.draftStrategy({
          userId: context.userId,
          question,
          company: context.company,
          connectedChannels: context.connectedChannels,
        });
        return { type: 'text', text: result.message };
      } catch (error) {
        console.error('Strategy draft failed', error);
      }
    }

    const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
      {
        type: 'function',
        function: {
          name: 'navigate',
          description: 'Navigate the user to a specific screen in the app',
          parameters: {
            type: 'object',
            properties: {
              screen: {
                type: 'string',
                enum: [
                  'Dashboard',
                  'BotAnalytics',
                  'CreateContent',
                  'SchedulePost',
                  'PostingHistory',
                  'Inbound',
                  'Engagement',
                  'FollowUps',
                  'WebLeads',
                  'AccountIntegrations',
                  'AdsManager',
                  'Controls',
                  'Support',
                  'Admin',
                ],
                description: 'The name of the screen to navigate to',
              },
            },
            required: ['screen'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'meta_ads_report',
          description: 'Get live Meta Ads performance, campaign status, spend, clicks, messages, leads, and diagnostics for the authenticated account',
          parameters: { type: 'object', properties: {} },
        },
      },
      {
        type: 'function',
        function: {
          name: 'request_meta_ads_action',
          description: 'Create a controlled Meta Ads request. Every write is placed in the Ads Manager approval queue before execution.',
          parameters: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: ['create_campaign_draft', 'activate_ad', 'pause_ad', 'update_budget'] },
              postId: { type: 'string' },
              adId: { type: 'string' },
              adSetId: { type: 'string' },
              adAccountId: { type: 'string' },
              caption: { type: 'string' },
              imageUrl: { type: 'string' },
              dailyBudgetUsd: { type: 'number' },
              durationHours: { type: 'number' },
              whatsappNumber: { type: 'string' },
            },
            required: ['action'],
          },
        },
      },
    ];

    const responseLanguage = LOCALE_RESPONSE_LANGUAGE[locale] ?? 'English';
    let knowledge: Array<{ title: string; summary: string; url?: string }> = [];
    try {
      knowledge = await this.safeResolve(
        'knowledge snippets',
        () => knowledgeBase.getRelevantSnippets(question, 3),
        [],
      );
    } catch (error) {
      console.warn('Failed to load knowledge snippets', (error as Error).message);
    }
    const knowledgeBlock =
      knowledge.length > 0
        ? `Relevant knowledge:\n${knowledge
            .map((entry, index) => `${index + 1}. ${entry.title}: ${entry.summary}${entry.url ? ` (Source: ${entry.url})` : ''}`)
            .join('\n')}`
        : '';
    const accountContextBlock = accountSnapshot ? this.buildAccountContextBlock(accountSnapshot) : '';

    const personalityPrompt = this.buildPersonalityPrompt(context);
    const systemPrompt = [
      'You are Dotti, an AI-powered business assistant inside the Dott Media app.',
      'Only answer questions about the authenticated user account, its connected channels, automation, performance, posting history, audience, business goals, growth strategy, and navigation inside Dott.',
      personalityPrompt,
      'If the user asks for anything unrelated to their account or business, reply briefly that you can only help with their account and business inside Dott.',
      'Base every answer on the account data provided below. Never invent metrics or connected channels.',
      'You have account-scoped access to the supplied daily and 30-day dashboard metrics, posting history, connected social accounts, and Meta Ads connection. Use the correct time range requested by the user and state clearly when a particular dataset is empty or unavailable.',
      'For comparisons, trends, plans, and diagnoses, consider the full 30-day series and posting history instead of relying only on today.',
      'When the user asks for a summary, give a clear performance summary grounded in the live account data.',
      'When the user asks for growth help, diagnose what is happening, explain the bottleneck, suggest a practical strategy, and explain what can be implemented inside Dott.',
      'Act as an experienced social media growth strategist when the user asks for a plan or strategy. Produce a practical plan tailored to the account, audience, goals, connected channels, and available performance data.',
      'A strong plan should include: the objective, current diagnosis, audience and positioning, content pillars, channel-specific actions, publishing cadence, engagement actions, a realistic timeline, measurable KPIs, and the next three actions. Adjust the depth to the request instead of forcing this structure into every reply.',
      'Maintain continuity across the supplied conversation history. Resolve follow-up words such as it, that plan, those posts, the account, and continue from the latest relevant topic without making the user repeat context.',
      'Treat older conversation details as background and the newest user instruction as authoritative when they conflict. Clearly separate known account facts from recommendations or assumptions.',
      'If a strategy has already been drafted and the user approves it, implementation can be triggered. Acknowledge that clearly and keep the approval path simple.',
      'You can email a monthly performance report to the user when requested.',
      'Use Meta Ads tools for ad reporting, diagnostics, campaign drafts, activation, pauses, or budget changes. Never claim a write happened until its approval has been completed.',
      'All Meta Ads write actions go to an approval queue. Tell the user to review the request in Ads Manager.',
      'Use the app tools only when the user asks to navigate, asks for a metric-specific account insight, or requests a Meta Ads operation.',
      'Keep answers professional, direct, and useful. Use short paragraphs. Stay concise unless the user asks for a detailed breakdown.',
      `Respond in ${responseLanguage}.`,
      accountSnapshot?.company ? `User Company: ${accountSnapshot.company}` : context.company ? `User Company: ${context.company}` : '',
      context.currentScreen ? `User is currently viewing: ${context.currentScreen}` : '',
      accountSnapshot?.subscriptionStatus
        ? `Subscription status: ${accountSnapshot.subscriptionStatus}`
        : context.subscriptionStatus
          ? `Subscription status: ${context.subscriptionStatus}`
          : '',
      accountSnapshot?.connectedChannels?.length
        ? `Connected channels: ${accountSnapshot.connectedChannels.join(', ')}`
        : context.connectedChannels?.length
          ? `Connected channels: ${context.connectedChannels.join(', ')}`
          : 'Connected channels: none listed',
      context.analytics
        ? `Legacy CRM snapshot: Leads=${context.analytics.leads ?? 'n/a'}, Engagement=${context.analytics.engagement ?? 'n/a'}%, Conversions=${context.analytics.conversions ?? 'n/a'}`
        : '',
      accountContextBlock ? `Live account data:\n${accountContextBlock}` : '',
      knowledgeBlock,
    ]
      .filter(Boolean)
      .join('\n');

    const explicitAdsReportRequest = /\b(ad spend|ad performance|ads? report(?:ing)?|campaign reporting|impressions|click-through rate|\bctr\b)\b/i.test(question);
    const explicitAdsActionRequest = /\b(create (?:an? )?ad|campaign draft|pause (?:an? )?ad|activate (?:an? )?ad|change (?:the )?ad budget|update (?:the )?ad budget)\b/i.test(question);
    const explicitNavigationRequest = /\b(open|go to|navigate|take me to|show me)\b/i.test(question);
    const availableTools = tools.filter(tool => {
      const name = tool.function.name;
      if (name === 'navigate') return explicitNavigationRequest;
      if (name === 'meta_ads_report') return explicitAdsReportRequest;
      if (name === 'request_meta_ads_action') return explicitAdsActionRequest;
      return false;
    });

    try {
      const completion = await assistantAI.chat.completions.create({
        model: config.assistantAI.model,
        messages: [
          { role: 'system', content: systemPrompt },
          ...(context.conversationHistory ?? []).slice(-120).map(message => ({
            role: message.role,
            content: message.content.slice(0, 4000),
          })),
          { role: 'user', content: question },
        ],
        ...(availableTools.length ? { tools: availableTools, tool_choice: 'auto' as const } : {}),
        temperature: 0.3,
        max_tokens: 900,
      });

      const message = completion.choices[0].message;

      // If the model wants to call a tool, return a structured response for the frontend to handle
      if (message.tool_calls && message.tool_calls.length > 0) {
        const toolCall = message.tool_calls[0];
        if (toolCall.type === 'function' && toolCall.function?.name) {
          let params: unknown = {};
          try {
            params = JSON.parse(toolCall.function.arguments || '{}');
          } catch (parseError) {
            console.error('Failed to parse tool arguments', parseError);
          }

          if (toolCall.function.name === 'meta_ads_report' && context.userId) {
            try {
              const report = await metaAdsControlService.reportingSummary(context.userId);
              return { type: 'text', text: report.text };
            } catch (error) {
              return { type: 'text', text: `I could not load Meta Ads reporting yet: ${error instanceof Error ? error.message : String(error)}. Check the Meta connection in Ads Manager.` };
            }
          }

          if (toolCall.function.name === 'request_meta_ads_action' && context.userId) {
            const actionParams = (params ?? {}) as Record<string, any>;
            const action = actionParams.action as MetaAdsAction;
            if (action === 'create_campaign_draft' && !String(actionParams.postId ?? '').trim()) {
              return { type: 'text', text: 'I can prepare that paused campaign draft, but I need the Facebook post ID first. You can also paste it in Ads Manager.' };
            }
            try {
              const approval = await metaAdsControlService.requestAction(context.userId, action, actionParams, 'dotti');
              return { type: 'text', text: `I created approval request ${approval.id}. Review it in Ads Manager before Meta receives the change.` };
            } catch (error) {
              return { type: 'text', text: `I did not submit that Meta Ads change: ${error instanceof Error ? error.message : String(error)}` };
            }
          }

          return {
            type: 'action',
            action: toolCall.function.name,
            params,
            text:
              locale === 'fr'
                ? "Je m'en occupe pour vous."
                : locale === 'de'
                  ? 'Ich kummer mich darum.'
                  : locale === 'ar'
                    ? 'سأتولى ذلك لك.'
                  : locale === 'zh'
                    ? '我会为您处理。'
                    : "I'm taking care of that for you.",
          };
        }
      }

      return {
        type: 'text',
        text:
          message.content ||
          (locale === 'fr'
            ? "Je ne suis pas sur de pouvoir aider encore, mais j'apprends."
            : locale === 'de'
              ? 'Ich bin mir nicht sicher, ob ich dabei helfen kann, aber ich lerne dazu.'
              : locale === 'ar'
                ? 'لست متاكدا انني استطيع المساعدة بعد، لكنني اتعلم.'
              : locale === 'zh'
                ? '我还不确定是否能帮到你，但我会继续学习。'
                : "I'm not sure how to help with that, but I'm learning!"),
      };
    } catch (error) {
      const { status, code, message } = extractOpenAIError(error);
      const combined = `${code ?? ''} ${message ?? ''}`.toLowerCase();
      let kind: 'billing' | 'auth' | 'generic' = 'generic';
      if (status === 401 || combined.includes('invalid_api_key') || combined.includes('authentication')) {
        kind = 'auth';
      } else if (
        status === 402 ||
        combined.includes('insufficient_quota') ||
        combined.includes('billing') ||
        combined.includes('quota')
      ) {
        kind = 'billing';
      }

      console.error('OpenAI Error:', { status, code, message });
      if (kind !== 'generic') {
        return { type: 'text', text: buildAssistantErrorText(kind) };
      }
      return {
        type: 'text',
        text:
          locale === 'fr'
            ? "Je rencontre un souci temporaire en me connectant. Merci de reessayer."
            : locale === 'de'
              ? 'Ich habe vorubergehend Probleme bei der Verbindung. Bitte versuch es gleich noch einmal.'
              : locale === 'ar'
                ? 'واجهت مشكلة مؤقتة في الاتصال. يرجى المحاولة مرة اخرى.'
              : locale === 'zh'
                ? '连接时遇到临时问题，请稍后再试。'
                : 'I encountered a temporary issue connecting to my brain. Please try again shortly.',
      };
    }
  }
}
