import admin from "firebase-admin";
import axios from "axios";
import sharp from "sharp";
import * as cheerio from "cheerio";
import fs from "fs";
import path from "path";
import * as crypto from "crypto";
import { TwitterApi } from "twitter-api-v2";
import { firestore } from "../db/firestore.js";
import { config } from "../config.js";
import { contentGenerationService } from "../packages/services/contentGenerationService.js";
import { socialAnalyticsService } from "../packages/services/socialAnalyticsService.js";
import { publishToInstagram, publishToInstagramReel, publishToInstagramStory } from "../packages/services/socialPlatforms/instagramPublisher.js";
import { publishToFacebook, publishToFacebookStory } from "../packages/services/socialPlatforms/facebookPublisher.js";
import { publishToLinkedIn } from "../packages/services/socialPlatforms/linkedinPublisher.js";
import { publishToThreads } from "../packages/services/socialPlatforms/threadsPublisher.js";
import { publishToTwitter } from "../packages/services/socialPlatforms/twitterPublisher.js";
import { publishToYouTube } from "../packages/services/socialPlatforms/youtubePublisher.js";
import { publishToTikTok } from "../packages/services/socialPlatforms/tiktokPublisher.js";
import { getTikTokIntegrationSecrets, getYouTubeIntegrationSecrets } from "./socialIntegrationService.js";
import { canUsePrimarySocialDefaults, isPrimarySocialUserId } from "../utils/socialAccess.js";
import { getNewsTrendingCandidates } from "./newsTrendSources.js";
import { getUserTrendConfig } from "./userTrendSourceService.js";
import { getTrendingCandidates as getFootballTrendingCandidates } from "./footballTrendSources.js";
import { footballTrendContentService } from "./footballTrendContentService.js";
import { fetchHighlightlyFootballHighlights } from "./highlightlyService.js";
import { resolveBrandIdForClient } from "./brandKitService.js";
import { renderLeagueTableImage, renderPredictionsImage, renderTopScorersImage } from "./tableImageService.js";
import { supabaseFallbackService } from "./supabaseFallbackService.js";
import { resolveFacebookPageId } from "./socialAccountResolver.js";
import {
  buildCarmarketVehicleCaption,
  pickCarmarketVehicle,
  prepareCarmarketVehicleImage,
  renderCarmarketCoverImage
} from "./beforwardVehicleService.js";
import {
  buildStaysphereListingCaption,
  pickStaysphereListing,
  prepareStaysphereListingImage,
  renderStaysphereCoverImage,
  staysphereListingHistoryKey
} from "./staysphereListingService.js";
import {
  buildGamersSteamCaption,
  buildGamersSteamVideoCaption,
  gamersSteamHistoryKey,
  pickGamersSteamScreenshots,
  pickGamersSteamVideo
} from "./gamersContentService.js";
import {
  buildDottEnergyFallbackCaption,
  buildDottEnergyEducationCaption,
  buildDottEnergyProductCaption,
  dottEnergyEducationHistoryKey,
  dottEnergyFallbackPosterHistoryKey,
  dottEnergyProductHistoryKey,
  pickDottEnergyEducationTopic,
  pickDottEnergyFallbackPoster,
  pickDottEnergyProduct,
  renderDottEnergyEducationCard,
  renderDottEnergyFallbackPoster,
  renderDottEnergyProductImage,
  shouldUseDottEnergyFallbackPoster
} from "./dottEnergyProductService.js";
import { saveGeneratedImageBuffer } from "./generatedMediaService.js";
import { isBwinScopeUser as isKnownBwinScopeUser, validateBwinSportsContent } from "./bwinContentGuard.js";
import {
  getBwinAccountClosureMessage,
  getBwinAccountClosureState,
  isBwinAccountClosureActive
} from "./bwinAccountClosureService.js";
const TOP_FIVE_LEAGUES = [
  { id: "eng.1", label: "Premier League", espnId: "eng.1" },
  { id: "esp.1", label: "La Liga", espnId: "esp.1" },
  { id: "ita.1", label: "Serie A", espnId: "ita.1" },
  { id: "ger.1", label: "Bundesliga", espnId: "ger.1" },
  { id: "fra.1", label: "Ligue 1", espnId: "fra.1" }
];
const autopostCollection = firestore.collection("autopostJobs");
const scheduledPostsCollection = firestore.collection("scheduledPosts");
const CLIENT_META_FALLBACKS = {
  acmVetCcOiTHeGk5D7eDYieamDF3: {
    pageId: "1033657279841186",
    instagramAccountId: "17841414110816982",
    instagramUsername: "carmarketplace999"
  },
  D1iNgjLKNRaQhH35M0NmGfw1LVD2: {
    pageId: "1191303874068642",
    instagramAccountId: "17841448080672466",
    instagramUsername: "staysphere93"
  },
  vzdH1DnfFLVjlY8bBgC26WACmmw2: {
    pageId: "1121885391014110",
    instagramAccountId: "17841412643148539",
    instagramUsername: "gamers44life"
  },
  LVR7p3WzdFM51ds92Kacf6S40og2: {
    pageId: "1201086759745632",
    instagramAccountId: "17841433799368009",
    instagramUsername: "dottenergy100"
  }
};
const CLIENT_ENV_PREFIXES = {
  acmVetCcOiTHeGk5D7eDYieamDF3: "CARMARKETPLACE",
  D1iNgjLKNRaQhH35M0NmGfw1LVD2: "STAYSPHERE",
  vzdH1DnfFLVjlY8bBgC26WACmmw2: "GAMERS44LIFE",
  LVR7p3WzdFM51ds92Kacf6S40og2: "DOTTENERGY"
};
const PINNED_CLIENT_RUNTIME_PROMPTS = {
  acmVetCcOiTHeGk5D7eDYieamDF3: {
    prompt: "Create a marketplace post for a real car listing suitable for Uganda buyers. Use practical, direct language and avoid generic Dott Media copy.",
    businessType: "Uganda car marketplace",
    fallbackHashtags: "#CarMarketPlace #UgandaCars #CarsForSaleUganda #KampalaCars"
  },
  D1iNgjLKNRaQhH35M0NmGfw1LVD2: {
    prompt: "Create a short-stay property post for StaySphere using real accommodation language for Uganda travelers. Mention the area, comfort, booking angle, and keep it warm but concise.",
    businessType: "Uganda stays, rentals, hotels, and Airbnbs",
    fallbackHashtags: "#StaySphere93 #UgandaStaycation #KampalaStays #ShortStayUganda #AirbnbUganda"
  },
  vzdH1DnfFLVjlY8bBgC26WACmmw2: {
    prompt: "Create a gaming post using real gameplay language and clear gamer-first wording. Avoid unrelated brand or Dott Media copy.",
    businessType: "gaming media and gameplay highlights",
    fallbackHashtags: "#Gamers44life #Gaming #Gameplay #GamingCommunity"
  },
  LVR7p3WzdFM51ds92Kacf6S40og2: {
    prompt: "Create a product-led Dott Energy post for wind turbines, wind generators, MPPT controllers, and off-grid clean power. Use practical buyer language, promote the Shopify store, and avoid generic climate slogans.",
    businessType: "wind turbines and renewable energy products",
    fallbackHashtags: "#DottEnergy #WindPower #CleanEnergy #RenewableEnergy #OffGridPower"
  }
};
const NICHE_CLIENT_SOCIAL_FEED_INTERVAL_HOURS = 3;
const NICHE_CLIENT_INSTAGRAM_REELS_INTERVAL_HOURS = 4;
const logSafeError = (error) => {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  const candidate = error;
  const apiMessage = candidate?.response?.data?.error?.message;
  if (typeof apiMessage === "string") return apiMessage;
  if (typeof candidate?.message === "string") return candidate.message;
  return String(error ?? "unknown_error");
};
const platformPublishers = {
  instagram: publishToInstagram,
  instagram_reels: publishToInstagramReel,
  instagram_story: publishToInstagramStory,
  threads: publishToThreads,
  tiktok: publishToTikTok,
  facebook: publishToFacebook,
  facebook_story: publishToFacebookStory,
  linkedin: publishToLinkedIn,
  twitter: publishToTwitter,
  youtube: publishToYouTube,
  x: publishToTwitter
};
class AutoPostService {
  constructor() {
    this.memoryStore = /* @__PURE__ */ new Map();
    this.useMemory = config.security.allowMockAuth && !process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim() && !process.env.FIREBASE_SERVICE_ACCOUNT?.trim();
    // Post every 4 hours by default; override with AUTOPOST_INTERVAL_MINUTES for tighter testing windows.
    this.defaultIntervalHours = Math.max(Number(process.env.AUTOPOST_INTERVAL_MINUTES ?? 240) / 60, 0.05);
    // Reels auto-post every 4 hours by default; override with AUTOPOST_REELS_INTERVAL_MINUTES if needed.
    this.defaultReelsIntervalHours = Math.max(Number(process.env.AUTOPOST_REELS_INTERVAL_MINUTES ?? 240) / 60, 0.25);
    this.defaultStoryIntervalHours = Math.max(Number(process.env.AUTOPOST_STORY_INTERVAL_MINUTES ?? 120) / 60, 0.25);
    this.fallbackImageBase = "https://images.unsplash.com/photo-1504384308090-c894fdcc538d?ixlib=rb-4.0.3&auto=format&fit=crop&w=1200&q=80";
    this.defaultFallbackImagePool = [
      "https://images.unsplash.com/photo-1504384308090-c894fdcc538d?ixlib=rb-4.0.3&auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1521737604893-d14cc237f11d?ixlib=rb-4.0.3&auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1525182008055-f88b95ff7980?ixlib=rb-4.0.3&auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1485217988980-11786ced9454?ixlib=rb-4.0.3&auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1529333166437-7750a6dd5a70?ixlib=rb-4.0.3&auto=format&fit=crop&w=1200&q=80"
    ];
    this.defaultFallbackCaption = "Meet Dott Media's AI Sales Bot - your always-on growth partner for CRM, social media, lead gen, and outreach automation. \u{1F680} Want a quick demo? DM us and let's build your pipeline. \u{1F916}\u2728";
    this.defaultFallbackHashtags = "DottMedia, AISalesBot, SalesAutomation, LeadGeneration, BusinessGrowth, CRM, MarketingAutomation, SalesPipeline, CustomerSuccess, AI, Automation, SmallBusiness, DigitalMarketing, B2B, Productivity, AIAutomation, AIForBusiness, AIAnalytics, AIMarketing, AIStrategy, AICRM, AIProductivity, AITools, MachineLearning, GenerativeAI";
    this.fallbackCaptionVariants = [
      "DM us for a quick demo.",
      "Book a 15-minute walkthrough.",
      "Want the demo link? Send a message.",
      "Ready to grow? Let's talk.",
      "Ask for a quick demo today."
    ];
    this.defaultBwinFallbackCaption = "Football update. Stay on top of fixtures, results, and matchday talking points.";
    this.defaultBwinFallbackHashtags = "FootballUpdate, Matchday, FootballNews, Soccer, MatchPreview, Results, Highlights, TopScorers, LiveTable, FootballAnalytics";
    this.bwinFallbackCaptionVariants = [
      "More match details available in bio.",
      "Track more fixtures and football updates in bio.",
      "Check the latest match context in bio.",
      "Stay tuned for more football updates.",
      "More football insight is live in bio."
    ];
    this.defaultXHighlightAccounts = [
      "ChampionsLeague",
      "SerieA_EN",
      "LaLigaEN",
      "Ligue1_ENG",
      "Bundesliga_EN"
    ];
    this.trustedXHighlightAccounts = /* @__PURE__ */ new Set([
      "championsleague",
      "seriea_en",
      "laligaen",
      "ligue1_eng",
      "bundesliga_en"
    ]);
    this.xBlockedHighlightAccounts = /* @__PURE__ */ new Set([
      "premierleague",
      "premier_league",
      "premier-league",
      "skysportsnews",
      "skysportspl",
      "espnfc",
      "433",
      "brfootball",
      "onefootball",
      "cbssportsgolazo",
      "tntsports",
      "footballontnt"
    ]);
    this.defaultXWeeklyAwardKeywords = [
      "player of the week",
      "goal of the week",
      "save of the week",
      "team of the week",
      "manager of the week",
      "weekly awards",
      "totw",
      "best xi",
      "goal of the month",
      "player of the month"
    ];
    this.emergencyXLastRunAt = 0;
    this.emergencyXLastKey = null;
  }
  getFallbackImagePool() {
    return this.loadFallbackImagePool();
  }
  getFallbackVideoPool() {
    return this.loadFallbackVideoPool();
  }
  getPrimaryFallbackEmail() {
    return (process.env.PRIMARY_SOCIAL_DEFAULT_EMAIL ?? "brasioxirin@gmail.com").trim().toLowerCase();
  }
  isBwinScopeUser(userId) {
    return isKnownBwinScopeUser(userId);
  }
  async stopBwinAutomation(userId, job, message) {
    const result = [{ platform: "bwin_account_closure", status: "failed", error: message }];
    const closedAt = admin.firestore.Timestamp.now();
    const updatePayload = {
      active: false,
      nextRun: null,
      reelsNextRun: null,
      storyNextRun: null,
      trendNextRun: null,
      lastRunAt: closedAt,
      reelsLastRunAt: closedAt,
      storyLastRunAt: closedAt,
      trendLastRunAt: closedAt,
      lastResult: result,
      reelsLastResult: result,
      storyLastResult: result,
      trendLastResult: result,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    try {
      await autopostCollection.doc(userId).set(updatePayload, { merge: true });
    } catch (error) {
      console.warn("[autopost] failed to mark Bwin job closed", error);
    }
    await this.mirrorAutopostJob(userId, {
      ...job,
      ...updatePayload,
      updatedAt: void 0
    });
  }
  async getRuntimeFallbackAccounts(userId) {
    if (!this.isBwinScopeUser(userId)) {
      const envAccounts = this.getPinnedClientEnvAccounts(userId);
      const clientFallback = CLIENT_META_FALLBACKS[userId];
      const prefix = CLIENT_ENV_PREFIXES[userId];
      const token = (prefix ? process.env[`${prefix}_META_USER_TOKEN`] ?? "" : "").trim();
      if (!clientFallback || !token) return envAccounts;
      try {
        const resolved = await resolveFacebookPageId(token, clientFallback.pageId);
        const pageToken = resolved?.pageToken?.trim() || token;
        const pageId = resolved?.pageId?.trim() || clientFallback.pageId;
        return {
          ...envAccounts,
          facebook: {
            accessToken: pageToken,
            pageId,
            ...resolved?.pageName ? { pageName: resolved.pageName } : {}
          },
          instagram: {
            accessToken: pageToken,
            accountId: clientFallback.instagramAccountId,
            username: clientFallback.instagramUsername
          }
        };
      } catch (error) {
        console.warn("[autopost] client runtime credential fallback failed", {
          userId,
          error: error instanceof Error ? error.message : String(error)
        });
        return envAccounts;
      }
    }
    const fallback = {
      ...this.getEmergencyTwitterCredentials() ?? {},
      ...this.getEmergencyInstagramCredentials() ?? {}
    };
    const rawFacebook = this.getEmergencyFacebookCredentials();
    const rawAccessToken = rawFacebook?.facebook?.accessToken?.trim() ?? "";
    const rawPageId = rawFacebook?.facebook?.pageId?.trim() ?? "";
    if (rawAccessToken && rawPageId) {
      let accessToken = rawAccessToken;
      let pageId = rawPageId;
      try {
        const resolved = await resolveFacebookPageId(rawAccessToken, rawPageId);
        accessToken = resolved?.pageToken?.trim() || accessToken;
        pageId = resolved?.pageId?.trim() || pageId;
      } catch (error) {
        console.warn("[autopost] failed to resolve Bwin page token from fallback token", {
          userId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
      fallback.facebook = { accessToken, pageId };
    }
    return fallback;
  }
  getPinnedClientEnvAccounts(userId) {
    const prefix = CLIENT_ENV_PREFIXES[userId];
    const fallback = CLIENT_META_FALLBACKS[userId];
    if (!prefix || !fallback) return {};
    const value = (name) => (process.env[`${prefix}_${name}`] ?? "").trim();
    const facebookToken = value("FACEBOOK_PAGE_TOKEN") || value("FACEBOOK_ACCESS_TOKEN");
    const instagramToken = value("INSTAGRAM_ACCESS_TOKEN") || facebookToken;
    const threadsToken = value("THREADS_ACCESS_TOKEN");
    const accounts = {};
    if (facebookToken) {
      accounts.facebook = {
        accessToken: facebookToken,
        pageId: value("FACEBOOK_PAGE_ID") || fallback.pageId
      };
    }
    if (instagramToken) {
      accounts.instagram = {
        accessToken: instagramToken,
        accountId: value("INSTAGRAM_ACCOUNT_ID") || fallback.instagramAccountId,
        username: value("INSTAGRAM_USERNAME") || fallback.instagramUsername
      };
    }
    const threadsAccountId = value("THREADS_ACCOUNT_ID") || value("THREADS_PROFILE_ID");
    if (threadsToken && threadsAccountId) {
      accounts.threads = {
        accessToken: threadsToken,
        accountId: threadsAccountId,
        username: value("THREADS_USERNAME") || fallback.instagramUsername
      };
    }
    return accounts;
  }
  buildPinnedClientRuntimeJob(userId) {
    if (process.env.AUTOPOST_PINNED_CLIENT_RUNTIME_JOBS === "false") return null;
    const profile = PINNED_CLIENT_RUNTIME_PROMPTS[userId];
    if (!profile) return null;
    const now = admin.firestore.Timestamp.now();
    const isDottEnergy = userId === "LVR7p3WzdFM51ds92Kacf6S40og2";
    return {
      userId,
      active: true,
      platforms: isDottEnergy ? ["facebook", "instagram"] : ["facebook", "instagram", "threads"],
      storyPlatforms: ["facebook_story", "instagram_story"],
      prompt: profile.prompt,
      businessType: profile.businessType,
      fallbackHashtags: profile.fallbackHashtags,
      requireAiImages: false,
      intervalHours: NICHE_CLIENT_SOCIAL_FEED_INTERVAL_HOURS,
      nextRun: now,
      storyIntervalHours: NICHE_CLIENT_SOCIAL_FEED_INTERVAL_HOURS,
      storyNextRun: now,
      reelsIntervalHours: isDottEnergy ? void 0 : NICHE_CLIENT_INSTAGRAM_REELS_INTERVAL_HOURS,
      reelsNextRun: !isDottEnergy && userId === "vzdH1DnfFLVjlY8bBgC26WACmmw2" ? now : void 0
    };
  }
  seedPinnedClientRuntimeJobs(now) {
    if (process.env.AUTOPOST_PINNED_CLIENT_RUNTIME_JOBS === "false") return;
    for (const userId of Object.keys(PINNED_CLIENT_RUNTIME_PROMPTS)) {
      if (this.memoryStore.has(userId)) continue;
      const job = this.buildPinnedClientRuntimeJob(userId);
      if (!job) continue;
      this.cacheJob(userId, {
        ...job,
        nextRun: now,
        storyNextRun: now,
        reelsNextRun: job.reelsNextRun ? now : void 0
      });
    }
  }
  async safeGetUserTrendConfig(userId) {
    return getUserTrendConfig(userId);
  }
  isFirestoreQuotaError(error) {
    if (!error || typeof error !== "object") return false;
    const candidate = error;
    const code = typeof candidate.code === "number" ? candidate.code : Number(candidate.code ?? NaN);
    if (Number.isFinite(code) && code === 8) return true;
    const details = String(candidate.details ?? "").toLowerCase();
    const message = String(candidate.message ?? "").toLowerCase();
    return details.includes("quota exceeded") || message.includes("quota exceeded") || message.includes("resource_exhausted");
  }
  withTimeout(promise, timeoutMs, label) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${label}_timeout`)), timeoutMs);
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        }
      );
    });
  }
  cacheJob(userId, job) {
    this.memoryStore.set(userId, job);
  }
  async mirrorAutopostJob(userId, job) {
    this.cacheJob(userId, job);
    try {
      await supabaseFallbackService.upsertAutopostJob(userId, job);
    } catch (error) {
      console.warn("[autopost] supabase job mirror failed", logSafeError(error));
    }
  }
  async loadAutopostJob(userId) {
    const cached = this.memoryStore.get(userId);
    if (cached) return cached;
    try {
      const firestoreTimeoutMs = Math.max(Number(process.env.AUTOPOST_FIRESTORE_TIMEOUT_MS ?? 15e3), 3e3);
      const snap = await this.withTimeout(
        autopostCollection.doc(userId).get(),
        firestoreTimeoutMs,
        "firestore_autopost_job_fetch"
      );
      if (snap.exists) {
        const job = snap.data();
        this.cacheJob(userId, job);
        return job;
      }
    } catch (error) {
      console.warn("[autopost] firestore job fetch failed; checking fallback store", error);
    }
    try {
      const fallback = await supabaseFallbackService.getAutopostJob(userId);
      if (fallback) {
        const job = fallback;
        this.cacheJob(userId, job);
        return job;
      }
    } catch (error) {
      console.warn("[autopost] supabase job fetch failed", logSafeError(error));
    }
    const runtimeJob = this.buildPinnedClientRuntimeJob(userId);
    if (runtimeJob) {
      console.warn("[autopost] using pinned client runtime job because configured stores are unavailable", { userId });
      this.cacheJob(userId, runtimeJob);
      return runtimeJob;
    }
    return null;
  }
  async runDueJobsFromFallback(now, excludedUserIds = /* @__PURE__ */ new Set()) {
    this.seedPinnedClientRuntimeJobs(now);
    const buildDueSets = () => ({
      dueStandard: Array.from(this.memoryStore.entries()).filter(
        ([userId, job]) => !excludedUserIds.has(userId) && job.active !== false && job.nextRun && job.nextRun.toMillis() <= now.toMillis()
      ),
      dueReels: Array.from(this.memoryStore.entries()).filter(
        ([userId, job]) => !excludedUserIds.has(userId) && job.active !== false && job.reelsNextRun && job.reelsNextRun.toMillis() <= now.toMillis()
      ),
      dueStories: Array.from(this.memoryStore.entries()).filter(
        ([userId, job]) => !excludedUserIds.has(userId) && job.active !== false && job.storyNextRun && job.storyNextRun.toMillis() <= now.toMillis()
      ),
      dueTrends: Array.from(this.memoryStore.entries()).filter(
        ([userId, job]) => !excludedUserIds.has(userId) && job.active !== false && job.trendEnabled === true && job.trendNextRun && job.trendNextRun.toMillis() <= now.toMillis()
      )
    });
    let { dueStandard, dueReels, dueStories, dueTrends } = buildDueSets();
    if (!dueStandard.length && !dueReels.length && !dueStories.length && !dueTrends.length) {
      try {
        const [standard, reels, stories, trends] = await Promise.all([
          supabaseFallbackService.getDueAutopostJobs("next_run", new Date(now.toMillis())),
          supabaseFallbackService.getDueAutopostJobs("reels_next_run", new Date(now.toMillis())),
          supabaseFallbackService.getDueAutopostJobs("story_next_run", new Date(now.toMillis())),
          supabaseFallbackService.getDueAutopostJobs("trend_next_run", new Date(now.toMillis()))
        ]);
        [...standard, ...reels, ...stories, ...trends].forEach((job) => {
          if (!job?.userId) return;
          this.cacheJob(job.userId, job);
        });
      } catch (error) {
        console.warn("[autopost] supabase due-job fetch failed", logSafeError(error));
      }
      ({ dueStandard, dueReels, dueStories, dueTrends } = buildDueSets());
    }
    let processed = 0;
    const results = /* @__PURE__ */ new Map();
    for (const [userId, job] of dueStandard) {
      if (!await this.claimDueRun(userId, job, "next_run", now)) continue;
      const outcome = await this.executeJob(userId, job);
      processed += 1;
      results.set(userId, {
        userId,
        posted: outcome.posted ?? 0,
        failed: outcome.failed?.length ?? 0,
        nextRun: typeof outcome.nextRun === "string" ? outcome.nextRun : null
      });
    }
    for (const [userId, job] of dueReels) {
      if (!await this.claimDueRun(userId, job, "reels_next_run", now)) continue;
      const outcome = await this.executeJob(userId, job, {
        platforms: ["instagram_reels"],
        intervalHours: this.getReelsIntervalHours(userId, job.reelsIntervalHours),
        nextRunField: "reelsNextRun",
        lastRunField: "reelsLastRunAt",
        resultField: "reelsLastResult",
        useGenericVideoFallback: false
      });
      processed += 1;
      const existing = results.get(userId) ?? { userId, posted: 0, failed: 0, nextRun: null };
      results.set(userId, {
        ...existing,
        reelsPosted: outcome.posted ?? 0,
        reelsFailed: outcome.failed?.length ?? 0,
        reelsNextRun: typeof outcome.nextRun === "string" ? outcome.nextRun : null
      });
    }
    for (const [userId, job] of dueStories) {
      if (!await this.claimDueRun(userId, job, "story_next_run", now)) continue;
      const outcome = job.storyTrendEnabled === true ? await this.executeTrendStories(userId, job) : await this.executeJob(userId, job, {
        platforms: this.getStoryPlatforms(job),
        intervalHours: this.getStoryIntervalHours(userId, job.storyIntervalHours),
        nextRunField: "storyNextRun",
        lastRunField: "storyLastRunAt",
        resultField: "storyLastResult"
      });
      processed += 1;
      const existing = results.get(userId) ?? { userId, posted: 0, failed: 0, nextRun: null };
      results.set(userId, {
        ...existing,
        storyPosted: outcome.posted ?? 0,
        storyFailed: outcome.failed?.length ?? 0,
        storyNextRun: typeof outcome.nextRun === "string" ? outcome.nextRun : null
      });
    }
    for (const [userId, job] of dueTrends) {
      const feedAlreadyProcessed = Boolean(results.get(userId)?.nextRun);
      if (this.isBwinScopeUser(userId) && feedAlreadyProcessed) {
        continue;
      }
      if (!await this.claimDueRun(userId, job, "trend_next_run", now)) continue;
      const outcome = await this.executeTrendPosts(userId, job);
      processed += 1;
      const existing = results.get(userId) ?? { userId, posted: 0, failed: 0, nextRun: null };
      results.set(userId, {
        ...existing,
        trendPosted: outcome.posted ?? 0,
        trendFailed: outcome.failed?.length ?? 0,
        trendNextRun: typeof outcome.nextRun === "string" ? outcome.nextRun : null
      });
    }
    return { processed, results: Array.from(results.values()) };
  }
  getEmergencyTwitterCredentials() {
    const accessToken = process.env.BWIN_X_ACCESS_TOKEN ?? process.env.BWIN_TWITTER_ACCESS_TOKEN ?? process.env.TWITTER_ACCESS_TOKEN ?? "";
    const accessSecret = process.env.BWIN_X_ACCESS_SECRET ?? process.env.BWIN_TWITTER_ACCESS_SECRET ?? process.env.TWITTER_ACCESS_SECRET ?? "";
    const appKey = process.env.BWIN_X_APP_KEY ?? process.env.BWIN_TWITTER_APP_KEY ?? process.env.TWITTER_API_KEY ?? process.env.TWITTER_CONSUMER_KEY ?? "";
    const appSecret = process.env.BWIN_X_APP_SECRET ?? process.env.BWIN_TWITTER_APP_SECRET ?? process.env.TWITTER_API_SECRET ?? process.env.TWITTER_CONSUMER_SECRET ?? "";
    if (!accessToken || !accessSecret || !appKey || !appSecret) return null;
    return {
      twitter: {
        accessToken,
        accessSecret,
        appKey,
        appSecret
      }
    };
  }
  getEmergencyFacebookCredentials() {
    const accessToken = process.env.BWIN_FACEBOOK_PAGE_TOKEN ?? process.env.BWIN_FACEBOOK_ACCESS_TOKEN ?? "";
    const pageId = process.env.BWIN_FACEBOOK_PAGE_ID ?? "";
    if (!accessToken || !pageId) return null;
    return {
      facebook: {
        accessToken,
        pageId
      }
    };
  }
  getEmergencyInstagramCredentials() {
    const accessToken = process.env.BWIN_INSTAGRAM_ACCESS_TOKEN ?? process.env.BWIN_INSTAGRAM_TOKEN ?? "";
    const accountId = process.env.BWIN_INSTAGRAM_ACCOUNT_ID ?? process.env.BWIN_INSTAGRAM_BUSINESS_ID ?? "";
    if (!accessToken || !accountId) return null;
    return {
      instagram: {
        accessToken,
        accountId,
        username: process.env.BWIN_INSTAGRAM_USERNAME ?? void 0
      }
    };
  }
  async runBwinEmergencyPost(now) {
    const enabled = process.env.BWIN_X_EMERGENCY_ENABLED === "true";
    if (!enabled) {
      return { attempted: false, posted: false, reason: "disabled" };
    }
    const intervalMinutes = Math.max(Number(process.env.BWIN_X_EMERGENCY_INTERVAL_MINUTES ?? 60), 10);
    if (this.emergencyXLastRunAt) {
      const elapsedMs = now.getTime() - this.emergencyXLastRunAt;
      if (elapsedMs < intervalMinutes * 60 * 1e3) {
        return {
          attempted: false,
          posted: false,
          reason: "cooldown",
          nextRunAt: new Date(this.emergencyXLastRunAt + intervalMinutes * 60 * 1e3).toISOString()
        };
      }
    }
    const xCredentials = this.getEmergencyTwitterCredentials();
    const facebookCredentials = this.getEmergencyFacebookCredentials();
    const instagramCredentials = this.getEmergencyInstagramCredentials();
    if (!xCredentials && !facebookCredentials && !instagramCredentials) {
      return { attempted: true, posted: false, reason: "missing_emergency_credentials" };
    }
    try {
      const maxAgeHours = Math.min(Math.max(Number(process.env.BWIN_X_EMERGENCY_MAX_AGE_HOURS ?? 24), 6), 72);
      const candidates = await getFootballTrendingCandidates({
        maxCandidates: 10,
        maxAgeHours
      });
      const newsCandidates = this.filterBwinNewsCandidates(candidates);
      if (!newsCandidates.length) {
        return { attempted: true, posted: false, reason: "no_trends" };
      }
      let selectedTitle = "";
      let selectedLink = "";
      let selectedImage = "";
      let selectedKey = "";
      let selectedScheduledPostId = "";
      const emergencyOwnerId = (process.env.BWIN_TRACK_OWNER_ID ?? process.env.BWIN_SCOPE_ID ?? "").trim();
      const persistentRecentKeys = /* @__PURE__ */ new Set();
      if (emergencyOwnerId) {
        try {
          for (const postId of await supabaseFallbackService.getRecentScheduledPostIds(emergencyOwnerId, 400)) {
            persistentRecentKeys.add(postId);
          }
          const recentPosts = await supabaseFallbackService.getPostsByUser(emergencyOwnerId, 400);
          for (const post of recentPosts) {
            const caption = String(post.caption || "");
            const headline = caption.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "";
            const normalizedHeadline = this.normalizeNewsText(headline);
            if (normalizedHeadline) {
              persistentRecentKeys.add(`emergency:bwin:${this.buildTrendContentKey("news", normalizedHeadline)}`);
            }
            const urls = Array.from(caption.matchAll(/https?:\/\/\S+/g)).map(
              (match) => match[0].replace(/[),.;]+$/, "")
            );
            for (const url of urls) {
              const normalizedLink = this.normalizeNewsLink(url);
              if (normalizedLink) {
                persistentRecentKeys.add(`emergency:bwin:${this.buildTrendContentKey("news", normalizedLink)}`);
              }
            }
          }
        } catch (error) {
          console.warn("[autopost] emergency recent post lookup failed", error);
        }
      }
      for (const candidate of newsCandidates) {
        const item = (candidate.items ?? []).find((entry) => Boolean(entry.title?.trim())) ?? candidate.items?.[0];
        if (this.isBlockedBwinNewsItem(item)) continue;
        const title = (item?.title?.trim() || candidate.topic || "").trim();
        if (!title) continue;
        const link = item?.link?.trim() || "";
        const key = `${title}|${link}`.toLowerCase();
        const candidateKeys = this.buildNewsCandidateKeys(candidate, item);
        const scheduledPostIds = candidateKeys.map((candidateKey) => `emergency:bwin:${candidateKey}`);
        if (key && key === this.emergencyXLastKey) continue;
        if (scheduledPostIds.some((postId) => persistentRecentKeys.has(postId))) continue;
        const sourceImage = await this.resolveBestNewsImageUrl(item?.imageUrl?.trim(), item?.link?.trim()) ?? "";
        if (!sourceImage) continue;
        selectedTitle = title;
        selectedLink = link;
        selectedKey = key;
        selectedImage = sourceImage;
        selectedScheduledPostId = scheduledPostIds[0] || `emergency:bwin:${this.buildTrendContentKey("news", key)}`;
        break;
      }
      if (!selectedTitle) {
        return { attempted: true, posted: false, reason: "no_fresh_source_image_candidate" };
      }
      const storyText = selectedLink ? await this.fetchArticleStoryText(selectedLink, "") : "";
      const baseCaption = this.buildBwinNewsCaption(selectedTitle, storyText, selectedLink);
      let imageUrls = selectedImage ? [selectedImage] : [];
      if (imageUrls.length) {
        const sourceImages = await this.improveNewsImageQuality(imageUrls, ["facebook", "instagram"]);
        imageUrls = sourceImages.length ? await this.finalizeNewsImages(sourceImages, selectedTitle) : await this.finalizeNewsImages(imageUrls, selectedTitle);
      }
      if (!imageUrls.length) {
        return { attempted: true, posted: false, reason: "source_image_finalization_failed", selectedTitle };
      }
      const cooldownPostId = `emergency:bwin:cooldown:${Math.floor(
        now.getTime() / (intervalMinutes * 60 * 1e3)
      )}`;
      if (emergencyOwnerId && selectedScheduledPostId) {
        try {
          const latestRecentKeys = new Set(
            await supabaseFallbackService.getRecentScheduledPostIds(emergencyOwnerId, 800)
          );
          if (latestRecentKeys.has(selectedScheduledPostId) || latestRecentKeys.has(cooldownPostId)) {
            return {
              attempted: true,
              posted: false,
              reason: "already_claimed_or_in_cooldown",
              selectedTitle
            };
          }
          await Promise.all([
            supabaseFallbackService.addSocialLog({
              userId: emergencyOwnerId,
              platform: "bwin_emergency_lock",
              scheduledPostId: selectedScheduledPostId,
              status: "claimed",
              extraPayload: {
                selectedTitle,
                selectedLink,
                imageUrls
              }
            }),
            supabaseFallbackService.addSocialLog({
              userId: emergencyOwnerId,
              platform: "bwin_emergency_lock",
              scheduledPostId: cooldownPostId,
              status: "claimed",
              extraPayload: {
                selectedTitle,
                selectedLink,
                imageUrls
              }
            })
          ]);
        } catch (error) {
          console.warn("[autopost] emergency claim lookup failed", error);
          if (selectedKey && selectedKey === this.emergencyXLastKey) {
            return {
              attempted: true,
              posted: false,
              reason: "already_claimed_in_memory",
              selectedTitle
            };
          }
        }
      }
      const results = [];
      if (xCredentials) {
        try {
          const xCaption = this.normalizeXCaption(this.applyBwinBetTracking(baseCaption, emergencyOwnerId, "x"));
          const response = await publishToTwitter({
            caption: xCaption,
            imageUrls,
            credentials: xCredentials
          });
          results.push({ platform: "x", status: "posted", remoteId: response.remoteId ?? null });
        } catch (error) {
          results.push({ platform: "x", status: "failed", error: error?.message ?? "x_emergency_post_failed" });
        }
      }
      if (facebookCredentials) {
        try {
          if (!imageUrls.length) {
            throw new Error("missing_facebook_image");
          }
          const facebookCaption = this.applyBwinBetTracking(baseCaption, emergencyOwnerId, "facebook");
          const response = await publishToFacebook({
            caption: facebookCaption,
            imageUrls: imageUrls.slice(0, 1),
            credentials: facebookCredentials
          });
          results.push({ platform: "facebook", status: "posted", remoteId: response.remoteId ?? null });
        } catch (error) {
          results.push({
            platform: "facebook",
            status: "failed",
            error: error?.message ?? "facebook_emergency_post_failed"
          });
        }
      }
      if (instagramCredentials) {
        try {
          if (!imageUrls.length) {
            throw new Error("missing_instagram_image");
          }
          const instagramCaption = this.sanitizeBwinInstagramCaptionLinks(
            this.applyBwinInstagramSportsHashtags(baseCaption, "instagram"),
            "instagram"
          );
          const response = await publishToInstagram({
            caption: instagramCaption,
            imageUrls,
            credentials: instagramCredentials
          });
          results.push({ platform: "instagram", status: "posted", remoteId: response.remoteId ?? null });
        } catch (error) {
          results.push({
            platform: "instagram",
            status: "failed",
            error: error?.message ?? "instagram_emergency_post_failed"
          });
        }
      }
      const posted = results.some((result) => result.status === "posted");
      if (posted) {
        this.emergencyXLastRunAt = now.getTime();
        if (selectedKey) this.emergencyXLastKey = selectedKey;
        if (emergencyOwnerId && selectedScheduledPostId) {
          await Promise.all(
            results.filter((result) => result.status === "posted").map(
              (result) => supabaseFallbackService.addSocialLog({
                userId: emergencyOwnerId,
                platform: result.platform,
                scheduledPostId: selectedScheduledPostId,
                status: result.status,
                responseId: result.remoteId ?? void 0,
                extraPayload: {
                  selectedTitle,
                  selectedLink,
                  imageUrls
                }
              })
            )
          ).catch((error) => console.warn("[autopost] emergency recent-key log failed", error));
        }
      }
      if (emergencyOwnerId && results.length) {
        const historyEntries = results.map((result) => ({
          platform: result.platform,
          status: result.status,
          caption: baseCaption,
          remoteId: result.remoteId ?? null,
          ...result.error ? { errorMessage: result.error } : {}
        }));
        await this.recordHistory(emergencyOwnerId, historyEntries, imageUrls);
      }
      return {
        attempted: true,
        posted,
        results,
        selectedTitle
      };
    } catch (error) {
      return {
        attempted: true,
        posted: false,
        reason: error?.message ?? "emergency_post_failed"
      };
    }
  }
  async start(payload) {
    const basePlatforms = payload.platforms?.length ? payload.platforms : ["instagram", "instagram_story", "facebook", "facebook_story", "linkedin"];
    const withStories = new Set(basePlatforms);
    if (withStories.has("instagram") && !withStories.has("instagram_story")) {
      withStories.add("instagram_story");
    }
    if (withStories.has("facebook") && !withStories.has("facebook_story")) {
      withStories.add("facebook_story");
    }
    const platforms = Array.from(withStories).filter((platform) => platform !== "instagram_reels");
    const now = /* @__PURE__ */ new Date();
    const reelsEnabled = Boolean(
      payload.instagramReelsVideoUrl || payload.instagramReelsVideoUrls && payload.instagramReelsVideoUrls.length || payload.platforms?.includes("instagram_reels")
    );
    const reelsVideoUrl = reelsEnabled ? payload.instagramReelsVideoUrl ?? payload.videoUrl : void 0;
    const reelsVideoUrls = reelsEnabled ? payload.instagramReelsVideoUrls?.length ? payload.instagramReelsVideoUrls : payload.videoUrls : void 0;
    const reelsIntervalHours = payload.reelsIntervalHours && payload.reelsIntervalHours > 0 ? payload.reelsIntervalHours : this.defaultReelsIntervalHours;
    const initialJob = {
      userId: payload.userId,
      platforms,
      prompt: payload.prompt ?? void 0,
      businessType: payload.businessType ?? void 0,
      videoUrl: payload.videoUrl ?? void 0,
      videoUrls: payload.videoUrls ?? void 0,
      videoCursor: payload.videoUrls && payload.videoUrls.length ? 0 : void 0,
      videoTitle: payload.videoTitle ?? void 0,
      youtubePrivacyStatus: payload.youtubePrivacyStatus ?? void 0,
      youtubeVideoUrl: payload.youtubeVideoUrl ?? void 0,
      youtubeVideoUrls: payload.youtubeVideoUrls ?? void 0,
      youtubeVideoCursor: payload.youtubeVideoUrls && payload.youtubeVideoUrls.length ? 0 : void 0,
      youtubeShorts: typeof payload.youtubeShorts === "boolean" ? payload.youtubeShorts : void 0,
      tiktokVideoUrl: payload.tiktokVideoUrl ?? void 0,
      tiktokVideoUrls: payload.tiktokVideoUrls ?? void 0,
      tiktokVideoCursor: payload.tiktokVideoUrls && payload.tiktokVideoUrls.length ? 0 : void 0,
      reelsVideoUrl: reelsVideoUrl ?? void 0,
      reelsVideoUrls: reelsVideoUrls ?? void 0,
      reelsVideoCursor: reelsVideoUrls && reelsVideoUrls.length ? 0 : void 0,
      intervalHours: this.defaultIntervalHours,
      nextRun: admin.firestore.Timestamp.fromDate(now),
      reelsIntervalHours: reelsEnabled ? reelsIntervalHours : void 0,
      reelsNextRun: reelsEnabled ? admin.firestore.Timestamp.fromDate(now) : void 0,
      active: true
    };
    try {
      await autopostCollection.doc(payload.userId).set(
        {
          ...initialJob,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );
    } catch (error) {
      console.warn("[autopost] firestore start config write failed; using fallback mirror", error);
    }
    await this.mirrorAutopostJob(payload.userId, initialJob);
    return this.runForUser(payload.userId, {
      ...payload.generatedContent ? { generatedContent: payload.generatedContent } : {}
    });
  }
  async runDueJobs() {
    const now = admin.firestore.Timestamp.now();
    if (this.useMemory) {
      const dueStandard = Array.from(this.memoryStore.entries()).filter(
        ([, job]) => job.active !== false && job.nextRun && job.nextRun.toMillis() <= now.toMillis()
      );
      const dueReels = Array.from(this.memoryStore.entries()).filter(
        ([, job]) => job.active !== false && job.reelsNextRun && job.reelsNextRun.toMillis() <= now.toMillis()
      );
      const dueStories = Array.from(this.memoryStore.entries()).filter(
        ([, job]) => job.active !== false && job.storyNextRun && job.storyNextRun.toMillis() <= now.toMillis()
      );
      const dueTrends = Array.from(this.memoryStore.entries()).filter(
        ([, job]) => job.active !== false && job.trendEnabled === true && job.trendNextRun && job.trendNextRun.toMillis() <= now.toMillis()
      );
      let processed = 0;
      const results = /* @__PURE__ */ new Map();
      for (const [userId, job] of dueStandard) {
        if (!await this.claimDueRun(userId, job, "next_run", now)) continue;
        const outcome = await this.executeJob(userId, job);
        processed += 1;
        results.set(userId, {
          userId,
          posted: outcome.posted ?? 0,
          failed: outcome.failed?.length ?? 0,
          nextRun: typeof outcome.nextRun === "string" ? outcome.nextRun : null
        });
      }
      for (const [userId, job] of dueReels) {
        if (!await this.claimDueRun(userId, job, "reels_next_run", now)) continue;
        const outcome = await this.executeJob(userId, job, {
          platforms: ["instagram_reels"],
          intervalHours: this.getReelsIntervalHours(userId, job.reelsIntervalHours),
          nextRunField: "reelsNextRun",
          lastRunField: "reelsLastRunAt",
          resultField: "reelsLastResult",
          useGenericVideoFallback: false
        });
        processed += 1;
        const existing = results.get(userId) ?? { userId, posted: 0, failed: 0, nextRun: null };
        results.set(userId, {
          ...existing,
          reelsPosted: outcome.posted ?? 0,
          reelsFailed: outcome.failed?.length ?? 0,
          reelsNextRun: typeof outcome.nextRun === "string" ? outcome.nextRun : null
        });
      }
      for (const [userId, job] of dueStories) {
        if (!await this.claimDueRun(userId, job, "story_next_run", now)) continue;
        const outcome = job.storyTrendEnabled === true ? await this.executeTrendStories(userId, job) : await this.executeJob(userId, job, {
          platforms: this.getStoryPlatforms(job),
          intervalHours: this.getStoryIntervalHours(userId, job.storyIntervalHours),
          nextRunField: "storyNextRun",
          lastRunField: "storyLastRunAt",
          resultField: "storyLastResult"
        });
        processed += 1;
        const existing = results.get(userId) ?? { userId, posted: 0, failed: 0, nextRun: null };
        results.set(userId, {
          ...existing,
          storyPosted: outcome.posted ?? 0,
          storyFailed: outcome.failed?.length ?? 0,
          storyNextRun: typeof outcome.nextRun === "string" ? outcome.nextRun : null
        });
      }
      for (const [userId, job] of dueTrends) {
        const feedAlreadyProcessed = Boolean(results.get(userId)?.nextRun);
        if (this.isBwinScopeUser(userId) && feedAlreadyProcessed) {
          continue;
        }
        if (!await this.claimDueRun(userId, job, "trend_next_run", now)) continue;
        const outcome = await this.executeTrendPosts(userId, job);
        processed += 1;
        const existing = results.get(userId) ?? { userId, posted: 0, failed: 0, nextRun: null };
        results.set(userId, {
          ...existing,
          trendPosted: outcome.posted ?? 0,
          trendFailed: outcome.failed?.length ?? 0,
          trendNextRun: typeof outcome.nextRun === "string" ? outcome.nextRun : null
        });
      }
      return { processed, results: Array.from(results.values()) };
    }
    try {
      const firestoreTimeoutMs = Math.max(Number(process.env.AUTOPOST_FIRESTORE_TIMEOUT_MS ?? 15e3), 3e3);
      const [standardSnap, reelsSnap, storiesSnap, trendSnap, missingReelsSnap, missingStoriesSnap] = await this.withTimeout(
        Promise.all([
          autopostCollection.where("nextRun", "<=", now).get(),
          autopostCollection.where("reelsNextRun", "<=", now).get(),
          autopostCollection.where("storyNextRun", "<=", now).get(),
          autopostCollection.where("trendNextRun", "<=", now).get(),
          autopostCollection.where("reelsNextRun", "==", null).get(),
          autopostCollection.where("storyNextRun", "==", null).get()
        ]),
        firestoreTimeoutMs,
        "firestore_due_jobs_query"
      );
      if (!missingReelsSnap.empty) {
        const selfHealWrites = missingReelsSnap.docs.map((doc) => {
          const data = doc.data();
          if (data.active === false) return null;
          const hasReelsConfig = Boolean(
            data.reelsVideoUrl || data.reelsVideoUrls && data.reelsVideoUrls.length || data.reelsIntervalHours || data.reelsLastRunAt || data.reelsLastResult
          );
          if (!hasReelsConfig) return null;
          const reelsIntervalHours = this.getReelsIntervalHours(doc.id, data.reelsIntervalHours);
          return autopostCollection.doc(doc.id).set(
            {
              reelsIntervalHours,
              reelsNextRun: now,
              updatedAt: admin.firestore.FieldValue.serverTimestamp()
            },
            { merge: true }
          );
        }).filter(Boolean);
        if (selfHealWrites.length) {
          await Promise.all(selfHealWrites);
        }
      }
      if (!missingStoriesSnap.empty) {
        const selfHealWrites = missingStoriesSnap.docs.map((doc) => {
          const data = doc.data();
          if (data.active === false || data.storyTrendEnabled !== true) return null;
          const intervalHours = this.getStoryIntervalHours(doc.id, data.storyIntervalHours);
          return autopostCollection.doc(doc.id).set(
            {
              storyIntervalHours: intervalHours,
              storyNextRun: now,
              updatedAt: admin.firestore.FieldValue.serverTimestamp()
            },
            { merge: true }
          );
        }).filter(Boolean);
        if (selfHealWrites.length) {
          await Promise.all(selfHealWrites);
        }
      }
      if (standardSnap.empty && reelsSnap.empty && storiesSnap.empty && trendSnap.empty) {
        return this.runDueJobsFromFallback(now);
      }
      let processed = 0;
      const results = /* @__PURE__ */ new Map();
      for (const doc of standardSnap.docs) {
        const data = doc.data();
        if (data.active === false) continue;
        this.cacheJob(doc.id, { ...data, userId: data.userId ?? doc.id });
        if (!await this.claimDueRun(doc.id, data, "next_run", now)) continue;
        const outcome = await this.executeJob(doc.id, data);
        processed += 1;
        results.set(doc.id, {
          userId: doc.id,
          posted: outcome.posted ?? 0,
          failed: outcome.failed?.length ?? 0,
          nextRun: typeof outcome.nextRun === "string" ? outcome.nextRun : null
        });
      }
      for (const doc of reelsSnap.docs) {
        const data = doc.data();
        if (data.active === false) continue;
        this.cacheJob(doc.id, { ...data, userId: data.userId ?? doc.id });
        if (!await this.claimDueRun(doc.id, data, "reels_next_run", now)) continue;
        const outcome = await this.executeJob(doc.id, data, {
          platforms: ["instagram_reels"],
          intervalHours: this.getReelsIntervalHours(doc.id, data.reelsIntervalHours),
          nextRunField: "reelsNextRun",
          lastRunField: "reelsLastRunAt",
          resultField: "reelsLastResult",
          useGenericVideoFallback: false
        });
        processed += 1;
        const existing = results.get(doc.id) ?? { userId: doc.id, posted: 0, failed: 0, nextRun: null };
        results.set(doc.id, {
          ...existing,
          reelsPosted: outcome.posted ?? 0,
          reelsFailed: outcome.failed?.length ?? 0,
          reelsNextRun: typeof outcome.nextRun === "string" ? outcome.nextRun : null
        });
      }
      for (const doc of storiesSnap.docs) {
        const data = doc.data();
        if (data.active === false) continue;
        this.cacheJob(doc.id, { ...data, userId: data.userId ?? doc.id });
        if (!await this.claimDueRun(doc.id, data, "story_next_run", now)) continue;
        const outcome = data.storyTrendEnabled === true ? await this.executeTrendStories(doc.id, data) : await this.executeJob(doc.id, data, {
          platforms: this.getStoryPlatforms(data),
          intervalHours: this.getStoryIntervalHours(doc.id, data.storyIntervalHours),
          nextRunField: "storyNextRun",
          lastRunField: "storyLastRunAt",
          resultField: "storyLastResult"
        });
        processed += 1;
        const existing = results.get(doc.id) ?? { userId: doc.id, posted: 0, failed: 0, nextRun: null };
        results.set(doc.id, {
          ...existing,
          storyPosted: outcome.posted ?? 0,
          storyFailed: outcome.failed?.length ?? 0,
          storyNextRun: typeof outcome.nextRun === "string" ? outcome.nextRun : null
        });
      }
      for (const doc of trendSnap.docs) {
        const data = doc.data();
        if (data.active === false || data.trendEnabled !== true) continue;
        this.cacheJob(doc.id, { ...data, userId: data.userId ?? doc.id });
        const feedAlreadyProcessed = Boolean(results.get(doc.id)?.nextRun);
        if (this.isBwinScopeUser(doc.id) && feedAlreadyProcessed) {
          continue;
        }
        if (!await this.claimDueRun(doc.id, data, "trend_next_run", now)) continue;
        const outcome = await this.executeTrendPosts(doc.id, data);
        processed += 1;
        const existing = results.get(doc.id) ?? { userId: doc.id, posted: 0, failed: 0, nextRun: null };
        results.set(doc.id, {
          ...existing,
          trendPosted: outcome.posted ?? 0,
          trendFailed: outcome.failed?.length ?? 0,
          trendNextRun: typeof outcome.nextRun === "string" ? outcome.nextRun : null
        });
      }
      const fallbackResult = await this.runDueJobsFromFallback(now, new Set(results.keys()));
      if ((fallbackResult.processed ?? 0) > 0) {
        for (const fallbackRow of fallbackResult.results ?? []) {
          const existing = results.get(fallbackRow.userId) ?? {
            userId: fallbackRow.userId,
            posted: 0,
            failed: 0,
            nextRun: null
          };
          results.set(fallbackRow.userId, { ...existing, ...fallbackRow });
        }
        processed += fallbackResult.processed ?? 0;
      }
      return { processed, results: Array.from(results.values()) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (this.isFirestoreQuotaError(error) || /firestore_.*_timeout/i.test(message)) {
        const fallbackResult = await this.runDueJobsFromFallback(now);
        if ((fallbackResult.processed ?? 0) > 0) {
          return fallbackResult;
        }
        console.warn("[autopost] Firestore unavailable; running emergency Bwin social posting path.", message);
        const emergency = await this.runBwinEmergencyPost(/* @__PURE__ */ new Date());
        return {
          processed: emergency.posted ? Array.isArray(emergency.results) ? emergency.results?.length ?? 1 : 1 : 0,
          emergency
        };
      }
      throw error;
    }
  }
  getClaimedRunValue(job, field) {
    switch (field) {
      case "reels_next_run":
        return job.reelsNextRun;
      case "story_next_run":
        return job.storyNextRun;
      case "trend_next_run":
        return job.trendNextRun;
      case "next_run":
      default:
        return job.nextRun;
    }
  }
  getClaimNextRunDate(userId, job, field, now) {
    const hours = field === "reels_next_run" ? this.getReelsIntervalHours(userId, job.reelsIntervalHours) : field === "story_next_run" ? this.getStoryIntervalHours(userId, job.storyIntervalHours) : field === "trend_next_run" ? job.trendIntervalHours ?? 4 : this.getFeedIntervalHours(userId, job.intervalHours);
    return new Date(now.getTime() + Math.max(hours, 0.05) * 60 * 60 * 1e3);
  }
  isNicheClientAccount(userId) {
    return Object.prototype.hasOwnProperty.call(CLIENT_META_FALLBACKS, userId);
  }
  hasCredentialsForPlatform(platform, credentials) {
    if (platform === "facebook" || platform === "facebook_story") return Boolean(credentials.facebook);
    if (platform === "instagram" || platform === "instagram_story" || platform === "instagram_reels") {
      return Boolean(credentials.instagram);
    }
    if (platform === "threads") return Boolean(credentials.threads);
    if (platform === "linkedin") return Boolean(credentials.linkedin);
    if (platform === "twitter" || platform === "x") return Boolean(credentials.twitter);
    if (platform === "tiktok") return Boolean(credentials.tiktok);
    if (platform === "youtube") return Boolean(credentials.youtube);
    return true;
  }
  getReelsIntervalHours(userId, configured) {
    if (this.isNicheClientAccount(userId)) {
      return configured && configured > 0 ? configured : NICHE_CLIENT_INSTAGRAM_REELS_INTERVAL_HOURS;
    }
    return configured && configured > 0 ? configured : this.defaultReelsIntervalHours;
  }
  getFeedIntervalHours(userId, configured) {
    if (this.isNicheClientAccount(userId)) {
      return NICHE_CLIENT_SOCIAL_FEED_INTERVAL_HOURS;
    }
    return configured && configured > 0 ? configured : this.defaultIntervalHours;
  }
  getStoryIntervalHours(userId, configured) {
    if (this.isNicheClientAccount(userId)) {
      return NICHE_CLIENT_SOCIAL_FEED_INTERVAL_HOURS;
    }
    return configured && configured > 0 ? configured : this.defaultStoryIntervalHours;
  }
  getInstagramAttemptField(platform) {
    if (platform === "instagram") return "instagramFeedLastAttemptAt";
    if (platform === "instagram_story") return "instagramStoryLastAttemptAt";
    return null;
  }
  timestampToMillis(value) {
    if (!value) return null;
    if (typeof value.toMillis === "function") return value.toMillis();
    const maybeDate = value;
    if (typeof maybeDate.getTime === "function") return maybeDate.getTime();
    return null;
  }
  shouldSkipNicheInstagramAttempt(userId, job, platform, now = Date.now()) {
    if (!this.isNicheClientAccount(userId)) return false;
    const attemptField = this.getInstagramAttemptField(platform);
    if (!attemptField) return false;
    const lastAttempt = this.timestampToMillis(job[attemptField]);
    if (!lastAttempt) return false;
    return now - lastAttempt < NICHE_CLIENT_SOCIAL_FEED_INTERVAL_HOURS * 60 * 60 * 1e3;
  }
  async claimDueRun(userId, job, field, now) {
    if (!supabaseFallbackService.isConfigured()) return true;
    const expectedRun = this.getClaimedRunValue(job, field);
    if (!expectedRun) return false;
    const nextRun = this.getClaimNextRunDate(userId, job, field, now.toDate());
    try {
      const claimed = await supabaseFallbackService.claimAutopostRun(userId, field, expectedRun, nextRun);
      if (!claimed) {
        const fallbackJob = await supabaseFallbackService.getAutopostJob(userId).catch(() => null);
        if (!fallbackJob) {
          await supabaseFallbackService.upsertAutopostJob(userId, job);
          const retriedClaim = await supabaseFallbackService.claimAutopostRun(userId, field, expectedRun, nextRun);
          if (retriedClaim) {
            return true;
          }
        }
        console.warn("[autopost] supabase due-run claim was stale; skipping Firestore due job", {
          userId,
          field
        });
        return false;
      }
      return true;
    } catch (error) {
      console.warn("[autopost] failed to claim due run in supabase fallback", {
        userId,
        field,
        error: error instanceof Error ? error.message : String(error)
      });
      return true;
    }
  }
  async runForUser(userId, options = {}) {
    if (this.useMemory && this.memoryStore.has(userId)) {
      const job2 = this.memoryStore.get(userId);
      const standard2 = await this.executeJob(userId, job2, options);
      if (job2.reelsNextRun || job2.reelsVideoUrl || job2.reelsVideoUrls && job2.reelsVideoUrls.length) {
        const reels = await this.executeJob(userId, job2, {
          ...options.generatedContent ? { generatedContent: options.generatedContent } : {},
          platforms: ["instagram_reels"],
          intervalHours: this.getReelsIntervalHours(userId, job2.reelsIntervalHours),
          nextRunField: "reelsNextRun",
          lastRunField: "reelsLastRunAt",
          resultField: "reelsLastResult",
          useGenericVideoFallback: false
        });
        return {
          ...standard2,
          reelsPosted: reels.posted,
          reelsFailed: reels.failed,
          reelsNextRun: reels.nextRun
        };
      }
      if (job2.storyNextRun) {
        const stories = job2.storyTrendEnabled === true ? await this.executeTrendStories(userId, job2) : await this.executeJob(userId, job2, {
          platforms: this.getStoryPlatforms(job2),
          intervalHours: this.getStoryIntervalHours(userId, job2.storyIntervalHours),
          nextRunField: "storyNextRun",
          lastRunField: "storyLastRunAt",
          resultField: "storyLastResult"
        });
        return {
          ...standard2,
          storyPosted: stories.posted,
          storyFailed: stories.failed,
          storyNextRun: stories.nextRun
        };
      }
      return standard2;
    }
    const job = await this.loadAutopostJob(userId);
    if (!job) {
      return { posted: 0, failed: [{ platform: "all", error: "autopost_not_configured", status: "failed" }], nextRun: null };
    }
    const standard = await this.executeJob(userId, job, options);
    if (job.reelsNextRun || job.reelsVideoUrl || job.reelsVideoUrls && job.reelsVideoUrls.length) {
      const reels = await this.executeJob(userId, job, {
        ...options.generatedContent ? { generatedContent: options.generatedContent } : {},
        platforms: ["instagram_reels"],
        intervalHours: this.getReelsIntervalHours(userId, job.reelsIntervalHours),
        nextRunField: "reelsNextRun",
        lastRunField: "reelsLastRunAt",
        resultField: "reelsLastResult",
        useGenericVideoFallback: false
      });
      return {
        ...standard,
        reelsPosted: reels.posted,
        reelsFailed: reels.failed,
        reelsNextRun: reels.nextRun
      };
    }
    if (job.storyNextRun) {
      const stories = job.storyTrendEnabled === true ? await this.executeTrendStories(userId, job) : await this.executeJob(userId, job, {
        platforms: this.getStoryPlatforms(job),
        intervalHours: this.getStoryIntervalHours(userId, job.storyIntervalHours),
        nextRunField: "storyNextRun",
        lastRunField: "storyLastRunAt",
        resultField: "storyLastResult"
      });
      return {
        ...standard,
        storyPosted: stories.posted,
        storyFailed: stories.failed,
        storyNextRun: stories.nextRun
      };
    }
    return standard;
  }
  getStoryPlatforms(job) {
    if (Array.isArray(job.storyPlatforms) && job.storyPlatforms.length) {
      return job.storyPlatforms;
    }
    const fromJob = (job.platforms ?? []).filter((platform) => platform.endsWith("_story"));
    if (fromJob.length) return fromJob;
    return ["instagram_story", "facebook_story"];
  }
  getTrendPlatforms(job) {
    if (Array.isArray(job.trendPlatforms) && job.trendPlatforms.length) {
      return job.trendPlatforms;
    }
    return ["facebook"];
  }
  getRecentStoryImageHistory(job) {
    if (!Array.isArray(job.storyRecentImageUrls)) return [];
    return job.storyRecentImageUrls.filter(Boolean);
  }
  summarizeStory(text, maxChars = 180) {
    const cleaned = text.replace(/\s+/g, " ").trim();
    if (!cleaned) return "";
    if (cleaned.length <= maxChars) return cleaned;
    const sentences = cleaned.split(/(?<=[.!?])\s+/).filter(Boolean);
    let summary = "";
    for (const sentence of sentences) {
      const candidate = summary ? `${summary} ${sentence}` : sentence;
      if (candidate.length > maxChars) break;
      summary = candidate;
      if (summary.length >= maxChars * 0.75) break;
    }
    if (!summary) {
      const truncated = cleaned.slice(0, maxChars);
      const lastSpace = truncated.lastIndexOf(" ");
      summary = lastSpace > 60 ? truncated.slice(0, lastSpace) : truncated;
    }
    const trimmed = summary.trim();
    if (!/[.!?]$/.test(trimmed)) return `${trimmed}.`;
    return trimmed;
  }
  normalizeXCaption(caption, maxChars = 270) {
    const cleaned = String(caption || "").replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    if (cleaned.length <= maxChars) return cleaned;
    const lines = cleaned.split("\n").map((line) => line.trim()).filter(Boolean);
    const cta = lines.find((line) => /bwinbetug\.info/i.test(line));
    let compactLines = lines.slice(0, 5);
    if (cta && !compactLines.includes(cta)) {
      compactLines.push(cta);
    }
    let compact = compactLines.join("\n");
    if (compact.length <= maxChars) return compact;
    const truncated = compact.slice(0, maxChars - 3).trimEnd();
    const lastBreak = Math.max(truncated.lastIndexOf("\n"), truncated.lastIndexOf(" "));
    const base = lastBreak > 80 ? truncated.slice(0, lastBreak) : truncated;
    return `${base.trimEnd()}...`;
  }
  normalizeBwinTrackingSource(platform) {
    const value = (platform ?? "").trim().toLowerCase();
    if (!value) return "social";
    if (value === "x" || value === "twitter") return "x";
    if (value.startsWith("instagram")) return "instagram";
    if (value.startsWith("facebook")) return "facebook";
    if (value === "threads") return "threads";
    if (value === "linkedin") return "linkedin";
    if (value === "tiktok") return "tiktok";
    if (value === "youtube") return "youtube";
    return "social";
  }
  normalizeBwinTrackingPlacement(platform) {
    const value = (platform ?? "").trim().toLowerCase();
    if (!value) return "post";
    if (value.includes("story")) return "story";
    if (value.includes("reel")) return "reel";
    if (value.includes("comment")) return "comment";
    if (value.includes("dm") || value.includes("message")) return "dm";
    return "post";
  }
  buildBwinTrackedBetUrl(ownerId, platform) {
    const normalizedOwnerId = ownerId.trim();
    if (!normalizedOwnerId) return "https://bwinbetug.com";
    const baseUrl = this.getPublicBaseUrl();
    if (!baseUrl) return "https://bwinbetug.com";
    const params = new URLSearchParams({
      ownerId: normalizedOwnerId,
      source: this.normalizeBwinTrackingSource(platform),
      placement: this.normalizeBwinTrackingPlacement(platform)
    });
    return `${baseUrl}/r/bwin?${params.toString()}`;
  }
  buildBwinTrackedInfoUrl(ownerId, platform) {
    const normalizedOwnerId = ownerId.trim();
    if (!normalizedOwnerId) return "https://www.bwinbetug.info";
    const baseUrl = this.getPublicBaseUrl();
    if (!baseUrl) return "https://www.bwinbetug.info";
    const params = new URLSearchParams({
      ownerId: normalizedOwnerId,
      source: this.normalizeBwinTrackingSource(platform),
      placement: this.normalizeBwinTrackingPlacement(platform)
    });
    return `${baseUrl}/r/bwin-info?${params.toString()}`;
  }
  applyBwinBetTracking(caption, ownerId, platform) {
    if (!caption || !/bwinbetug\.(?:com|info)/i.test(caption)) return caption;
    const useRedirectLinks = (process.env.BWIN_TRACK_REDIRECT_URLS ?? "true").toLowerCase() !== "false";
    if (!useRedirectLinks) return caption;
    const trackedUrl = this.buildBwinTrackedBetUrl(ownerId, platform);
    const trackedInfoUrl = this.buildBwinTrackedInfoUrl(ownerId, platform);
    return caption.replace(/(?:https?:\/\/)?(?:www\.)?bwinbetug\.com\b\/?/gi, trackedUrl).replace(/(?:https?:\/\/)?(?:www\.)?bwinbetug\.info\b\/?/gi, trackedInfoUrl);
  }
  applyBwinInstagramSportsHashtags(caption, platform) {
    const normalizedPlatform = (platform ?? "").trim().toLowerCase();
    if (normalizedPlatform !== "instagram" && normalizedPlatform !== "instagram_reels") {
      return caption;
    }
    if (!caption || !/bwinbetug\.(?:com|info)|bwinbet ug/i.test(caption)) {
      return caption;
    }
    const existing = this.extractHashtagTokens(caption);
    const existingSet = new Set(existing.map((tag) => tag.toLowerCase()));
    const suggested = this.buildBwinInstagramSportsHashtags(caption);
    const missing = suggested.filter((tag) => !existingSet.has(tag.toLowerCase()));
    if (!missing.length) {
      return caption.trim();
    }
    return `${caption.trim()}

${missing.map((tag) => `#${tag}`).join(" ")}`.trim();
  }
  sanitizeBwinInstagramCaptionLinks(caption, platform) {
    const normalizedPlatform = (platform ?? "").trim().toLowerCase();
    if (normalizedPlatform !== "instagram" && normalizedPlatform !== "instagram_reels" && normalizedPlatform !== "instagram_story") {
      return caption;
    }
    if (!caption) return caption;
    const hasBwinReference = /bwinbetug\.(?:com|info)/i.test(caption) || /\/r\/bwin(?:-info)?\b/i.test(caption) || /ownerId=.*source=instagram/i.test(caption);
    if (!hasBwinReference) {
      return caption;
    }
    const sanitizedLines = caption.split("\n").map((line) => line.trim()).filter(Boolean).filter(
      (line) => !/https?:\/\/\S+/i.test(line) && !/(?:www\.)?bwinbetug\.(?:com|info)\b/i.test(line) && !/\bbet now\b|\bmore info\b|\bplace your bet\b/i.test(line)
    );
    sanitizedLines.push("More football updates in bio.");
    return Array.from(new Set(sanitizedLines)).join("\n");
  }
  buildBwinInstagramSportsHashtags(caption) {
    const normalized = String(caption || "").toLowerCase();
    const tags = [
      "Football",
      "SportsUpdates",
      "Matchday",
      "FootballAnalytics",
      "FootballUpdates"
    ];
    if (/\bprediction|\bodds\b|place your bet|bet now|match picks|football tips/i.test(normalized)) {
      tags.push("MatchPredictions", "FootballTips", "MatchPreview");
    } else if (/\blive table\b|\btable update\b|\bstandings\b/i.test(normalized)) {
      tags.push("LeagueTable", "FootballTable", "TitleRace", "TopTeams");
    } else if (/\btop scorers\b|\bgolden boot\b|\bgoals\b|\bscorer\b/i.test(normalized)) {
      tags.push("TopScorers", "GoldenBoot", "GoalMachine", "FootballStats");
    } else if (/\bresult\b|\bfinal score\b|\bscoreline\b|\bft\b/i.test(normalized)) {
      tags.push("MatchResults", "FinalScore", "FootballResults", "FullTime");
    } else if (/\bvideo\b|\bhighlight\b|\bclip\b|\bgoal\b|\bwonder goal\b/i.test(normalized)) {
      tags.push("FootballHighlights", "GoalAlert", "SportsVideo", "GoalOfTheDay");
    } else {
      tags.push("FootballNews", "TrendingFootball", "SportsBuzz", "GameOn");
    }
    if (/\bpremier league\b/i.test(normalized)) tags.push("PremierLeague");
    if (/\bla liga\b/i.test(normalized)) tags.push("LaLiga");
    if (/\bserie a\b/i.test(normalized)) tags.push("SerieA");
    if (/\bbundesliga\b/i.test(normalized)) tags.push("Bundesliga");
    if (/\bligue 1\b/i.test(normalized)) tags.push("Ligue1");
    if (/\bchampions league\b/i.test(normalized)) tags.push("ChampionsLeague");
    if (/\btransfer\b/i.test(normalized)) tags.push("TransferNews");
    const unique = [];
    const seen = /* @__PURE__ */ new Set();
    for (const tag of tags) {
      const normalizedTag = tag.replace(/^#+/, "").trim();
      if (!normalizedTag) continue;
      const key = normalizedTag.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(normalizedTag);
      if (unique.length >= 12) break;
    }
    return unique;
  }
  extractHashtagTokens(caption) {
    return Array.from(new Set((caption.match(/#[A-Za-z0-9_]+/g) ?? []).map((tag) => tag.replace(/^#+/, ""))));
  }
  buildVideoCaptionFromHighlight(rawText, username, timezone) {
    const cleaned = String(rawText || "").replace(/https?:\/\/\S+/gi, "").replace(/\s+/g, " ").trim();
    const headlineSeed = cleaned || `Latest football clip from @${username}`;
    const headline = headlineSeed.length > 140 ? `${headlineSeed.slice(0, 137).trimEnd()}...` : headlineSeed;
    return [
      `Video: ${headline}`,
      `Update time: ${this.formatTrendClock(timezone)} EAT`,
      "More football updates in bio."
    ].filter(Boolean).join("\n");
  }
  buildHighlightlyVideoCaption(item, timezone) {
    const matchup = item.homeTeam && item.awayTeam ? item.score ? `${item.homeTeam} ${item.score} ${item.awayTeam}` : `${item.homeTeam} vs ${item.awayTeam}` : "";
    const sourceLine = item.channel || item.source ? `Verified source: ${item.channel || item.source}` : "";
    const competitionLine = item.leagueName ? `Competition: ${item.leagueName}` : "";
    return [
      "Highlight alert",
      item.title,
      matchup,
      competitionLine,
      sourceLine,
      `Update time: ${this.formatTrendClock(timezone)} EAT`,
      "More football updates in bio."
    ].filter(Boolean).join("\n");
  }
  async pickFreshHighlightlyVideoCandidate(userId, timezone, recentSet) {
    const now = /* @__PURE__ */ new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1e3);
    const highlights = await fetchHighlightlyFootballHighlights({
      dates: [this.getDateKeyForTimezone(now, timezone), this.getDateKeyForTimezone(yesterday, timezone)],
      timezone,
      limit: 5,
      secretOwnerId: userId
    });
    for (const item of highlights) {
      const key = this.buildTrendContentKey("video", `highlightly|${item.id}|${item.url || item.title}`);
      if (!recentSet.has(key)) {
        return { item, key };
      }
    }
    return null;
  }
  getTrendRecentKeys(job) {
    if (!Array.isArray(job.trendRecentKeys)) return [];
    return job.trendRecentKeys.filter(Boolean).map((value) => String(value).toLowerCase().trim()).filter(Boolean);
  }
  mergeTrendRecentKeys(existing, used) {
    const maxHistory = Math.max(Number(process.env.AUTOPOST_TREND_KEY_HISTORY ?? 180), 40);
    const next = [...used, ...existing].map((value) => String(value || "").toLowerCase().trim()).filter(Boolean);
    const seen = /* @__PURE__ */ new Set();
    const unique = next.filter((value) => {
      if (seen.has(value)) return false;
      seen.add(value);
      return true;
    });
    return unique.slice(0, maxHistory);
  }
  getHourForTimezone(date, timezone) {
    try {
      const formatted = new Intl.DateTimeFormat("en-GB", {
        timeZone: timezone,
        hour: "2-digit",
        hour12: false
      }).format(date);
      const parsed = Number.parseInt(formatted, 10);
      if (Number.isFinite(parsed)) return parsed;
    } catch (error) {
      console.warn("[autopost] invalid trend timezone, falling back to UTC", { timezone, error });
    }
    return date.getUTCHours();
  }
  getDateKeyForTimezone(date, timezone) {
    try {
      const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }).formatToParts(date);
      const year2 = parts.find((part) => part.type === "year")?.value;
      const month2 = parts.find((part) => part.type === "month")?.value;
      const day2 = parts.find((part) => part.type === "day")?.value;
      if (year2 && month2 && day2) {
        return `${year2}-${month2}-${day2}`;
      }
    } catch (error) {
      console.warn("[autopost] invalid trend timezone for date key; falling back to UTC", { timezone, error });
    }
    const year = date.getUTCFullYear();
    const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
    const day = `${date.getUTCDate()}`.padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  getDailyLeagueForDate(date, timezone) {
    const dateKey = this.getDateKeyForTimezone(date, timezone);
    const [yearRaw, monthRaw, dayRaw] = dateKey.split("-");
    const year = Number.parseInt(yearRaw, 10);
    const month = Number.parseInt(monthRaw, 10);
    const day = Number.parseInt(dayRaw, 10);
    const daySerial = Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day) ? Math.floor(Date.UTC(year, month - 1, day) / 864e5) : Math.floor(date.getTime() / 864e5);
    const idx = (daySerial % TOP_FIVE_LEAGUES.length + TOP_FIVE_LEAGUES.length) % TOP_FIVE_LEAGUES.length;
    return TOP_FIVE_LEAGUES[idx];
  }
  parseNumeric(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number.parseFloat(value.replace(/[^0-9.-]/g, ""));
      if (Number.isFinite(parsed)) return parsed;
    }
    return 0;
  }
  getStructuredFootballCycle(job) {
    const allowed = /* @__PURE__ */ new Set(["result", "news", "video"]);
    const provided = Array.isArray(job.trendContentCycle) ? job.trendContentCycle.map((value) => String(value || "").trim().toLowerCase()).filter((value) => allowed.has(value)) : [];
    return provided.length ? provided : ["result", "news", "video"];
  }
  getStructuredFootballSlot(job, now) {
    const timezone = job.trendTimezone?.trim() || process.env.AUTOPOST_FOOTBALL_TZ?.trim() || "Africa/Kampala";
    const hour = this.getHourForTimezone(now, timezone);
    const predictionHours = /* @__PURE__ */ new Set();
    const tableHours = /* @__PURE__ */ new Set();
    const topScorerHours = /* @__PURE__ */ new Set();
    if (predictionHours.has(hour)) {
      return { contentType: "prediction", timezone, hour };
    }
    if (tableHours.has(hour)) {
      return { contentType: "table", timezone, hour };
    }
    if (topScorerHours.has(hour)) {
      return { contentType: "top_scorer", timezone, hour };
    }
    const cycle = this.getStructuredFootballCycle(job);
    const cursor = Number.isFinite(job.trendSlotCursor) ? job.trendSlotCursor : hour % cycle.length;
    const idx = (Math.trunc(cursor) % cycle.length + cycle.length) % cycle.length;
    return {
      contentType: cycle[idx],
      timezone,
      hour,
      nextSlotCursor: (idx + 1) % cycle.length
    };
  }
  buildTrendContentKey(type, value) {
    const normalized = String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
    return `${type}:${normalized}`.slice(0, 320);
  }
  normalizeNewsText(value) {
    return String(value || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/https?:\/\/\S+/g, " ").replace(/[_|]+/g, " ").replace(/[^a-z0-9]+/g, " ").replace(/\b(?:live|latest|breaking|update|updates|report|reports|reported|watch)\b/g, " ").replace(/\s+/g, " ").trim();
  }
  normalizeNewsLink(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    try {
      const parsed = new URL(raw);
      parsed.hash = "";
      ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid"].forEach(
        (param) => parsed.searchParams.delete(param)
      );
      const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
      const pathname = parsed.pathname.replace(/\/+$/, "").toLowerCase();
      const search = parsed.search ? parsed.search.toLowerCase() : "";
      return `${host}${pathname}${search}`;
    } catch {
      return raw.toLowerCase().replace(/\s+/g, " ").trim();
    }
  }
  buildNewsCandidateKeys(candidate, item = candidate.items?.[0]) {
    const topic = this.normalizeNewsText(candidate.topic || "");
    const headline = this.normalizeNewsText(item?.title || candidate.sampleTitles?.[0] || candidate.topic || "");
    const source = this.normalizeNewsText(item?.sourceLabel || candidate.sources?.[0] || "");
    const link = this.normalizeNewsLink(item?.link || "");
    const rawKeys = [
      headline ? this.buildTrendContentKey("news", headline) : "",
      topic && headline ? this.buildTrendContentKey("news", `${topic}|${headline}`) : "",
      headline && source ? this.buildTrendContentKey("news", `${headline}|${source}`) : "",
      link ? this.buildTrendContentKey("news", link) : "",
      headline && link ? this.buildTrendContentKey("news", `${headline}|${link}`) : ""
    ];
    return rawKeys.filter((value, index, arr) => Boolean(value) && arr.indexOf(value) === index);
  }
  isBlockedBwinNewsItem(item) {
    const link = String(item?.link || "").toLowerCase();
    const title = this.normalizeNewsText(item?.title || "");
    if (!link || !title) return true;
    if (link.includes("bbc.co.uk/sounds") || link.includes("bbc.com/sounds") || link.includes("/iplayer") || link.includes("/live/") || link.includes("/audio/") || link.includes("/podcast")) {
      return true;
    }
    if (/\b(?:podcast|listen|watch|live stream|radio|football daily|sportscene)\b/i.test(title)) {
      return true;
    }
    return false;
  }
  filterBwinNewsCandidates(candidates) {
    return candidates.map((candidate) => {
      const items = (candidate.items ?? []).filter((item) => !this.isBlockedBwinNewsItem(item));
      return items.length ? { ...candidate, items, topic: items[0]?.title || candidate.topic } : null;
    }).filter(Boolean);
  }
  hasRecentTrendKeys(keys, recentSet) {
    return keys.some((key) => recentSet.has(key));
  }
  buildNewsCandidateKey(candidate, item = candidate.items?.[0]) {
    return this.buildNewsCandidateKeys(candidate, item)[0] ?? "";
  }
  pickFreshNewsCandidate(candidates, recentSet) {
    for (const candidate of candidates) {
      const item = candidate.items?.[0];
      if (this.isBlockedBwinNewsItem(item)) continue;
      const keys = this.buildNewsCandidateKeys(candidate, item);
      if (keys.length && !this.hasRecentTrendKeys(keys, recentSet)) {
        return { candidate, item, key: keys[0], keys };
      }
    }
    return null;
  }
  pickFreshVideoCandidate(candidates, recentSet) {
    for (const candidate of candidates) {
      for (const item of candidate.items ?? []) {
        const videoUrl = item.videoUrl?.trim();
        if (!videoUrl) continue;
        const key = this.buildTrendContentKey("video", `${item.link || videoUrl}|${item.title || ""}`);
        if (!recentSet.has(key)) {
          return { candidate, item, key };
        }
      }
    }
    return null;
  }
  toHighResolutionImageUrl(rawUrl) {
    const value = String(rawUrl || "").trim();
    if (!value) return "";
    try {
      const parsed = new URL(value);
      const host = parsed.hostname.toLowerCase();
      if (host.includes("images.unsplash.com")) {
        parsed.searchParams.set("auto", "format");
        parsed.searchParams.set("fit", "crop");
        parsed.searchParams.set("w", "1800");
        parsed.searchParams.set("q", "90");
        return parsed.toString();
      }
      if (host.includes("i.guim.co.uk")) {
        parsed.searchParams.set("width", "2000");
        parsed.searchParams.set("quality", "90");
        parsed.searchParams.set("auto", "format");
        parsed.searchParams.set("fit", "max");
        return parsed.toString();
      }
      if (host.includes("bbci.co.uk") || host.includes("bbc.co.uk") || host.includes("bbc.com")) {
        parsed.pathname = parsed.pathname.replace(/\/ace\/standard\/\d+\//i, "/ace/standard/1600/");
        parsed.pathname = parsed.pathname.replace(/\/images\/ic\/\d+x\d+\//i, "/images/ic/1920x1080/");
        parsed.searchParams.set("w", "1600");
        parsed.searchParams.set("h", "900");
        parsed.searchParams.set("quality", "95");
        return parsed.toString();
      }
      if (host.includes("espncdn.com") || host.includes("espn.com")) {
        parsed.searchParams.set("w", "1600");
        parsed.searchParams.set("h", "900");
        parsed.searchParams.set("q", "90");
        return parsed.toString();
      }
      return parsed.toString();
    } catch {
      return value;
    }
  }
  isLikelyLowResolutionUrl(rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      const width = Number.parseInt(parsed.searchParams.get("width") ?? parsed.searchParams.get("w") ?? "", 10);
      const height = Number.parseInt(parsed.searchParams.get("height") ?? parsed.searchParams.get("h") ?? "", 10);
      if (Number.isFinite(width) && width > 0 && width <= 500) return true;
      if (Number.isFinite(height) && height > 0 && height <= 350) return true;
      const url = rawUrl.toLowerCase();
      if (url.includes("/thumb/") || url.includes("thumbnail") || url.includes("width=140") || /\/ace\/standard\/(?:[1-5]\d{2}|\d{1,2})\//i.test(url) || /\/images\/ic\/(?:[1-5]\d{2}|\d{1,2})x(?:[1-3]\d{2}|\d{1,2})\//i.test(url)) {
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }
  async fetchOpenGraphImage(articleUrl) {
    try {
      const response = await axios.get(articleUrl, {
        timeout: 12e3,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
        }
      });
      const html = typeof response.data === "string" ? response.data : JSON.stringify(response.data);
      const $ = cheerio.load(html);
      const imageCandidates = [
        $('meta[property="og:image"]').attr("content")?.trim() || $('meta[property="og:image:secure_url"]').attr("content")?.trim() || $('meta[name="twitter:image"]').attr("content")?.trim() || $('link[rel="image_src"]').attr("href")?.trim(),
        ...$('article img, main img, figure img, picture img, [data-testid="lede-image"] img').toArray().flatMap((node) => {
          const src = $(node).attr("src")?.trim();
          const dataSrc = $(node).attr("data-src")?.trim();
          const srcset = String($(node).attr("srcset") || "").split(",").map((part) => part.trim().split(/\s+/)[0]).filter(Boolean);
          return [src, dataSrc, ...srcset];
        })
      ].filter(Boolean);
      for (const candidate of imageCandidates) {
        try {
          return new URL(candidate, articleUrl).toString();
        } catch {
          if (/^https?:\/\//i.test(candidate)) return candidate;
        }
      }
      return null;
    } catch (error) {
      console.warn("[autopost] failed to fetch article OG image", { articleUrl, error });
      return null;
    }
  }
  async resolveBestNewsImageUrl(imageUrl, articleUrl) {
    const normalized = imageUrl ? this.toHighResolutionImageUrl(imageUrl) : "";
    if (normalized) {
      const quality = await this.inspectNewsImageQuality(normalized);
      if (!this.isLikelyLowResolutionUrl(normalized) && this.isUsableNewsImageQuality(quality)) {
        return normalized;
      }
      const enhanced = this.isEnhanceableNewsImageQuality(quality) ? await this.enhanceImageToDataUrl(normalized) : null;
      if (enhanced && this.isUsableNewsImageQuality(await this.inspectNewsImageQuality(enhanced))) {
        return enhanced;
      }
    }
    if (articleUrl) {
      const ogImage = await this.fetchOpenGraphImage(articleUrl);
      if (ogImage) {
        const normalizedOgImage = this.toHighResolutionImageUrl(ogImage);
        const quality = await this.inspectNewsImageQuality(normalizedOgImage);
        if (this.isUsableNewsImageQuality(quality)) {
          return normalizedOgImage;
        }
        const enhancedOgImage = this.isEnhanceableNewsImageQuality(quality) ? await this.enhanceImageToDataUrl(normalizedOgImage) : null;
        if (enhancedOgImage && this.isUsableNewsImageQuality(await this.inspectNewsImageQuality(enhancedOgImage))) {
          return enhancedOgImage;
        }
      }
    }
    return null;
  }
  async enhanceImageToDataUrl(url) {
    try {
      const response = await axios.get(url, {
        responseType: "arraybuffer",
        timeout: 2e4,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
        }
      });
      const source = Buffer.from(response.data);
      const buffer = await sharp(source).rotate().resize(1600, 900, { fit: "cover", position: "attention" }).sharpen().jpeg({ quality: 90, mozjpeg: true, chromaSubsampling: "4:4:4" }).toBuffer();
      return `data:image/jpeg;base64,${buffer.toString("base64")}`;
    } catch (error) {
      console.warn("[autopost] image enhancement failed", { url, error });
      return null;
    }
  }
  async inspectNewsImageQuality(url) {
    const source = await this.loadImageBuffer(url);
    if (!source) return null;
    try {
      const metadata = await sharp(source).metadata();
      const width = Number(metadata.width ?? 0);
      const height = Number(metadata.height ?? 0);
      return { width, height, bytes: source.length };
    } catch (error) {
      console.warn("[autopost] failed to inspect bwin news image quality", { url, error });
      return null;
    }
  }
  isUsableNewsImageQuality(quality) {
    return Boolean(quality && quality.width >= 1200 && quality.height >= 675 && quality.bytes >= 8e4);
  }
  isEnhanceableNewsImageQuality(quality) {
    return Boolean(quality && quality.width >= 640 && quality.height >= 360 && quality.bytes >= 25e3);
  }
  async improveNewsImageQuality(imageUrls, platforms) {
    const normalized = imageUrls.map((url) => this.toHighResolutionImageUrl(url)).filter(Boolean).filter((value, index, arr) => arr.indexOf(value) === index);
    if (!normalized.length) return [];
    const xOnly = platforms.every((platform) => platform === "x" || platform === "twitter");
    const usable = [];
    for (const url of normalized) {
      const quality = await this.inspectNewsImageQuality(url);
      if (this.isUsableNewsImageQuality(quality)) {
        usable.push(url);
        continue;
      }
      if (!this.isEnhanceableNewsImageQuality(quality)) {
        continue;
      }
      const enhanced = await this.enhanceImageToDataUrl(url);
      if (enhanced && (xOnly || this.isUsableNewsImageQuality(await this.inspectNewsImageQuality(enhanced)))) {
        usable.push(enhanced);
      }
    }
    return usable;
  }
  async loadImageBuffer(url) {
    try {
      if (/^data:image\/[a-zA-Z0-9.+-]+;base64,/i.test(url)) {
        const [, base64] = url.split(",", 2);
        return base64 ? Buffer.from(base64, "base64") : null;
      }
      const response = await axios.get(url, {
        responseType: "arraybuffer",
        timeout: 2e4,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
        }
      });
      return Buffer.from(response.data);
    } catch (error) {
      console.warn("[autopost] failed to load image buffer", { url, error });
      return null;
    }
  }
  cleanArticleText(value) {
    return String(value || "").replace(/Continue reading\.?/gi, "").replace(/Advertisement/gi, " ").replace(/\s+/g, " ").trim();
  }
  isUsefulArticleParagraph(value) {
    const text = this.cleanArticleText(value);
    if (text.length < 45) return false;
    if (/^(advertisement|related topics|listen to|sign up|follow us|copyright)/i.test(text)) return false;
    if (/cookies|privacy policy|newsletter/i.test(text)) return false;
    return true;
  }
  async fetchArticleStoryText(articleUrl, fallback = "") {
    const fallbackText = this.cleanArticleText(fallback);
    if (!articleUrl) return fallbackText;
    try {
      const response = await axios.get(articleUrl, {
        timeout: 12e3,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml"
        }
      });
      const html = typeof response.data === "string" ? response.data : JSON.stringify(response.data);
      const $ = cheerio.load(html);
      const metaText = [
        $('meta[property="og:description"]').attr("content"),
        $('meta[name="description"]').attr("content"),
        $('meta[name="twitter:description"]').attr("content")
      ].map((value) => this.cleanArticleText(value || "")).filter(Boolean);
      const selectors = [
        "article p",
        "main p",
        '[data-testid="article-body"] p',
        '[data-component="text-block"] p',
        ".article-body p",
        ".story-body p"
      ];
      const paragraphs = selectors.flatMap((selector) => $(selector).toArray().map((node) => this.cleanArticleText($(node).text()))).filter((paragraph) => this.isUsefulArticleParagraph(paragraph));
      const unique = [];
      const seen = /* @__PURE__ */ new Set();
      for (const paragraph of [...paragraphs, ...metaText, fallbackText]) {
        const cleaned = this.cleanArticleText(paragraph);
        const key = cleaned.toLowerCase();
        if (!this.isUsefulArticleParagraph(cleaned) || seen.has(key)) continue;
        seen.add(key);
        unique.push(cleaned);
        if (unique.length >= 3) break;
      }
      return unique.join("\n\n") || fallbackText;
    } catch (error) {
      console.warn("[autopost] article story extraction failed", { articleUrl, error });
      return fallbackText;
    }
  }
  buildBwinNewsCaption(headline, storyText, link, hashtags) {
    const normalizedHeadline = String(headline || "Football update").replace(/\s+/g, " ").trim();
    const fallbackStory = normalizedHeadline ? `This football update is developing around ${normalizedHeadline.toLowerCase()}. We are tracking the source report, the key reactions, and what it could mean next as more details come in.` : "";
    const lines = [
      normalizedHeadline,
      this.formatBwinStoryParagraphs(storyText || fallbackStory, 1100),
      link ? `Read more: ${link}` : "",
      "More football updates in bio.",
      hashtags || ""
    ].filter(Boolean);
    return lines.join("\n\n").trim();
  }
  async buildBwinFullStoryCaption(topic, items, hashtags) {
    const primary = items[0];
    const headline = String(primary?.title || topic || "Football update").replace(/\s+/g, " ").trim();
    const storyText = await this.fetchArticleStoryText(primary?.link, primary?.summary || "");
    const summary = this.formatBwinStoryParagraphs(storyText);
    const related = items.slice(1, 3).map((item) => String(item.title || "").replace(/\s+/g, " ").trim()).filter(Boolean);
    const lines = [
      headline,
      summary,
      related.length ? `Also developing: ${related.join(" | ")}` : "",
      "More football updates in bio.",
      hashtags
    ].filter(Boolean);
    return lines.join("\n\n").trim();
  }
  formatBwinStoryParagraphs(value, maxChars = 1200) {
    const cleaned = String(value || "").replace(/Continue reading\.?/gi, "").replace(/\s+/g, " ").trim();
    if (!cleaned) return "";
    const clipped = cleaned.length > maxChars ? `${cleaned.slice(0, maxChars).trimEnd()}...` : cleaned;
    const sentences = clipped.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g)?.map((sentence) => sentence.trim()).filter(Boolean) ?? [
      clipped
    ];
    const paragraphs = [];
    let current = "";
    for (const sentence of sentences) {
      const next = current ? `${current} ${sentence}` : sentence;
      if (next.length > 360 && current) {
        paragraphs.push(current);
        current = sentence;
      } else {
        current = next;
      }
      if (paragraphs.length >= 3) break;
    }
    if (current && paragraphs.length < 4) paragraphs.push(current);
    return paragraphs.join("\n\n");
  }
  async overlayNewsHeadline(source, headline) {
    const normalizedHeadline = this.trimTextForCard(headline, 120);
    if (!normalizedHeadline) return source;
    const width = 1800;
    const height = 1800;
    const lines = this.wrapCardText(normalizedHeadline, 20, 3);
    const accentY = 1246;
    const textY = 1360;
    const lineGap = 112;
    const headlineSvg = lines.map(
      (line, index) => `<text x="96" y="${textY + index * lineGap}" font-family="Arial Black, Arial, Helvetica, sans-serif" font-size="92" font-weight="900" fill="#ffffff">${this.escapeSvgText(line.toUpperCase())}</text>`
    ).join("\n");
    const svg = `
      <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#020617" stop-opacity="0"/>
            <stop offset="0.48" stop-color="#020617" stop-opacity="0.24"/>
            <stop offset="1" stop-color="#020617" stop-opacity="0.92"/>
          </linearGradient>
        </defs>
        <rect width="${width}" height="${height}" fill="url(#shade)"/>
        <rect x="96" y="${accentY}" width="180" height="14" rx="7" fill="#35B653"/>
        ${headlineSvg}
      </svg>
    `;
    return sharp(source).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).jpeg({ quality: 94, mozjpeg: true, chromaSubsampling: "4:4:4" }).toBuffer();
  }
  async publishBwinNewsImageBuffer(buffer) {
    const supabaseUrl = (process.env.SUPABASE_URL ?? "").trim().replace(/\/$/, "");
    const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
    const bucket = (process.env.BWIN_NEWS_BUCKET ?? "bwin-news").trim() || "bwin-news";
    if (supabaseUrl && serviceRoleKey) {
      try {
        const objectPath = `autopost/${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}/${crypto.randomUUID()}.jpg`;
        await axios.post(`${supabaseUrl}/storage/v1/object/${bucket}/${objectPath}`, buffer, {
          headers: {
            apikey: serviceRoleKey,
            Authorization: `Bearer ${serviceRoleKey}`,
            "Content-Type": "image/jpeg",
            "x-upsert": "true"
          },
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
          timeout: 6e4
        });
        return `${supabaseUrl}/storage/v1/object/public/${bucket}/${objectPath}`;
      } catch (error) {
        console.warn("[autopost] failed to upload bwin news image to supabase", error);
      }
    }
    return saveGeneratedImageBuffer(buffer, "jpg");
  }
  async finalizeNewsImages(imageUrls, headline = "") {
    const finalized = [];
    for (const url of imageUrls) {
      if (/^data:image\/[a-zA-Z0-9.+-]+;base64,/i.test(url)) {
        const source = await this.loadImageBuffer(url);
        if (source) {
          const base = await sharp(source).rotate().resize(1800, 1800, { fit: "cover", position: "attention", withoutEnlargement: false }).sharpen().jpeg({ quality: 94, mozjpeg: true, chromaSubsampling: "4:4:4" }).toBuffer();
          const buffer = await this.overlayNewsHeadline(base, headline);
          const publicUrl = await this.publishBwinNewsImageBuffer(buffer);
          if (publicUrl) finalized.push(publicUrl);
        }
        continue;
      }
      try {
        const source = await this.loadImageBuffer(url);
        if (!source) continue;
        const base = await sharp(source).rotate().resize(1800, 1800, { fit: "cover", position: "attention", withoutEnlargement: false }).sharpen().jpeg({ quality: 94, mozjpeg: true, chromaSubsampling: "4:4:4" }).toBuffer();
        const buffer = await this.overlayNewsHeadline(base, headline);
        const publicUrl = await this.publishBwinNewsImageBuffer(buffer);
        if (publicUrl) {
          finalized.push(publicUrl);
        }
      } catch (error) {
        console.warn("[autopost] failed to finalize news image", { url, error });
      }
    }
    return finalized;
  }
  formatTrendClock(timezone = "Africa/Kampala") {
    try {
      return new Intl.DateTimeFormat("en-GB", {
        timeZone: timezone,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      }).format(/* @__PURE__ */ new Date());
    } catch {
      return (/* @__PURE__ */ new Date()).toISOString().slice(11, 16);
    }
  }
  buildFootballFallbackCaption(topic, contentType, timezone = "Africa/Kampala") {
    const title = topic?.trim() || `${contentType.replace(/_/g, " ")} update`;
    const stamp = this.formatTrendClock(timezone);
    return `${title}

Update time: ${stamp} EAT
More football updates in bio.`;
  }
  escapeSvgText(value) {
    return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  trimTextForCard(value, maxLength = 120) {
    const normalized = String(value || "").replace(/\s+/g, " ").trim();
    if (!normalized) return "";
    if (normalized.length <= maxLength) return normalized;
    return `${normalized.slice(0, Math.max(maxLength - 1, 1)).trimEnd()}\u2026`;
  }
  wrapCardText(value, maxCharsPerLine = 22, maxLines = 4) {
    const words = this.trimTextForCard(value, maxCharsPerLine * maxLines + 16).split(/\s+/).filter(Boolean);
    const lines = [];
    let current = "";
    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (next.length <= maxCharsPerLine || !current) {
        current = next;
        continue;
      }
      lines.push(current);
      current = word;
      if (lines.length >= maxLines - 1) break;
    }
    if (lines.length < maxLines && current) {
      lines.push(current);
    }
    return lines.slice(0, maxLines);
  }
  deriveBwinHeadline(source) {
    const quoted = String(source || "").match(/"([^"]{6,160})"/);
    if (quoted?.[1]) return this.trimTextForCard(quoted[1], 110);
    const cleaned = String(source || "").replace(/^(create|generate)\s+(?:a|an)\s+/i, "").replace(/\b(?:editorial|realistic|football|sports|poster|image|graphic|card|update|visual)\b/gi, " ").replace(/\s+/g, " ").trim();
    return this.trimTextForCard(cleaned || "Latest football update", 110);
  }
  async generateBwinSportsFallbackImage(headline, subline) {
    const width = 1600;
    const height = 1600;
    const headlineLines = this.wrapCardText(headline || "Latest football update", 21, 4);
    const sublineLines = this.wrapCardText(
      subline || "Fixtures, results, odds, and football highlights",
      34,
      3
    );
    const headlineSvg = headlineLines.map(
      (line, index) => `<text x="110" y="${410 + index * 122}" font-family="Arial, Helvetica, sans-serif" font-size="102" font-weight="800" fill="#f8fafc">${this.escapeSvgText(
        line
      )}</text>`
    ).join("");
    const sublineSvg = sublineLines.map(
      (line, index) => `<text x="110" y="${980 + index * 62}" font-family="Arial, Helvetica, sans-serif" font-size="48" font-weight="500" fill="#cbd5e1">${this.escapeSvgText(
        line
      )}</text>`
    ).join("");
    const svg = `
      <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#101827"/>
            <stop offset="55%" stop-color="#172554"/>
            <stop offset="100%" stop-color="#020617"/>
          </linearGradient>
          <radialGradient id="stadiumGlow" cx="72%" cy="22%" r="58%">
            <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.34"/>
            <stop offset="45%" stop-color="#facc15" stop-opacity="0.12"/>
            <stop offset="100%" stop-color="#020617" stop-opacity="0"/>
          </radialGradient>
        </defs>
        <rect width="${width}" height="${height}" fill="url(#bg)"/>
        <rect width="${width}" height="${height}" fill="url(#stadiumGlow)"/>
        <rect x="0" y="0" width="${width}" height="200" fill="#020617" opacity="0.88"/>
        <rect x="0" y="${height - 210}" width="${width}" height="210" fill="#020617" opacity="0.90"/>
        <rect x="92" y="286" width="${width - 184}" height="8" fill="#facc15" opacity="0.68"/>
        <rect x="92" y="1120" width="${width - 184}" height="8" fill="#38bdf8" opacity="0.45"/>
        <text x="110" y="142" font-family="Arial, Helvetica, sans-serif" font-size="56" font-weight="800" fill="#facc15">FOOTBALL UPDATE</text>
        <text x="110" y="256" font-family="Arial, Helvetica, sans-serif" font-size="44" font-weight="700" fill="#e5e7eb">FOOTBALL UPDATE</text>
        ${headlineSvg}
        ${sublineSvg}
        <text x="110" y="${height - 116}" font-family="Arial, Helvetica, sans-serif" font-size="42" font-weight="700" fill="#facc15">PLAY RESPONSIBLY</text>
      </svg>
    `;
    try {
      const pipeline = sharp(Buffer.from(svg)).png();
      const output = await pipeline.png({ compressionLevel: 1, palette: false }).toBuffer();
      const publicUrl = await this.publishBwinNewsImageBuffer(output);
      return publicUrl ? [publicUrl] : [];
    } catch (error) {
      console.warn("[autopost] failed to generate bwin sports fallback image", error);
      return [];
    }
  }
  async generateFootballCardImage(prompt, recentSet) {
    try {
      const generated = await contentGenerationService.generateContent({
        prompt,
        businessType: "Football content card",
        imageCount: 1
      });
      const images = this.selectFreshImages(generated.images ?? [], recentSet);
      if (images.length) return images.slice(0, 1);
    } catch (error) {
      console.warn("[autopost] football card image generation failed", error);
    }
    return this.generateBwinSportsFallbackImage(this.deriveBwinHeadline(prompt));
  }
  extractResultEntries(candidates, recentSet) {
    const scorePattern = /\b\d{1,2}\s*[-:]\s*\d{1,2}\b/;
    const entries = candidates.flatMap((candidate) => {
      const itemMatches = (candidate.items ?? []).filter((item) => scorePattern.test(item.title)).map((item) => {
        const key = this.buildTrendContentKey("result", `${item.title}|${item.link || ""}|${item.publishedAt || ""}`);
        return { candidate, item, key };
      }).filter((entry) => !recentSet.has(entry.key));
      return itemMatches;
    });
    return entries.slice(0, 10);
  }
  async fetchBwinPredictionPicks(job, limit = 3) {
    const configured = job.trendPredictionsUrl?.trim() || "https://bwinbetug.com";
    const targets = [configured, "https://m.bwinbetug.com"].filter((value, index, arr) => arr.indexOf(value) === index);
    const picks = [];
    const seen = /* @__PURE__ */ new Set();
    for (const target of targets) {
      try {
        const response = await axios.get(target, {
          timeout: 15e3,
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
          }
        });
        const html = typeof response.data === "string" ? response.data : JSON.stringify(response.data);
        const $ = cheerio.load(html);
        const candidates = [];
        const selectors = ['[class*="event"]', '[class*="match"]', '[class*="fixture"]', "li", "a", "div"];
        for (const selector of selectors) {
          $(selector).slice(0, 800).each((_, element) => {
            const text = $(element).text().replace(/\s+/g, " ").trim();
            if (text.length >= 12 && text.length <= 180 && /( vs | v | - )/i.test(text)) {
              candidates.push(text);
            }
          });
          if (candidates.length >= 100) break;
        }
        for (const raw of candidates) {
          const fixtureMatch = raw.match(/([A-Za-z0-9 .'-]{2,})\s(?:vs|v|-)\s([A-Za-z0-9 .'-]{2,})/i);
          if (!fixtureMatch) continue;
          const fixture = `${fixtureMatch[1].trim()} vs ${fixtureMatch[2].trim()}`.replace(/\s+/g, " ");
          const oddsMatches = raw.match(/\b\d{1,2}\.\d{1,2}\b/g) ?? [];
          const odds = oddsMatches.slice(0, 3).join(" / ") || void 0;
          const dedupeKey = `${fixture.toLowerCase()}|${odds || ""}`;
          if (seen.has(dedupeKey)) continue;
          seen.add(dedupeKey);
          picks.push({ fixture, odds });
          if (picks.length >= limit) return picks;
        }
      } catch (error) {
        console.warn("[autopost] prediction source fetch failed", { target, error });
      }
    }
    return picks;
  }
  async fetchLeagueTableSnapshot(job, options = {}) {
    const leagues = TOP_FIVE_LEAGUES;
    const cursorRaw = Number.isFinite(job.trendTableCursor) ? job.trendTableCursor : 0;
    const start = (Math.trunc(cursorRaw) % leagues.length + leagues.length) % leagues.length;
    const orderedLeagues = options.preferredLeague ? options.strictPreferred ? [options.preferredLeague] : [
      options.preferredLeague,
      ...leagues.filter((league) => league.id !== options.preferredLeague?.id)
    ] : [...leagues.slice(start), ...leagues.slice(0, start)];
    for (const league of orderedLeagues) {
      const index = leagues.findIndex((item) => item.id === league.id);
      try {
        const response = await axios.get(`https://api-football-standings.azharimm.dev/leagues/${league.id}/standings`, {
          timeout: 15e3
        });
        const standings = Array.isArray(response.data?.data?.standings) ? response.data.data.standings : [];
        const rows = standings.slice(0, 8).map((entry) => {
          const name = String(entry?.team?.displayName || entry?.team?.name || "").trim();
          const stats = Array.isArray(entry?.stats) ? entry.stats : [];
          const pointsStat = stats.find(
            (stat) => String(stat?.name || "").toLowerCase() === "points" || String(stat?.displayName || "").toLowerCase() === "points"
          );
          const playedStat = stats.find(
            (stat) => String(stat?.name || "").toLowerCase() === "gamesplayed" || String(stat?.displayName || "").toLowerCase() === "games played"
          );
          const goalDiffStat = stats.find(
            (stat) => String(stat?.name || "").toLowerCase() === "pointdifferential" || String(stat?.displayName || "").toLowerCase() === "goal difference"
          );
          const points = this.parseNumeric(pointsStat?.value ?? pointsStat?.displayValue ?? 0);
          const played = this.parseNumeric(playedStat?.value ?? playedStat?.displayValue ?? 0);
          const goalDiff = this.parseNumeric(goalDiffStat?.value ?? goalDiffStat?.displayValue ?? 0);
          return { name, points, played, goalDiff };
        }).filter((entry) => entry.name);
        if (rows.length) {
          return {
            leagueId: league.id,
            league: league.label,
            rows,
            nextCursor: ((index >= 0 ? index : 0) + 1) % leagues.length,
            source: "api-football-standings"
          };
        }
      } catch (error) {
        console.warn("[autopost] standings fetch failed (primary source)", { league: league.label, error });
      }
      try {
        const response = await axios.get(`https://site.api.espn.com/apis/v2/sports/soccer/${league.espnId}/standings`, {
          timeout: 2e4,
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
          }
        });
        const entries = Array.isArray(response.data?.children?.[0]?.standings?.entries) ? response.data.children[0].standings.entries : [];
        const rows = entries.slice(0, 8).map((entry) => {
          const name = String(entry?.team?.displayName || entry?.team?.name || "").trim();
          const stats = Array.isArray(entry?.stats) ? entry.stats : [];
          const getStat = (nameKey) => stats.find((stat) => String(stat?.name || "").toLowerCase() === nameKey.toLowerCase());
          const points = this.parseNumeric(getStat("points")?.value ?? getStat("points")?.displayValue ?? 0);
          const played = this.parseNumeric(getStat("gamesPlayed")?.value ?? getStat("gamesPlayed")?.displayValue ?? 0);
          const goalDiff = this.parseNumeric(
            getStat("pointDifferential")?.value ?? getStat("pointDifferential")?.displayValue ?? 0
          );
          return { name, points, played, goalDiff };
        }).filter((entry) => entry.name);
        if (rows.length) {
          return {
            leagueId: league.id,
            league: league.label,
            rows,
            nextCursor: ((index >= 0 ? index : 0) + 1) % leagues.length,
            source: "espn"
          };
        }
      } catch (error) {
        console.warn("[autopost] standings fetch failed (espn fallback)", { league: league.label, error });
      }
    }
    return null;
  }
  async fetchTopScorersSnapshot(league) {
    try {
      const response = await axios.get(`https://site.api.espn.com/apis/site/v2/sports/soccer/${league.espnId}/statistics`, {
        timeout: 2e4,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
        }
      });
      const stats = Array.isArray(response.data?.stats) ? response.data.stats : [];
      const goalsBucket = stats.find((group) => {
        const key = String(group?.name || "").toLowerCase();
        const display = String(group?.displayName || "").toLowerCase();
        return key.includes("goals") || display.includes("goal");
      });
      const leaders = Array.isArray(goalsBucket?.leaders) ? goalsBucket.leaders : [];
      const rows = leaders.slice(0, 10).map((entry) => {
        const athlete = entry?.athlete ?? {};
        const statsList = Array.isArray(athlete?.statistics) ? athlete.statistics : [];
        const goalsStat = statsList.find((stat) => String(stat?.name || "").toLowerCase() === "totalgoals");
        const appearanceStat = statsList.find((stat) => String(stat?.name || "").toLowerCase() === "appearances");
        const player = String(athlete?.displayName || athlete?.shortName || "").trim();
        const team = String(athlete?.team?.displayName || athlete?.team?.name || "").trim();
        const goals = Math.trunc(
          this.parseNumeric(entry?.value ?? goalsStat?.value ?? goalsStat?.displayValue ?? 0)
        );
        let appearances = this.parseNumeric(appearanceStat?.value ?? appearanceStat?.displayValue ?? 0);
        if (!appearances && typeof entry?.displayValue === "string") {
          const match = entry.displayValue.match(/matches:\s*(\d{1,3})/i);
          if (match) appearances = this.parseNumeric(match[1]);
        }
        return {
          player,
          team,
          goals,
          appearances: appearances > 0 ? Math.trunc(appearances) : null
        };
      }).filter((row) => row.player && row.goals > 0);
      if (!rows.length) return null;
      return {
        leagueId: league.id,
        league: league.label,
        rows,
        source: "espn-statistics"
      };
    } catch (error) {
      console.warn("[autopost] top scorers fetch failed", { league: league.label, error });
      return null;
    }
  }
  async createLeagueTableImageUrl(userId, snapshot) {
    const baseUrl = this.getPublicBaseUrl();
    if (!baseUrl) return null;
    try {
      const draftRef = firestore.collection("tableImageDrafts").doc();
      await draftRef.set({
        userId,
        league: snapshot.league,
        rows: snapshot.rows.slice(0, 8).map((row) => ({
          name: row.name,
          points: row.points,
          played: row.played,
          goalDiff: row.goalDiff ?? null
        })),
        source: snapshot.source,
        cta: "More football updates in bio",
        updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
      return `${baseUrl}/public/table-image/${draftRef.id}.png`;
    } catch (error) {
      console.warn("[autopost] table image draft creation failed", error);
      return null;
    }
  }
  async createLeagueTableImageDataUrl(snapshot) {
    try {
      const buffer = await renderLeagueTableImage({
        league: snapshot.league,
        rows: snapshot.rows.slice(0, 8).map((row) => ({
          name: row.name,
          points: row.points,
          played: row.played,
          goalDiff: row.goalDiff ?? null
        })),
        source: snapshot.source,
        cta: "More football updates in bio",
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      });
      return this.publishBwinNewsImageBuffer(buffer);
    } catch (error) {
      console.warn("[autopost] table image generation failed", error);
      return null;
    }
  }
  async createTopScorersImageDataUrl(snapshot) {
    try {
      const buffer = await renderTopScorersImage({
        league: snapshot.league,
        rows: snapshot.rows.slice(0, 8).map((row) => ({
          player: row.player,
          team: row.team,
          goals: row.goals,
          appearances: row.appearances ?? null
        })),
        source: snapshot.source,
        cta: "More football updates in bio",
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      });
      return this.publishBwinNewsImageBuffer(buffer);
    } catch (error) {
      console.warn("[autopost] top scorers image generation failed", error);
      return null;
    }
  }
  async createPredictionsImageDataUrl(picks) {
    try {
      const buffer = await renderPredictionsImage({
        rows: picks.slice(0, 8).map((pick) => ({
          fixture: pick.fixture,
          odds: pick.odds ?? null
        })),
        source: "Fixture scan",
        cta: "More football updates in bio",
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      });
      return this.publishBwinNewsImageBuffer(buffer);
    } catch (error) {
      console.warn("[autopost] predictions image generation failed", error);
      return null;
    }
  }
  async executeTrendStories(userId, job) {
    if (await isBwinAccountClosureActive(userId)) {
      const closureState = await getBwinAccountClosureState(userId);
      const message = getBwinAccountClosureMessage(closureState);
      await this.stopBwinAutomation(userId, job, message);
      return {
        posted: 0,
        failed: [{ platform: "stories", status: "failed", error: message }],
        nextRun: null
      };
    }
    const onNewRelease = job.storyOnNewRelease === true;
    const defaultPollMinutes = Math.max(Number(process.env.AUTOPOST_STORY_POLL_MINUTES ?? 5), 1);
    const pollMinutes = job.storyPollMinutes && job.storyPollMinutes > 0 ? job.storyPollMinutes : defaultPollMinutes;
    const intervalHours = onNewRelease ? Math.max(pollMinutes / 60, 1 / 60) : job.storyIntervalHours && job.storyIntervalHours > 0 ? job.storyIntervalHours : this.defaultStoryIntervalHours;
    const nextRunDate = new Date(Date.now() + intervalHours * 60 * 60 * 1e3);
    const platforms = this.getStoryPlatforms(job);
    if (!platforms.length) {
      return { posted: 0, failed: [{ platform: "stories", error: "no_story_platforms", status: "failed" }], nextRun: nextRunDate.toISOString() };
    }
    const recentImages = this.getRecentStoryImageHistory(job);
    const recentSet = new Set(recentImages);
    if (this.isBwinScopeUser(userId)) {
      const candidates2 = await getFootballTrendingCandidates({
        maxCandidates: job.storyMaxCandidates ?? 8,
        maxAgeHours: job.storyMaxAgeHours ?? 72
      });
      const newsCandidates = this.filterBwinNewsCandidates(candidates2);
      const picked = this.pickFreshNewsCandidate(newsCandidates, new Set(this.getTrendRecentKeys(job)))?.candidate ?? newsCandidates[0] ?? null;
      const topItem2 = picked?.items?.[0];
      const topic2 = topItem2?.title?.trim() || picked?.topic?.trim() || "Latest football update";
      const summary2 = this.summarizeStory(topItem2?.summary || picked?.sampleTitles?.[0] || topic2, 260);
      const sourceLabel2 = "Football news";
      const publishedKey2 = topItem2?.publishedAt || picked?.publishedAt || "";
      const linkKey2 = topItem2?.link || "";
      const trendKey2 = [sourceLabel2, topic2, linkKey2, publishedKey2].map((value) => String(value || "").trim().toLowerCase()).join("||");
      if (onNewRelease && job.storyLastTrendKey && trendKey2 === job.storyLastTrendKey) {
        const nextRecord3 = {
          storyLastRunAt: admin.firestore.Timestamp.now(),
          storyNextRun: admin.firestore.Timestamp.fromDate(nextRunDate)
        };
        await autopostCollection.doc(userId).set(
          {
            ...nextRecord3,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          },
          { merge: true }
        );
        await this.mirrorAutopostJob(userId, { ...job, ...nextRecord3 });
        return { posted: 0, failed: [], nextRun: nextRunDate.toISOString() };
      }
      const relatedImageUrl2 = await this.resolveBestNewsImageUrl(topItem2?.imageUrl?.trim(), topItem2?.link?.trim()) || "";
      const baseUrl2 = this.getPublicBaseUrl();
      let finalImages2 = [];
      if (baseUrl2) {
        const draftRef = firestore.collection("storyImageDrafts").doc();
        await draftRef.set({
          headline: topic2,
          summary: summary2,
          source: sourceLabel2,
          imageUrl: relatedImageUrl2 || null,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        finalImages2 = [`${baseUrl2}/public/story-image/${draftRef.id}.png`];
      } else if (relatedImageUrl2 && !recentSet.has(relatedImageUrl2)) {
        finalImages2 = [relatedImageUrl2];
      }
      if (!finalImages2.length) {
        finalImages2 = await this.generateFootballCardImage(
          `Create a vertical football news story image for "${topic2}". Clean editorial sports style, no logos.`,
          recentSet
        );
      }
      const credentials2 = await this.resolveCredentials(userId);
      const results2 = [];
      const historyEntries2 = [];
      for (const platform of platforms) {
        const publisher = platformPublishers[platform];
        if (!publisher) {
          results2.push({ platform, status: "failed", error: "unsupported_platform" });
          historyEntries2.push({ platform, status: "failed", caption: topic2, errorMessage: "unsupported_platform" });
          continue;
        }
        try {
          const response = await publisher({ caption: topic2, imageUrls: finalImages2, credentials: credentials2 });
          results2.push({ platform, status: "posted", remoteId: response.remoteId ?? null });
          historyEntries2.push({ platform, status: "posted", caption: topic2, remoteId: response.remoteId ?? null });
        } catch (error) {
          const message = error?.message ?? "publish_failed";
          results2.push({ platform, status: "failed", error: message });
          historyEntries2.push({ platform, status: "failed", caption: topic2, errorMessage: message });
        }
      }
      const nextRecord2 = {
        storyLastRunAt: admin.firestore.Timestamp.now(),
        storyNextRun: admin.firestore.Timestamp.fromDate(nextRunDate),
        storyLastResult: results2,
        storyLastTrendKey: trendKey2,
        storyRecentImageUrls: this.mergeRecentImages(recentImages, finalImages2)
      };
      await autopostCollection.doc(userId).set(
        {
          ...nextRecord2,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );
      await this.mirrorAutopostJob(userId, { ...job, ...nextRecord2 });
      await this.recordHistory(userId, historyEntries2, finalImages2);
      return {
        posted: results2.filter((result) => result.status === "posted").length,
        failed: results2.filter((result) => result.status === "failed"),
        nextRun: nextRunDate.toISOString()
      };
    }
    const { sources, mode } = await this.safeGetUserTrendConfig(userId);
    const candidates = await getNewsTrendingCandidates({
      sources,
      sourceMode: mode,
      maxCandidates: job.storyMaxCandidates ?? 6,
      maxAgeHours: job.storyMaxAgeHours ?? 48
    });
    const top = candidates[0];
    const topic = top?.topic?.trim() || "Latest AI updates";
    const topItem = top?.items?.[0];
    const summaryRaw = topItem?.summary || top?.sampleTitles?.[0] || "";
    const summary = this.summarizeStory(summaryRaw, 180);
    const sourceLabel = top?.sources?.[0] || topItem?.sourceLabel || "AI news";
    const publishedKey = topItem?.publishedAt || top?.publishedAt || "";
    const linkKey = topItem?.link || "";
    const trendKey = [sourceLabel, topic, linkKey, publishedKey].map((value) => String(value || "").trim().toLowerCase()).join("||");
    if (onNewRelease && job.storyLastTrendKey && trendKey === job.storyLastTrendKey) {
      const nextRecord2 = {
        storyLastRunAt: admin.firestore.Timestamp.now(),
        storyNextRun: admin.firestore.Timestamp.fromDate(nextRunDate)
      };
      try {
        await autopostCollection.doc(userId).set(
          {
            ...nextRecord2,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          },
          { merge: true }
        );
      } catch (error) {
        console.warn("[autopost] firestore story duplicate skip update failed", error);
      }
      await this.mirrorAutopostJob(userId, { ...job, ...nextRecord2 });
      return {
        posted: 0,
        failed: [],
        nextRun: nextRunDate.toISOString()
      };
    }
    let relatedImageUrl = topItem?.imageUrl?.trim() || "";
    if (!relatedImageUrl) {
      const prompt = `Create a clean, modern news visual related to this AI headline: "${topic}". Context: "${summary || top?.sampleTitles?.[0] || "AI news update"}". Keep it realistic and editorial, no logos.`;
      let generated = null;
      try {
        generated = await contentGenerationService.generateContent({ prompt, businessType: "AI news image", imageCount: 1 });
      } catch (error) {
        console.warn("[autopost] related story image generation failed", error);
      }
      const generatedImages = this.resolveImageUrls(generated?.images ?? [], recentSet, false);
      if (generatedImages.length) {
        relatedImageUrl = generatedImages[0];
      }
    }
    const baseUrl = this.getPublicBaseUrl();
    let finalImages = [];
    if (baseUrl) {
      const draftRef = firestore.collection("storyImageDrafts").doc();
      await draftRef.set({
        headline: topic,
        summary,
        source: sourceLabel,
        imageUrl: relatedImageUrl || null,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
      finalImages = [`${baseUrl}/public/story-image/${draftRef.id}.png`];
    } else {
      if (relatedImageUrl && !recentSet.has(relatedImageUrl)) {
        finalImages = [relatedImageUrl];
      }
      const prompt = `Create a clean, modern social media story image representing this AI news headline: "${topic}". Use futuristic tech visuals, abstract AI motifs, and leave space for a short headline. Avoid logos and real brand marks.`;
      let generated = null;
      if (!finalImages.length) {
        try {
          generated = await contentGenerationService.generateContent({ prompt, businessType: "AI news update", imageCount: 1 });
        } catch (error) {
          console.warn("[autopost] trend story generation failed", error);
        }
        const imageUrls = this.resolveImageUrls(generated?.images ?? [], recentSet, false);
        finalImages = imageUrls.length ? imageUrls : [this.pickFallbackImage(recentSet)];
      }
    }
    const credentials = await this.resolveCredentials(userId);
    const results = [];
    const historyEntries = [];
    for (const platform of platforms) {
      const publisher = platformPublishers[platform];
      if (!publisher) {
        results.push({ platform, status: "failed", error: "unsupported_platform" });
        historyEntries.push({ platform, status: "failed", caption: topic, errorMessage: "unsupported_platform" });
        continue;
      }
      try {
        const response = await publisher({ caption: topic, imageUrls: finalImages, credentials });
        results.push({ platform, status: "posted", remoteId: response.remoteId ?? null });
        historyEntries.push({ platform, status: "posted", caption: topic, remoteId: response.remoteId ?? null });
      } catch (error) {
        const message = error?.message ?? "publish_failed";
        results.push({ platform, status: "failed", error: message });
        historyEntries.push({ platform, status: "failed", caption: topic, errorMessage: message });
      }
    }
    const nextRecord = {
      storyLastRunAt: admin.firestore.Timestamp.now(),
      storyNextRun: admin.firestore.Timestamp.fromDate(nextRunDate),
      storyLastResult: results,
      storyLastTrendKey: trendKey,
      storyRecentImageUrls: this.mergeRecentImages(recentImages, finalImages)
    };
    try {
      await autopostCollection.doc(userId).set(
        {
          ...nextRecord,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );
    } catch (error) {
      console.warn("[autopost] firestore story update failed", error);
    }
    await this.mirrorAutopostJob(userId, { ...job, ...nextRecord });
    await this.recordHistory(userId, historyEntries, finalImages);
    return {
      posted: results.filter((result) => result.status === "posted").length,
      failed: results.filter((result) => result.status === "failed"),
      nextRun: nextRunDate.toISOString()
    };
  }
  async executeTrendPosts(userId, job) {
    if (await isBwinAccountClosureActive(userId)) {
      const closureState = await getBwinAccountClosureState(userId);
      const message = getBwinAccountClosureMessage(closureState);
      await this.stopBwinAutomation(userId, job, message);
      return {
        posted: 0,
        failed: [{ platform: "trend", status: "failed", error: message }],
        nextRun: null
      };
    }
    const intervalHours = job.trendIntervalHours && job.trendIntervalHours > 0 ? job.trendIntervalHours : 4;
    const nextRunDate = new Date(Date.now() + intervalHours * 60 * 60 * 1e3);
    const platforms = this.getTrendPlatforms(job);
    if (!platforms.length) {
      return {
        posted: 0,
        failed: [{ platform: "trend", error: "no_trend_platforms", status: "failed" }],
        nextRun: nextRunDate.toISOString()
      };
    }
    const credentials = await this.resolveCredentials(userId);
    const results = [];
    const historyEntries = [];
    let userData;
    try {
      const userDoc = await firestore.collection("users").doc(userId).get();
      userData = userDoc.data();
    } catch (error) {
      console.warn("[autopost] trend user lookup failed; using runtime fallback context", {
        userId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
    const email = userData?.email ?? (isPrimarySocialUserId(userId) ? this.getPrimaryFallbackEmail() : null);
    const normalizedEmail = email?.toLowerCase().trim() ?? "";
    const brandId = this.isBwinScopeUser(userId) ? "bwinbetug" : normalizedEmail ? resolveBrandIdForClient(normalizedEmail) : null;
    const scope = brandId === "bwinbetug" ? "football" : "global";
    const now = /* @__PURE__ */ new Date();
    const structuredScheduleEnabled = scope === "football" && job.trendStructuredScheduleEnabled !== false;
    const structuredSlot = structuredScheduleEnabled ? this.getStructuredFootballSlot(job, now) : null;
    let selectedContentType = structuredSlot?.contentType ?? (scope === "football" ? "news" : "news");
    const scheduleTimezone = (structuredSlot?.timezone ?? job.trendTimezone?.trim()) || "Africa/Kampala";
    const trendDateKey = this.getDateKeyForTimezone(now, scheduleTimezone);
    const dailyLeague = structuredScheduleEnabled ? this.getDailyLeagueForDate(now, scheduleTimezone) : null;
    let nextTrendSlotCursor = structuredScheduleEnabled && typeof structuredSlot?.nextSlotCursor === "number" ? structuredSlot.nextSlotCursor : null;
    const trendRecentKeys = this.getTrendRecentKeys(job);
    const trendRecentSet = new Set(trendRecentKeys);
    const usedTrendKeys = [];
    let caption = "";
    let trendTopic = "";
    let imageUrls = [];
    const sourceImageUrls = [];
    const sourceVideoUrls = [];
    const trendCaptions = {};
    let newsBaselineCaption = "";
    let newsBaselineImages = [];
    let newsBaselineCaptions = {};
    let newsOverlayHeadline = "";
    let footballCandidates = [];
    let baselineCandidate = null;
    let usedTableCursor = null;
    let trendContentKey = null;
    let highlightlyVideoSelection = null;
    const allowThirdPartyHighlightVideoRepublish = this.allowThirdPartyHighlightVideoRepublish();
    if (scope === "football") {
      try {
        const { sources } = await this.safeGetUserTrendConfig(userId);
        const candidates = await getFootballTrendingCandidates({
          sources,
          maxCandidates: job.trendMaxCandidates ?? 6,
          maxAgeHours: job.trendMaxAgeHours ?? 48
        });
        footballCandidates = this.filterBwinNewsCandidates(candidates);
        const top = selectedContentType === "video" ? footballCandidates.find(
          (candidate) => (candidate.items ?? []).some((item) => Boolean(item.videoUrl?.trim()))
        ) ?? footballCandidates[0] : this.pickFreshNewsCandidate(footballCandidates, trendRecentSet)?.candidate ?? footballCandidates[0];
        baselineCandidate = top ?? null;
        if (!top) {
          caption = this.buildFootballFallbackCaption(void 0, "news", scheduleTimezone);
        } else {
          trendTopic = top.topic;
          const items = (top.items ?? []).slice(0, 6);
          const topItemImages = [];
          for (const item of items.slice(0, 4)) {
            const resolved = await this.resolveBestNewsImageUrl(item.imageUrl?.trim(), item.link?.trim());
            if (resolved) topItemImages.push(resolved);
          }
          const videoPool = selectedContentType === "video" ? footballCandidates.flatMap((item) => item.items ?? []) : items;
          const topItemVideos = Array.from(
            new Set(
              videoPool.map((item) => item.videoUrl?.trim()).filter((url) => Boolean(url))
            )
          );
          sourceImageUrls.push(...topItemImages);
          sourceVideoUrls.push(...topItemVideos.slice(0, 10));
          const contextLines = [
            `topic: ${top.topic}`,
            top.sources?.length ? `sources: ${top.sources.join(", ")}` : "",
            top.publishedAt ? `published_at: ${top.publishedAt}` : "",
            "",
            ...items.map((item) => {
              const summary = item.summary ? ` | ${item.summary}` : "";
              const when = item.publishedAt ? ` (${item.publishedAt})` : "";
              return `- ${item.sourceLabel}: ${item.title}${when}${summary}`;
            })
          ].filter(Boolean);
          const context = contextLines.join("\n").trim();
          const gen = await footballTrendContentService.generate({
            topic: top.topic,
            context: context.length >= 10 ? context : `topic: ${top.topic}`,
            trendSignals: [
              ...top.sources?.slice(0, 3) ?? [],
              ...top.sampleTitles?.slice(0, 3) ?? []
            ],
            ...normalizedEmail ? { clientId: normalizedEmail } : {},
            channels: platforms.map((platform) => platform.replace(/_story$/, "")),
            region: job.trendRegion ?? "Uganda",
            language: job.trendLanguage ?? "English",
            rightsInfo: "Use official/public news context only. Do not claim ownership of match footage. Avoid copyrighted clips unless licensed.",
            includePosterImage: true,
            imageCount: 1
          });
          const tags = (gen.content.hashtags ?? []).map((tag) => tag.trim()).filter(Boolean).map((tag) => tag.startsWith("#") ? tag : `#${tag.replace(/^#+/, "")}`).join(" ");
          const fullStoryCaption = await this.buildBwinFullStoryCaption(top.topic, items, tags);
          newsOverlayHeadline = gen.content.poster?.headline?.trim() || top.topic || items[0]?.title || "";
          const baseCaptionByPlatform = (platform) => {
            if (platform === "twitter" || platform === "x") return gen.content.captions.viral_caption;
            if (platform === "linkedin") return gen.content.captions.instagram;
            return gen.content.captions.instagram;
          };
          caption = fullStoryCaption || [gen.content.captions.instagram, tags].filter(Boolean).join("\n\n").trim();
          const mergedImages = [...sourceImageUrls, ...gen.images ?? []].filter(Boolean);
          imageUrls = Array.from(new Set(mergedImages)).slice(0, 4);
          for (const p of platforms) {
            const base = baseCaptionByPlatform(p);
            const combined = [base, tags].filter(Boolean).join(p === "twitter" || p === "x" ? " " : "\n\n").trim();
            if (p === "twitter" || p === "x") {
              if (combined) trendCaptions[p] = combined;
            } else if (caption) {
              trendCaptions[p] = caption;
            }
          }
        }
      } catch (error) {
        console.warn("[autopost] trend generation failed; using text fallback", error);
        caption = this.buildFootballFallbackCaption(trendTopic, "news", scheduleTimezone);
        imageUrls = Array.from(new Set(sourceImageUrls)).slice(0, 4);
      }
    } else {
      caption = "Trending update coming soon.";
      imageUrls = [];
    }
    if (scope === "football" && imageUrls.length === 0 && trendTopic) {
      try {
        const generatedImage = await contentGenerationService.generateContent({
          prompt: `Create a realistic football news image for this trend: "${trendTopic}". Dynamic stadium energy, editorial sports style, no logos.`,
          businessType: "Football trend news visual",
          imageCount: 1
        });
        const resolvedImages = this.resolveImageUrls(generatedImage.images ?? [], /* @__PURE__ */ new Set(), false);
        if (resolvedImages.length) {
          imageUrls = resolvedImages.slice(0, 1);
        }
      } catch (error) {
        console.warn("[autopost] trend image fallback generation failed", error);
      }
    }
    if (scope === "football") {
      newsBaselineCaption = caption.trim();
      newsBaselineImages = [...imageUrls];
      newsBaselineCaptions = { ...trendCaptions };
    }
    if (structuredScheduleEnabled && scope === "football") {
      const topCandidate = baselineCandidate ?? footballCandidates[0];
      const topItem = topCandidate?.items?.[0];
      const setUnifiedCaption = () => {
        for (const platform of platforms) {
          trendCaptions[platform] = caption;
        }
      };
      const restoreNewsBaseline = () => {
        caption = newsBaselineCaption || this.buildFootballFallbackCaption(trendTopic, "news", scheduleTimezone);
        imageUrls = newsBaselineImages.length ? [...newsBaselineImages] : Array.from(new Set(sourceImageUrls)).slice(0, 4);
        for (const platform of platforms) {
          delete trendCaptions[platform];
          const baselineCaption = newsBaselineCaptions[platform]?.trim();
          if (baselineCaption) {
            trendCaptions[platform] = baselineCaption;
          }
        }
      };
      if (selectedContentType === "prediction") {
        const picks = await this.fetchBwinPredictionPicks(job, 3);
        if (picks.length) {
          const updatedStamp = (/* @__PURE__ */ new Date()).toLocaleTimeString("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
            timeZone: scheduleTimezone
          });
          const picksLine = picks.map((pick, idx) => `${idx + 1}. ${pick.fixture}${pick.odds ? ` (${pick.odds})` : ""}`).join("\n");
          caption = [
            "Football predictions update",
            `Updated: ${updatedStamp} (${scheduleTimezone})`,
            picksLine,
            "More football updates in bio."
          ].filter(Boolean).join("\n");
          const key = this.buildTrendContentKey(
            "prediction",
            `${job.trendPredictionsUrl || "https://bwinbetug.com"}|${picks.map((pick) => `${pick.fixture}|${pick.odds || ""}`).join("|")}`
          );
          if (trendRecentSet.has(key)) {
            selectedContentType = "news";
            restoreNewsBaseline();
          } else {
            trendContentKey = key;
            usedTrendKeys.push(key);
            setUnifiedCaption();
            const predictionsImageDataUrl = await this.createPredictionsImageDataUrl(picks);
            if (predictionsImageDataUrl) {
              imageUrls = [predictionsImageDataUrl];
            } else {
              imageUrls = await this.generateFootballCardImage(
                `Create a clean football prediction card with readable fixture list and odds style layout. Highlight: "${picks[0]?.fixture || "Top fixtures"}". No sportsbook logos.`,
                new Set(this.getRecentImageHistory(job))
              );
            }
          }
        } else {
          selectedContentType = "news";
        }
      }
      if (selectedContentType === "table") {
        const snapshot = await this.fetchLeagueTableSnapshot(
          job,
          dailyLeague ? { preferredLeague: dailyLeague, strictPreferred: true } : {}
        );
        if (snapshot?.rows?.length) {
          const updatedStamp = (/* @__PURE__ */ new Date()).toLocaleTimeString("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
            timeZone: scheduleTimezone
          });
          const rows = snapshot.rows.slice(0, 6).map(
            (row, idx) => `${idx + 1}. ${row.name} - ${Math.trunc(row.points)} pts${row.played ? ` (${Math.trunc(row.played)}P)` : ""}`
          );
          caption = [
            `${snapshot.league} live table update`,
            `Updated: ${updatedStamp} (${scheduleTimezone})`,
            ...rows,
            "More football updates in bio."
          ].filter(Boolean).join("\n");
          const key = this.buildTrendContentKey(
            "table",
            `${trendDateKey}|${snapshot.league}|${snapshot.rows.map((row) => `${row.name}:${row.points}:${row.played}`).join("|")}`
          );
          if (!dailyLeague) {
            usedTableCursor = snapshot.nextCursor;
          }
          if (trendRecentSet.has(key)) {
            selectedContentType = "news";
            restoreNewsBaseline();
          } else {
            trendContentKey = key;
            usedTrendKeys.push(key);
            setUnifiedCaption();
            const tableImageUrl = await this.createLeagueTableImageUrl(userId, snapshot);
            if (tableImageUrl) {
              imageUrls = [tableImageUrl];
            } else {
              const tableImageDataUrl = await this.createLeagueTableImageDataUrl(snapshot);
              if (tableImageDataUrl) {
                imageUrls = [tableImageDataUrl];
              } else {
                imageUrls = await this.generateFootballCardImage(
                  `Design a modern football league table card for ${snapshot.league}. Show top teams and points with strong readability.`,
                  new Set(this.getRecentImageHistory(job))
                );
              }
            }
          }
        } else {
          selectedContentType = "news";
        }
      }
      if (selectedContentType === "top_scorer") {
        const scorerLeague = dailyLeague ?? TOP_FIVE_LEAGUES[0];
        const snapshot = await this.fetchTopScorersSnapshot(scorerLeague);
        if (snapshot?.rows?.length) {
          const updatedStamp = (/* @__PURE__ */ new Date()).toLocaleTimeString("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
            timeZone: scheduleTimezone
          });
          const rows = snapshot.rows.slice(0, 6).map(
            (row, idx) => `${idx + 1}. ${row.player} (${row.team}) - ${Math.trunc(row.goals)} goals${row.appearances ? ` in ${Math.trunc(row.appearances)} apps` : ""}`
          );
          caption = [
            `${snapshot.league} top scorers update`,
            `Updated: ${updatedStamp} (${scheduleTimezone})`,
            ...rows,
            "More football updates in bio."
          ].filter(Boolean).join("\n");
          const key = this.buildTrendContentKey(
            "top_scorer",
            `${trendDateKey}|${snapshot.league}|${snapshot.rows.map((row) => `${row.player}:${row.goals}:${row.appearances ?? "-"}`).join("|")}`
          );
          if (trendRecentSet.has(key)) {
            selectedContentType = "news";
            restoreNewsBaseline();
          } else {
            trendContentKey = key;
            usedTrendKeys.push(key);
            setUnifiedCaption();
            const topScorersImageDataUrl = await this.createTopScorersImageDataUrl(snapshot);
            if (topScorersImageDataUrl) {
              imageUrls = [topScorersImageDataUrl];
            } else {
              imageUrls = await this.generateFootballCardImage(
                `Design a modern ${snapshot.league} top scorers card with player names, clubs, and goals.`,
                new Set(this.getRecentImageHistory(job))
              );
            }
          }
        } else {
          selectedContentType = "news";
        }
      }
      if (this.isBwinScopeUser(userId) && selectedContentType === "video" && this.areBwinShortVideosDisabled()) {
        selectedContentType = "news";
      }
      if (selectedContentType === "video") {
        highlightlyVideoSelection = await this.pickFreshHighlightlyVideoCandidate(userId, scheduleTimezone, trendRecentSet);
        if (highlightlyVideoSelection) {
          const updatedStamp = (/* @__PURE__ */ new Date()).toLocaleTimeString("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
            timeZone: scheduleTimezone
          });
          const source = highlightlyVideoSelection.item.channel || highlightlyVideoSelection.item.source || "Highlightly";
          const title = highlightlyVideoSelection.item.title || "Football highlight";
          caption = [
            "Highlight alert",
            title,
            `Official source: ${source}`,
            `Updated: ${updatedStamp} (${scheduleTimezone})`,
            "More football updates in bio."
          ].filter(Boolean).join("\n");
          setUnifiedCaption();
          trendContentKey = highlightlyVideoSelection.key;
          usedTrendKeys.push(highlightlyVideoSelection.key);
          const resolvedImage = await this.resolveBestNewsImageUrl(
            highlightlyVideoSelection.item.imageUrl?.trim(),
            highlightlyVideoSelection.item.url?.trim()
          );
          if (!allowThirdPartyHighlightVideoRepublish) {
            imageUrls = await this.generateFootballCardImage(
              `Create a premium football highlight alert card. Headline: "${title}". Secondary line: "Official source: ${source}". Sharp sports editorial design, clean typography, dynamic football energy, no sportsbook logos, no watermarks, no club crests.`,
              new Set(this.getRecentImageHistory(job))
            );
          } else if (resolvedImage) {
            imageUrls = [resolvedImage];
          } else if (!imageUrls.length) {
            imageUrls = await this.generateFootballCardImage(
              `Create a football highlight poster image for "${title}". High-energy action style with clean headline space.`,
              new Set(this.getRecentImageHistory(job))
            );
          }
        }
      }
      if (selectedContentType === "video" && !highlightlyVideoSelection) {
        const videoSelection = this.pickFreshVideoCandidate(footballCandidates, trendRecentSet);
        if (videoSelection) {
          const updatedStamp = (/* @__PURE__ */ new Date()).toLocaleTimeString("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
            timeZone: scheduleTimezone
          });
          const source = videoSelection.item.sourceLabel || videoSelection.candidate.sources?.[0] || "Football source";
          const title = videoSelection.item.title || videoSelection.candidate.topic || "Football highlight";
          caption = [
            allowThirdPartyHighlightVideoRepublish ? "Football video highlight" : "Highlight alert",
            title,
            allowThirdPartyHighlightVideoRepublish ? `Source: ${source}` : `Official source: ${source}`,
            `Updated: ${updatedStamp} (${scheduleTimezone})`,
            "More football updates in bio."
          ].filter(Boolean).join("\n");
          setUnifiedCaption();
          trendContentKey = videoSelection.key;
          usedTrendKeys.push(videoSelection.key);
          const pickedVideoUrl = videoSelection.item.videoUrl?.trim();
          if (pickedVideoUrl) {
            const nextVideoPool = [pickedVideoUrl, ...sourceVideoUrls].filter(Boolean);
            sourceVideoUrls.length = 0;
            sourceVideoUrls.push(...Array.from(new Set(nextVideoPool)).slice(0, 10));
          }
          const resolvedImage = await this.resolveBestNewsImageUrl(
            videoSelection.item.imageUrl?.trim(),
            videoSelection.item.link?.trim()
          );
          if (!allowThirdPartyHighlightVideoRepublish) {
            imageUrls = await this.generateFootballCardImage(
              `Create a premium football highlight alert card. Headline: "${title}". Secondary line: "Official source: ${source}". Sharp sports editorial design, clean typography, dynamic football energy, no sportsbook logos, no watermarks, no club crests.`,
              new Set(this.getRecentImageHistory(job))
            );
          } else if (resolvedImage) {
            imageUrls = [resolvedImage];
          } else if (!imageUrls.length) {
            imageUrls = await this.generateFootballCardImage(
              `Create a football highlight poster image for "${title}". High-energy action style with clean headline space.`,
              new Set(this.getRecentImageHistory(job))
            );
          }
        } else {
          const updatedStamp = (/* @__PURE__ */ new Date()).toLocaleTimeString("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
            timeZone: scheduleTimezone
          });
          caption = [
            "Football video highlight",
            "Top clip from trusted football sources",
            `Updated: ${updatedStamp} (${scheduleTimezone})`,
            "More football updates in bio."
          ].filter(Boolean).join("\n");
          setUnifiedCaption();
        }
      }
      if (selectedContentType === "result") {
        const resultEntries = this.extractResultEntries(footballCandidates, trendRecentSet);
        const selectedResult = resultEntries[0];
        if (selectedResult) {
          const updatedStamp = (/* @__PURE__ */ new Date()).toLocaleTimeString("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
            timeZone: scheduleTimezone
          });
          const source = selectedResult.item.sourceLabel || selectedResult.candidate.sources?.[0] || "Football source";
          caption = [
            "Latest result update",
            `Updated: ${updatedStamp} (${scheduleTimezone})`,
            selectedResult.item.title,
            `Source: ${source}`,
            "More football updates in bio."
          ].filter(Boolean).join("\n");
          trendContentKey = selectedResult.key;
          usedTrendKeys.push(selectedResult.key);
          setUnifiedCaption();
          if (selectedResult.item.imageUrl?.trim()) {
            imageUrls = [selectedResult.item.imageUrl.trim()];
          } else {
            imageUrls = await this.generateFootballCardImage(
              `Create a football scorecard image for this result: "${selectedResult.item.title}". Editorial sports style, clear score emphasis.`,
              new Set(this.getRecentImageHistory(job))
            );
          }
        } else {
          selectedContentType = "news";
        }
      }
      if (selectedContentType === "news") {
        const staleStructuredCaption = /(live table update|top scorers update|football predictions update|latest result update)/i.test(
          caption
        );
        if (staleStructuredCaption) {
          restoreNewsBaseline();
        }
        const currentNewsKeys = topCandidate ? this.buildNewsCandidateKeys(topCandidate, topItem) : [];
        const currentNewsFresh = currentNewsKeys.length > 0 && !this.hasRecentTrendKeys(currentNewsKeys, trendRecentSet);
        const freshNews = this.pickFreshNewsCandidate(footballCandidates, trendRecentSet);
        const effectiveNewsCandidate = currentNewsFresh ? topCandidate : freshNews?.candidate;
        const effectiveNewsItem = currentNewsFresh ? topItem : freshNews?.item;
        const effectiveNewsKeys = currentNewsFresh ? currentNewsKeys : freshNews?.keys ?? [];
        const effectiveNewsKey = effectiveNewsKeys[0];
        if (effectiveNewsCandidate && (!caption || !currentNewsFresh || staleStructuredCaption)) {
          const headline = effectiveNewsItem?.title || effectiveNewsCandidate.topic;
          trendTopic = effectiveNewsCandidate.topic || trendTopic;
          const storyText = await this.fetchArticleStoryText(effectiveNewsItem?.link, effectiveNewsItem?.summary || "");
          caption = this.buildBwinNewsCaption(headline, storyText, effectiveNewsItem?.link);
          setUnifiedCaption();
          const resolvedImage = await this.resolveBestNewsImageUrl(
            effectiveNewsItem?.imageUrl?.trim(),
            effectiveNewsItem?.link?.trim()
          );
          if (resolvedImage) {
            imageUrls = [resolvedImage];
          }
        }
        if (!effectiveNewsCandidate) {
          trendTopic = "Latest football update";
          caption = this.buildFootballFallbackCaption(trendTopic, "news", scheduleTimezone);
          setUnifiedCaption();
        }
        if (!caption) {
          caption = topCandidate?.topic ? `${topCandidate.topic}

More football updates in bio.` : this.buildFootballFallbackCaption(void 0, selectedContentType, scheduleTimezone);
          setUnifiedCaption();
        }
        if (effectiveNewsKey && !this.hasRecentTrendKeys(effectiveNewsKeys, trendRecentSet)) {
          trendContentKey = effectiveNewsKey;
          usedTrendKeys.push(...effectiveNewsKeys);
        }
        if (!imageUrls.length && trendTopic) {
          imageUrls = await this.generateFootballCardImage(
            `Create a football breaking-news poster image for "${trendTopic}". Clean typography space, dynamic stadium atmosphere.`,
            new Set(this.getRecentImageHistory(job))
          );
        }
      }
    }
    if (scope === "football" && this.isBwinScopeUser(userId) && selectedContentType === "news") {
      if (!imageUrls.length) {
        const backupImages = [];
        for (const candidate of footballCandidates.slice(0, 8)) {
          for (const item of (candidate.items ?? []).slice(0, 3)) {
            const resolved = await this.resolveBestNewsImageUrl(item.imageUrl?.trim(), item.link?.trim());
            if (resolved) backupImages.push(resolved);
            if (backupImages.length >= 3) break;
          }
          if (backupImages.length >= 3) break;
        }
        imageUrls = Array.from(new Set(backupImages)).slice(0, 3);
      }
      imageUrls = imageUrls.length ? await this.improveNewsImageQuality(imageUrls, platforms) : [];
      if (!imageUrls.length) {
        console.warn("[autopost] Bwin news skipped source image fallback because no source-aligned image passed quality checks", {
          trendTopic
        });
      }
      const sourceAlignedImages = [...imageUrls];
      imageUrls = imageUrls.length ? await this.finalizeNewsImages(imageUrls, newsOverlayHeadline || trendTopic) : [];
      if (!imageUrls.length && sourceAlignedImages.length) {
        console.warn("[autopost] Bwin news finalization failed; using source-aligned image without overlay", {
          trendTopic
        });
        imageUrls = sourceAlignedImages.slice(0, 1);
      }
      if (!imageUrls.length) {
        results.push({ platform: "bwin_news_guard", status: "failed", error: "missing_full_bleed_news_image" });
        historyEntries.push({
          platform: "bwin_news_guard",
          status: "failed",
          caption,
          errorMessage: "missing_full_bleed_news_image"
        });
        console.warn("[autopost] Bwin news publish skipped because full-bleed source image could not be finalized", {
          trendTopic
        });
        const guardedNextRecord = {
          ...job,
          trendLastRunAt: admin.firestore.Timestamp.now(),
          trendNextRun: admin.firestore.Timestamp.fromDate(nextRunDate),
          trendLastResult: results
        };
        try {
          await autopostCollection.doc(userId).set(
            {
              trendLastRunAt: guardedNextRecord.trendLastRunAt,
              trendNextRun: guardedNextRecord.trendNextRun,
              trendLastResult: results,
              updatedAt: admin.firestore.FieldValue.serverTimestamp()
            },
            { merge: true }
          );
        } catch (error) {
          console.warn("[autopost] firestore Bwin image guard update failed", error);
        }
        await this.mirrorAutopostJob(userId, guardedNextRecord);
        await this.recordHistory(userId, historyEntries, imageUrls);
        return {
          posted: 0,
          failed: results.filter((result) => result.status === "failed"),
          nextRun: nextRunDate.toISOString()
        };
      }
    }
    const genericVideoSelection = this.selectNextGenericVideo(job, []);
    const trendVideoUrl = sourceVideoUrls[0] || (scope === "football" ? void 0 : genericVideoSelection.videoUrl);
    const videoCapablePlatforms = /* @__PURE__ */ new Set(["twitter", "x", "facebook", "facebook_story", "instagram", "linkedin"]);
    const hasXPlatform = platforms.some((platform) => platform === "x" || platform === "twitter");
    const bwinShortVideosDisabled = this.isBwinScopeUser(userId) && this.areBwinShortVideosDisabled();
    const shouldUseVideoMode = scope === "football" && selectedContentType === "video" && !bwinShortVideosDisabled;
    const weeklyAwardsEnabled = scope === "football" && job.xWeeklyAwardsEnabled === true;
    const weeklyAwardsOnly = weeklyAwardsEnabled && job.xWeeklyAwardsOnly === true;
    const ownedBwinHighlightVideoUrl = shouldUseVideoMode && !allowThirdPartyHighlightVideoRepublish ? this.getOwnedBwinHighlightVideoUrl() : "";
    let xHighlight = null;
    const highlightlyMetaCaptionTemplate = shouldUseVideoMode && highlightlyVideoSelection ? this.buildHighlightlyVideoCaption(highlightlyVideoSelection.item, scheduleTimezone) : "";
    if (shouldUseVideoMode && hasXPlatform) {
      try {
        xHighlight = await this.pickFootballHighlightForX(job, credentials, {
          preferWeeklyAwards: weeklyAwardsEnabled,
          weeklyAwardsOnly,
          rotateAccounts: true
        });
      } catch (error) {
        console.warn(
          "[autopost] x highlight lookup failed; continuing with direct video fallback",
          error instanceof Error ? error.message : error
        );
      }
    }
    let usedXHighlightTweetId = null;
    let usedXHighlightUsername = null;
    let usedXHighlightAccountCursor = null;
    let usedXWeeklyAwardTweetId = null;
    let resolvedHighlightVideoUrl = null;
    if (shouldUseVideoMode && xHighlight?.tweetId) {
      resolvedHighlightVideoUrl = await this.resolveVideoUrlFromTweet(xHighlight.tweetId, credentials);
    }
    const effectiveTrendVideoUrl = resolvedHighlightVideoUrl || trendVideoUrl;
    const nextRecord = {
      trendLastRunAt: admin.firestore.Timestamp.now(),
      trendNextRun: admin.firestore.Timestamp.fromDate(nextRunDate),
      trendLastResult: results,
      ...!sourceVideoUrls[0] && effectiveTrendVideoUrl && typeof genericVideoSelection.nextCursor === "number" ? { videoCursor: genericVideoSelection.nextCursor } : {}
    };
    for (const platform of platforms) {
      const publisher = platformPublishers[platform];
      if (!publisher) {
        results.push({ platform, status: "failed", error: "unsupported_platform" });
        historyEntries.push({ platform, status: "failed", caption, errorMessage: "unsupported_platform" });
        continue;
      }
      if ((platform === "facebook_story" || platform === "instagram_story") && imageUrls.length === 0) {
        results.push({ platform, status: "failed", error: "missing_image_for_story" });
        historyEntries.push({ platform, status: "failed", caption, errorMessage: "missing_image_for_story" });
        continue;
      }
      try {
        const highlightCaptionTemplate = shouldUseVideoMode && xHighlight?.text ? xHighlight.isWeeklyAward ? `${this.buildVideoCaptionFromHighlight(xHighlight.text || "", xHighlight.username, scheduleTimezone)}
Weekly award clip` : this.buildVideoCaptionFromHighlight(xHighlight.text || "", xHighlight.username, scheduleTimezone) : "";
        const useXHighlightTemplateForMeta = Boolean(highlightCaptionTemplate) && shouldUseVideoMode && !highlightlyMetaCaptionTemplate && (platform === "facebook" || platform === "facebook_story" || platform === "instagram" || platform === "linkedin");
        const rawPerPlatformCaption = useXHighlightTemplateForMeta ? highlightCaptionTemplate : highlightlyMetaCaptionTemplate && shouldUseVideoMode && (platform === "facebook" || platform === "facebook_story" || platform === "instagram" || platform === "linkedin") ? highlightlyMetaCaptionTemplate : trendCaptions[platform] || caption;
        const trackedRawPerPlatformCaption = this.applyBwinBetTracking(rawPerPlatformCaption, userId, platform);
        const cleanedRawPerPlatformCaption = this.sanitizeBwinInstagramCaptionLinks(
          trackedRawPerPlatformCaption,
          platform
        );
        const brandedRawPerPlatformCaption = this.applyBwinInstagramSportsHashtags(
          cleanedRawPerPlatformCaption,
          platform
        );
        const perPlatformCaption = platform === "x" || platform === "twitter" ? this.normalizeXCaption(brandedRawPerPlatformCaption) : brandedRawPerPlatformCaption;
        if (shouldUseVideoMode && (platform === "x" || platform === "twitter") && xHighlight?.tweetId) {
          const relatedCaptionTemplate = xHighlight.isWeeklyAward ? `${this.buildVideoCaptionFromHighlight(xHighlight.text || "", xHighlight.username, scheduleTimezone)}
Weekly award clip` : this.buildVideoCaptionFromHighlight(xHighlight.text || "", xHighlight.username, scheduleTimezone);
          const relatedCaption = this.normalizeXCaption(
            this.applyBwinBetTracking(relatedCaptionTemplate, userId, platform)
          );
          const quoteCaption = relatedCaption;
          const sourceTweetUrl = `https://x.com/${xHighlight.username}/status/${xHighlight.tweetId}`;
          let response2 = null;
          let finalCaption = quoteCaption;
          try {
            response2 = await publisher({
              caption: quoteCaption,
              imageUrls: [],
              quoteTweetId: xHighlight.tweetId,
              credentials
            });
          } catch (quoteError) {
            const forbidden = Number(quoteError?.code ?? quoteError?.status) === 403;
            if (!forbidden) throw quoteError;
            finalCaption = this.normalizeXCaption(
              this.applyBwinBetTracking(
                `${this.buildVideoCaptionFromHighlight(xHighlight.text || "", xHighlight.username, scheduleTimezone)}
Official clip: ${sourceTweetUrl}`,
                userId,
                platform
              )
            );
            response2 = await publisher({
              caption: finalCaption,
              imageUrls: [],
              credentials
            });
          }
          results.push({ platform, status: "posted", remoteId: response2.remoteId ?? null });
          historyEntries.push({
            platform,
            status: "posted",
            caption: finalCaption,
            remoteId: response2.remoteId ?? null
          });
          usedXHighlightTweetId = xHighlight.tweetId;
          usedXHighlightUsername = xHighlight.username;
          if (typeof xHighlight.nextCursor === "number") {
            usedXHighlightAccountCursor = xHighlight.nextCursor;
          }
          if (xHighlight.isWeeklyAward) {
            usedXWeeklyAwardTweetId = xHighlight.tweetId;
          }
          if (!trendContentKey) {
            trendContentKey = this.buildTrendContentKey("video", `${xHighlight.username}|${xHighlight.tweetId}`);
            usedTrendKeys.push(trendContentKey);
          }
          continue;
        }
        const platformVideoUrl = shouldUseVideoMode && !allowThirdPartyHighlightVideoRepublish ? platform === "facebook" || platform === "instagram" ? ownedBwinHighlightVideoUrl || "" : "" : effectiveTrendVideoUrl || "";
        const useVideo = shouldUseVideoMode && Boolean(platformVideoUrl) && videoCapablePlatforms.has(platform) && (allowThirdPartyHighlightVideoRepublish || (platform === "facebook" || platform === "instagram") && Boolean(ownedBwinHighlightVideoUrl));
        const effectivePublisher = platform === "instagram" && useVideo ? publishToInstagramReel : publisher;
        const response = await effectivePublisher({
          caption: perPlatformCaption,
          imageUrls: useVideo ? [] : imageUrls,
          videoUrl: useVideo ? platformVideoUrl || void 0 : void 0,
          credentials
        });
        results.push({ platform, status: "posted", remoteId: response.remoteId ?? null });
        historyEntries.push({
          platform,
          status: "posted",
          caption: perPlatformCaption,
          remoteId: response.remoteId ?? null,
          videoUrl: useVideo ? platformVideoUrl || void 0 : void 0
        });
      } catch (error) {
        const message = error?.message ?? "publish_failed";
        results.push({ platform, status: "failed", error: message });
        historyEntries.push({ platform, status: "failed", caption, errorMessage: message });
      }
    }
    const nextRecentTrendKeys = usedTrendKeys.length ? this.mergeTrendRecentKeys(trendRecentKeys, usedTrendKeys) : trendRecentKeys;
    const trendJobNext = {
      ...job,
      ...nextRecord,
      trendLastContentType: selectedContentType,
      ...trendContentKey ? { trendLastContentKey: trendContentKey } : {},
      ...nextRecentTrendKeys.length ? { trendRecentKeys: nextRecentTrendKeys } : {},
      ...typeof nextTrendSlotCursor === "number" ? { trendSlotCursor: nextTrendSlotCursor } : {},
      ...typeof usedTableCursor === "number" ? { trendTableCursor: usedTableCursor } : {},
      ...usedXHighlightTweetId ? { xLastHighlightTweetId: usedXHighlightTweetId } : {},
      ...usedXHighlightUsername ? { xLastHighlightUsername: usedXHighlightUsername } : {},
      ...typeof usedXHighlightAccountCursor === "number" ? { xHighlightAccountCursor: usedXHighlightAccountCursor } : {},
      ...usedXWeeklyAwardTweetId ? { xLastWeeklyAwardTweetId: usedXWeeklyAwardTweetId } : {}
    };
    try {
      await autopostCollection.doc(userId).set(
        {
          ...nextRecord,
          trendLastContentType: selectedContentType,
          ...trendContentKey ? { trendLastContentKey: trendContentKey } : {},
          ...nextRecentTrendKeys.length ? { trendRecentKeys: nextRecentTrendKeys } : {},
          ...typeof nextTrendSlotCursor === "number" ? { trendSlotCursor: nextTrendSlotCursor } : {},
          ...typeof usedTableCursor === "number" ? { trendTableCursor: usedTableCursor } : {},
          ...usedXHighlightTweetId ? { xLastHighlightTweetId: usedXHighlightTweetId } : {},
          ...usedXHighlightUsername ? { xLastHighlightUsername: usedXHighlightUsername } : {},
          ...typeof usedXHighlightAccountCursor === "number" ? { xHighlightAccountCursor: usedXHighlightAccountCursor } : {},
          ...usedXWeeklyAwardTweetId ? { xLastWeeklyAwardTweetId: usedXWeeklyAwardTweetId } : {},
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );
    } catch (error) {
      console.warn("[autopost] firestore trend update failed", error);
    }
    await this.mirrorAutopostJob(userId, trendJobNext);
    await this.recordHistory(userId, historyEntries, imageUrls);
    return {
      posted: results.filter((result) => result.status === "posted").length,
      failed: results.filter((result) => result.status === "failed"),
      nextRun: nextRunDate.toISOString()
    };
  }
  async executeJob(userId, job, options = {}) {
    if (await isBwinAccountClosureActive(userId)) {
      const closureState = await getBwinAccountClosureState(userId);
      const message = getBwinAccountClosureMessage(closureState);
      await this.stopBwinAutomation(userId, job, message);
      return {
        posted: 0,
        failed: [{ platform: "autopost", status: "failed", error: message }],
        nextRun: null
      };
    }
    const isReelsRun = (options.nextRunField ?? "nextRun") === "reelsNextRun";
    const isStoryRun = (options.nextRunField ?? "nextRun") === "storyNextRun";
    const configuredIntervalHours = options.intervalHours ?? (isReelsRun ? job.reelsIntervalHours : isStoryRun ? job.storyIntervalHours : job.intervalHours);
    const intervalHours = isReelsRun ? this.getReelsIntervalHours(userId, configuredIntervalHours) : isStoryRun ? this.getStoryIntervalHours(userId, configuredIntervalHours) : this.getFeedIntervalHours(userId, configuredIntervalHours);
    const effectiveIntervalHours = Math.max(intervalHours, isReelsRun ? 0.25 : 0.05);
    const requestedPlatforms = options.platforms ?? job.platforms ?? [];
    const platforms = requestedPlatforms.filter(
      (platform) => !this.shouldSkipNicheInstagramAttempt(userId, job, platform)
    );
    const instagramAttemptFields = new Set(
      platforms.map((platform) => this.getInstagramAttemptField(platform)).filter((field) => Boolean(field))
    );
    const nextRunField = options.nextRunField ?? "nextRun";
    const lastRunField = options.lastRunField ?? "lastRunAt";
    const resultField = options.resultField ?? "lastResult";
    const clientFallbackProfile = this.getClientFallbackProfile(userId);
    const useGenericVideoFallback = options.useGenericVideoFallback !== false && !clientFallbackProfile;
    if (!platforms.length) {
      const nextRunDate2 = new Date(Date.now() + effectiveIntervalHours * 60 * 60 * 1e3);
      const updatePayload2 = {
        [lastRunField]: admin.firestore.FieldValue.serverTimestamp(),
        [resultField]: [],
        [nextRunField]: admin.firestore.Timestamp.fromDate(nextRunDate2),
        active: job.active !== false,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };
      try {
        await autopostCollection.doc(userId).set(updatePayload2, { merge: true });
      } catch (error) {
        console.warn("[autopost] firestore no-platform update failed", error);
      }
      await this.mirrorAutopostJob(userId, {
        ...job,
        active: job.active !== false,
        [lastRunField]: admin.firestore.Timestamp.now(),
        [resultField]: [],
        [nextRunField]: admin.firestore.Timestamp.fromDate(nextRunDate2)
      });
      return { posted: 0, failed: [], nextRun: nextRunDate2.toISOString() };
    }
    if (this.isBwinScopeUser(userId) && !isReelsRun && !isStoryRun) {
      const feedPlatforms = platforms.filter(
        (platform) => ["facebook", "instagram", "threads", "x", "twitter"].includes(platform)
      );
      if (!feedPlatforms.length) {
        return { posted: 0, failed: [], nextRun: null };
      }
      const trendOutcome = await this.executeTrendPosts(userId, {
        ...job,
        trendEnabled: true,
        trendPlatforms: feedPlatforms,
        trendStructuredScheduleEnabled: false,
        trendContentCycle: ["news"]
      });
      const nextRunDate2 = new Date(Date.now() + effectiveIntervalHours * 60 * 60 * 1e3);
      const updatedTrendSnap = await autopostCollection.doc(userId).get();
      const updatedTrendResult = updatedTrendSnap.data()?.trendLastResult;
      const result = Array.isArray(updatedTrendResult) ? updatedTrendResult : trendOutcome.failed;
      try {
        await autopostCollection.doc(userId).set(
          {
            [lastRunField]: admin.firestore.FieldValue.serverTimestamp(),
            [resultField]: result,
            [nextRunField]: admin.firestore.Timestamp.fromDate(nextRunDate2),
            active: job.active !== false,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          },
          { merge: true }
        );
      } catch (error) {
        console.warn("[autopost] firestore Bwin news-only feed update failed", error);
      }
      await this.mirrorAutopostJob(userId, {
        ...job,
        [lastRunField]: admin.firestore.Timestamp.now(),
        [resultField]: result,
        [nextRunField]: admin.firestore.Timestamp.fromDate(nextRunDate2),
        active: job.active !== false
      });
      return {
        posted: trendOutcome.posted,
        failed: trendOutcome.failed,
        nextRun: nextRunDate2.toISOString()
      };
    }
    const credentials = await this.resolveCredentials(userId);
    const missingCredentialFailures = platforms.filter((platform) => !this.hasCredentialsForPlatform(platform, credentials)).map((platform) => ({
      platform,
      status: "failed",
      error: `missing_${platform}_credentials`
    }));
    const publishPlatforms = platforms.filter((platform) => this.hasCredentialsForPlatform(platform, credentials));
    if (!publishPlatforms.length) {
      const nextRunDate2 = new Date(Date.now() + effectiveIntervalHours * 60 * 60 * 1e3);
      this.cacheJob(userId, {
        ...job,
        active: job.active !== false,
        [lastRunField]: admin.firestore.Timestamp.now(),
        [resultField]: missingCredentialFailures,
        [nextRunField]: admin.firestore.Timestamp.fromDate(nextRunDate2)
      });
      return {
        posted: 0,
        failed: missingCredentialFailures,
        nextRun: nextRunDate2.toISOString()
      };
    }
    const videoPlatforms = /* @__PURE__ */ new Set(["youtube", "tiktok", "instagram_reels"]);
    const optionalVideoPlatforms = /* @__PURE__ */ new Set([
      "facebook",
      "facebook_story",
      "instagram_story",
      "linkedin",
      "twitter",
      "x",
      "threads"
    ]);
    const enableYouTubeShorts = this.useYouTubeShorts(job);
    const isBwinUser = this.isBwinScopeUser(userId);
    const basePrompt = job.prompt ?? (isBwinUser ? "Create a sharp football matchday visual featuring real match energy, players in action, stadium atmosphere, and clean editorial sports composition." : "Create a realistic, photo-style scene of the Dott Media AI Sales Bot interacting with people in an executive suite; friendly humanoid robot wearing a tie and glasses, assisting a diverse team, natural expressions, premium interior finishes, cinematic depth, subtle futuristic UI overlays, clean space reserved for a headline.");
    let runPrompt = isBwinUser ? this.buildBwinVisualPrompt(basePrompt) : this.buildVisualPrompt(this.applyNeonPreference(basePrompt));
    const businessType = job.businessType ?? (isBwinUser ? "Sports betting brand" : "AI CRM + automation agency");
    const scheduledHistory = await this.getScheduledPostContentHistory(userId);
    const recentImages = this.mergeRecentImages(this.getRecentImageHistory(job), [
      ...scheduledHistory.imageUrls,
      ...scheduledHistory.contentKeys
    ]);
    const recentSet = new Set(recentImages);
    const fallbackVideoPool = this.getFallbackVideoPool();
    const genericVideoSelection = useGenericVideoFallback ? this.selectNextGenericVideo(job, fallbackVideoPool) : { videoUrl: void 0, nextCursor: void 0 };
    const hasGenericVideo = Boolean(genericVideoSelection.videoUrl);
    const needsImages = publishPlatforms.some((platform) => {
      if (videoPlatforms.has(platform)) return false;
      if (optionalVideoPlatforms.has(platform) && hasGenericVideo) return false;
      return true;
    });
    const clientPhotoProfile = needsImages ? clientFallbackProfile : null;
    const requireAiImages = needsImages ? isBwinUser || clientPhotoProfile ? false : this.requireAiImages(job) : false;
    const maxImageAttempts = Math.max(Number(process.env.AUTOPOST_IMAGE_ATTEMPTS ?? 3), 1);
    const fallbackCopy = this.buildFallbackCopy(job, userId);
    let generated = options.generatedContent ? {
      ...options.generatedContent,
      images: Array.isArray(options.generatedContent.images) ? options.generatedContent.images.filter(Boolean) : []
    } : null;
    let generationError = null;
    if (!generated && clientPhotoProfile) {
      generated = {
        images: [],
        caption_instagram: "",
        caption_linkedin: "",
        caption_x: "",
        hashtags_instagram: "",
        hashtags_generic: ""
      };
    }
    if (!generated && !needsImages) {
      generated = {
        images: [],
        caption_instagram: fallbackCopy.caption,
        caption_linkedin: fallbackCopy.caption,
        caption_x: fallbackCopy.caption,
        hashtags_instagram: fallbackCopy.hashtags,
        hashtags_generic: fallbackCopy.hashtags
      };
    }
    if (!generated) {
      for (let attempt = 0; attempt < maxImageAttempts; attempt += 1) {
        try {
          generated = await contentGenerationService.generateContent({ prompt: runPrompt, businessType, imageCount: 1 });
          generationError = null;
        } catch (error) {
          generationError = error;
          console.error("[autopost] generation failed", error);
        }
        const fresh = this.selectFreshImages(generated?.images ?? [], recentSet);
        if (fresh.length && generated) {
          generated.images = fresh;
          break;
        }
        runPrompt = isBwinUser ? this.buildBwinVisualPrompt(basePrompt) : this.buildVisualPrompt(basePrompt);
      }
      if (!generated) {
        if (generationError) {
          console.warn("[autopost] using fallback content after generation failures");
        }
        generated = {
          images: [],
          caption_instagram: "",
          caption_linkedin: "",
          caption_x: "",
          hashtags_instagram: "",
          hashtags_generic: ""
        };
      }
    }
    const results = [...missingCredentialFailures];
    const finalGenerated = generated;
    let imageUrls = needsImages ? options.generatedContent ? this.resolveApprovedImageUrls(finalGenerated.images ?? [], recentSet, requireAiImages, userId) : this.resolveImageUrls(finalGenerated.images ?? [], recentSet, requireAiImages, userId) : [];
    const recentVideos = this.mergeRecentVideos(this.getRecentVideoHistory(job), scheduledHistory.videoUrls);
    const recentVideoSet = new Set(recentVideos);
    const cursorUpdates = {};
    let usedGenericVideo = false;
    const recentCaptions = this.mergeRecentCaptions(this.getRecentCaptionHistory(job), [
      ...scheduledHistory.captions,
      ...scheduledHistory.contentKeys
    ]);
    const captionHistory = new Set(recentCaptions);
    const usedCaptions = [];
    const historyEntries = [];
    let usedClientSourceImageUrl = null;
    let carmarketVehicleCaption = null;
    let usedBeforwardStockKey = null;
    let staysphereListingCaption = null;
    let usedStaysphereListingKey = null;
    let gamersSteamCaption = null;
    let usedGamersSteamKey = null;
    let dottEnergyProductCaption = null;
    let usedDottEnergyProductKey = null;
    let clientInstagramSourceImageUrls = [];
    if (clientPhotoProfile?.key === "carmarketplace" && needsImages) {
      try {
        const recentStockNos = new Set(
          [...recentImages, ...recentCaptions].map((value) => {
            const stockKey = String(value).match(/beforward-stock:([^\s,]+)/i)?.[1]?.toUpperCase();
            if (stockKey) return stockKey;
            return String(value).match(/\b[A-Z]{2}\d{6}\b/i)?.[0]?.toUpperCase();
          }).filter((value) => Boolean(value))
        );
        const vehicle = await pickCarmarketVehicle({ recentStockNos });
        const vehicleImages = vehicle.images.slice(0, isStoryRun ? 1 : 10);
        clientInstagramSourceImageUrls = vehicleImages.slice(0, isStoryRun ? 1 : 5);
        if (isStoryRun) {
          imageUrls = clientInstagramSourceImageUrls;
          carmarketVehicleCaption = buildCarmarketVehicleCaption(vehicle);
          usedBeforwardStockKey = vehicle.stockNo ? `beforward-stock:${vehicle.stockNo}` : null;
        } else {
          const coverImageUrl = await renderCarmarketCoverImage(vehicle).catch((error) => {
            console.warn("[autopost] Carmarket cover image render failed; skipping vehicle listing to avoid raw cover", {
              userId,
              error: error instanceof Error ? error.message : String(error)
            });
            return null;
          });
          if (!coverImageUrl) {
            throw new Error("carmarket_cover_render_failed");
          }
          const preparedVehicleImages = await Promise.all(
            vehicleImages.slice(1, 5).map(async (imageUrl) => {
              try {
                return await prepareCarmarketVehicleImage(imageUrl);
              } catch (error) {
                console.warn("[autopost] Carmarket listing image preparation failed; skipping raw source URL", {
                  userId,
                  imageUrl,
                  error: error instanceof Error ? error.message : String(error)
                });
                return null;
              }
            })
          );
          imageUrls = [coverImageUrl, ...preparedVehicleImages.filter((url) => Boolean(url))];
          carmarketVehicleCaption = buildCarmarketVehicleCaption(vehicle);
          usedBeforwardStockKey = vehicle.stockNo ? `beforward-stock:${vehicle.stockNo}` : null;
        }
      } catch (error) {
        console.warn("[autopost] BE FORWARD vehicle lookup failed; using client photo fallback", {
          userId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    if (clientPhotoProfile?.key === "staysphere" && needsImages) {
      try {
        const recentListingKeysOrdered = [...recentImages, ...recentCaptions].map((value) => String(value).match(/staysphere-listing:[^\s]+/i)?.[0]?.toLowerCase()).filter((value) => Boolean(value));
        const listing = await pickStaysphereListing({
          recentListingKeys: new Set(recentListingKeysOrdered),
          recentListingKeysOrdered
        });
        const listingImages = listing.images.slice(0, isStoryRun ? 1 : 5);
        clientInstagramSourceImageUrls = listingImages.slice(0, isStoryRun ? 1 : 5);
        const coverImageUrl = await renderStaysphereCoverImage(
          listing,
          listingImages[0],
          isStoryRun ? "story" : "feed"
        ).catch((error) => {
          console.warn("[autopost] Staysphere cover image render failed; using raw listing cover", {
            userId,
            error: error instanceof Error ? error.message : String(error)
          });
          return null;
        });
        const preparedListingImages = await Promise.all(
          listingImages.slice(coverImageUrl ? 1 : 0).map(async (imageUrl) => {
            try {
              return await prepareStaysphereListingImage(imageUrl);
            } catch (error) {
              console.warn("[autopost] Staysphere listing image preparation failed; skipping raw source URL", {
                userId,
                imageUrl,
                error: error instanceof Error ? error.message : String(error)
              });
              return null;
            }
          })
        );
        imageUrls = [
          ...coverImageUrl ? [coverImageUrl] : [],
          ...preparedListingImages.filter((value) => Boolean(value))
        ];
        staysphereListingCaption = buildStaysphereListingCaption(listing);
        usedStaysphereListingKey = staysphereListingHistoryKey(listing);
      } catch (error) {
        console.warn("[autopost] Staysphere Uganda listing lookup failed; source-only post will fail instead of using unrelated fallback", {
          userId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    if (clientPhotoProfile?.key === "gamers44life" && needsImages) {
      try {
        const recentSteamKeys = new Set(
          [...recentImages, ...recentCaptions].map((value) => String(value).match(/steam-game:\d+/i)?.[0]?.toLowerCase()).filter((value) => Boolean(value))
        );
        const steamPost = await pickGamersSteamScreenshots({ recentKeys: recentSteamKeys });
        imageUrls = steamPost.images.slice(0, isStoryRun ? 1 : 6);
        clientInstagramSourceImageUrls = imageUrls;
        gamersSteamCaption = buildGamersSteamCaption(steamPost);
        usedGamersSteamKey = gamersSteamHistoryKey(steamPost);
      } catch (error) {
        console.warn("[autopost] Gamers Steam screenshot lookup failed; using client photo fallback", {
          userId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    if (clientPhotoProfile?.key === "dottenergy" && needsImages) {
      const recentDottEnergyKeys = new Set(
        [...recentImages, ...recentCaptions].map((value) => String(value).match(/dott-energy-(?:product|poster|education):[^\s,]+/i)?.[0]?.toLowerCase()).filter((value) => Boolean(value))
      );
      const usePoster = shouldUseDottEnergyFallbackPoster();
      try {
        if (!isStoryRun) {
          const topic = pickDottEnergyEducationTopic({ recentKeys: recentDottEnergyKeys });
          imageUrls = [await renderDottEnergyEducationCard(topic)];
          dottEnergyProductCaption = buildDottEnergyEducationCaption(topic);
          usedDottEnergyProductKey = dottEnergyEducationHistoryKey(topic);
        } else if (usePoster) {
          const poster = pickDottEnergyFallbackPoster({ recentKeys: recentDottEnergyKeys });
          if (!poster) throw new Error("No Dott Energy fallback posters found");
          imageUrls = [await renderDottEnergyFallbackPoster(poster, isStoryRun ? "story" : "feed")];
          dottEnergyProductCaption = buildDottEnergyFallbackCaption();
          usedDottEnergyProductKey = dottEnergyFallbackPosterHistoryKey(poster);
        } else {
          const product = await pickDottEnergyProduct({ recentKeys: recentDottEnergyKeys });
          const coverImageUrl = await renderDottEnergyProductImage(
            product,
            product.images[0],
            isStoryRun ? "story" : "feed"
          );
          imageUrls = [coverImageUrl];
          clientInstagramSourceImageUrls = product.images.slice(0, 1);
          dottEnergyProductCaption = buildDottEnergyProductCaption(product);
          usedDottEnergyProductKey = dottEnergyProductHistoryKey(product);
        }
      } catch (error) {
        console.warn("[autopost] Dott Energy primary source failed; trying fallback poster", {
          userId,
          error: error instanceof Error ? error.message : String(error)
        });
        try {
          const poster = pickDottEnergyFallbackPoster({ recentKeys: recentDottEnergyKeys });
          if (!poster) throw new Error("No Dott Energy fallback posters found");
          imageUrls = [await renderDottEnergyFallbackPoster(poster, isStoryRun ? "story" : "feed")];
          dottEnergyProductCaption = buildDottEnergyFallbackCaption();
          usedDottEnergyProductKey = dottEnergyFallbackPosterHistoryKey(poster);
        } catch (fallbackError) {
          console.warn("[autopost] Dott Energy fallback poster failed; source-only post will fail instead of using unrelated fallback", {
            userId,
            error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
          });
        }
      }
    }
    if (clientPhotoProfile && clientPhotoProfile.key !== "staysphere" && clientPhotoProfile.key !== "dottenergy" && !carmarketVehicleCaption && !staysphereListingCaption && !gamersSteamCaption && !dottEnergyProductCaption) {
      const sourcedPhoto = await this.pickClientPhotoImageUrl(clientPhotoProfile, isStoryRun ? "story" : "feed", recentSet);
      if (sourcedPhoto) {
        usedClientSourceImageUrl = sourcedPhoto;
        const preparedPhoto = await this.prepareClientPhotoImageUrl(
          sourcedPhoto,
          clientPhotoProfile,
          isStoryRun ? "story" : "feed"
        );
        imageUrls = [preparedPhoto ?? sourcedPhoto];
      }
    }
    if (clientPhotoProfile && imageUrls.some((url) => this.isDefaultDottFallbackImage(url))) {
      imageUrls = await this.generateClientFallbackImageUrls(userId, job, isStoryRun, recentSet);
    }
    if (isBwinUser && needsImages) {
      imageUrls = await this.ensureBwinSafeImageUrls(imageUrls, finalGenerated, basePrompt);
    }
    if (needsImages && imageUrls.length === 0 && clientPhotoProfile?.key === "staysphere") {
      const nextRunDate2 = new Date(Date.now() + effectiveIntervalHours * 60 * 60 * 1e3);
      const failed = [
        ...missingCredentialFailures,
        ...publishPlatforms.map((platform) => ({
          platform,
          status: "failed",
          error: "staysphere_listing_source_unavailable"
        }))
      ];
      try {
        await autopostCollection.doc(userId).set(
          {
            [lastRunField]: admin.firestore.FieldValue.serverTimestamp(),
            [resultField]: failed,
            [nextRunField]: admin.firestore.Timestamp.fromDate(nextRunDate2),
            active: job.active !== false,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          },
          { merge: true }
        );
      } catch (error) {
        console.warn("[autopost] firestore Staysphere source failure update failed", error);
      }
      await this.recordHistory(userId, [], []);
      await this.mirrorAutopostJob(userId, {
        ...job,
        [lastRunField]: admin.firestore.Timestamp.now(),
        [resultField]: failed,
        [nextRunField]: admin.firestore.Timestamp.fromDate(nextRunDate2),
        active: job.active !== false
      });
      return {
        posted: 0,
        failed,
        nextRun: nextRunDate2.toISOString()
      };
    }
    if (needsImages && imageUrls.length === 0) {
      imageUrls = await this.generateClientFallbackImageUrls(userId, job, isStoryRun, recentSet);
    }
    if (requireAiImages && imageUrls.length === 0) {
      const nextRunDate2 = new Date(Date.now() + effectiveIntervalHours * 60 * 60 * 1e3);
      const failed = [
        ...missingCredentialFailures,
        ...publishPlatforms.map((platform) => ({
          platform,
          status: "failed",
          error: "ai_image_generation_failed"
        }))
      ];
      try {
        await autopostCollection.doc(userId).set(
          {
            lastRunAt: admin.firestore.FieldValue.serverTimestamp(),
            lastResult: failed,
            nextRun: admin.firestore.Timestamp.fromDate(nextRunDate2),
            active: job.active !== false,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          },
          { merge: true }
        );
      } catch (error) {
        console.warn("[autopost] firestore ai-image failure update failed", error);
      }
      await this.mirrorAutopostJob(userId, {
        ...job,
        lastRunAt: admin.firestore.Timestamp.now(),
        lastResult: failed,
        nextRun: admin.firestore.Timestamp.fromDate(nextRunDate2),
        active: job.active !== false
      });
      return {
        posted: 0,
        failed,
        nextRun: nextRunDate2.toISOString()
      };
    }
    for (const platform of publishPlatforms) {
      const publisher = platformPublishers[platform] ?? publishToTwitter;
      const isFeedCaptionPlatform = platform === "facebook" || platform === "instagram" || platform === "threads";
      const rawCaption = carmarketVehicleCaption && isFeedCaptionPlatform ? carmarketVehicleCaption : staysphereListingCaption && isFeedCaptionPlatform ? staysphereListingCaption : gamersSteamCaption && isFeedCaptionPlatform ? gamersSteamCaption : dottEnergyProductCaption && isFeedCaptionPlatform ? dottEnergyProductCaption : this.captionForPlatform(platform, finalGenerated, fallbackCopy);
      const shortsCaption = platform === "youtube" && enableYouTubeShorts ? this.ensureShortsCaption(rawCaption) : rawCaption;
      const trackedCaption = this.applyBwinBetTracking(shortsCaption, userId, platform);
      const cleanedCaption = this.sanitizeBwinInstagramCaptionLinks(trackedCaption, platform);
      const brandedCaption = this.applyBwinInstagramSportsHashtags(cleanedCaption, platform);
      const threadSafeCaption = this.limitThreadsCaption(platform, brandedCaption);
      let captionSelection = carmarketVehicleCaption || staysphereListingCaption || gamersSteamCaption || dottEnergyProductCaption ? { caption: threadSafeCaption, signature: this.buildCaptionSignature(platform, threadSafeCaption) } : this.ensureCaptionVariety(platform, brandedCaption, captionHistory, userId);
      let caption = this.limitThreadsCaption(platform, captionSelection.caption);
      let signature = caption === captionSelection.caption ? captionSelection.signature : this.buildCaptionSignature(platform, caption);
      const isVideoPlatform = videoPlatforms.has(platform);
      const supportsVideo = isVideoPlatform || optionalVideoPlatforms.has(platform);
      let videoUrl;
      let videoTitle;
      const privacyStatus = platform === "youtube" ? job.youtubePrivacyStatus : void 0;
      const tags = platform === "youtube" && enableYouTubeShorts ? ["shorts"] : void 0;
      if (supportsVideo && isVideoPlatform) {
        const platformSelection = await this.selectNextVideo(
          job,
          platform,
          fallbackVideoPool,
          userId,
          recentVideoSet
        );
        if (platformSelection.videoUrl) {
          videoUrl = platformSelection.videoUrl;
          if (platformSelection.caption) {
            caption = this.limitThreadsCaption(platform, platformSelection.caption);
            signature = this.buildCaptionSignature(platform, caption);
          }
          if (platform === "youtube" && typeof platformSelection.nextCursor === "number") {
            cursorUpdates.youtubeVideoCursor = platformSelection.nextCursor;
          }
          if (platform === "tiktok" && typeof platformSelection.nextCursor === "number") {
            cursorUpdates.tiktokVideoCursor = platformSelection.nextCursor;
          }
          if (platform === "instagram_reels" && typeof platformSelection.nextCursor === "number") {
            cursorUpdates.reelsVideoCursor = platformSelection.nextCursor;
          }
        } else if (genericVideoSelection.videoUrl && useGenericVideoFallback && platform !== "instagram_reels") {
          videoUrl = genericVideoSelection.videoUrl;
          usedGenericVideo = true;
        }
        videoTitle = platform === "youtube" ? job.videoTitle?.trim() : void 0;
        if (platform === "youtube" && enableYouTubeShorts && videoTitle) {
          videoTitle = this.ensureShortsTitle(videoTitle);
        }
      } else if (supportsVideo && genericVideoSelection.videoUrl) {
        videoUrl = genericVideoSelection.videoUrl;
        usedGenericVideo = true;
      }
      if (isVideoPlatform && !videoUrl) {
        const errorMessage = platform === "youtube" ? "Missing YouTube video URL" : platform === "tiktok" ? "Missing TikTok video URL" : "Missing Instagram Reels video URL";
        results.push({ platform, status: "failed", error: errorMessage });
        historyEntries.push({ platform, status: "failed", caption, errorMessage });
        continue;
      }
      const bwinValidation = validateBwinSportsContent({
        userId,
        platform,
        caption,
        videoTitle,
        imageUrls: videoUrl ? [] : imageUrls,
        videoUrl
      });
      if (!bwinValidation.ok) {
        const errorMessage = bwinValidation.reason ?? "Bwinbet auto-post content must stay sports-only.";
        results.push({ platform, status: "failed", error: errorMessage });
        historyEntries.push({ platform, status: "failed", caption, errorMessage, videoUrl, videoTitle });
        continue;
      }
      try {
        const hasLocalGeneratedImages = imageUrls.some((url) => /\/public\/generated-media\//i.test(url));
        const publishImageUrls = videoUrl ? [] : hasLocalGeneratedImages && clientInstagramSourceImageUrls.length && (platform === "instagram" || platform === "instagram_story") ? clientInstagramSourceImageUrls : clientPhotoProfile?.key === "staysphere" && platform === "facebook" ? imageUrls.slice(0, 1) : imageUrls;
        if (!videoUrl && (platform === "instagram" || platform === "instagram_story") && publishImageUrls.some((url) => /\/public\/generated-media\//i.test(url))) {
          const errorMessage = "instagram_requires_durable_public_media_url";
          results.push({ platform, status: "failed", error: errorMessage });
          historyEntries.push({ platform, status: "failed", caption, errorMessage });
          continue;
        }
        const response = await publisher({
          caption,
          imageUrls: publishImageUrls,
          videoUrl,
          videoTitle,
          privacyStatus,
          tags,
          credentials
        });
        results.push({ platform, status: "posted", remoteId: response?.remoteId ?? null });
        usedCaptions.push(signature);
        captionHistory.add(signature);
        historyEntries.push({
          platform,
          status: "posted",
          caption,
          remoteId: response?.remoteId ?? null,
          videoUrl,
          videoTitle
        });
      } catch (error) {
        let retryError = error;
        if (platform === "instagram_reels") {
          const retryCursor = typeof cursorUpdates.reelsVideoCursor === "number" ? cursorUpdates.reelsVideoCursor : job.reelsVideoCursor;
          if (typeof retryCursor === "number") {
            const retrySelection = await this.selectNextVideo(
              { ...job, reelsVideoCursor: retryCursor },
              "instagram_reels",
              fallbackVideoPool,
              userId,
              new Set([...recentVideoSet, videoUrl].filter(Boolean))
            );
            if (retrySelection.videoUrl && retrySelection.videoUrl !== videoUrl) {
              try {
                const retryResponse = await publisher({
                  caption,
                  imageUrls: [],
                  videoUrl: retrySelection.videoUrl,
                  videoTitle,
                  privacyStatus,
                  tags,
                  credentials
                });
                if (typeof retrySelection.nextCursor === "number") {
                  cursorUpdates.reelsVideoCursor = retrySelection.nextCursor;
                }
                results.push({ platform, status: "posted", remoteId: retryResponse?.remoteId ?? null });
                usedCaptions.push(signature);
                captionHistory.add(signature);
                historyEntries.push({
                  platform,
                  status: "posted",
                  caption,
                  remoteId: retryResponse?.remoteId ?? null,
                  videoUrl: retrySelection.videoUrl,
                  videoTitle
                });
                continue;
              } catch (retry) {
                retryError = retry;
              }
            }
          }
        }
        const errorMessage = retryError?.message ?? "publish_failed";
        results.push({ platform, status: "failed", error: errorMessage });
        historyEntries.push({ platform, status: "failed", caption, errorMessage, videoUrl, videoTitle });
      }
    }
    const nextRunDate = new Date(Date.now() + effectiveIntervalHours * 60 * 60 * 1e3);
    const nextRecentImages = this.mergeRecentImages(
      recentImages,
      [
        ...imageUrls,
        usedClientSourceImageUrl,
        usedBeforwardStockKey,
        usedStaysphereListingKey,
        usedGamersSteamKey,
        usedDottEnergyProductKey
      ].filter((url) => Boolean(url))
    );
    const postedVideoUrls = historyEntries.filter((entry) => entry.status === "posted").map((entry) => entry.videoUrl?.trim()).filter((url) => Boolean(url));
    const nextRecentVideos = this.mergeRecentVideos(recentVideos, postedVideoUrls);
    const nextRecentCaptions = this.mergeRecentCaptions(
      recentCaptions,
      [
        ...usedCaptions,
        usedBeforwardStockKey,
        usedStaysphereListingKey,
        usedGamersSteamKey,
        usedDottEnergyProductKey
      ].filter((value) => Boolean(value))
    );
    if (usedGenericVideo && typeof genericVideoSelection.nextCursor === "number") {
      cursorUpdates.videoCursor = genericVideoSelection.nextCursor;
    }
    const updatePayload = {
      [lastRunField]: admin.firestore.FieldValue.serverTimestamp(),
      [resultField]: results,
      [nextRunField]: admin.firestore.Timestamp.fromDate(nextRunDate),
      active: job.active !== false,
      recentImageUrls: nextRecentImages,
      recentVideoUrls: nextRecentVideos,
      recentCaptions: nextRecentCaptions,
      ...cursorUpdates,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    for (const field of instagramAttemptFields) {
      updatePayload[field] = admin.firestore.FieldValue.serverTimestamp();
    }
    if (!isReelsRun && !isStoryRun) {
      updatePayload.intervalHours = effectiveIntervalHours;
    } else if (isReelsRun) {
      updatePayload.reelsIntervalHours = effectiveIntervalHours;
    } else if (isStoryRun) {
      updatePayload.storyIntervalHours = effectiveIntervalHours;
    }
    try {
      await autopostCollection.doc(userId).set(updatePayload, { merge: true });
    } catch (error) {
      console.warn("[autopost] firestore executeJob update failed", error);
    }
    await this.recordHistory(userId, historyEntries, imageUrls);
    const nextRecord = {
      ...job,
      active: job.active !== false,
      recentImageUrls: nextRecentImages,
      recentVideoUrls: nextRecentVideos,
      recentCaptions: nextRecentCaptions,
      [resultField]: results,
      videoCursor: usedGenericVideo && typeof genericVideoSelection.nextCursor === "number" ? genericVideoSelection.nextCursor : job.videoCursor,
      youtubeVideoCursor: typeof cursorUpdates.youtubeVideoCursor === "number" ? cursorUpdates.youtubeVideoCursor : job.youtubeVideoCursor,
      tiktokVideoCursor: typeof cursorUpdates.tiktokVideoCursor === "number" ? cursorUpdates.tiktokVideoCursor : job.tiktokVideoCursor,
      reelsVideoCursor: typeof cursorUpdates.reelsVideoCursor === "number" ? cursorUpdates.reelsVideoCursor : job.reelsVideoCursor
    };
    for (const field of instagramAttemptFields) {
      nextRecord[field] = admin.firestore.Timestamp.now();
    }
    if (!isReelsRun && !isStoryRun) {
      nextRecord.intervalHours = effectiveIntervalHours;
    } else if (isReelsRun) {
      nextRecord.reelsIntervalHours = effectiveIntervalHours;
    } else if (isStoryRun) {
      nextRecord.storyIntervalHours = effectiveIntervalHours;
    }
    if (nextRunField === "nextRun") {
      nextRecord.lastRunAt = admin.firestore.Timestamp.now();
      nextRecord.nextRun = admin.firestore.Timestamp.fromDate(nextRunDate);
    } else if (nextRunField === "reelsNextRun") {
      nextRecord.reelsLastRunAt = admin.firestore.Timestamp.now();
      nextRecord.reelsNextRun = admin.firestore.Timestamp.fromDate(nextRunDate);
    } else {
      nextRecord.storyLastRunAt = admin.firestore.Timestamp.now();
      nextRecord.storyNextRun = admin.firestore.Timestamp.fromDate(nextRunDate);
    }
    await this.mirrorAutopostJob(userId, nextRecord);
    return {
      posted: results.filter((result) => result.status === "posted").length,
      failed: results.filter((result) => result.status === "failed"),
      nextRun: nextRunDate.toISOString()
    };
  }
  async recordHistory(userId, entries, imageUrls) {
    if (!entries.length) return;
    const targetDate = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const scheduledFor = admin.firestore.Timestamp.now();
    const now = /* @__PURE__ */ new Date();
    const fallbackRows = entries.map((entry) => {
      const isVideoPlatform = entry.platform === "youtube" || entry.platform === "tiktok" || entry.platform === "instagram_reels";
      return {
        id: scheduledPostsCollection.doc().id,
        userId,
        platform: entry.platform,
        caption: entry.caption,
        hashtags: "",
        imageUrls: isVideoPlatform ? [] : imageUrls,
        scheduledFor: now,
        targetDate,
        status: entry.status,
        createdAt: now,
        postedAt: entry.status === "posted" ? now : null,
        errorMessage: entry.errorMessage ?? null,
        remoteId: entry.remoteId ?? null,
        source: "autopost",
        videoUrl: entry.videoUrl,
        videoTitle: entry.videoTitle
      };
    });
    try {
      const batch = firestore.batch();
      fallbackRows.forEach((entry) => {
        const ref = scheduledPostsCollection.doc(entry.id);
        const isVideoPlatform = entry.platform === "youtube" || entry.platform === "tiktok" || entry.platform === "instagram_reels";
        const payload = {
          userId,
          platform: entry.platform,
          caption: entry.caption,
          hashtags: "",
          imageUrls: isVideoPlatform ? [] : imageUrls,
          scheduledFor,
          targetDate,
          status: entry.status,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          postedAt: entry.status === "posted" ? admin.firestore.FieldValue.serverTimestamp() : null,
          errorMessage: entry.errorMessage ?? null,
          remoteId: entry.remoteId ?? null,
          source: "autopost"
        };
        if (entry.videoUrl) {
          payload.videoUrl = entry.videoUrl;
        }
        if (entry.videoTitle) {
          payload.videoTitle = entry.videoTitle;
        }
        batch.set(ref, payload);
      });
      await batch.commit();
      await Promise.all(
        entries.map(
          (entry) => socialAnalyticsService.incrementDaily({
            userId,
            platform: entry.platform,
            status: entry.status
          })
        )
      );
    } catch (error) {
      console.warn("[autopost] failed to record history", error);
    }
    try {
      await supabaseFallbackService.upsertScheduledPosts(fallbackRows);
    } catch (error) {
      console.warn("[autopost] failed to mirror history to supabase", logSafeError(error));
    }
  }
  async resolveCredentials(userId) {
    let userData;
    try {
      const userDoc = await firestore.collection("users").doc(userId).get();
      userData = userDoc.data();
      if (userData?.socialAccounts) {
        void supabaseFallbackService.upsertSocialAccounts(userId, {
          email: userData.email ?? null,
          socialAccounts: userData.socialAccounts
        }).catch((error) => console.warn("[autopost] supabase social account mirror failed", logSafeError(error)));
      }
    } catch (error) {
      console.warn("[autopost] user credential lookup failed; using runtime fallbacks", {
        userId,
        error: error instanceof Error ? error.message : String(error)
      });
      try {
        const fallback = await supabaseFallbackService.getSocialAccounts(userId);
        if (fallback) {
          userData = fallback;
        }
      } catch (fallbackError) {
        console.warn("[autopost] supabase social account lookup failed", logSafeError(fallbackError));
      }
    }
    const allowDefaults = !this.isNicheClientAccount(userId) && canUsePrimarySocialDefaults(userData, userId);
    const defaults = this.defaultSocialAccounts(allowDefaults);
    const userAccounts = userData?.socialAccounts ?? {};
    const runtimeFallbackAccounts = await this.getRuntimeFallbackAccounts(userId);
    const merged = { ...defaults, ...runtimeFallbackAccounts, ...userAccounts };
    if (allowDefaults && !merged.facebook && config.channels.facebook.pageToken) {
      try {
        const resolved = await resolveFacebookPageId(
          config.channels.facebook.pageToken,
          config.channels.facebook.pageId || void 0
        );
        if (resolved?.pageId) {
          merged.facebook = {
            accessToken: resolved.pageToken?.trim() || config.channels.facebook.pageToken,
            pageId: resolved.pageId,
            ...resolved.pageName ? { pageName: resolved.pageName } : {}
          };
        }
      } catch (error) {
        console.warn("[autopost] failed to resolve primary facebook page from fallback token", {
          userId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    if (this.isNicheClientAccount(userId)) {
      return merged;
    }
    try {
      const youtubeIntegration = await getYouTubeIntegrationSecrets(userId);
      if (youtubeIntegration) {
        merged.youtube = {
          refreshToken: youtubeIntegration.refreshToken,
          accessToken: youtubeIntegration.accessToken,
          privacyStatus: youtubeIntegration.privacyStatus,
          channelId: youtubeIntegration.channelId ?? void 0
        };
      }
    } catch (error) {
      console.warn("[autopost] youtube integration lookup failed", {
        userId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
    try {
      const tiktokIntegration = await getTikTokIntegrationSecrets(userId);
      if (tiktokIntegration) {
        merged.tiktok = {
          accessToken: tiktokIntegration.accessToken,
          refreshToken: tiktokIntegration.refreshToken,
          openId: tiktokIntegration.openId ?? void 0
        };
      }
    } catch (error) {
      console.warn("[autopost] tiktok integration lookup failed", {
        userId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
    return merged;
  }
  defaultSocialAccounts(allowDefaults) {
    const defaults = {};
    if (allowDefaults && config.channels.facebook.pageId && config.channels.facebook.pageToken) {
      defaults.facebook = { accessToken: config.channels.facebook.pageToken, pageId: config.channels.facebook.pageId };
    }
    if (allowDefaults && config.channels.instagram.businessId && config.channels.instagram.accessToken) {
      defaults.instagram = { accessToken: config.channels.instagram.accessToken, accountId: config.channels.instagram.businessId };
    }
    if (allowDefaults && config.linkedin.accessToken && config.linkedin.organizationId) {
      defaults.linkedin = {
        accessToken: config.linkedin.accessToken,
        urn: `urn:li:organization:${config.linkedin.organizationId}`
      };
    }
    if (allowDefaults && config.tiktok.accessToken && config.tiktok.openId) {
      defaults.tiktok = {
        accessToken: config.tiktok.accessToken,
        openId: config.tiktok.openId,
        clientKey: config.tiktok.clientKey || void 0,
        clientSecret: config.tiktok.clientSecret || void 0
      };
    }
    return defaults;
  }
  captionForPlatform(platform, content, fallbackCopy) {
    const captions = {
      instagram: content.caption_instagram,
      instagram_reels: content.caption_instagram,
      instagram_story: content.caption_instagram,
      threads: content.caption_instagram,
      tiktok: content.caption_instagram,
      facebook: content.caption_linkedin,
      facebook_story: content.caption_instagram,
      linkedin: content.caption_linkedin,
      twitter: content.caption_x,
      x: content.caption_x,
      youtube: content.caption_linkedin
    };
    const chosen = (captions[platform] ?? content.caption_linkedin ?? content.caption_instagram ?? "").trim();
    const fallbackCaption = fallbackCopy.caption.trim();
    const caption = chosen.length ? chosen : fallbackCaption;
    const hasHashtags = /#[A-Za-z0-9_]+/.test(caption);
    const sourceHashtags = platform === "instagram" || platform === "instagram_reels" || platform === "instagram_story" || platform === "facebook_story" || platform === "threads" || platform === "tiktok" ? content.hashtags_instagram : content.hashtags_generic;
    const formattedSourceHashtags = this.formatHashtags(sourceHashtags);
    const formattedFallbackHashtags = this.formatHashtags(fallbackCopy.hashtags);
    const hashtags = hasHashtags ? "" : formattedSourceHashtags || formattedFallbackHashtags;
    if (platform === "twitter" || platform === "x") {
      return [caption, hashtags].filter(Boolean).join(" ");
    }
    return this.limitThreadsCaption(platform, [caption, hashtags].filter(Boolean).join("\n\n"));
  }
  limitThreadsCaption(platform, caption) {
    if (platform !== "threads" || caption.length <= 500) return caption;
    const hashtags = caption.match(/#[A-Za-z0-9_]+/g) ?? [];
    const suffix = hashtags.length ? `

${hashtags.slice(0, 4).join(" ")}` : "";
    const maxBodyLength = Math.max(1, 500 - suffix.length - 3);
    const body = caption.replace(/#[A-Za-z0-9_]+/g, "").replace(/\n{3,}/g, "\n\n").trim().slice(0, maxBodyLength).replace(/\s+\S*$/, "").trim();
    return `${body}...${suffix}`;
  }
  buildFallbackCopy(job, userId) {
    const isBwinUser = userId ? this.isBwinScopeUser(userId) : false;
    const caption = job.fallbackCaption?.trim() || (isBwinUser ? this.defaultBwinFallbackCaption : this.defaultFallbackCaption);
    let hashtags = job.fallbackHashtags?.trim() || (isBwinUser ? this.defaultBwinFallbackHashtags : this.defaultFallbackHashtags);
    if (!this.formatHashtags(hashtags)) {
      hashtags = isBwinUser ? this.defaultBwinFallbackHashtags : this.defaultFallbackHashtags;
    }
    return { caption, hashtags };
  }
  formatHashtags(raw) {
    if (!raw) return "";
    const tokens = raw.split(/[,\n]/g).map((token) => token.trim()).filter(Boolean).flatMap((token) => token.split(/\s+/).filter(Boolean)).map((token) => token.replace(/^#+/, "").replace(/[^A-Za-z0-9_]/g, "")).filter(Boolean);
    if (!tokens.length) return "";
    const seen = /* @__PURE__ */ new Set();
    const unique = tokens.filter((token) => {
      const key = token.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return unique.slice(0, 25).map((token) => `#${token}`).join(" ");
  }
  useYouTubeShorts(job) {
    if (typeof job.youtubeShorts === "boolean") return job.youtubeShorts;
    const flag = process.env.AUTOPOST_YOUTUBE_SHORTS?.toLowerCase();
    if (!flag) return false;
    return flag !== "false";
  }
  ensureShortsCaption(caption) {
    const trimmed = caption.trim();
    if (!trimmed) return "#Shorts";
    if (/#shorts\b/i.test(trimmed)) return trimmed;
    return `${trimmed}

#Shorts`;
  }
  ensureShortsTitle(title) {
    const trimmed = title.trim();
    if (!trimmed) return "#Shorts";
    if (/#shorts\b/i.test(trimmed)) return trimmed;
    return `${trimmed} #Shorts`;
  }
  parseFallbackUrls(raw) {
    if (!raw) return [];
    return raw.split(/[\r\n,]+/).map((item) => item.trim()).filter(Boolean);
  }
  getPublicBaseUrl() {
    const raw = process.env.BASE_URL ?? process.env.RENDER_EXTERNAL_URL ?? "";
    return raw.trim().replace(/\/+$/, "");
  }
  loadFallbackImagesFromDir(dir) {
    const baseUrl = this.getPublicBaseUrl();
    if (!baseUrl) {
      console.warn("[autopost] AUTOPOST_FALLBACK_DIR set but BASE_URL is missing; using other fallback sources.");
      return [];
    }
    try {
      const resolved = path.resolve(dir);
      const entries = fs.readdirSync(resolved, { withFileTypes: true });
      const images = entries.filter((entry) => entry.isFile()).map((entry) => entry.name).filter((name) => /\.(png|jpe?g|webp|gif)$/i.test(name));
      if (!images.length) {
        console.warn("[autopost] No fallback images found in AUTOPOST_FALLBACK_DIR; using other fallback sources.");
        return [];
      }
      return images.map((name) => `${baseUrl}/public/fallback-images/${encodeURIComponent(name)}`);
    } catch (error) {
      console.warn("[autopost] Failed to load fallback images; using other fallback sources.", error);
      return [];
    }
  }
  loadFallbackVideosFromDir(dir) {
    const baseUrl = this.getPublicBaseUrl();
    if (!baseUrl) {
      console.warn("[autopost] AUTOPOST_FALLBACK_VIDEO_DIR set but BASE_URL is missing; using other fallback sources.");
      return [];
    }
    try {
      const resolved = path.resolve(dir);
      const entries = fs.readdirSync(resolved, { withFileTypes: true });
      const videos = entries.filter((entry) => entry.isFile()).map((entry) => entry.name).filter((name) => /\.(mp4|mov|m4v|webm|avi|mkv)$/i.test(name));
      if (!videos.length) {
        console.warn("[autopost] No fallback videos found in AUTOPOST_FALLBACK_VIDEO_DIR; using other fallback sources.");
        return [];
      }
      return videos.map((name) => `${baseUrl}/public/fallback-videos/${encodeURIComponent(name)}`);
    } catch (error) {
      console.warn("[autopost] Failed to load fallback videos; using other fallback sources.", error);
      return [];
    }
  }
  loadFallbackImagePool() {
    const dir = process.env.AUTOPOST_FALLBACK_DIR?.trim();
    const dirUrls = dir ? this.loadFallbackImagesFromDir(dir) : [];
    if (dirUrls.length) return dirUrls;
    const explicitUrls = this.parseFallbackUrls(process.env.AUTOPOST_FALLBACK_URLS);
    if (explicitUrls.length) return explicitUrls;
    const urlsFile = process.env.AUTOPOST_FALLBACK_URLS_FILE?.trim();
    if (urlsFile) {
      try {
        const resolved = path.resolve(urlsFile);
        const contents = fs.readFileSync(resolved, "utf8");
        const fileUrls = this.parseFallbackUrls(contents);
        if (fileUrls.length) return fileUrls;
        console.warn("[autopost] No URLs found in AUTOPOST_FALLBACK_URLS_FILE; using default fallback images.");
      } catch (error) {
        console.warn("[autopost] Failed to load AUTOPOST_FALLBACK_URLS_FILE; using default fallback images.", error);
      }
    }
    return this.defaultFallbackImagePool;
  }
  loadFallbackVideoPool() {
    const dir = process.env.AUTOPOST_FALLBACK_VIDEO_DIR?.trim() || "./public/fallback-videos";
    const dirUrls = dir ? this.loadFallbackVideosFromDir(dir) : [];
    if (dirUrls.length) return dirUrls;
    const explicitUrls = this.parseFallbackUrls(process.env.AUTOPOST_FALLBACK_VIDEO_URLS);
    if (explicitUrls.length) return explicitUrls;
    const urlsFile = process.env.AUTOPOST_FALLBACK_VIDEO_URLS_FILE?.trim();
    if (urlsFile) {
      try {
        const resolved = path.resolve(urlsFile);
        const contents = fs.readFileSync(resolved, "utf8");
        const fileUrls = this.parseFallbackUrls(contents);
        if (fileUrls.length) return fileUrls;
        console.warn("[autopost] No URLs found in AUTOPOST_FALLBACK_VIDEO_URLS_FILE; using empty fallback videos.");
      } catch (error) {
        console.warn("[autopost] Failed to load AUTOPOST_FALLBACK_VIDEO_URLS_FILE; using empty fallback videos.", error);
      }
    }
    return [];
  }
  withCacheBuster(url) {
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}t=${Date.now()}`;
  }
  fallbackImageUrl() {
    return this.withCacheBuster(this.fallbackImageBase);
  }
  getRecentImageHistory(job) {
    if (!Array.isArray(job.recentImageUrls)) return [];
    return job.recentImageUrls.filter(Boolean);
  }
  getRecentVideoHistory(job) {
    if (!Array.isArray(job.recentVideoUrls)) return [];
    return job.recentVideoUrls.filter(Boolean);
  }
  getRecentCaptionHistory(job) {
    if (!Array.isArray(job.recentCaptions)) return [];
    return job.recentCaptions.filter(Boolean);
  }
  async getScheduledPostContentHistory(userId) {
    const empty = { imageUrls: [], videoUrls: [], captions: [], contentKeys: [] };
    const maxHistory = Math.max(Number(process.env.AUTOPOST_SCHEDULED_HISTORY_SCAN ?? 240), 40);
    const collectRows = (rows) => {
      const imageUrls = [];
      const videoUrls = [];
      const captions = [];
      const contentKeys = [];
      for (const data of rows) {
        const platform = String(data.platform || "").trim();
        const caption = String(data.caption || "").trim();
        if (caption) {
          captions.push(caption);
          if (platform) captions.push(this.buildCaptionSignature(platform, caption));
          contentKeys.push(...this.extractContentKeys(caption));
        }
        const images = Array.isArray(data.imageUrls) ? data.imageUrls : [];
        for (const value of images) {
          const url = String(value || "").trim();
          if (!url) continue;
          imageUrls.push(url);
          contentKeys.push(...this.extractContentKeys(url));
        }
        const videoUrl = String(data.videoUrl || "").trim();
        if (videoUrl) videoUrls.push(videoUrl);
      }
      return {
        imageUrls: this.uniqueHistoryValues(imageUrls),
        videoUrls: this.uniqueHistoryValues(videoUrls),
        captions: this.uniqueHistoryValues(captions),
        contentKeys: this.uniqueHistoryValues(contentKeys)
      };
    };
    const collect = (docs) => collectRows(docs.map((doc) => doc.data()));
    const collectSupabaseHistory = async () => {
      const fallbackPosts = await supabaseFallbackService.getPostsByUser(userId, maxHistory);
      return collectRows(fallbackPosts.map((post) => post));
    };
    try {
      const snapshot = await scheduledPostsCollection.where("userId", "==", userId).orderBy("createdAt", "desc").limit(maxHistory).get();
      return collect(snapshot.docs);
    } catch (error) {
      console.warn("[autopost] scheduled post history lookup with ordering failed; retrying without order", {
        userId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
    try {
      const snapshot = await scheduledPostsCollection.where("userId", "==", userId).limit(maxHistory).get();
      return collect(snapshot.docs);
    } catch (error) {
      console.warn("[autopost] scheduled post history lookup failed", {
        userId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
    try {
      const fallbackHistory = await collectSupabaseHistory();
      if (fallbackHistory.imageUrls.length || fallbackHistory.videoUrls.length || fallbackHistory.captions.length || fallbackHistory.contentKeys.length) {
        return fallbackHistory;
      }
    } catch (error) {
      console.warn("[autopost] supabase scheduled post history lookup failed", {
        userId,
        error: logSafeError(error)
      });
    }
    try {
      const job = await supabaseFallbackService.getAutopostJob(userId);
      if (job) {
        return {
          imageUrls: this.uniqueHistoryValues(Array.isArray(job.recentImageUrls) ? job.recentImageUrls.filter(Boolean) : []),
          videoUrls: this.uniqueHistoryValues(Array.isArray(job.recentVideoUrls) ? job.recentVideoUrls.filter(Boolean) : []),
          captions: this.uniqueHistoryValues(Array.isArray(job.recentCaptions) ? job.recentCaptions.filter(Boolean) : []),
          contentKeys: this.uniqueHistoryValues(
            [
              ...Array.isArray(job.recentImageUrls) ? job.recentImageUrls : [],
              ...Array.isArray(job.recentCaptions) ? job.recentCaptions : []
            ].map((value) => this.extractContentKeys(String(value || ""))).flat()
          )
        };
      }
    } catch (error) {
      console.warn("[autopost] supabase autopost job history lookup failed", {
        userId,
        error: logSafeError(error)
      });
    }
    return empty;
  }
  extractContentKeys(value) {
    const keys = [];
    for (const match of value.matchAll(/beforward-stock:([^\s,]+)/gi)) {
      keys.push(`beforward-stock:${match[1].toUpperCase()}`);
    }
    for (const match of value.matchAll(/dott-energy-product:([^\s,]+)/gi)) {
      keys.push(`dott-energy-product:${match[1].toLowerCase()}`);
    }
    for (const match of value.matchAll(/\b[A-Z]{2}\d{6}\b/gi)) {
      keys.push(`beforward-stock:${match[0].toUpperCase()}`);
    }
    for (const match of value.matchAll(/https?:\/\/[^\s)]+/gi)) {
      const normalized = match[0].replace(/[.,;]+$/g, "").replace(/\/+$/, "");
      if (/store\.steampowered\.com\/app\/(\d+)/i.test(normalized)) {
        const appId = normalized.match(/store\.steampowered\.com\/app\/(\d+)/i)?.[1];
        if (appId) keys.push(`steam-game:${appId}`);
      }
      if (/aderokestates\.com\/properties\/|simbaproperties\.co\.ug\/properties\/|jiji\.ug\//i.test(normalized)) {
        keys.push(`staysphere-listing:${normalized.toLowerCase()}`);
      }
      if (/dott-energy-2\.myshopify\.com\/products\/([^/?#]+)/i.test(normalized)) {
        const handle = normalized.match(/dott-energy-2\.myshopify\.com\/products\/([^/?#]+)/i)?.[1];
        if (handle) keys.push(`dott-energy-product:${handle.toLowerCase()}`);
      }
    }
    return keys;
  }
  uniqueHistoryValues(values) {
    const seen = /* @__PURE__ */ new Set();
    const unique = [];
    for (const value of values) {
      const normalized = value.trim();
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      unique.push(normalized);
    }
    return unique;
  }
  selectFreshImages(images, recent) {
    return images.filter((url) => url && !recent.has(url));
  }
  resolveImageUrls(images, recent, requireAiImages, userId) {
    const fresh = this.selectFreshImages(images, recent);
    if (fresh.length) return fresh;
    if (requireAiImages) return [];
    const fallback = this.pickFallbackImage(recent, userId);
    return fallback ? [fallback] : images;
  }
  resolveApprovedImageUrls(images, recent, requireAiImages, userId) {
    const approved = images.filter(Boolean);
    if (approved.length) return approved;
    if (requireAiImages) return [];
    const fallback = this.pickFallbackImage(recent, userId);
    return fallback ? [fallback] : [];
  }
  mergeRecentImages(existing, used) {
    const maxHistory = Math.max(Number(process.env.AUTOPOST_IMAGE_HISTORY ?? 400), 3);
    const next = [...used, ...existing].filter(Boolean);
    const seen = /* @__PURE__ */ new Set();
    const unique = next.filter((url) => {
      if (seen.has(url)) return false;
      seen.add(url);
      return true;
    });
    return unique.slice(0, maxHistory);
  }
  mergeRecentVideos(existing, used) {
    const maxHistory = Math.max(Number(process.env.AUTOPOST_VIDEO_HISTORY ?? 300), 30);
    const next = [...used, ...existing].filter(Boolean);
    const seen = /* @__PURE__ */ new Set();
    const unique = next.filter((url) => {
      if (seen.has(url)) return false;
      seen.add(url);
      return true;
    });
    return unique.slice(0, maxHistory);
  }
  mergeRecentCaptions(existing, used) {
    const maxHistory = Math.max(Number(process.env.AUTOPOST_CAPTION_HISTORY ?? 12), 3);
    const next = [...used, ...existing].filter(Boolean);
    const seen = /* @__PURE__ */ new Set();
    const unique = next.filter((value) => {
      if (seen.has(value)) return false;
      seen.add(value);
      return true;
    });
    return unique.slice(0, maxHistory);
  }
  pickFallbackImage(recent, userId) {
    const clientProfile = userId ? this.getClientFallbackProfile(userId) : null;
    if (clientProfile) {
      const clientPool = [...clientProfile.curatedImages.feed, ...clientProfile.curatedImages.story];
      const freshClientPool = clientPool.filter((url) => !recent.has(url));
      const pickFromClient = freshClientPool.length ? freshClientPool : clientPool;
      if (pickFromClient.length) {
        return this.withCacheBuster(pickFromClient[Math.floor(Math.random() * pickFromClient.length)]);
      }
    }
    const poolAll = this.getFallbackImagePool();
    const pool = poolAll.filter((url) => !recent.has(url));
    const pickFrom = pool.length ? pool : poolAll;
    if (!pickFrom.length) return this.fallbackImageUrl();
    const chosen = pickFrom[Math.floor(Math.random() * pickFrom.length)];
    return this.withCacheBuster(chosen);
  }
  buildBwinVisualPrompt(basePrompt) {
    const scenes = [
      "matchday action in a floodlit football stadium",
      "players celebrating a goal in front of a packed stand",
      "dynamic pre-kickoff tunnel walk with footballers",
      "goalkeeper save sequence under bright stadium lights",
      "close-up football action with crowd blur and sharp ball detail",
      "stadium-side football editorial visual with match tension"
    ];
    const compositions = [
      "editorial sports photograph",
      "high-energy matchday poster composition",
      "sharp action frame with clean space for a headline",
      "broadcast-style football still with premium clarity"
    ];
    const details = [
      "real players, real kit texture, no robots, no office scenes",
      "clear faces, sharp pitch detail, clean stadium lighting",
      "premium sports photography style, motion energy, no logos added",
      "crisp football atmosphere with strong depth and contrast"
    ];
    const pick = (items) => items[Math.floor(Math.random() * items.length)];
    const ref = `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
    return `${basePrompt} Scene: ${pick(scenes)}. Composition: ${pick(compositions)}. Details: ${pick(details)}. Ref ${ref}.`;
  }
  isBwinUnsafeFallbackImage(url) {
    const normalized = String(url || "").toLowerCase().trim();
    if (!normalized) return false;
    if (normalized.includes("/fallback-images/")) return true;
    return [
      "robot",
      "bot",
      "executive",
      "playground",
      "teenage",
      "holographic chart",
      "corporate poster"
    ].some((marker) => normalized.includes(marker));
  }
  async ensureBwinSafeImageUrls(images, content, basePrompt) {
    const safeImages = (images ?? []).filter((url) => url && !this.isBwinUnsafeFallbackImage(url));
    if (safeImages.length) return safeImages;
    const fallbackHeadline = content.caption_instagram?.trim() || content.caption_x?.trim() || content.caption_linkedin?.trim() || this.deriveBwinHeadline(basePrompt);
    return this.generateBwinSportsFallbackImage(fallbackHeadline);
  }
  getClientFallbackProfile(userId) {
    const profiles = {
      acmVetCcOiTHeGk5D7eDYieamDF3: {
        key: "carmarketplace",
        brand: "CARMARKETUG",
        accent: "#f5c542",
        dark: "#111418",
        light: "#f8fafc",
        hooks: ["Fresh arrivals", "Budget match", "Clean daily drives", "Buyer checklist", "Deal watch", "Book a viewing"],
        sublines: ["Search smarter", "View with confidence", "Message your budget", "Find your next ride"],
        queries: [
          "Range Rover SUV",
          "Audi Q3 SUV",
          "Subaru Forester",
          "Toyota Harrier",
          "Toyota RAV4",
          "Toyota Prado",
          "Toyota Land Cruiser",
          "Toyota Corolla",
          "Toyota Fielder",
          "Toyota Vitz",
          "BMW X5",
          "BMW 3 Series",
          "Mercedes Benz C Class",
          "Mercedes Benz GLE",
          "electric car",
          "hybrid car",
          "Tesla electric car",
          "Porsche 911",
          "Lamborghini supercar",
          "Ferrari supercar",
          "McLaren supercar"
        ],
        curatedImages: {
          feed: [
            "https://loremflickr.com/1080/1080/rangerover?lock=41001",
            "https://loremflickr.com/1080/1080/audiq3?lock=41002",
            "https://loremflickr.com/1080/1080/subaruforester?lock=41003",
            "https://loremflickr.com/1080/1080/toyotarav4?lock=41004",
            "https://loremflickr.com/1080/1080/toyotaharrier?lock=41005",
            "https://loremflickr.com/1080/1080/toyotalandcruiser?lock=41006",
            "https://loremflickr.com/1080/1080/toyotaprado?lock=41007",
            "https://loremflickr.com/1080/1080/toyotacorolla?lock=41008",
            "https://loremflickr.com/1080/1080/toyotafielder?lock=41009",
            "https://loremflickr.com/1080/1080/toyotavitz?lock=41010",
            "https://loremflickr.com/1080/1080/bmwx5?lock=41011",
            "https://loremflickr.com/1080/1080/bmw3series?lock=41012",
            "https://loremflickr.com/1080/1080/mercedesbenz?lock=41013",
            "https://loremflickr.com/1080/1080/mercedescclass?lock=41014",
            "https://loremflickr.com/1080/1080/mercedesgle?lock=41015",
            "https://loremflickr.com/1080/1080/electriccar?lock=41016",
            "https://loremflickr.com/1080/1080/hybridcar?lock=41017",
            "https://loremflickr.com/1080/1080/porsche911?lock=41018",
            "https://loremflickr.com/1080/1080/lamborghini?lock=41019",
            "https://loremflickr.com/1080/1080/ferrari?lock=41020",
            "https://loremflickr.com/1080/1080/mclaren?lock=41021"
          ],
          story: [
            "https://loremflickr.com/1080/1920/rangerover?lock=42001",
            "https://loremflickr.com/1080/1920/audiq3?lock=42002",
            "https://loremflickr.com/1080/1920/subaruforester?lock=42003",
            "https://loremflickr.com/1080/1920/toyotarav4?lock=42004",
            "https://loremflickr.com/1080/1920/toyotaharrier?lock=42005",
            "https://loremflickr.com/1080/1920/toyotalandcruiser?lock=42006",
            "https://loremflickr.com/1080/1920/toyotaprado?lock=42007",
            "https://loremflickr.com/1080/1920/toyotacorolla?lock=42008",
            "https://loremflickr.com/1080/1920/toyotafielder?lock=42009",
            "https://loremflickr.com/1080/1920/toyotavitz?lock=42010",
            "https://loremflickr.com/1080/1920/bmwx5?lock=42011",
            "https://loremflickr.com/1080/1920/bmw3series?lock=42012",
            "https://loremflickr.com/1080/1920/mercedesbenz?lock=42013",
            "https://loremflickr.com/1080/1920/mercedescclass?lock=42014",
            "https://loremflickr.com/1080/1920/mercedesgle?lock=42015",
            "https://loremflickr.com/1080/1920/electriccar?lock=42016",
            "https://loremflickr.com/1080/1920/hybridcar?lock=42017",
            "https://loremflickr.com/1080/1920/porsche911?lock=42018",
            "https://loremflickr.com/1080/1920/lamborghini?lock=42019",
            "https://loremflickr.com/1080/1920/ferrari?lock=42020",
            "https://loremflickr.com/1080/1920/mclaren?lock=42021"
          ]
        }
      },
      D1iNgjLKNRaQhH35M0NmGfw1LVD2: {
        key: "staysphere",
        brand: "STAY-SPHERE93",
        accent: "#34d399",
        dark: "#12201c",
        light: "#f4fbf8",
        hooks: ["Weekend stay", "Comfort first", "Short stay ready", "Room spotlight", "Easy booking", "Dates open"],
        sublines: ["Comfort made simple", "Ask for availability", "Dates open", "Stay where it fits"],
        queries: ["hotel room", "apartment bedroom", "short stay apartment", "cozy accommodation", "clean modern room"],
        curatedImages: {
          feed: [
            "https://images.pexels.com/photos/271624/pexels-photo-271624.jpeg?auto=compress&cs=tinysrgb&w=1600",
            "https://images.pexels.com/photos/164595/pexels-photo-164595.jpeg?auto=compress&cs=tinysrgb&w=1600",
            "https://images.pexels.com/photos/1571460/pexels-photo-1571460.jpeg?auto=compress&cs=tinysrgb&w=1600",
            "https://images.pexels.com/photos/1457842/pexels-photo-1457842.jpeg?auto=compress&cs=tinysrgb&w=1600",
            "https://images.pexels.com/photos/6585751/pexels-photo-6585751.jpeg?auto=compress&cs=tinysrgb&w=1600"
          ],
          story: [
            "https://images.pexels.com/photos/271624/pexels-photo-271624.jpeg?auto=compress&cs=tinysrgb&h=1920",
            "https://images.pexels.com/photos/164595/pexels-photo-164595.jpeg?auto=compress&cs=tinysrgb&h=1920",
            "https://images.pexels.com/photos/1571460/pexels-photo-1571460.jpeg?auto=compress&cs=tinysrgb&h=1920",
            "https://images.pexels.com/photos/1457842/pexels-photo-1457842.jpeg?auto=compress&cs=tinysrgb&h=1920",
            "https://images.pexels.com/photos/6585751/pexels-photo-6585751.jpeg?auto=compress&cs=tinysrgb&h=1920"
          ]
        }
      },
      vzdH1DnfFLVjlY8bBgC26WACmmw2: {
        key: "gamers44life",
        brand: "GAMERS44LIFE",
        accent: "#60a5fa",
        dark: "#111827",
        light: "#f8fbff",
        hooks: ["Weekend gaming", "Rate the setup", "Squad night", "Clutch moment", "Game of the day", "Community check"],
        sublines: ["Play more", "Squad up", "Drop your rank", "Community check"],
        queries: ["gaming setup", "esports gaming", "gamer desk", "gaming controller", "pc gaming setup"],
        curatedImages: {
          feed: [
            "https://images.pexels.com/photos/3165335/pexels-photo-3165335.jpeg?auto=compress&cs=tinysrgb&w=1600",
            "https://images.pexels.com/photos/442576/pexels-photo-442576.jpeg?auto=compress&cs=tinysrgb&w=1600",
            "https://images.pexels.com/photos/7915357/pexels-photo-7915357.jpeg?auto=compress&cs=tinysrgb&w=1600",
            "https://images.pexels.com/photos/3945683/pexels-photo-3945683.jpeg?auto=compress&cs=tinysrgb&w=1600",
            "https://images.pexels.com/photos/777001/pexels-photo-777001.jpeg?auto=compress&cs=tinysrgb&w=1600"
          ],
          story: [
            "https://images.pexels.com/photos/3165335/pexels-photo-3165335.jpeg?auto=compress&cs=tinysrgb&h=1920",
            "https://images.pexels.com/photos/442576/pexels-photo-442576.jpeg?auto=compress&cs=tinysrgb&h=1920",
            "https://images.pexels.com/photos/7915357/pexels-photo-7915357.jpeg?auto=compress&cs=tinysrgb&h=1920",
            "https://images.pexels.com/photos/3945683/pexels-photo-3945683.jpeg?auto=compress&cs=tinysrgb&h=1920",
            "https://images.pexels.com/photos/777001/pexels-photo-777001.jpeg?auto=compress&cs=tinysrgb&h=1920"
          ]
        }
      },
      LVR7p3WzdFM51ds92Kacf6S40og2: {
        key: "dottenergy",
        brand: "DOTT-ENERGY",
        accent: "#7ed957",
        dark: "#07120f",
        light: "#f4fff4",
        hooks: ["Clean wind power", "Off-grid ready", "Turbine spotlight", "Energy backup", "Shop wind systems", "Power your site"],
        sublines: ["Clean power. Stronger future.", "Shop wind turbines", "DM your power needs", "Built for off-grid sites"],
        queries: ["wind turbine", "renewable energy turbine", "off grid power", "wind generator", "clean energy"],
        curatedImages: {
          feed: [
            "https://images.pexels.com/photos/414837/pexels-photo-414837.jpeg?auto=compress&cs=tinysrgb&w=1600",
            "https://images.pexels.com/photos/433308/pexels-photo-433308.jpeg?auto=compress&cs=tinysrgb&w=1600",
            "https://images.pexels.com/photos/159397/solar-panel-array-power-sun-electricity-159397.jpeg?auto=compress&cs=tinysrgb&w=1600"
          ],
          story: [
            "https://images.pexels.com/photos/414837/pexels-photo-414837.jpeg?auto=compress&cs=tinysrgb&h=1920",
            "https://images.pexels.com/photos/433308/pexels-photo-433308.jpeg?auto=compress&cs=tinysrgb&h=1920",
            "https://images.pexels.com/photos/159397/solar-panel-array-power-sun-electricity-159397.jpeg?auto=compress&cs=tinysrgb&h=1920"
          ]
        }
      }
    };
    return profiles[userId] ?? null;
  }
  shuffled(items) {
    return [...items].sort(() => Math.random() - 0.5);
  }
  pickClientPhotoQuery(profile) {
    return profile.queries[Math.floor(Math.random() * profile.queries.length)] ?? profile.queries[0] ?? profile.key;
  }
  async fetchPexelsClientPhoto(profile, format, recentSet) {
    const apiKey = (process.env.PEXELS_API_KEY ?? process.env.CLIENT_IMAGE_PEXELS_API_KEY ?? "").trim();
    if (!apiKey) return null;
    try {
      const query = this.pickClientPhotoQuery(profile);
      const page = 1 + Math.floor(Math.random() * 8);
      const response = await axios.get("https://api.pexels.com/v1/search", {
        headers: { Authorization: apiKey },
        params: {
          query,
          per_page: 30,
          page,
          orientation: format === "story" ? "portrait" : "landscape"
        },
        timeout: 2e4
      });
      const photos = response.data?.photos ?? [];
      const candidates = this.shuffled(
        photos.map((photo) => format === "story" ? photo.src?.portrait || photo.src?.large2x : photo.src?.large2x || photo.src?.large).filter((url) => Boolean(url))
      );
      return candidates.find((url) => !recentSet.has(url)) ?? null;
    } catch (error) {
      console.warn("[autopost] Pexels client image lookup failed", {
        profile: profile.key,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }
  async fetchPixabayClientPhoto(profile, format, recentSet) {
    const apiKey = (process.env.PIXABAY_API_KEY ?? process.env.CLIENT_IMAGE_PIXABAY_API_KEY ?? "").trim();
    if (!apiKey) return null;
    try {
      const query = this.pickClientPhotoQuery(profile);
      const page = 1 + Math.floor(Math.random() * 5);
      const response = await axios.get("https://pixabay.com/api/", {
        params: {
          key: apiKey,
          q: query,
          image_type: "photo",
          safesearch: true,
          per_page: 50,
          page,
          orientation: format === "story" ? "vertical" : "horizontal"
        },
        timeout: 2e4
      });
      const hits = response.data?.hits ?? [];
      const candidates = this.shuffled(
        hits.map((hit) => hit.largeImageURL || hit.webformatURL).filter((url) => Boolean(url))
      );
      return candidates.find((url) => !recentSet.has(url)) ?? null;
    } catch (error) {
      console.warn("[autopost] Pixabay client image lookup failed", {
        profile: profile.key,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }
  pickCuratedClientPhoto(profile, format, recentSet) {
    const pool = [...profile.curatedImages[format] ?? [], ...this.generatedClientPhotoPool(profile, format)];
    const candidates = this.shuffled(pool).filter((url) => !recentSet.has(url));
    return candidates[0] ?? null;
  }
  generatedClientPhotoPool(profile, format) {
    const targetCount = 190;
    const locksPerQuery = Math.max(Math.ceil(targetCount / Math.max(profile.queries.length, 1)), 8);
    const dimensions = format === "story" ? "1080/1920" : "1080/1080";
    const keyOffsets = {
      carmarketplace: 61e3,
      staysphere: 71e3,
      gamers44life: 81e3
    };
    const offset = keyOffsets[profile.key] ?? 9e4;
    const urls = [];
    profile.queries.forEach((query, queryIndex) => {
      const slug = query.toLowerCase().replace(/[^a-z0-9]+/g, "").trim() || profile.key;
      for (let index = 0; index < locksPerQuery; index += 1) {
        const lock = offset + queryIndex * 100 + index + (format === "story" ? 50 : 0);
        urls.push(`https://loremflickr.com/${dimensions}/${slug}?lock=${lock}`);
      }
    });
    return urls.slice(0, targetCount);
  }
  async pickClientPhotoImageUrl(profile, format, recentSet) {
    return await this.fetchPexelsClientPhoto(profile, format, recentSet) || await this.fetchPixabayClientPhoto(profile, format, recentSet) || this.pickCuratedClientPhoto(profile, format, recentSet);
  }
  wrapFallbackWords(value, maxChars) {
    const words = value.split(/\s+/);
    const lines = [];
    let current = "";
    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (next.length > maxChars && current) {
        lines.push(current);
        current = word;
      } else {
        current = next;
      }
    }
    if (current) lines.push(current);
    return lines;
  }
  escapeFallbackSvg(value) {
    return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  }
  buildClientFallbackSvg(profile, format) {
    const width = 1080;
    const height = format === "story" ? 1920 : 1080;
    const nonce = `${Date.now()}-${Math.floor(Math.random() * 1e5)}`;
    const seed = crypto.createHash("sha256").update(`${profile.key}-${format}-${nonce}`).digest("hex");
    const a = parseInt(seed.slice(0, 2), 16);
    const b = parseInt(seed.slice(2, 4), 16);
    const hook = profile.hooks[parseInt(seed.slice(4, 6), 16) % profile.hooks.length].toUpperCase();
    const subline = profile.sublines[parseInt(seed.slice(6, 8), 16) % profile.sublines.length];
    const titleLines = this.wrapFallbackWords(hook, format === "story" ? 13 : 16).slice(0, 3);
    const yBase = format === "story" ? 640 : 365;
    const titleSize = format === "story" ? 118 : 100;
    return `
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${profile.dark}"/>
      <stop offset="0.58" stop-color="#1f2937"/>
      <stop offset="1" stop-color="${profile.accent}"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="32%" r="70%">
      <stop offset="0" stop-color="${profile.accent}" stop-opacity="0.44"/>
      <stop offset="1" stop-color="${profile.accent}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)"/>
  <rect width="${width}" height="${height}" fill="url(#glow)"/>
  <circle cx="${160 + a}" cy="${170 + b}" r="${format === "story" ? 270 : 190}" fill="${profile.accent}" opacity="0.13"/>
  <circle cx="${width - 145 - b}" cy="${height - 145 - a}" r="${format === "story" ? 340 : 230}" fill="#ffffff" opacity="0.08"/>
  <path d="M${90 + b} ${height - 280} C ${300 + a} ${height - 430}, ${620 - b} ${height - 160}, ${width - 80} ${height - 350}" fill="none" stroke="${profile.accent}" stroke-width="18" opacity="0.42"/>
  <rect x="70" y="70" width="${width - 140}" height="${height - 140}" rx="42" fill="none" stroke="#ffffff" stroke-opacity="0.18" stroke-width="3"/>
  <text x="92" y="${format === "story" ? 170 : 135}" fill="${profile.light}" font-family="Arial, Helvetica, sans-serif" font-size="${format === "story" ? 44 : 34}" font-weight="700">${this.escapeFallbackSvg(profile.brand)}</text>
  ${titleLines.map(
      (line, index) => `<text x="92" y="${yBase + index * (titleSize + 12)}" fill="${profile.light}" font-family="Arial Black, Arial, Helvetica, sans-serif" font-size="${titleSize}" font-weight="900">${this.escapeFallbackSvg(line)}</text>`
    ).join("\n")}
  <rect x="92" y="${format === "story" ? height - 415 : height - 255}" width="${width - 184}" height="${format === "story" ? 168 : 122}" rx="30" fill="#ffffff" opacity="0.12"/>
  <text x="130" y="${format === "story" ? height - 315 : height - 180}" fill="${profile.light}" font-family="Arial, Helvetica, sans-serif" font-size="${format === "story" ? 52 : 38}" font-weight="700">${this.escapeFallbackSvg(subline)}</text>
  <text x="130" y="${format === "story" ? height - 240 : height - 130}" fill="${profile.light}" opacity="0.72" font-family="Arial, Helvetica, sans-serif" font-size="${format === "story" ? 34 : 26}">Message us to get started</text>
  <text x="${width - 92}" y="${height - 95}" text-anchor="end" fill="${profile.light}" opacity="0.45" font-family="Arial, Helvetica, sans-serif" font-size="24">${this.escapeFallbackSvg(seed.slice(0, 10).toUpperCase())}</text>
</svg>`;
  }
  async uploadClientFallbackImage(buffer, profileKey, format) {
    const supabaseUrl = (process.env.SUPABASE_URL ?? "").trim().replace(/\/$/, "");
    const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
    const bucket = process.env.CLIENT_CAMPAIGN_BUCKET?.trim() || "dott-campaign";
    if (supabaseUrl && serviceRoleKey) {
      try {
        const objectPath = `client-autopost/${profileKey}/${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}/${format}-${Date.now()}-${crypto.randomUUID()}.jpg`;
        await axios.post(`${supabaseUrl}/storage/v1/object/${bucket}/${objectPath}`, buffer, {
          headers: {
            Authorization: `Bearer ${serviceRoleKey}`,
            apikey: serviceRoleKey,
            "Content-Type": "image/jpeg",
            "x-upsert": "true"
          },
          maxBodyLength: Infinity,
          timeout: 12e3
        });
        return `${supabaseUrl}/storage/v1/object/public/${bucket}/${objectPath}`;
      } catch (error) {
        console.warn("[autopost] client fallback image upload failed; using local media fallback", {
          profile: profileKey,
          format,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    return saveGeneratedImageBuffer(buffer, "jpg");
  }
  async prepareClientPhotoImageUrl(url, profile, format) {
    try {
      const source = await this.loadImageBuffer(url);
      if (!source) return null;
      const dimensions = format === "story" ? { width: 1080, height: 1920 } : { width: 1080, height: 1080 };
      const buffer = await sharp(source).rotate().resize(dimensions.width, dimensions.height, {
        fit: "cover",
        position: "attention",
        withoutEnlargement: false
      }).jpeg({ quality: 91, mozjpeg: true }).toBuffer();
      return this.uploadClientFallbackImage(buffer, profile.key, format);
    } catch (error) {
      console.warn("[autopost] client photo normalization failed", {
        profile: profile.key,
        format,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }
  async generateClientFallbackImageUrls(userId, _job, isStoryRun, recentSet) {
    const profile = this.getClientFallbackProfile(userId);
    if (!profile) return [];
    try {
      const format = isStoryRun ? "story" : "feed";
      const photoUrl = await this.pickClientPhotoImageUrl(profile, format, recentSet);
      if (photoUrl) {
        return [await this.prepareClientPhotoImageUrl(photoUrl, profile, format) ?? photoUrl];
      }
      const svg = this.buildClientFallbackSvg(profile, format);
      const buffer = await sharp(Buffer.from(svg)).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
      const url = await this.uploadClientFallbackImage(buffer, profile.key, format);
      return recentSet.has(url) ? [] : [url];
    } catch (error) {
      console.warn("[autopost] client fallback image generation failed", {
        userId,
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }
  buildVisualPrompt(basePrompt) {
    const sceneContext = this.getSceneContext();
    const style = this.getVisualStyle(basePrompt);
    const scenes = [
      "strategy session in a high-rise executive suite",
      "client consultation in a private boardroom suite",
      "robot guiding a product demo in a premium sales suite",
      "team huddle around a glass table in a skyline suite",
      "customer success check-in in a luxury meeting suite",
      "robot assisting a marketer in a modern executive suite",
      "lead pipeline review in a glass-walled suite",
      "sales standup in a refined conference suite"
    ];
    const interactions = [
      "robot pointing at a funnel chart while people discuss",
      "robot handing a tablet to a team member",
      "robot and human shaking hands in agreement",
      "robot highlighting insights on a floating UI panel",
      "robot taking notes while the team presents",
      "robot collaborating on a shared screen",
      "robot guiding a live demo with subtle gestures",
      "robot and team reviewing KPIs together"
    ];
    const settings = [
      "executive suite with city skyline windows",
      "luxury boardroom with soft daylight",
      "premium client suite with warm neutral tones",
      "glass-walled executive lounge with refined decor",
      "high-end conference suite with minimal accents",
      "private strategy suite with modern finishes",
      "suite-style meeting space with soft seating"
    ];
    const compositions = [
      "wide establishing shot",
      "eye-level candid shot",
      "over-the-shoulder view toward the screen",
      "three-quarter angle with depth of field",
      "medium shot focused on faces and gestures",
      "close-up on the robot and one collaborator"
    ];
    const lighting = [
      "morning sunlight with soft shadows",
      "golden hour glow",
      "diffused daylight, clean and natural",
      "soft studio lighting with gentle highlights",
      "cool daylight balanced with warm accents"
    ];
    const palettes = [
      "warm neutrals with teal accents",
      "soft gray with amber highlights",
      "clean white with cobalt blue accents",
      "muted charcoal with mint highlights",
      "light sand tones with subtle navy"
    ];
    const details = [
      "subtle holographic UI overlays",
      "minimalistic charts on screens",
      "clean glass surfaces with reflections",
      "calm, confident expressions",
      "tidy workspace with notebooks and coffee",
      "modern devices and a sleek tablet",
      "robot dressed with a tie and glasses"
    ];
    const neonLighting = [
      "neon glow with high-contrast shadows",
      "magenta and cyan rim lighting",
      "futuristic neon ambience with light haze",
      "vivid neon highlights with soft bloom"
    ];
    const neonPalettes = [
      "magenta and cyan neon with deep charcoal",
      "electric blue and pink neon accents",
      "neon teal and violet against dark glass",
      "high-contrast neon gradients with glossy blacks"
    ];
    const neonDetails = [
      "glowing holographic UI overlays",
      "neon edge lighting on glass surfaces",
      "reflective floors with neon streaks",
      "futuristic neon signage accents",
      "robot dressed with a tie and glasses"
    ];
    const subtleNeonLighting = [
      "soft ambient glow with minimal neon highlights",
      "gentle neon rim lighting with balanced shadows",
      "subtle neon accents with clean studio lighting",
      "light haze with restrained neon bloom"
    ];
    const subtleNeonPalettes = [
      "neutral tones with faint cyan accents",
      "soft charcoal with muted neon teal",
      "warm neutrals with minimal magenta glow",
      "clean white with subtle neon edge lighting"
    ];
    const subtleNeonDetails = [
      "light holographic UI overlays",
      "subtle neon accents on glass edges",
      "soft reflections with minimal neon streaks",
      "restrained neon signage accents",
      "robot dressed with a tie and glasses"
    ];
    const pick = (items) => items[Math.floor(Math.random() * items.length)];
    const pickLighting = style === "neon" ? pick(neonLighting) : style === "neon-subtle" ? pick(subtleNeonLighting) : pick(lighting);
    const pickPalette = style === "neon" ? pick(neonPalettes) : style === "neon-subtle" ? pick(subtleNeonPalettes) : pick(palettes);
    const pickDetail = style === "neon" ? pick(neonDetails) : style === "neon-subtle" ? pick(subtleNeonDetails) : pick(details);
    const ref = `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
    return `${basePrompt} Context: ${sceneContext}. Scene: ${pick(scenes)}. Interaction: ${pick(interactions)}. Setting: ${pick(settings)}. Composition: ${pick(
      compositions
    )}. Lighting: ${pickLighting}. Palette: ${pickPalette}. Details: ${pickDetail}. Ref ${ref}.`;
  }
  getSceneContext() {
    const raw = process.env.AUTOPOST_SCENE_CONTEXT?.trim();
    return raw && raw.length > 0 ? raw : "executive suite";
  }
  applyNeonPreference(basePrompt) {
    const forceNeon = (process.env.AUTOPOST_FORCE_NEON ?? "true").toLowerCase() !== "false";
    if (!forceNeon) return basePrompt;
    const lower = basePrompt.toLowerCase();
    if (lower.includes("neon") || lower.includes("cyberpunk")) {
      return basePrompt;
    }
    return `${basePrompt} Neon lighting with magenta and cyan accents, futuristic glow, glossy reflections.`;
  }
  getVisualStyle(basePrompt) {
    const lower = basePrompt.toLowerCase();
    if (lower.includes("subtle neon") || lower.includes("minimal neon") || lower.includes("soft neon")) {
      return "neon-subtle";
    }
    return lower.includes("neon") || lower.includes("cyberpunk") ? "neon" : "default";
  }
  requireAiImages(job) {
    if (typeof job.requireAiImages === "boolean") return job.requireAiImages;
    const flag = process.env.AUTOPOST_REQUIRE_AI_IMAGES?.toLowerCase();
    if (flag === "false") return false;
    return true;
  }
  ensureCaptionVariety(platform, caption, history, userId) {
    const signature = this.buildCaptionSignature(platform, caption);
    if (!history.has(signature)) {
      return { caption, signature };
    }
    const variants = this.getCaptionVarietyVariants(userId);
    for (const variant of variants) {
      const candidate = this.appendCaptionSuffix(caption, variant, platform);
      const candidateSignature = this.buildCaptionSignature(platform, candidate);
      if (!history.has(candidateSignature)) {
        return { caption: candidate, signature: candidateSignature };
      }
    }
    return { caption, signature };
  }
  appendCaptionSuffix(caption, suffix, platform) {
    const joiner = platform === "twitter" || platform === "x" ? " " : "\n\n";
    const hashtagMatch = caption.match(/\s(#[A-Za-z0-9_]+)/);
    if (!hashtagMatch || hashtagMatch.index === void 0) {
      return `${caption}${joiner}${suffix}`.trim();
    }
    const idx = hashtagMatch.index;
    if (idx <= 0) {
      return `${caption}${joiner}${suffix}`.trim();
    }
    const head = caption.slice(0, idx).trim();
    const tail = caption.slice(idx).trim();
    return [head, suffix, tail].filter(Boolean).join(joiner).trim();
  }
  buildCaptionSignature(platform, caption) {
    const normalized = caption.toLowerCase().replace(/\s+/g, " ").trim();
    return `${platform}:${normalized}`;
  }
  getXHighlightAccounts(job) {
    const isBlocked = (value) => this.xBlockedHighlightAccounts.has(value.toLowerCase());
    const isTrusted = (value) => this.trustedXHighlightAccounts.has(value.toLowerCase());
    const normalize = (value) => String(value || "").replace(/^@/, "").trim();
    if (Array.isArray(job.xHighlightAccounts) && job.xHighlightAccounts.length) {
      const provided = job.xHighlightAccounts.map(normalize).filter((value) => Boolean(value) && !isBlocked(value) && isTrusted(value));
      if (provided.length) return provided.slice(0, 15);
    }
    return this.defaultXHighlightAccounts.filter((value) => !isBlocked(value) && isTrusted(value));
  }
  allowThirdPartyHighlightVideoRepublish() {
    return (process.env.ALLOW_THIRD_PARTY_HIGHLIGHT_VIDEO_REPUBLISH ?? "false").toLowerCase() === "true";
  }
  areBwinShortVideosDisabled() {
    return true;
  }
  getCaptionVarietyVariants(userId) {
    const profile = userId ? this.getClientFallbackProfile(userId) : null;
    if (profile?.key === "staysphere") {
      return ["Send your dates to check availability.", "DM your guest count and preferred area.", "Ask for current stay options."];
    }
    if (profile?.key === "gamers44life") {
      return ["Drop your current game in the comments.", "DM your setup or highlight idea.", "What platform are you playing on?"];
    }
    if (profile?.key === "carmarketplace") {
      return ["Send your budget and preferred model.", "DM your viewing area and car type.", "Ask for clean car options today."];
    }
    return userId && this.isBwinScopeUser(userId) ? this.bwinFallbackCaptionVariants : this.fallbackCaptionVariants;
  }
  isDefaultDottFallbackImage(url) {
    const value = String(url ?? "").toLowerCase();
    return value.includes("/public/fallback-images/") || value.includes("dottmediaapk.onrender.com/public/fallback-images/");
  }
  getOwnedBwinHighlightVideoUrl() {
    const explicitUrl = (process.env.BWIN_HIGHLIGHT_BRANDED_VIDEO_URL ?? "").trim();
    if (explicitUrl) {
      return this.withCacheBuster(explicitUrl);
    }
    const baseUrl = this.getPublicBaseUrl();
    if (!baseUrl) return "";
    const dir = process.env.AUTOPOST_FALLBACK_VIDEO_DIR?.trim() || "./public/fallback-videos";
    const preferredNames = ["bwinbet-highlight-alert.mp4", "bwinbet-highlight-alert.mov", "bwinbet-highlight-alert.m4v"];
    try {
      const resolved = path.resolve(dir);
      for (const name of preferredNames) {
        if (fs.existsSync(path.join(resolved, name))) {
          return this.withCacheBuster(`${baseUrl}/public/fallback-videos/${encodeURIComponent(name)}`);
        }
      }
    } catch (error) {
      console.warn("[autopost] Failed to resolve owned Bwin highlight video fallback.", error);
    }
    return "";
  }
  getXWeeklyAwardKeywords(job) {
    if (Array.isArray(job.xWeeklyAwardKeywords) && job.xWeeklyAwardKeywords.length) {
      const provided = job.xWeeklyAwardKeywords.map((value) => String(value || "").toLowerCase().trim()).filter(Boolean);
      if (provided.length) return provided.slice(0, 30);
    }
    return this.defaultXWeeklyAwardKeywords;
  }
  isWeeklyAwardHighlight(text, keywords) {
    const normalized = String(text || "").toLowerCase().replace(/\s+/g, " ").trim();
    if (!normalized) return false;
    return keywords.some((keyword) => normalized.includes(keyword));
  }
  buildTwitterClient(credentials) {
    const accessToken = credentials?.twitter?.accessToken;
    const accessSecret = credentials?.twitter?.accessSecret;
    const appKey = credentials?.twitter?.appKey ?? credentials?.twitter?.consumerKey ?? process.env.TWITTER_API_KEY ?? process.env.TWITTER_CONSUMER_KEY;
    const appSecret = credentials?.twitter?.appSecret ?? credentials?.twitter?.consumerSecret ?? process.env.TWITTER_API_SECRET ?? process.env.TWITTER_CONSUMER_SECRET;
    if (!accessToken || !accessSecret || !appKey || !appSecret) return null;
    return new TwitterApi({
      appKey,
      appSecret,
      accessToken,
      accessSecret
    });
  }
  async resolveVideoUrlFromTweet(tweetId, credentials) {
    const client = this.buildTwitterClient(credentials);
    if (!client) return null;
    try {
      const detail = await client.readOnly.v2.singleTweet(tweetId, {
        expansions: ["attachments.media_keys"],
        "tweet.fields": ["attachments"],
        "media.fields": ["type", "variants", "url", "preview_image_url"]
      });
      const mediaItems = Array.isArray(detail?.includes?.media) ? detail.includes.media : [];
      for (const media of mediaItems) {
        const type = String(media?.type || "").toLowerCase();
        if (type !== "video" && type !== "animated_gif") continue;
        const variants = Array.isArray(media?.variants) ? media.variants : [];
        const mp4Variants = variants.filter((variant) => String(variant?.content_type || "").toLowerCase() === "video/mp4" && variant?.url).sort((a, b) => Number(b?.bit_rate || 0) - Number(a?.bit_rate || 0));
        if (mp4Variants.length) {
          return String(mp4Variants[0].url).trim();
        }
      }
    } catch (error) {
      console.warn("[autopost] failed to resolve source video URL from tweet", { tweetId, error });
    }
    return null;
  }
  async pickFootballHighlightForX(job, credentials, options) {
    const client = this.buildTwitterClient(credentials);
    if (!client) return null;
    const readOnly = client.readOnly;
    const accounts = this.getXHighlightAccounts(job);
    const maxAgeHours = Math.max(job.xHighlightMaxAgeHours ?? 72, 6);
    const minCreatedAt = Date.now() - maxAgeHours * 60 * 60 * 1e3;
    const lastTweetId = (job.xLastHighlightTweetId || "").trim();
    const lastWeeklyAwardTweetId = (job.xLastWeeklyAwardTweetId || "").trim();
    const weeklyAwardKeywords = this.getXWeeklyAwardKeywords(job);
    const preferWeeklyAwards = options?.preferWeeklyAwards === true;
    const weeklyAwardsOnly = options?.weeklyAwardsOnly === true;
    const rotateAccounts = options?.rotateAccounts !== false;
    const cursorRaw = Number.isFinite(job.xHighlightAccountCursor) ? job.xHighlightAccountCursor : 0;
    const startCursor = accounts.length ? (Math.trunc(cursorRaw) % accounts.length + accounts.length) % accounts.length : 0;
    const candidates = [];
    for (let accountIndex = 0; accountIndex < accounts.length; accountIndex += 1) {
      const username = accounts[accountIndex];
      try {
        const userLookup = await readOnly.v2.userByUsername(username);
        const authorId = userLookup?.data?.id;
        if (!authorId) continue;
        const timeline = await readOnly.v2.userTimeline(authorId, {
          max_results: 30,
          exclude: ["replies"],
          expansions: ["attachments.media_keys"],
          "tweet.fields": ["created_at", "public_metrics", "attachments"],
          "media.fields": ["type"]
        });
        const realData = timeline?._realData ?? {};
        const tweets = Array.isArray(realData?.data) ? realData.data : [];
        const mediaItems = Array.isArray(realData?.includes?.media) ? realData.includes.media : [];
        const mediaByKey = new Map(
          mediaItems.filter((item) => item?.media_key).map((item) => [String(item.media_key), item])
        );
        for (const tweet of tweets) {
          const tweetId = String(tweet?.id || "").trim();
          if (!tweetId || lastTweetId && tweetId === lastTweetId) continue;
          if (lastWeeklyAwardTweetId && tweetId === lastWeeklyAwardTweetId) continue;
          const createdAtMs = Date.parse(String(tweet?.created_at || ""));
          if (Number.isFinite(createdAtMs) && createdAtMs < minCreatedAt) continue;
          const text = String(tweet?.text || "").trim();
          const isWeeklyAward = this.isWeeklyAwardHighlight(text, weeklyAwardKeywords);
          if (weeklyAwardsOnly && !isWeeklyAward) continue;
          const mediaKeys = Array.isArray(tweet?.attachments?.media_keys) ? tweet.attachments.media_keys : [];
          const hasVideo = mediaKeys.some((key) => {
            const media = mediaByKey.get(String(key));
            const type = String(media?.type || "").toLowerCase();
            return type === "video" || type === "animated_gif";
          });
          if (!hasVideo) continue;
          const metrics = tweet?.public_metrics ?? {};
          const score = Number(metrics?.retweet_count ?? 0) * 1.2 + Number(metrics?.like_count ?? 0) * 0.7 + Number(metrics?.reply_count ?? 0) * 0.5 + Number(metrics?.quote_count ?? 0) * 1 + (preferWeeklyAwards && isWeeklyAward ? 1e5 : 0);
          candidates.push({
            tweetId,
            username,
            usernameKey: username.toLowerCase(),
            score,
            createdAtMs: Number.isFinite(createdAtMs) ? createdAtMs : 0,
            tweetUrl: `https://x.com/${username}/status/${tweetId}`,
            isWeeklyAward,
            text,
            accountIndex,
            nextCursor: accounts.length ? (accountIndex + 1) % accounts.length : 0
          });
        }
      } catch (error) {
        console.warn("[autopost] x highlight lookup failed", { username, error });
      }
    }
    if (!candidates.length) return null;
    candidates.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.createdAtMs - a.createdAtMs;
    });
    if (!rotateAccounts || !accounts.length) {
      return candidates[0];
    }
    const byAccount = /* @__PURE__ */ new Map();
    for (const candidate of candidates) {
      const list = byAccount.get(candidate.usernameKey) ?? [];
      list.push(candidate);
      byAccount.set(candidate.usernameKey, list);
    }
    for (let offset = 0; offset < accounts.length; offset += 1) {
      const idx = (startCursor + offset) % accounts.length;
      const account = accounts[idx];
      const accountCandidates = byAccount.get(account.toLowerCase());
      if (accountCandidates?.length) {
        return accountCandidates[0];
      }
    }
    return candidates[0];
  }
  async selectNextVideo(job, platform, fallbackVideos = [], userId, recentVideos = /* @__PURE__ */ new Set()) {
    const nicheProfile = userId ? this.getClientFallbackProfile(userId) : null;
    const isNicheReel = platform === "instagram_reels" && Boolean(nicheProfile);
    if (isNicheReel) {
      const dynamicVideo = await this.pickDynamicClientReelVideo(userId, recentVideos);
      if (dynamicVideo?.videoUrl) {
        return { ...dynamicVideo, nextCursor: void 0 };
      }
      return { videoUrl: void 0, nextCursor: void 0 };
    }
    const list = platform === "youtube" ? (job.youtubeVideoUrls ?? []).map((url) => url.trim()).filter(Boolean) : platform === "tiktok" ? (job.tiktokVideoUrls ?? []).map((url) => url.trim()).filter(Boolean) : (job.reelsVideoUrls ?? []).map((url) => url.trim()).filter(Boolean);
    const single = platform === "youtube" ? job.youtubeVideoUrl?.trim() : platform === "tiktok" ? job.tiktokVideoUrl?.trim() : job.reelsVideoUrl?.trim();
    const cursor = platform === "youtube" ? Number.isFinite(job.youtubeVideoCursor) ? job.youtubeVideoCursor : 0 : platform === "tiktok" ? Number.isFinite(job.tiktokVideoCursor) ? job.tiktokVideoCursor : 0 : Number.isFinite(job.reelsVideoCursor) ? job.reelsVideoCursor : 0;
    const freshList = list.filter((url) => !recentVideos.has(url));
    if (!freshList.length && list.length) {
      return { videoUrl: void 0, nextCursor: cursor };
    }
    if (!freshList.length) {
      if (single) {
        if (recentVideos.has(single)) return { videoUrl: void 0, nextCursor: void 0 };
        return { videoUrl: single, nextCursor: void 0 };
      }
      const freshFallbackVideos = fallbackVideos.filter((url) => !recentVideos.has(url));
      if (!freshFallbackVideos.length) {
        return { videoUrl: void 0, nextCursor: void 0 };
      }
      const index2 = (cursor % freshFallbackVideos.length + freshFallbackVideos.length) % freshFallbackVideos.length;
      const nextCursor2 = (index2 + 1) % freshFallbackVideos.length;
      return { videoUrl: freshFallbackVideos[index2], nextCursor: nextCursor2 };
    }
    const index = (cursor % freshList.length + freshList.length) % freshList.length;
    const nextCursor = (index + 1) % freshList.length;
    return { videoUrl: freshList[index], nextCursor };
  }
  async pickDynamicClientReelVideo(userId, recentVideos) {
    if (this.getClientFallbackProfile(userId)?.key === "gamers44life") {
      const steamVideo = await pickGamersSteamVideo({ recentVideos });
      if (steamVideo?.videoUrl) {
        return {
          videoUrl: steamVideo.videoUrl,
          caption: buildGamersSteamVideoCaption(steamVideo)
        };
      }
      return null;
    }
    return null;
  }
  selectNextGenericVideo(job, fallbackVideos = []) {
    const list = (job.videoUrls ?? []).map((url) => url.trim()).filter(Boolean);
    if (!list.length) {
      const single = job.videoUrl?.trim();
      if (single) {
        return { videoUrl: single, nextCursor: void 0 };
      }
      if (!fallbackVideos.length) {
        return { videoUrl: void 0, nextCursor: void 0 };
      }
      const cursor2 = Number.isFinite(job.videoCursor) ? job.videoCursor : 0;
      const index2 = (cursor2 % fallbackVideos.length + fallbackVideos.length) % fallbackVideos.length;
      const nextCursor2 = (index2 + 1) % fallbackVideos.length;
      return { videoUrl: fallbackVideos[index2], nextCursor: nextCursor2 };
    }
    const cursor = Number.isFinite(job.videoCursor) ? job.videoCursor : 0;
    const index = (cursor % list.length + list.length) % list.length;
    const nextCursor = (index + 1) % list.length;
    return { videoUrl: list[index], nextCursor };
  }
}
const autoPostService = new AutoPostService();
export {
  AutoPostService,
  autoPostService
};
