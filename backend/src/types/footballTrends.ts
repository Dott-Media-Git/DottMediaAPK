export type TrendSourceType = 'rss' | 'atom' | 'html';

export type TrendSourceSelectors = {
  item?: string;
  title?: string;
  link?: string;
  summary?: string;
  published?: string;
};

export type TrendSource = {
  id: string;
  label: string;
  url: string;
  type: TrendSourceType;
  region?: string;
  trusted?: boolean;
  selectors?: TrendSourceSelectors;
};

export type TrendItem = {
  title: string;
  link?: string;
  summary?: string;
  imageUrl?: string;
  videoUrl?: string;
  publishedAt?: string;
  sourceId: string;
  sourceLabel: string;
};

export type TrendCandidate = {
  topic: string;
  score: number;
  sources: string[];
  publishedAt?: string;
  sampleTitles: string[];
  items: TrendItem[];
};

export type BrandKit = {
  name: string;
  handle?: string;
  tone?: string;
  colors?: string[];
  typography?: string;
  logoPlacement?: string;
  logoPath?: string;
  templates?: Record<string, unknown>;
};

export type TrendGenerationInput = {
  topic: string;
  context: string;
  trendSignals?: string[];
  brand?: BrandKit;
  brandId?: string;
  clientId?: string;
  channels: string[];
  region?: string;
  language?: string;
  rightsInfo?: string;
  includePosterImage?: boolean;
  imageCount?: number;
};

export type TrendContentPackage = {
  trend_summary: string;
  primary_angle: string;
  fan_emotion: string;
  key_takeaway: string;
  poster: {
    headline: string;
    subhead: string;
    cta?: string;
    layout_notes: string;
    image_prompt: string;
  };
  captions: {
    viral_caption: string;
    instagram: string;
    x_thread: string[];
  };
  meme_concepts: string[];
  video: {
    hook: string;
    script: string[];
    voiceover_style: string;
    clip_plan: string;
  };
  hashtags: string[];
  compliance: {
    facts_checked: string;
    rights_checked: string;
    platform_rules: string;
  };
  post_plan: {
    platforms: string[];
    best_time_window: string;
    asset_notes: string;
  };
};
