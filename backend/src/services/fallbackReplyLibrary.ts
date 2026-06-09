import { Platform } from '../types/bot';

export type FallbackKind = 'message' | 'comment';
export type ReplyProfile =
  | 'default'
  | 'bwinbetug'
  | 'carmarketplace'
  | 'staysphere'
  | 'gamers44life'
  | 'shecare'
  | 'dotthr'
  | 'dottenergy';

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
      'Thanks for reaching out to our sports team. For today\'s fixtures, odds, and updates, visit the link in bio.',
      'Welcome to our sports team. For full sports info and latest markets, check the link in bio.',
      'Appreciate the message. For football picks, match previews, and offers, see the link in bio.',
      'Thanks for the message. For all sports betting details, please visit the link in bio.',
    ],
    instagram: [
      'Thanks for the DM. For latest football updates and odds, visit the link in bio.',
      'Great to hear from you. For full sports info and betting options, check the link in bio.',
      'For lineups, fixtures, and markets, head to the link in bio.',
    ],
    facebook: [
      'Thanks for the message. For the latest sports updates and odds, visit the link in bio.',
      'Welcome to our sports team. For full details and current markets, check the link in bio.',
      'For match previews and football offers, please see the link in bio.',
    ],
    whatsapp: [
      'Thanks for contacting our sports team. For full sports details, visit the link in bio.',
      'For today\'s football markets and updates, check the link in bio.',
      'Need more info? Please visit the link in bio for all sports updates.',
    ],
    threads: [
      'Thanks for reaching out. For latest sports updates and offers, visit the link in bio.',
      'For football picks and match info, check the link in bio.',
    ],
    linkedin: [
      'Thanks for reaching out. For our sports team sports updates and market details, visit the link in bio.',
      'For football and wider sports information, please check the link in bio.',
    ],
    web: [
      'Welcome to our sports team. For fixtures, odds, and sports news, visit the link in bio.',
      'Thanks for reaching out. For full sports details and updates, check the link in bio.',
    ],
  },
  comment: {
    default: [
      'Thanks for the comment. For more info visit the link in bio, and place your bets at the betting link in bio.',
      'Appreciate your engagement. Get full details at the link in bio, then bet at the betting link in bio.',
      'Great shout. See the latest updates on the link in bio and place bets at the betting link in bio.',
    ],
    instagram: [
      'Thanks for the comment. For full match details visit the link in bio, and place your bets at the betting link in bio.',
      'Appreciate the support. Get more sports updates on the link in bio, then bet at the betting link in bio.',
    ],
    facebook: [
      'Thanks for the comment. For latest football updates visit the link in bio, and place your bets at the betting link in bio.',
      'Appreciate your engagement. For more sports info check the link in bio, then bet at the betting link in bio.',
    ],
    linkedin: [
      'Thanks for your comment. For more sports updates visit the link in bio, and place bets at the betting link in bio.',
      'Appreciate the note. Full information is available at the link in bio, with betting at the betting link in bio.',
    ],
  },
};

const carMarketplaceLibrary: Library = {
  message: {
    default: [
      'Thanks for reaching out to Carmarketug. Send your budget, preferred model, and location, and we will help you find serious car options.',
      'Welcome to Carmarketug. Share the car type you want, your budget, and when you want to view, and we will guide you.',
      'Appreciate the message. Tell us whether you need a family car, fuel saver, first car, or upgrade, and we will help narrow it down.',
    ],
    instagram: [
      'Thanks for messaging Carmarketug. Send your budget and preferred model, and we will help with available options.',
      'Welcome. Share your car budget, model preference, and location so we can point you to fitting options.',
    ],
    facebook: [
      'Thanks for contacting Carmarketug. Send your budget, preferred car, and viewing location, and we will help you search smarter.',
      'Happy to help. Tell us the car type you need and your budget, and we will guide you on available options.',
    ],
  },
  comment: {
    default: [
      'Thanks for the interest. Message us your budget and preferred model so we can help.',
      'Appreciate the comment. Send us a message with your budget and car type.',
      'Thanks. DM Carmarketug with your preferred model, budget, and viewing area.',
    ],
  },
};

const staySphereLibrary: Library = {
  message: {
    default: [
      'Thanks for reaching out to Stay-sphere93. Send your dates, guest count, area, and budget so we can help with availability.',
      'Welcome to Stay-sphere93. Share your check-in date, length of stay, and preferred location, and we will guide you.',
      'Appreciate the message. Tell us your dates and guest count, and we will help find a clean, comfortable stay.',
    ],
    instagram: [
      'Thanks for messaging Stay-sphere93. Send your dates, guest count, and preferred area for availability.',
      'Welcome. Share your booking dates and budget, and we will help match you with a fitting stay.',
    ],
    facebook: [
      'Thanks for contacting Stay-sphere93. Send your dates, guest count, location, and budget so we can check availability.',
      'Happy to help with your stay. Share your dates and preferred area, and we will guide you.',
    ],
  },
  comment: {
    default: [
      'Thanks for the interest. Message us your dates and guest count for availability.',
      'Appreciate the comment. DM your dates, area, and budget so we can help.',
      'Thanks. Send Stay-sphere93 your booking dates and guest count.',
    ],
  },
};

