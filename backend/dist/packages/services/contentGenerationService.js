import OpenAI from 'openai';
import path from 'path';
import { config } from '../../config.js';
import { saveGeneratedImageBuffer, saveGeneratedVideoFile } from '../../services/generatedMediaService.js';
import { generateSoraVideoFile } from '../../services/soraVideoService.js';
import { cleanupTempFile } from '../../services/videoUrlService.js';
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
        this.lastVideoError = null;
    }
    async generateContent(params) {
        const result = { ...DEFAULT_OUTPUT };
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
        }
        else if (params.generateVideo && this.lastVideoError) {
            result.video_error = this.lastVideoError;
        }
        return result;
    }
    async generateImages(params, imageCount) {
        if (process.env.OPENAI_IMAGE_GENERATION_ENABLED === 'false') {
            this.lastImageError = 'OpenAI image generation disabled';
            return [];
        }
        const modelCandidates = (process.env.OPENAI_IMAGE_MODEL_PRIORITY ?? 'gpt-image-1.5,gpt-image-1,dall-e-3')
            .split(',')
            .map(value => value.trim())
            .filter(Boolean);
        if (!modelCandidates.length) {
            this.lastImageError = 'No OpenAI image models configured';
            return [];
        }
        const count = 1;
        this.lastImageError = null;
        const prompt = `${params.prompt}. Stylize for ${params.businessType} social media campaign.`;
        const attempts = Math.max(Number(process.env.OPENAI_IMAGE_ATTEMPTS ?? 2), 1);
        for (let attempt = 0; attempt < attempts; attempt += 1) {
            for (const model of modelCandidates) {
                try {
                    const request = {
                        model,
                        prompt,
                        size: '1024x1024',
                        n: count,
                    };
                    if (model.startsWith('dall-e')) {
                        request.response_format = 'url';
                    }
                    const response = await this.client.images.generate(request);
                    const data = response.data ?? [];
                    const urls = [];
                    for (const item of data) {
                        if (item.url) {
                            urls.push(item.url);
                            continue;
                        }
                        if (item.b64_json) {
                            const savedUrl = await saveGeneratedImageBuffer(Buffer.from(item.b64_json, 'base64'));
                            urls.push(savedUrl);
                        }
                    }
                    if (urls.length)
                        return urls;
                    this.lastImageError = `OpenAI returned no image output for ${model}.`;
                }
                catch (error) {
                    const message = error?.response?.data?.error?.message ??
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
    async generateVideo(params) {
        this.lastVideoError = null;
        const prompt = `${params.prompt}. Create a polished vertical social media video for ${params.businessType}. Keep it visually strong, brand-safe, and optimized for short-form engagement.`;
        try {
            const { filePath } = await generateSoraVideoFile({
                prompt,
                model: process.env.SORA_MODEL ?? 'sora-2',
                seconds: process.env.SORA_SECONDS ?? '8',
                size: process.env.SORA_SIZE ?? '720x1280',
            });
            const extension = path.extname(filePath).replace('.', '') || 'mp4';
            const publicUrl = await saveGeneratedVideoFile(filePath, extension);
            await cleanupTempFile(filePath);
            return publicUrl;
        }
        catch (error) {
            this.lastVideoError =
                error?.response?.data?.error?.message ??
                    error?.message ??
                    'Sora video generation failed';
            console.error('Video generation failed', this.lastVideoError);
            return undefined;
        }
    }
    async generateCaptions(params) {
        const context = `${params.businessType} ${params.prompt}`.toLowerCase();
        const sportsMode = /\b(bwin|sport|sports|football|soccer|bet|betting|fixture|fixtures|odds|result|results|goal|highlight|league|table|prediction)\b/.test(context);
        const systemPrompt = sportsMode
            ? `You create high-performing social media copy for Instagram, LinkedIn, and Twitter for football and sports betting brands.
Focus on fixtures, results, highlights, odds, tables, predictions, and matchday energy.
Do not mention CRM, lead generation, demos, pipelines, appointment booking, robots, outreach automation, or B2B services.
Return JSON with keys:
caption_instagram, caption_linkedin, caption_x, hashtags_instagram (comma separated), hashtags_generic (comma separated 15-25 hashtags).`
            : `You create high-performing social media copy for Instagram, LinkedIn, and Twitter.
Focus on the product/services and outcomes, not the image scene.
Avoid describing clothing, suits, ties, executive suites, or photography/lighting.
Emphasize real services like CRM, social media marketing, lead generation, outreach automation, analytics, AI automation, and appointment booking.
Return JSON with keys:
caption_instagram, caption_linkedin, caption_x, hashtags_instagram (comma separated), hashtags_generic (comma separated 15-25 hashtags).`;
        const userPrompt = sportsMode
            ? `Prompt: ${params.prompt}\nBusiness type: ${params.businessType}\nFocus: football updates, odds, fixtures, results, highlights, tables, predictions, and sports engagement.\nTone: energetic, sports-focused, concise, and betting-friendly.`
            : `Prompt: ${params.prompt}\nBusiness type: ${params.businessType}\nServices: CRM, social media marketing, lead generation, outreach automation, analytics, AI automation, appointment booking, auto-replies.\nTone: energetic, helpful, growth-minded.`;
        const completion = await this.client.chat.completions.create({
            model: 'gpt-4o-mini',
            temperature: 0.6,
            response_format: { type: 'json_object' },
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
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
