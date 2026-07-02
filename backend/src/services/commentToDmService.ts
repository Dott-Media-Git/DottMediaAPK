type Platform = 'instagram' | 'facebook';

const DEFAULT_TRIGGER_KEYWORDS = [
  'guide',
  'info',
  'details',
  'help',
  'price',
  'pricing',
  'book',
  'demo',
  'whatsapp',
  'contact',
  'interested',
];

const CLIENT_PROFILES: Record<string, string> = {
  tce1fq1cofgdupoxp23mpumqraz1: 'shecare',
  '80byieiuuknftuvxtuobxmfc7pu1': 'dotthr',
  lvr7p3wzdfm51ds92kacf6s40og2: 'dottenergy',
  acmvetccoithegk5d7edyieamdf3: 'carmarketplace',
  d1ingjlknraqh35m0nmgfw1lvd2: 'staysphere',
  vzdh1dnfflvjly8bbgc26wacmmw2: 'gamers44life',
  '1zvy9nnyxmcfxdpqeyx0bidk7r53': 'bwinbetug',
};

const USERNAME_PROFILES: Record<string, string> = {
  shecaredoctor: 'shecare',
  dott_human_resource: 'dotthr',
  dottenergy100: 'dottenergy',
  carmarketplace999: 'carmarketplace',
  staysphere93: 'staysphere',
  gamers44life: 'gamers44life',
  ball_analytics: 'bwinbetug',
};

const FACEBOOK_PAGE_PROFILES: Record<string, string> = {
  '1114686181730831': 'shecare',
  '1158550557346330': 'dotthr',
  '1165009866702868': 'dottenergy',
  '1191892417341226': 'carmarketplace',
  '1254924081027995': 'staysphere',
  '1121885391014110': 'gamers44life',
};

const parseKeywords = () => {
  const configured = process.env.COMMENT_TO_DM_KEYWORDS?.split(/[,\n]/).map(value => value.trim()).filter(Boolean) ?? [];
  return (configured.length ? configured : DEFAULT_TRIGGER_KEYWORDS).map(value => value.toLowerCase());
};

export const isCommentToDmTrigger = (text?: string | null) => {
  const normalized = String(text ?? '').toLowerCase();
  if (!normalized) return false;
  return parseKeywords().some(keyword => {
    if (!keyword) return false;
    return new RegExp(`(^|[^a-z0-9_])${escapeRegExp(keyword)}([^a-z0-9_]|$)`, 'i').test(normalized);
  });
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const profileFor = (userId?: string, username?: string, pageId?: string) =>
  CLIENT_PROFILES[userId?.trim().toLowerCase() ?? ''] ??
  USERNAME_PROFILES[username?.trim().toLowerCase() ?? ''] ??
  FACEBOOK_PAGE_PROFILES[pageId?.trim() ?? ''] ??
  'default';

export const buildCommentToDmCaptionCta = (options: { userId?: string; username?: string; pageId?: string }) => {
  const profile = profileFor(options.userId, options.username, options.pageId);
  if (profile === 'shecare') return 'Comment HELP and we will send private details in your DM.';
  if (profile === 'dotthr') return 'Comment GUIDE and we will send the details in your DM.';
  if (profile === 'dottenergy') return 'Comment PRICE and we will send product details in your DM.';
  if (profile === 'carmarketplace') return 'Comment CAR and we will send available options in your DM.';
  if (profile === 'staysphere') return 'Comment BOOK and we will send availability details in your DM.';
  if (profile === 'gamers44life') return 'Comment INFO and we will send the details in your DM.';
  if (profile === 'bwinbetug') return 'Comment GUIDE and we will send sports details in your DM.';
  return 'Comment INFO and we will send the details in your DM.';
};

export const appendCommentToDmCaptionCta = (
  caption: string,
  options: { userId?: string; username?: string; pageId?: string } = {},
) => {
  const cleanCaption = String(caption ?? '').trim();
  if (!cleanCaption) return cleanCaption;
  if (/comment\s+(guide|info|details|help|price|pricing|book|demo|whatsapp|contact|interested|car)\b/i.test(cleanCaption)) {
    return cleanCaption;
  }
  return `${cleanCaption}\n\n${buildCommentToDmCaptionCta(options)}`.trim();
};

export const buildCommentToDmPublicReply = (options: { platform: Platform; userId?: string }) => {
  const profile = profileFor(options.userId);
  if (profile === 'shecare') return 'Thank you. We have sent you a private message for discreet support.';
  if (profile === 'dotthr') return 'Thanks. We have sent the HR details to your inbox.';
  if (profile === 'dottenergy') return 'Thanks. We have sent product and pricing details to your inbox.';
  if (profile === 'carmarketplace') return 'Thanks. We have sent car options and next steps to your inbox.';
  if (profile === 'staysphere') return 'Thanks. We have sent booking details to your inbox.';
  if (profile === 'gamers44life') return 'Thanks. We have sent the details to your inbox.';
  if (profile === 'bwinbetug') return 'Thanks. We have sent the sports details to your inbox.';
  return `Thanks. We have sent the details to your ${options.platform === 'facebook' ? 'Messenger' : 'inbox'}.`;
};

export const buildCommentToDmMessage = (options: { platform: Platform; userId?: string; commentText?: string }) => {
  const profile = profileFor(options.userId);
  if (profile === 'shecare') {
    return 'Thank you for reaching out to SheCare Doctor. Your privacy matters. Please tell us what support you need, or use the WhatsApp link in our bio for confidential help.';
  }
  if (profile === 'dotthr') {
    return 'Thanks for your interest in Dott HR. We can help with hiring, onboarding, HR policies, team structure, and staff management. What support do you need right now?';
  }
  if (profile === 'dottenergy') {
    return 'Thanks for your interest in Dott Energy. Tell us your location, power need, and whether you need a turbine, generator, controller, battery, or full setup.';
  }
  if (profile === 'carmarketplace') {
    return 'Thanks for your interest in Carmarketug. Send your budget, preferred model, location, and whether you want to buy, view, or compare options.';
  }
  if (profile === 'staysphere') {
    return 'Thanks for your interest in Stay-sphere93. Send your dates, guest count, preferred area, and budget so we can help with availability.';
  }
  if (profile === 'gamers44life') {
    return 'Thanks for reaching out to Gamers44life. Tell us the game, platform, rank, setup, or content idea you want help with.';
  }
  if (profile === 'bwinbetug') {
    return 'Thanks for your interest. For football updates, fixtures, markets, and betting details, visit the link in bio.';
  }
  return 'Thanks for your interest. Tell us what you need and we will send the right details. Reply STOP to opt out.';
};
