import path from 'path';
import dotenv from 'dotenv';
import admin from 'firebase-admin';
import { firestore } from '../src/db/firestore';
import { supabaseFallbackService } from '../src/services/supabaseFallbackService';

for (const envPath of [path.resolve(process.cwd(), '.env'), path.resolve(process.cwd(), 'backend/.env')]) {
  dotenv.config({ path: envPath, override: false });
}

if (process.env.FIRESTORE_PREFER_REST === 'true') {
  firestore.settings({ preferRest: true });
}

type ClientConfig = {
  key: string;
  label: string;
  uid: string;
  prompt: string;
  businessType: string;
  fallbackCaption: string;
  fallbackHashtags: string;
  autoReplyPrompt: string;
  includeReels?: boolean;
};

const intervalHours = Math.max(Number(process.env.CLIENT_SOCIAL_INTERVAL_HOURS ?? 1), 0.25);
const reelsIntervalHours = Math.max(Number(process.env.CLIENT_SOCIAL_REELS_INTERVAL_HOURS ?? 2), 0.25);
const now = admin.firestore.Timestamp.now();
const dryRun = process.argv.includes('--dry-run');
const onlyClient = readArg('client').toLowerCase();

const clients: ClientConfig[] = [
  {
    key: 'carmarketplace',
    label: 'Carmarketug',
    uid: 'acmVetCcOiTHeGk5D7eDYieamDF3',
    prompt:
      'Create a fresh, realistic social media image for Carmarketug, a Uganda car marketplace. Show clean cars, smart buying, dealership or viewing energy, confident buyers, polished automotive detail, and no repeated composition.',
    businessType: 'Car marketplace',
    fallbackCaption:
      'Looking for a clean car without wasting time? Send Carmarketug your budget, preferred model, and location, and we will help you narrow down serious options.',
    fallbackHashtags: 'Carmarketug, CarsForSale, UgandaCars, CarMarketplace, BuyACar, CarDeals',
    autoReplyPrompt:
      'Reply as Carmarketug. Ask for budget, preferred model, location, and viewing timing. Keep replies practical and never mention Dott Media.',
  },
  {
    key: 'staysphere',
    label: 'Stay-sphere93',
    uid: 'D1iNgjLKNRaQhH35M0NmGfw1LVD2',
    prompt:
      'Create a fresh, inviting social media image for Stay-sphere93, a short-stay and accommodation brand. Show clean rooms, apartment comfort, travel ease, booking readiness, warm hospitality, and no repeated composition.',
    businessType: 'Short stay accommodation',
    fallbackCaption:
      'Need a comfortable short stay? Send Stay-sphere93 your dates, guest count, preferred area, and budget so we can help with availability.',
    fallbackHashtags: 'StaySphere93, ShortStay, ApartmentStay, BookYourStay, TravelStay, ComfortableStay',
    autoReplyPrompt:
      'Reply as Stay-sphere93. Ask for dates, guest count, preferred area, budget, and availability needs. Keep replies helpful and never mention Dott Media.',
  },
  {
    key: 'gamers44life',
    label: 'Gamers44life',
    uid: 'vzdH1DnfFLVjlY8bBgC26WACmmw2',
    prompt:
      'Create a fresh, high-energy social media image for Gamers44life, a gaming community. Show gaming setups, controllers, monitors, squad play, esports energy, community engagement, and no repeated composition.',
    businessType: 'Gaming community',
    fallbackCaption:
      'Gaming check-in: what are you playing today? Drop the title, your rank, your platform, or the setup upgrade the community should talk about next.',
    fallbackHashtags: 'Gamers44life, GamingCommunity, GamingLife, SetupGoals, Esports, GamerTalk',
    autoReplyPrompt:
      'Reply as Gamers44life. Ask about the game, platform, rank, setup, highlights, or community content ideas. Keep replies natural and never mention Dott Media.',
  },
  {
    key: 'simplicityhomedecor',
    label: 'Simplicity Home Decor',
    uid: 'X0ObAFQft0UWZee9IbUyYaeaBfO2',
    prompt:
      'Create product-led sales copy for Simplicity Home Decor using only the supplied product media. Describe visible home textiles such as throws, cushions, bedsheets, patterns, colours, texture, comfort, and room styling. Never invent prices, materials, sizes, stock, discounts, or delivery promises. End with a clear WhatsApp call to action: +256 774 055 210 or https://wa.me/256774055210.',
    businessType: 'Home decor, throws, cushions and bedding',
    fallbackCaption:
      'Give your space a warm, polished finish with beautiful home textiles from Simplicity Home Decor. Ask about the colours, patterns and options shown. Order or enquire on WhatsApp: +256 774 055 210 — https://wa.me/256774055210',
    fallbackHashtags: 'SimplicityHomeDecor, HomeDecorUganda, Throws, Cushions, Bedsheets, KampalaHomes, InteriorStyling',
    autoReplyPrompt:
      'Reply as Simplicity Home Decor. Be warm, brief and sales-focused. Help with throws, cushions, bedsheets, colours, availability and delivery, but never invent prices or stock. Direct interested customers to WhatsApp +256 774 055 210 (https://wa.me/256774055210). Never mention Dott Media or AI.',
  },
  {
    key: 'dottenergy',
    label: 'Dott Energy',
    uid: 'LVR7p3WzdFM51ds92Kacf6S40og2',
    prompt:
      'Create product-led social posts for Dott Energy, a wind turbine and renewable energy store. Use real wind turbine/product language, mention off-grid use cases, and promote the Shopify store.',
    businessType: 'Wind turbines and renewable energy products',
    fallbackCaption:
      'Clean power starts with the right setup. Dott Energy supplies wind turbines, generators and controllers for homes, farms, lodges and off-grid sites.',
    fallbackHashtags: 'DottEnergy, WindPower, CleanEnergy, RenewableEnergy, OffGridPower, UgandaBusiness',
    autoReplyPrompt:
      'Reply as Dott Energy. Ask for the customer location, power needs, preferred turbine size, battery/inverter setup, and whether they need a wind turbine, generator, or controller. Promote the store when relevant and never mention Dott Media.',
    includeReels: false,
  },
];

