import OpenAI from 'openai';
import { config } from '../../config.js';
const DEFAULT_OUTPUT = {
    images: [],
    caption_instagram: '',
    caption_linkedin: '',
    caption_x: '',
    hashtags_instagram: '',
    hashtags_generic: '',
};
export class ContentGenerationService {
    constructor() {
        this.client = new OpenAI({ apiKey: config.openAI.apiKey, timeout: 120000 });
        this.lastImageError = null;
    }
    async generateContent(params) {
        const result = { ...DEFAULT_OUTPUT };
        const imageCount = Math.min(Math.max(params.imageCount ?? 2, 1), 4);
        const [images, captions] = await Promise.all([this.generateImages(params, imageCount), this.generateCaptions(params)]);
        result.images = images;
        Object.assign(result, captions);
        if (!result.images.length && this.lastImageError) {
            result.image_error = this.lastImageError;
        }
        return result;
    }
    async generateImages(params, imageCount) {
        const model = 'dall-e-3';
        const count = Math.min(imageCount, 1); // DALL-E 3 supports a single image per request
        this.lastImageError = null;
        const prompt = `${params.prompt}. Stylize for ${params.businessType} social media campaign.`;
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
                const data = response.data ?? [];
                const urls = data.map(item => item.url).filter((url) => Boolean(url));
                if (urls.length)
                    return urls;
                this.lastImageError = 'OpenAI returned no image URL.';
            }
            catch (error) {
                const message = error?.response?.data?.error?.message ??
                    error?.message ??
                    'OpenAI image generation failed';
                this.lastImageError = message;
                console.error('Image generation failed', message);
                if (attempt < attempts - 1) {
                    await new Promise(resolve => setTimeout(resolve, 1500));
                }
            }
        }
        return [];
    }
    async generateCaptions(params) {
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
        }
        catch (error) {
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
