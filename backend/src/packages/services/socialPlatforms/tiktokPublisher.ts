// Creator-controlled TikTok posts are handled by tiktokReviewedPublisher and authenticated review routes.
export async function publishToTikTok(_input: unknown): Promise<{remoteId?: string}> {
 throw new Error('TikTok requires creator review. Open Account Integrations > TikTok > Review & post a video.');
}
