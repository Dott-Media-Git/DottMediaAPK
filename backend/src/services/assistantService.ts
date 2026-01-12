import OpenAI from 'openai';
import { config } from '../config';
import { AnalyticsService } from './analyticsService';
import { SocialAnalyticsService } from '../packages/services/socialAnalyticsService';
import { AssistantStrategyService } from './assistantStrategyService';
import { KnowledgeBaseService } from './knowledgeBaseService';

const openai = new OpenAI({ apiKey: config.openAI.apiKey });
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
    return 'AI is temporarily offline because OpenAI credits/billing are exhausted. Please top up and try again.';
  }
  if (kind === 'auth') {
    return 'AI is temporarily offline due to an OpenAI authentication issue. Please check the API key and try again.';
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
  currentScreen?: string;
  subscriptionStatus?: string;
  connectedChannels?: string[];
  locale?: Locale;
  analytics?: {
    leads?: number;
    engagement?: number;
    conversions?: number;
    feedbackScore?: number;
  };
};

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
    return /\b(strategy|marketing plan|growth plan|campaign plan|strategy plan|go to market|g2m)\b/.test(normalized);
  }

  private shouldApplyStrategy(question: string) {
    const normalized = question.toLowerCase();
    const approve = /\b(approve|accept|apply|implement|go ahead|activate|start)\b/.test(normalized);
    const mentionsStrategy = /\b(strategy|plan)\b/.test(normalized);
    const hasId = /strat-[a-z0-9]{6}/i.test(normalized);
    return approve && (mentionsStrategy || hasId);
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

    if (context.userId && this.shouldSendMonthlyReport(question)) {
      try {
        const result = await strategyService.sendMonthlyReport({
          userId: context.userId,
          email: context.userEmail ?? null,
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

    if (context.userId && this.shouldProvideWeeklySummary(question)) {
      try {
        return { type: 'text', text: await this.buildWeeklySummary(context.userId, locale) };
      } catch (error) {
        console.error('Weekly summary failed', error);
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
          name: 'get_insights',
          description: 'Get specific analytical insights about performance',
          parameters: {
            type: 'object',
            properties: {
              metric: {
                type: 'string',
                enum: ['leads', 'engagement', 'conversions', 'feedback'],
                description: 'The metric to analyze',
              },
            },
            required: ['metric'],
          },
        },
      },
    ];

    const responseLanguage = LOCALE_RESPONSE_LANGUAGE[locale] ?? 'English';
    let knowledge: Array<{ title: string; summary: string; url?: string }> = [];
    try {
      knowledge = await knowledgeBase.getRelevantSnippets(question, 3);
    } catch (error) {
      console.warn('Failed to load knowledge snippets', (error as Error).message);
    }
    const knowledgeBlock =
      knowledge.length > 0
        ? `Relevant knowledge:\n${knowledge
            .map((entry, index) => `${index + 1}. ${entry.title}: ${entry.summary}${entry.url ? ` (Source: ${entry.url})` : ''}`)
            .join('\n')}`
        : '';

    const systemPrompt = [
      'You are Dotti, an AI sales agent and assistant inside the Dott Media CRM mobile app.',
      'Your goal is to help the user manage their marketing automation, analyze data, and navigate the app.',
      'You have access to tools to control the app. Use them when the user asks to go somewhere or needs specific data.',
      'You can draft marketing strategies based on performance, ask for approval, and then implement them.',
      'You can email a monthly performance report to the user when requested.',
      'Keep answers conversational, professional, and concise (under 3 sentences unless detailed analysis is asked).',
      `Respond in ${responseLanguage}.`,
      context.company ? `User Company: ${context.company}` : '',
      context.currentScreen ? `User is currently viewing: ${context.currentScreen}` : '',
      context.subscriptionStatus ? `Subscription status: ${context.subscriptionStatus}` : '',
      context.connectedChannels?.length ? `Connected channels: ${context.connectedChannels.join(', ')}` : 'Connected channels: none listed',
      context.analytics
        ? `Current Snapshot: Leads=${context.analytics.leads ?? 'n/a'}, Engagement=${context.analytics.engagement ?? 'n/a'}%, Conversions=${context.analytics.conversions ?? 'n/a'}, Feedback=${context.analytics.feedbackScore ?? 'n/a'}/5`
        : '',
      knowledgeBlock,
    ]
      .filter(Boolean)
      .join('\n');

    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: question },
        ],
        tools,
        tool_choice: 'auto',
        temperature: 0.3,
        max_tokens: 300,
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

          if (toolCall.function.name === 'get_insights' && context.userId) {
            return { type: 'text', text: await this.buildWeeklySummary(context.userId, locale) };
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
