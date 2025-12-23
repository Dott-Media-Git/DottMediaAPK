import OpenAI from 'openai';
import admin from 'firebase-admin';
import { firestore } from '../db/firestore';

type TargetProfile = {
  industries: string[];
  globalCountries: string[];
  homeCountry: string;
  source: 'env' | 'openai' | 'default';
  updatedAtMs?: number;
};

type TargetState = {
  runCount: number;
  industryIndex: number;
  countryIndex: number;
  expanded: boolean;
  updatedAtMs?: number;
  lastRunAtMs?: number;
};

export type OutboundDiscoveryTarget = {
  industry: string;
  country: string;
  industries: string[];
  countries: string[];
  expanded: boolean;
  homeCountry: string;
  source: TargetProfile['source'];
};

const targetsDoc = firestore.collection('ops').doc('outboundTargets');
const stateDoc = firestore.collection('ops').doc('outboundState');

const DEFAULT_INDUSTRIES = [
  'real estate',
  'ecommerce',
  'marketing agencies',
  'coaches',
  'saas',
  'healthcare clinics',
  'education',
  'hospitality',
];

const DEFAULT_GLOBAL_COUNTRIES = [
  'United States',
  'United Kingdom',
  'Canada',
  'Australia',
  'Germany',
  'Netherlands',
  'United Arab Emirates',
  'South Africa',
];

const DEFAULT_SERVICE_PROFILE =
  'Dott Media builds AI CRM automation, chat + voice bots, lead generation agents, AI courses, and brand automation/digital strategy programs.';

const openAiKey = process.env.OPENAI_API_KEY ?? process.env.OPENAI_KEY ?? process.env.OPENAI_API_TOKEN ?? '';
const openAiClient = openAiKey ? new OpenAI({ apiKey: openAiKey }) : null;

const parseList = (raw?: string): string[] =>
  (raw ?? '')
    .split(/[,\n]/)
    .map(value => value.trim())
    .filter(Boolean);

