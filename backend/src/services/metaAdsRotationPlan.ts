export type RotationPost = { id: string; platform: 'facebook' | 'instagram' };

/** Each daily campaign shares one lifetime budget across both platform-specific ads. */
export function createSharedBudgetRotationPlan(input: {
  facebookPost: RotationPost;
  instagramPost: RotationPost;
  dailyBudgetCents: number;
  startTime: Date;
  endTime?: Date;
}) {
  const { facebookPost, instagramPost, dailyBudgetCents, startTime } = input;
  if (facebookPost.platform !== 'facebook' || !facebookPost.id.trim()) throw new Error('A Facebook post is required.');
  if (instagramPost.platform !== 'instagram' || !instagramPost.id.trim()) throw new Error('An Instagram post is required.');
  if (!Number.isSafeInteger(dailyBudgetCents) || dailyBudgetCents < 1) throw new Error('A positive shared daily budget is required.');
  if (!Number.isFinite(startTime.getTime())) throw new Error('A valid start time is required.');
  const end = input.endTime ?? new Date(startTime.getTime() + 86_400_000);
  const duration = end.getTime() - startTime.getTime();
  if (!Number.isFinite(duration) || duration <= 0 || duration > 86_400_000) {
    throw new Error('A campaign must end within 24 hours of its start.');
  }
  return {
    campaign: { status: 'PAUSED' as const, lifetime_budget: dailyBudgetCents },
    startTime: startTime.toISOString(),
    endTime: end.toISOString(),
    ads: [
      { status: 'PAUSED' as const, platform: 'facebook' as const, postId: facebookPost.id },
      { status: 'PAUSED' as const, platform: 'instagram' as const, postId: instagramPost.id },
    ],
  };
}