const gamersLibrary: Library = {
  message: {
    default: [
      'Thanks for reaching out to Gamers44life. Tell us what you play, your platform, and what gaming content you want to see next.',
      'Welcome to Gamers44life. Drop your game, rank, or setup question, and we will keep the conversation going.',
      'Appreciate the message. Share your current game or setup, and tell us what the community should feature next.',
    ],
    instagram: [
      'Thanks for messaging Gamers44life. What are you playing today? Drop the game, rank, or setup you want featured.',
      'Welcome. Send your game title, platform, or highlight idea and we will check it out.',
    ],
    facebook: [
      'Thanks for contacting Gamers44life. Tell us what you play and what content you want from the community.',
      'Appreciate the message. Drop your game, platform, or setup topic and we will respond.',
    ],
  },
  comment: {
    default: [
      'Thanks for joining in. Drop your game or setup in DM.',
      'Appreciate the comment. What are you playing today?',
      'Thanks. DM your game, rank, or setup idea for Gamers44life.',
    ],
  },
};

const shecareLibrary: Library = {
  message: {
    default: [
      'Thank you for reaching out to SheCare Doctor. Your privacy matters. Please send us a private message or WhatsApp us so we can support you discreetly.',
      'We are here to listen with care and respect. For confidential support, please continue privately or use the WhatsApp link in our bio.',
      'You are not alone. SheCare Doctor can support you privately and respectfully. Please message us directly when you are ready.',
    ],
    instagram: [
      'Thank you for messaging SheCare Doctor. We are here privately and without judgement. Please share what support you need when you are ready.',
      'Your privacy matters. Continue here in DM or use our WhatsApp link for confidential SheCare Doctor support.',
    ],
    facebook: [
      'Thank you for contacting SheCare Doctor. We offer private, respectful support. Please message us with what you need when you are ready.',
      'We are here to listen confidentially. Please continue privately or use the WhatsApp link for SheCare Doctor support.',
    ],
  },
  comment: {
    default: [
      'Thank you for reaching out. Please message SheCare Doctor privately so we can support you confidentially.',
      'We are here to help privately and respectfully. Please send us a direct message.',
      'Your privacy matters. Please DM SheCare Doctor for confidential support.',
    ],
  },
};

const dottHrLibrary: Library = {
  message: {
    default: [
      'Thanks for reaching out to Dott Human Resource. Tell us your hiring or HR support need, team size, and the issue you want solved.',
      'Welcome to Dott HR. Share whether you need recruitment, onboarding, policies, staff management, or HR structure support.',
      'Happy to help. Send your business type, team size, and HR challenge so we can guide you clearly.',
    ],
    instagram: [
      'Thanks for messaging Dott HR. What HR support do you need: hiring, onboarding, policies, or team structure?',
      'Welcome. Share your team size and the HR issue you want to improve, and we will guide you.',
    ],
    facebook: [
      'Thanks for contacting Dott HR. Send your hiring or HR support need, team size, and timeline so we can help.',
      'Happy to help with HR support. Tell us whether you need recruitment, policies, onboarding, or staff management.',
    ],
    threads: [
      'Thanks for reaching out to Dott HR. Tell us the people-management challenge you want to solve.',
      'Appreciate the message. Share your team size and HR support need so we can guide you.',
    ],
  },
  comment: {
    default: [
      'Thanks for the interest. Message Dott HR with your team size and HR support need.',
      'Appreciate the comment. DM us if you need hiring, onboarding, policy, or staff-management support.',
      'Thanks. Send Dott HR a message and we will help you map the next HR step.',
    ],
  },
};

const dottEnergyLibrary: Library = {
  message: {
    default: [
      'Thanks for contacting Dott Energy. Please share your location, power need, and whether you want a turbine, generator, controller, or full setup.',
      'Happy to help with clean power. Send your site location, daily power needs, battery/inverter setup, and preferred turbine size.',
      'Welcome to Dott Energy. Tell us what you want to power and your location so we can guide you to the right wind setup.',
    ],
    instagram: [
      'Thanks for messaging Dott Energy. Share your location, power needs, and whether you need a turbine, generator, or controller.',
      'Happy to help. Tell us your site, battery/inverter setup, and preferred wind turbine size.',
    ],
    facebook: [
      'Thanks for contacting Dott Energy. Send your location, load size, and whether you need a wind turbine, generator, or controller.',
      'We can help you choose the right setup. Please share your power needs, location, and current battery/inverter details.',
    ],
    threads: [
      'Thanks for reaching out to Dott Energy. Share your location and power need so we can recommend a wind setup.',
      'Appreciate the message. Tell us whether you need a turbine, generator, controller, or full off-grid setup.',
    ],
  },
  comment: {
    default: [
      'Thanks for the interest. Message Dott Energy with your location and power needs so we can guide you.',
      'Appreciate the comment. DM us if you need a turbine, generator, controller, or full clean-power setup.',
      'Thanks. Send your site and power needs to Dott Energy and we will recommend the right setup.',
    ],
  },
};

const profileLibraries: Record<ReplyProfile, Library> = {
  default: defaultLibrary,
  bwinbetug: bwinbetLibrary,
  carmarketplace: carMarketplaceLibrary,
  staysphere: staySphereLibrary,
  gamers44life: gamersLibrary,
  shecare: shecareLibrary,
  dotthr: dottHrLibrary,
  dottenergy: dottEnergyLibrary,
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
