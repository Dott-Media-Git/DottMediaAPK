export type RotationPost = { id: string; platform: 'facebook' | 'instagram' };

const dayMs = 86_400_000;
const kampalaOffset = 3 * 3_600_000;
const carMarketRotationDays = 10;

export function getCarMarketRotationDay(startDate: string, now: number) {
  const anchor = Date.parse(`${startDate}T00:00:00.000+03:00`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !Number.isFinite(anchor)) {
    throw new Error('An activation date is required in YYYY-MM-DD format.');
  }
  if (now < anchor) return { status: 'waiting_for_start_date' } as const;
  const day = Math.floor((now - anchor) / dayMs);
  if (day >= carMarketRotationDays) return { status: 'rotation_finished' } as const;
  return {
    status: 'scheduled',
    date: new Date(now + kampalaOffset).toISOString().slice(0, 10),
    dayEnd: anchor + (day + 1) * dayMs,
    pairIndex: Math.floor(day / 2),
  } as const;
}

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
  const end = input.endTime ?? new Date(startTime.getTime() + dayMs);
  const duration = end.getTime() - startTime.getTime();
  if (!Number.isFinite(duration) || duration <= 0 || duration > dayMs) {
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
