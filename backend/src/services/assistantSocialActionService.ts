import admin from 'firebase-admin';
import { firestore } from '../db/firestore';
import { contentGenerationService } from '../packages/services/contentGenerationService';
import { socialSchedulingService, type SchedulePayload } from '../packages/services/socialSchedulingService';
import { socialPostingService } from '../packages/services/socialPostingService';
import { supabaseFallbackService } from './supabaseFallbackService';

const supportedPlatforms = new Set<SchedulePayload['platforms'][number]>([
  'instagram', 'instagram_reels', 'instagram_story', 'facebook', 'facebook_story',
  'linkedin', 'twitter', 'x', 'threads', 'tiktok', 'youtube', 'whatsapp',
]);

class AssistantSocialActionService {
  async generateImage(input: { userId: string; orgId?: string; prompt: string; businessType?: string }) {
    const result = await contentGenerationService.generateContent({
      prompt: input.prompt,
      businessType: input.businessType || 'Business',
      imageCount: 1,
      userId: input.userId,
      orgId: input.orgId,
    });
    if (!result.images[0]) throw new Error(result.image_error || 'Image generation returned no image.');
    return { imageUrl: result.images[0], caption: result.caption_instagram || result.caption_linkedin || result.caption_x, hashtags: result.hashtags_instagram || result.hashtags_generic };
  }

  async publishNow(input: { userId: string; platforms: string[]; caption: string; hashtags?: string; imageUrl?: string; videoUrl?: string }) {
    const platforms = [...new Set(input.platforms.map(value => value.toLowerCase().trim()))]
      .filter((value): value is SchedulePayload['platforms'][number] => supportedPlatforms.has(value as SchedulePayload['platforms'][number]));
    if (!platforms.length) throw new Error('Choose at least one supported connected platform.');
    const result = await socialSchedulingService.schedulePosts({
      userId: input.userId,
      platforms,
      images: input.imageUrl ? [input.imageUrl] : undefined,
      videoUrl: input.videoUrl,
      tiktokVideoUrl: input.videoUrl,
      youtubeVideoUrl: input.videoUrl,
      instagramReelsVideoUrl: input.videoUrl,
      caption: input.caption,
      hashtags: input.hashtags,
      scheduledFor: new Date().toISOString(),
      timesPerDay: 1,
    });
    await socialPostingService.runQueue(100);
    return result;
  }

  async configureReplies(input: { userId: string; enabled: boolean; instructions?: string }) {
    const threadsSaved = supabaseFallbackService.isConfigured();
    if (threadsSaved) {
      await supabaseFallbackService.addInboundMessage({
        id: `threads_auto_response_setting_${input.userId}`,
        channel: 'settings', senderId: input.userId, recipientId: input.userId,
        messageType: 'threads_auto_response', status: 'configured',
        payload: { enabled: input.enabled },
      });
      const saved = await supabaseFallbackService.getInboundMessage(`threads_auto_response_setting_${input.userId}`);
      if ((saved?.payload as { enabled?: unknown } | undefined)?.enabled !== input.enabled) {
        throw new Error('Unable to confirm that the Threads auto-response setting was saved.');
      }
    }
    const firebaseUpdate = firestore.collection('assistant_settings').doc(input.userId).set({
      autoReplyEnabled: input.enabled,
      autoReplyPrompt: input.instructions?.trim() || admin.firestore.FieldValue.delete(),
      autoReplyUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      autoReplyUpdatedBy: 'dotti',
    }, { merge: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        firebaseUpdate,
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Reply settings timed out')), 4000); }),
      ]);
      return { enabled: input.enabled, threadsSaved, otherSettingsSynced: true };
    } catch (error) {
      if (!threadsSaved) throw error;
      return { enabled: input.enabled, threadsSaved: true, otherSettingsSynced: false,
        warning: 'Threads settings were saved, but other channel settings could not be confirmed.' };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

export const assistantSocialActionService = new AssistantSocialActionService();
