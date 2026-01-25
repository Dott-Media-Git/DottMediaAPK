import OpenAI from 'openai';
import { z } from 'zod';
import { config } from '../config';
import { FOOTBALL_TREND_SYSTEM_PROMPT } from './footballTrendPrompt';
import { loadBrandKit, resolveBrandIdForClient } from './brandKitService';
import { BrandKit, TrendContentPackage, TrendGenerationInput } from '../types/footballTrends';

const outputSchema = z.object({
  trend_summary: z.string().min(1),
  primary_angle: z.string().min(1),
  fan_emotion: z.string().min(1),
  key_takeaway: z.string().min(1),
  poster: z.object({
    headline: z.string().min(1),
    subhead: z.string().min(1),
    cta: z.string().optional(),
    layout_notes: z.string().min(1),
    image_prompt: z.string().min(1),
  }),
  captions: z.object({
    viral_caption: z.string().min(1),
    instagram: z.string().min(1),
    x_thread: z.array(z.string().min(1)).min(3).max(3),
  }),
  meme_concepts: z.array(z.string().min(1)).min(3).max(5),
  video: z.object({
    hook: z.string().min(1),
    script: z.array(z.string().min(1)).min(4).max(4),
    voiceover_style: z.string().min(1),
    clip_plan: z.string().min(1),
  }),
  hashtags: z.array(z.string().min(1)).min(3).max(12),
  compliance: z.object({
    facts_checked: z.string().min(1),
    rights_checked: z.string().min(1),
    platform_rules: z.string().min(1),
  }),
  post_plan: z.object({
    platforms: z.array(z.string().min(1)).min(1),
    best_time_window: z.string().min(1),
    asset_notes: z.string().min(1),
  }),
});

const resolveBrandKit = (input: TrendGenerationInput) => {
  if (input.brand) return input.brand;
  const brandId = input.brandId ?? (input.clientId ? resolveBrandIdForClient(input.clientId) : null);
  if (brandId) return loadBrandKit(brandId);
  throw new Error('Missing brand kit');
};

const buildUserPrompt = (input: TrendGenerationInput, brand: BrandKit) => {
  const lines = [
    `trend_topic: ${input.topic}`,
    `context_data: ${input.context}`,
    `trend_signals: ${input.trendSignals?.length ? input.trendSignals.join(' | ') : 'none provided'}`,
    `brand_kit: ${JSON.stringify(brand)}`,
    `channels: ${input.channels.join(', ')}`,
    input.region ? `region: ${input.region}` : '',
    input.language ? `language: ${input.language}` : '',
    input.rightsInfo ? `rights_info: ${input.rightsInfo}` : '',
  ];
  return lines.filter(Boolean).join('\n');
};

export class FootballTrendContentService {
  private client = new OpenAI({ apiKey: config.openAI.apiKey, timeout: 120000 });

  async generate(input: TrendGenerationInput): Promise<{ content: TrendContentPackage; images: string[] }> {
    const brand = resolveBrandKit(input);
    const completion = await this.client.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.4,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: FOOTBALL_TREND_SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(input, brand) },
      ],
    });

    const raw = completion.choices?.[0]?.message?.content ?? '{}';
    let parsed: TrendContentPackage;
    try {
      parsed = outputSchema.parse(JSON.parse(raw));
    } catch (error) {
      console.error('Football trend output parsing failed', error);
      throw new Error('Football trend content generation failed');
    }

    const images = input.includePosterImage === false
      ? []
      : await this.generatePosterImage(parsed.poster.image_prompt, input.imageCount);

    return { content: parsed, images };
  }

  private async generatePosterImage(prompt: string, imageCount = 1): Promise<string[]> {
    const model = 'dall-e-3';
    const count = Math.min(Math.max(imageCount, 1), 1);
    const attempts = Math.max(Number(process.env.OPENAI_IMAGE_ATTEMPTS ?? 2), 1);
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const response = await this.client.images.generate({
          model,
          prompt,
          size: '1024x1024',
          n: count,
          response_format: 'url',
        });
        const urls = (response.data ?? []).map(item => item.url).filter((url): url is string => Boolean(url));
        if (urls.length) return urls;
      } catch (error) {
        console.error('Football trend image generation failed', error);
        if (attempt < attempts - 1) {
          await new Promise(resolve => setTimeout(resolve, 1500));
        }
      }
    }
    return [];
  }
}

export const footballTrendContentService = new FootballTrendContentService();
