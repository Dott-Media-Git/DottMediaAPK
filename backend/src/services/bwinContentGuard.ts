const KNOWN_BWIN_SCOPE_IDS = ['1zvY9nNyXMcfxdPQEyx0bIdK7r53'];

const BWIN_SPORTS_MARKERS = [
  'bwinbet',
  'sports',
  'sport',
  'football',
  'soccer',
  'match',
  'fixture',
  'fixtures',
  'odds',
  'bet',
  'betting',
  'goal',
  'goals',
  'result',
  'results',
  'table',
  'standings',
  'top scorer',
  'top scorers',
  'prediction',
  'predictions',
  'highlight',
  'highlights',
  'premier league',
  'champions league',
  'la liga',
  'serie a',
  'bundesliga',
  'ligue 1',
  'transfer',
  'kickoff',
  'kick-off',
];

const BANNED_BWIN_MARKERS = [
  'dott media',
  'ai sales bot',
  'sales bot',
  'crm',
  'lead gen',
  'lead generation',
  'outreach automation',
  'social media marketing',
  'appointment booking',
  'book a demo',
  'growth partner',
  'build your pipeline',
  'pipeline',
  'digital playground',
  'executive suite',
  'humanoid robot',
  'always-on growth partner',
];

const BANNED_BWIN_MEDIA_MARKERS = [
  'youthful robot',
  'digital playground poster',
  'executive suite',
  'whatsapp video 2026-01-02',
];

const ALLOWED_BWIN_MEDIA_MARKERS = [
  'bwin',
  'football',
  'soccer',
  'sports',
  'highlight',
  'table-image',
  'top-scorer',
  'prediction',
  'standings',
  'news',
  'result',
];

export type BwinContentValidationInput = {
  userId: string;
  caption?: string;
  hashtags?: string;
  videoTitle?: string;
  imageUrls?: string[];
  videoUrl?: string;
};

export type BwinContentValidationResult = {
  ok: boolean;
  reason?: string;
};

const normalize = (value?: string | null) => `${value ?? ''}`.trim().toLowerCase();

export const resolveBwinScopeIds = () => {
  const envIds = [
    process.env.BWIN_SCOPE_ID ?? '',
    process.env.BWIN_TRACK_OWNER_ID ?? '',
  ]
    .map(value => value.trim())
    .filter(Boolean);
  return Array.from(new Set([...KNOWN_BWIN_SCOPE_IDS, ...envIds]));
};

export const isBwinScopeUser = (userId: string) => resolveBwinScopeIds().includes(userId.trim());

export const validateBwinSportsContent = (
  input: BwinContentValidationInput,
): BwinContentValidationResult => {
  if (!isBwinScopeUser(input.userId)) {
    return { ok: true };
  }

  const textParts = [input.caption, input.hashtags, input.videoTitle]
    .map(value => normalize(value))
    .filter(Boolean);
  const mediaParts = [...(input.imageUrls ?? []), input.videoUrl ?? '']
    .map(value => normalize(value))
    .filter(Boolean);

  const combinedText = textParts.join(' \n ');
  const combinedMedia = mediaParts.join(' \n ');
  const combined = `${combinedText} \n ${combinedMedia}`.trim();

  if (!combined) {
    return {
      ok: false,
      reason: 'Bwinbet content must stay sports-only. Add a sports caption or sports media first.',
    };
  }

  if (BANNED_BWIN_MARKERS.some(marker => combined.includes(marker))) {
    return {
      ok: false,
      reason: 'Bwinbet posts must stay sports-only. Dott Media promo content is blocked for this account.',
    };
  }

  if (BANNED_BWIN_MEDIA_MARKERS.some(marker => combinedMedia.includes(marker))) {
    return {
      ok: false,
      reason: 'Bwinbet posts must use sports media only. This media looks unrelated to sports.',
    };
  }

  const hasSportsText = BWIN_SPORTS_MARKERS.some(marker => combinedText.includes(marker));
  const hasSportsMedia = ALLOWED_BWIN_MEDIA_MARKERS.some(marker => combinedMedia.includes(marker));

  if (!hasSportsText && !hasSportsMedia) {
    return {
      ok: false,
      reason: 'Bwinbet content must stay sports and betting focused.',
    };
  }

  return { ok: true };
};
