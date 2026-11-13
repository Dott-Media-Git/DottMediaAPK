/** Recover uploaded images from this user's own successfully published posts. */
export function recoverGalleryImageUrls(posts: Array<Record<string, unknown>>): string[] {
  const urls = new Set<string>();
  for (const post of posts) {
    if (post.status !== 'posted' || !Array.isArray(post.imageUrls)) continue;
    for (const item of post.imageUrls) {
      if (typeof item !== 'string') continue;
      try {
        const url = new URL(item);
        if (url.protocol === 'https:' && url.pathname.includes('/app-uploads/images/')) urls.add(item);
      } catch { /* Ignore invalid or inaccessible legacy links. */ }
    }
  }
  return [...urls];
}