const uniqueList = (values: string[]): string[] => {
  const seen = new Set<string>();
  return values.filter(value => {
    const key = value.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const clampList = (values: string[], fallback: string[], max: number) => {
  const cleaned = uniqueList(values).filter(Boolean);
  if (!cleaned.length) return fallback.slice(0, max);
  return cleaned.slice(0, max);
};

const extractJson = (raw: string) => {
  const fenced = raw.match(/```json\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1];
  const brace = raw.match(/\{[\s\S]*\}/);
  return brace?.[0] ?? raw;
};

const resolveHomeCountry = () =>
  process.env.OUTBOUND_HOME_COUNTRY ??
  process.env.OUTBOUND_TARGET_COUNTRY ??
  process.env.DEFAULT_COUNTRY ??
  'Uganda';

async function getCachedTargets(maxAgeDays: number): Promise<TargetProfile | null> {
  if (maxAgeDays <= 0) return null;
  const snap = await targetsDoc.get();
  if (!snap.exists) return null;
  const data = snap.data() as TargetProfile;
  if (!data?.industries?.length || !data?.globalCountries?.length || !data.updatedAtMs) return null;
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  if (Date.now() - data.updatedAtMs > maxAgeMs) return null;
  return data;
}

async function generateTargetsWithOpenAI(profile: string, homeCountry: string): Promise<TargetProfile | null> {
  if (!openAiClient) return null;
  try {
    const prompt = `
You are selecting outbound prospecting targets for a B2B services company.
Services/products: ${profile}
Return JSON only: {"industries": [...], "globalCountries": [...]}
Include 6-8 industries and 6-10 countries. Avoid duplicates. Use proper country names.
`;
    const completion = await openAiClient.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      max_tokens: 260,
      messages: [
        { role: 'system', content: 'You output concise JSON with no extra commentary.' },
        { role: 'user', content: prompt.trim() },
      ],
    });
    const raw = completion.choices?.[0]?.message?.content?.trim();
    if (!raw) return null;
    const parsed = JSON.parse(extractJson(raw));
    const industries = clampList(parsed.industries ?? parsed.industry ?? [], DEFAULT_INDUSTRIES, 8);
    const globalCountries = clampList(parsed.globalCountries ?? parsed.countries ?? [], DEFAULT_GLOBAL_COUNTRIES, 10).filter(
      country => country.toLowerCase() !== homeCountry.toLowerCase(),
    );
    return { industries, globalCountries, homeCountry, source: 'openai' };
  } catch (error) {
    console.warn('[outboundTargets] OpenAI targeting failed', error);
    return null;
  }
}

async function resolveTargets(): Promise<TargetProfile> {
  const homeCountry = resolveHomeCountry();
  const envIndustry = process.env.OUTBOUND_TARGET_INDUSTRY;
  const envIndustries = uniqueList([envIndustry ?? '', ...parseList(process.env.OUTBOUND_TARGET_INDUSTRIES)]).filter(
    Boolean,
  );
  const envCountry = process.env.OUTBOUND_TARGET_COUNTRY;
  const envCountries = uniqueList([envCountry ?? '', ...parseList(process.env.OUTBOUND_TARGET_COUNTRIES)]).filter(Boolean);

  if (envIndustries.length || envCountries.length) {
    return {
      industries: clampList(envIndustries, DEFAULT_INDUSTRIES, 8),
      globalCountries: clampList(envCountries, DEFAULT_GLOBAL_COUNTRIES, 10).filter(
        country => country.toLowerCase() !== homeCountry.toLowerCase(),
      ),
      homeCountry,
      source: 'env',
    };
  }

  const cacheDays = Number(process.env.OUTBOUND_TARGET_REFRESH_DAYS ?? 7);
  const cached = await getCachedTargets(cacheDays);
  if (cached) return cached;

  const profile = process.env.OUTBOUND_SERVICE_PROFILE ?? DEFAULT_SERVICE_PROFILE;
  const aiTargets = await generateTargetsWithOpenAI(profile, homeCountry);
  if (aiTargets) {
    await targetsDoc.set(
      {
        ...aiTargets,
        updatedAtMs: Date.now(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return aiTargets;
  }

  return {
    industries: DEFAULT_INDUSTRIES.slice(0, 8),
    globalCountries: DEFAULT_GLOBAL_COUNTRIES.slice(0, 10),
    homeCountry,
    source: 'default',
  };
}

async function loadState(): Promise<TargetState> {
  const snap = await stateDoc.get();
  if (!snap.exists) {
    return { runCount: 0, industryIndex: 0, countryIndex: 0, expanded: false };
  }
  const data = snap.data() as Partial<TargetState>;
  return {
    runCount: data.runCount ?? 0,
    industryIndex: data.industryIndex ?? 0,
    countryIndex: data.countryIndex ?? 0,
    expanded: data.expanded ?? false,
    updatedAtMs: data.updatedAtMs,
    lastRunAtMs: data.lastRunAtMs,
  };
}

export async function resolveOutboundDiscoveryTarget(): Promise<OutboundDiscoveryTarget> {
  const targets = await resolveTargets();
  const state = await loadState();
  const expandAfterRuns = Number(process.env.OUTBOUND_EXPAND_AFTER_RUNS ?? 3);
  const expanded =
    state.expanded ||
    expandAfterRuns <= 0 ||
    (expandAfterRuns > 0 && state.runCount + 1 >= expandAfterRuns);

  const industries = clampList(targets.industries, DEFAULT_INDUSTRIES, 8);
  const countries = expanded
    ? clampList([targets.homeCountry, ...targets.globalCountries], DEFAULT_GLOBAL_COUNTRIES, 10)
    : [targets.homeCountry];

  const industryIndex = state.industryIndex % industries.length;
  const countryIndex = countries.length ? state.countryIndex % countries.length : 0;

  const industry = industries[industryIndex] ?? DEFAULT_INDUSTRIES[0];
  const country = countries[countryIndex] ?? targets.homeCountry;

  await stateDoc.set(
    {
      runCount: state.runCount + 1,
      industryIndex: industryIndex + 1,
      countryIndex: expanded ? countryIndex + 1 : 0,
      expanded,
      lastRunAtMs: Date.now(),
      updatedAtMs: Date.now(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  return {
    industry,
    country,
    industries,
    countries,
    expanded,
    homeCountry: targets.homeCountry,
    source: targets.source,
  };
}
