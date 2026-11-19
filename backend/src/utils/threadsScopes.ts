/** Add review-only permissions for explicitly configured test accounts. */
export function threadsScopesForUser(base: string[], userId: string | undefined, reviewUserIds: string): string[] {
  const allowed = reviewUserIds.split(',').map(id => id.trim()).filter(Boolean);
  if (!userId || !allowed.includes(userId)) return [...base];
  return Array.from(new Set([...base, 'threads_read_replies', 'threads_manage_replies', 'threads_manage_insights']));
}
