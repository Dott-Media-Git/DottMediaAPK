import { getPlan } from './planCatalog.js';
const toDate = (value) => {
    if (!value)
        return null;
    const resolved = value?.toDate?.() ?? new Date(value);
    return resolved instanceof Date && Number.isFinite(resolved.getTime()) ? resolved : null;
};
export const resolveUsablePlan = (data, now = new Date()) => {
    const plan = getPlan(data?.planId ?? data?.plan ?? 'free');
    if (plan.id === 'free')
        return plan;
    const status = String(data?.subscriptionStatus ?? '').trim().toLowerCase();
    if (status !== 'active' && status !== 'trialing')
        return getPlan('free');
    const endsAt = toDate(data?.billingCycleEndsAt);
    if (endsAt && endsAt.getTime() <= now.getTime())
        return getPlan('free');
    return plan;
};
export const canActivateCheckoutSession = (paymentStatus) => paymentStatus === 'paid' || paymentStatus === 'no_payment_required';
export const assertUsageAllowed = (plan, usage, credits, charges) => {
    for (const [resource, amount] of charges) {
        const usedValue = Number(usage[resource] ?? 0);
        const creditValue = Number(credits[resource] ?? 0);
        const used = Number.isFinite(usedValue) && usedValue > 0 ? usedValue : 0;
        const credit = Number.isFinite(creditValue) && creditValue > 0 ? creditValue : 0;
        const limit = plan.limits[resource];
        if (limit !== null && used + amount > limit + credit) {
            const error = new Error(`${resource} limit reached for the ${plan.name} plan. Upgrade or buy credits to continue.`);
            error.status = 402;
            throw error;
        }
    }
};
