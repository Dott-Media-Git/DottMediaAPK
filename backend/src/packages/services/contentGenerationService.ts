import OpenAI from 'openai';
import { config } from '../../config';

export type GeneratedContent = {
  images: string[];
  caption_instagram: string;
  caption_linkedin: string;
  caption_x: string;
  hashtags_instagram: string;
  hashtags_generic: string;
};

type GenerationParams = {
  prompt: string;
  businessType: string;
  imageCount?: number;
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
  private client = new OpenAI({ apiKey: config.openAI.apiKey });

  async generateContent(params: GenerationParams): Promise<GeneratedContent> {
    const result: GeneratedContent = { ...DEFAULT_OUTPUT };
    const imageCount = Math.min(Math.max(params.imageCount ?? 2, 1), 4);

    const [images, captions] = await Promise.all([this.generateImages(params, imageCount), this.generateCaptions(params)]);

    result.images = images;
    Object.assign(result, captions);
    return result;
  }

  private async generateImages(params: GenerationParams, imageCount: number): Promise<string[]> {
    try {
      const response = await this.client.images.generate({
        model: 'gpt-image-1',
        prompt: `${params.prompt}. Stylize for ${params.businessType} social media campaign.`,
        size: '1024x1024',
        n: imageCount,
      });
      const data = response.data ?? [];
      return data.map(item => item.url).filter((url): url is string => Boolean(url));
    } catch (error) {
      console.error('Image generation failed', error);
      return [];
    }
  }

  private async generateCaptions(params: GenerationParams) {
    const systemPrompt = `You create high-performing social media copy for Instagram, LinkedIn, and Twitter.
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
          content: `Prompt: ${params.prompt}\nBusiness type: ${params.businessType}\nTone: energetic, helpful, growth-minded.`,
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
