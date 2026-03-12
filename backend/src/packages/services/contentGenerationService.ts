import OpenAI from 'openai';
import path from 'path';
import { config } from '../../config';
import { saveGeneratedImageBuffer, saveGeneratedVideoFile } from '../../services/generatedMediaService';
import { generateSoraVideoFile } from '../../services/soraVideoService';
import { cleanupTempFile } from '../../services/videoUrlService';

export type GeneratedContent = {
  images: string[];
  caption_instagram: string;
  caption_linkedin: string;
  caption_x: string;
  hashtags_instagram: string;
  hashtags_generic: string;
  image_error?: string;
  video_url?: string;
  video_error?: string;
};

type GenerationParams = {
  prompt: string;
  businessType: string;
  imageCount?: number;
  generateVideo?: boolean;
};

const DEFAULT_OUTPUT: GeneratedContent = {
  images: [],
  caption_instagram: '',
  caption_linkedin: '',
  caption_x: '',
  hashtags_instagram: '',
  hashtags_generic: '',
};

export class ContentGenerationService {
  private client = new OpenAI({ apiKey: config.openAI.apiKey, timeout: 120000 });
  private lastImageError: string | null = null;
  private lastVideoError: string | null = null;

  async generateContent(params: GenerationParams): Promise<GeneratedContent> {
    const result: GeneratedContent = { ...DEFAULT_OUTPUT };
    const imageCount = Math.min(Math.max(params.imageCount ?? 2, 1), 4);

    const [images, captions, videoUrl] = await Promise.all([
      this.generateImages(params, imageCount),
      this.generateCaptions(params),
      params.generateVideo ? this.generateVideo(params) : Promise.resolve(undefined),
    ]);

    result.images = images;
    Object.assign(result, captions);
    if (!result.images.length && this.lastImageError) {
      result.image_error = this.lastImageError;
    }
    if (videoUrl) {
      result.video_url = videoUrl;
    } else if (params.generateVideo && this.lastVideoError) {
      result.video_error = this.lastVideoError;
    }
    return result;
  }

  private async generateImages(params: GenerationParams, imageCount: number): Promise<string[]> {
    const modelCandidates = (process.env.OPENAI_IMAGE_MODEL_PRIORITY ?? 'gpt-image-1.5,gpt-image-1,dall-e-3')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean);
    const count = 1;
    this.lastImageError = null;
    const prompt = `${params.prompt}. Stylize for ${params.businessType} social media campaign.`;
    const attempts = Math.max(Number(process.env.OPENAI_IMAGE_ATTEMPTS ?? 2), 1);
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      for (const model of modelCandidates) {
        try {
          const request: Record<string, unknown> = {
            model,
            prompt,
            size: '1024x1024',
            n: count,
          };
          if (model.startsWith('dall-e')) {
            request.response_format = 'url';
          }
          const response = await this.client.images.generate(request as any);
          const data = response.data ?? [];
          const urls: string[] = [];
          for (const item of data) {
            if (item.url) {
              urls.push(item.url);
              continue;
            }
            if ((item as { b64_json?: string }).b64_json) {
              const savedUrl = await saveGeneratedImageBuffer(
                Buffer.from((item as { b64_json: string }).b64_json, 'base64'),
              );
              urls.push(savedUrl);
            }
          }
          if (urls.length) return urls;
          this.lastImageError = `OpenAI returned no image output for ${model}.`;
        } catch (error: any) {
          const message =
            error?.response?.data?.error?.message ??
            error?.message ??
            'OpenAI image generation failed';
          this.lastImageError = `${model}: ${message}`;
          console.error('Image generation failed', this.lastImageError);
        }
      }
      if (attempt < attempts - 1) {
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    }
    return [];
  }

  private async generateVideo(params: GenerationParams) {
    this.lastVideoError = null;
    const prompt = `${params.prompt}. Create a polished vertical social media video for ${params.businessType}. Keep it visually strong, brand-safe, and optimized for short-form engagement.`;
    try {
      const { filePath } = await generateSoraVideoFile({
        prompt,
        model: (process.env.SORA_MODEL as 'sora-2' | 'sora-2-pro' | undefined) ?? 'sora-2',
        seconds: (process.env.SORA_SECONDS as '4' | '8' | '12' | undefined) ?? '8',
        size: (process.env.SORA_SIZE as '720x1280' | '1280x720' | '1024x1792' | '1792x1024' | undefined) ?? '720x1280',
      });
      const extension = path.extname(filePath).replace('.', '') || 'mp4';
      const publicUrl = await saveGeneratedVideoFile(filePath, extension);
      await cleanupTempFile(filePath);
      return publicUrl;
    } catch (error: any) {
      this.lastVideoError =
        error?.response?.data?.error?.message ??
        error?.message ??
        'Sora video generation failed';
      console.error('Video generation failed', this.lastVideoError);
      return undefined;
    }
  }

  private async generateCaptions(params: GenerationParams) {
    const systemPrompt = `You create high-performing social media copy for Instagram, LinkedIn, and Twitter.
Focus on the product/services and outcomes, not the image scene.
Avoid describing clothing, suits, ties, executive suites, or photography/lighting.
Emphasize real services like CRM, social media marketing, lead generation, outreach automation, analytics, AI automation, and appointment booking.
Return JSON with keys:
caption_instagram, caption_linkedin, caption_x, hashtags_instagram (comma separated), hashtags_generic (comma separated 15-25 hashtags).`;

    const completion = await this.client.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.6,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `Prompt: ${params.prompt}\nBusiness type: ${params.businessType}\nServices: CRM, social media marketing, lead generation, outreach automation, analytics, AI automation, appointment booking, auto-replies.\nTone: energetic, helpful, growth-minded.`,
        },
      ],
    });

    const raw = completion.choices?.[0]?.message?.content ?? '{}';
    try {
      const parsed = JSON.parse(raw);
      return {
        caption_instagram: parsed.caption_instagram ?? '',
        caption_linkedin: parsed.caption_linkedin ?? '',
        caption_x: parsed.caption_x ?? '',
        hashtags_instagram: parsed.hashtags_instagram ?? '',
        hashtags_generic: parsed.hashtags_generic ?? '',
      };
    } catch (error) {
      console.error('Caption generation parsing failed', error);
      return {
        caption_instagram: '',
        caption_linkedin: '',
        caption_x: '',
        hashtags_instagram: '',
        hashtags_generic: '',
      };
    }
  }
}

export const contentGenerationService = new ContentGenerationService();
