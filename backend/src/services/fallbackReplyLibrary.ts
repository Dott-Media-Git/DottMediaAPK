import { Platform } from '../types/bot';

export type FallbackKind = 'message' | 'comment';

type Library = Record<FallbackKind, Record<string, string[]>>;

const library: Library = {
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

const pickRandom = (items: string[]) => items[Math.floor(Math.random() * items.length)];

export function pickFallbackReply(options: { channel: Platform; kind: FallbackKind }) {
  const channel = options.channel || 'web';
  const kind = options.kind;
  const pool = library[kind]?.[channel] ?? library[kind]?.default ?? [];
  if (!pool.length) {
    return 'Thanks for reaching out to Dott Media! We will follow up shortly.';
  }
  return pickRandom(pool);
}