function readArg(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return '';
  return process.argv[index + 1]?.trim() ?? '';
}

async function ensureClient(client: ClientConfig) {
  const feedPlatforms = client.key === 'simplicityhomedecor' ? ['facebook', 'instagram', 'threads'] : ['facebook', 'instagram'];
  const autopostPayload = {
    userId: client.uid,
    active: true,
    platforms: feedPlatforms,
    intervalHours,
    nextRun: now,
    storyPlatforms: ['facebook_story', 'instagram_story'],
    storyIntervalHours: intervalHours,
    storyNextRun: now,
    storyTrendEnabled: false,
    prompt: client.prompt,
    businessType: client.businessType,
    fallbackCaption: client.fallbackCaption,
    fallbackHashtags: client.fallbackHashtags,
    requireAiImages: false,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (client.includeReels !== false) {
    Object.assign(autopostPayload, {
      reelsIntervalHours,
      reelsSourceMode: 'dynamic',
      ...(client.key === 'simplicityhomedecor'
        ? { reelsPlatforms: ['instagram_reels', 'facebook', 'threads'] }
        : {}),
    });
  }
  const settingsPayload = {
    autoReplyPrompt: client.autoReplyPrompt,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  if (dryRun) {
    console.log(`[dry-run] would configure ${client.label}`, {
      uid: client.uid,
      platforms: autopostPayload.platforms,
      storyPlatforms: autopostPayload.storyPlatforms,
      intervalHours,
      reelsIntervalHours: client.includeReels === false ? 'disabled' : reelsIntervalHours,
    });
    return;
  }

  try {
    await firestore.collection('autopostJobs').doc(client.uid).set(autopostPayload, { merge: true });
    await firestore.collection('assistant_settings').doc(client.uid).set(settingsPayload, { merge: true });
  } catch (error) {
    console.warn(`Firestore configure failed for ${client.label}; writing autopost fallback`, error instanceof Error ? error.message : String(error));
    await supabaseFallbackService.upsertAutopostJob(client.uid, {
      ...autopostPayload,
      nextRun: now.toDate(),
      storyNextRun: now.toDate(),
      updatedAt: new Date(),
    });
  }
  console.log(
    `configured ${client.label}: feed + stories every ${intervalHours}h, reels ${client.includeReels === false ? 'disabled' : `every ${reelsIntervalHours}h`}, autoreply prompt set`,
  );
}

async function run() {
  const targets = onlyClient
    ? clients.filter(client => client.key === onlyClient || client.label.toLowerCase().includes(onlyClient))
    : clients;
  if (!targets.length) {
    throw new Error(`No client matched ${onlyClient}`);
  }
  for (const client of targets) {
    await ensureClient(client);
  }
}

run().catch(error => {
  console.error('ensure-client-social-automation failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
