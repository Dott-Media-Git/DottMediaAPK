import { Platform } from '../types/bot';

export type FallbackKind = 'message' | 'comment';
export type ReplyProfile = 'default' | 'bwinbetug';

type Library = Record<FallbackKind, Record<string, string[]>>;

const defaultLibrary: Library = {
  message: {
    default: [
      'Thanks for reaching out to Dott Media! We help brands automate replies, content, and outreach. WhatsApp +256-775067216.',
      'Appreciate the message. Want a quick demo or pricing overview? WhatsApp +256-775067216.',
      'Glad you connected with Dott Media. We can share a short walkthrough and next steps. WhatsApp +256-775067216.',
      'Thanks for contacting Dott Media! We can tailor an AI setup for your goals. WhatsApp +256-775067216.',
      'Happy to share how Dott Media can grow your engagement and sales. WhatsApp +256-775067216.',
    ],
    instagram: [
      'Thanks for the message! Want a quick Dott Media AI demo? WhatsApp +256-775067216.',
      'Appreciate you reaching out. We help brands grow engagement with AI automation. WhatsApp +256-775067216.',
      'Happy to share pricing and setup details. WhatsApp +256-775067216.',
      'We can walk you through the Dott Media AI Sales Agent in a few minutes. WhatsApp +256-775067216.',
    ],
    facebook: [
      'Thanks for the message! We help brands automate replies, content, and outreach. WhatsApp +256-775067216.',
      'Appreciate you reaching out. Want a quick demo or pricing overview? WhatsApp +256-775067216.',
      'We can tailor a setup for your business goals. WhatsApp +256-775067216.',
      'Happy to share details and next steps. WhatsApp +256-775067216.',
    ],
    whatsapp: [
      'Thanks for reaching out to Dott Media. Want a quick demo or details? WhatsApp +256-775067216.',
      'Appreciate the message. We help brands grow with AI automation. WhatsApp +256-775067216.',
      'Happy to share pricing and a short walkthrough. WhatsApp +256-775067216.',
    ],
    threads: [
      'Thanks for reaching out! Want a quick Dott Media AI demo? WhatsApp +256-775067216.',
      'We help brands automate replies, content, and outreach. WhatsApp +256-775067216.',
      'Happy to share details and next steps. WhatsApp +256-775067216.',
    ],
    linkedin: [
      'Thanks for connecting with Dott Media. We help teams automate replies, content, and outreach. WhatsApp +256-775067216.',
      'Appreciate the note. We can share a short Dott Media AI Sales Agent walkthrough. WhatsApp +256-775067216.',
      'Happy to discuss pricing and a quick demo. WhatsApp +256-775067216.',
    ],
    web: [
      'Thanks for reaching out to Dott Media! We help brands automate replies, content, and outreach. WhatsApp +256-775067216.',
      'Appreciate the message. Want a quick demo or pricing overview? WhatsApp +256-775067216.',
      'Glad you connected with Dott Media. We can share next steps and a short walkthrough. WhatsApp +256-775067216.',
    ],
  },
  comment: {
    default: [
      'Thanks for the comment! For details, WhatsApp +256-775067216.',
      'Appreciate the support. Happy to share details in a DM.',
      'Thanks for engaging! We can share a short demo link if you want.',
    ],
    instagram: [
      'Thanks for the comment! For details, WhatsApp +256-775067216.',
      'Appreciate the support. Happy to share details in a DM.',
    ],
    facebook: [
      'Thanks for the comment! For details, WhatsApp +256-775067216.',
      'Appreciate the support. Happy to share details in a message.',
    ],
    linkedin: [
      'Thanks for the note. Happy to share a brief overview in a message.',
      'Appreciate the comment. We can share a short Dott Media AI demo link if you want.',
    ],
  },
};

const bwinbetLibrary: Library = {
  message: {
    default: [
      'Thanks for reaching out to Bwinbet UG. For today\'s fixtures, odds, and updates, visit www.bwinbetug.info.',
      'Welcome to Bwinbet UG. For full sports info and latest markets, check www.bwinbetug.info.',
      'Appreciate the message. For football picks, match previews, and offers, see www.bwinbetug.info.',
      'Thanks for the message. For all sports betting details, please visit www.bwinbetug.info.',
    ],
    instagram: [
      'Thanks for the DM. For latest football updates and odds, visit www.bwinbetug.info.',
      'Great to hear from you. For full sports info and betting options, check www.bwinbetug.info.',
      'For lineups, fixtures, and markets, head to www.bwinbetug.info.',
    ],
    facebook: [
      'Thanks for the message. For the latest sports updates and odds, visit www.bwinbetug.info.',
      'Welcome to Bwinbet UG. For full details and current markets, check www.bwinbetug.info.',
      'For match previews and football offers, please see www.bwinbetug.info.',
    ],
    whatsapp: [
      'Thanks for contacting Bwinbet UG. For full sports details, visit www.bwinbetug.info.',
      'For today\'s football markets and updates, check www.bwinbetug.info.',
      'Need more info? Please visit www.bwinbetug.info for all sports updates.',
    ],
    threads: [
      'Thanks for reaching out. For latest sports updates and offers, visit www.bwinbetug.info.',
      'For football picks and match info, check www.bwinbetug.info.',
    ],
    linkedin: [
      'Thanks for reaching out. For Bwinbet UG sports updates and market details, visit www.bwinbetug.info.',
      'For football and wider sports information, please check www.bwinbetug.info.',
    ],
    web: [
      'Welcome to Bwinbet UG. For fixtures, odds, and sports news, visit www.bwinbetug.info.',
      'Thanks for reaching out. For full sports details and updates, check www.bwinbetug.info.',
    ],
  },
  comment: {
    default: [
      'Thanks for the comment. For more sports info, visit www.bwinbetug.info.',
      'Appreciate your engagement. Get full details at www.bwinbetug.info.',
      'Great shout. For latest updates and markets, see www.bwinbetug.info.',
    ],
    instagram: [
      'Thanks for the comment. For full match details and odds, visit www.bwinbetug.info.',
      'Appreciate the support. Get more sports updates at www.bwinbetug.info.',
    ],
    facebook: [
      'Thanks for the comment. For latest football updates, visit www.bwinbetug.info.',
      'Appreciate your engagement. For more sports info, check www.bwinbetug.info.',
    ],
    linkedin: [
      'Thanks for your comment. For more sports updates, visit www.bwinbetug.info.',
      'Appreciate the note. Full information is available at www.bwinbetug.info.',
    ],
  },
};

const profileLibraries: Record<ReplyProfile, Library> = {
  default: defaultLibrary,
  bwinbetug: bwinbetLibrary,
};

const pickRandom = (items: string[]) => items[Math.floor(Math.random() * items.length)];

export function pickFallbackReply(options: { channel: Platform; kind: FallbackKind; profile?: string | null }) {
  const channel = options.channel || 'web';
  const kind = options.kind;
  const requestedProfile = String(options.profile ?? 'default').toLowerCase();
  const profileLibrary = profileLibraries[requestedProfile as ReplyProfile] ?? profileLibraries.default;
  const pool =
    profileLibrary[kind]?.[channel] ??
    profileLibrary[kind]?.default ??
    defaultLibrary[kind]?.[channel] ??
    defaultLibrary[kind]?.default ??
    [];
  if (!pool.length) {
    return 'Thanks for reaching out to Dott Media! We will follow up shortly.';
  }
  return pickRandom(pool);
}
