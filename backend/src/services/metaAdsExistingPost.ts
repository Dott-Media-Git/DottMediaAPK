export type ExistingMetaPost = {
  platform: 'facebook' | 'instagram';
  postId: string;
  pageId: string;
};

/** Build the creative reference only after the caller verifies ownership of the post. */
export function existingPostCreative(input: ExistingMetaPost): Record<string, string> {
  const postId = input.postId.trim();
  const pageId = input.pageId.trim();
  if (!/^\d+$/.test(pageId)) throw new Error('A connected Facebook Page is required.');
  if (input.platform === 'facebook') {
    const parts = postId.split('_');
    if (parts.length !== 2 || parts[0] !== pageId || !/^\d+$/.test(parts[1])) {
      throw new Error('Select a post from the connected Facebook Page.');
    }
    return { object_story_id: postId };
  }
  if (input.platform !== 'instagram' || !/^\d+$/.test(postId)) {
    throw new Error('Select a post from the connected Instagram account.');
  }
  return { source_instagram_media_id: postId };
}
