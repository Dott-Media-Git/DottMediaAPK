import admin from 'firebase-admin';
import Stripe from 'stripe';
import createHttpError from 'http-errors';
import { firestore } from '../../db/firestore';
import { getPlan, getStripePriceId, normalizePlanId, planCatalog, UsageResource } from './planCatalog';

const orgsCollection = firestore.collection('orgs');
const profilesCollection = firestore.collection('profiles');
const usersCollection = firestore.collection('users');
const usageMonthlyCollection = firestore.collection('usageMonthly');
const creditBalancesCollection = firestore.collection('creditBalances');
const financialLedgerCollection = firestore.collection('financialLedger');

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

export type BillingScope = {
  userId: string;
  orgId: string;
  email?: string;
};

export const currentMonthKey = (date = new Date()) => date.toISOString().slice(0, 7).replace('-', '');

export const resolveBillingScope = (userId: string, orgId?: string | null, email?: string): BillingScope => ({
  userId,
  orgId: orgId?.trim() || userId,
  email,
});

const monthlyUsageId = (scope: BillingScope, month = currentMonthKey()) => `${scope.orgId}_${month}`;

export async function getPlanForScope(scope: BillingScope) {
  const orgSnap = await orgsCollection.doc(scope.orgId).get().catch(() => null);
  const orgPlan = orgSnap?.exists ? orgSnap.data()?.plan : null;
  if (orgPlan) return getPlan(orgPlan);
  const profileSnap = await profilesCollection.doc(scope.userId).get().catch(() => null);
  return getPlan(profileSnap?.exists ? profileSnap.data()?.plan : 'free');
}

export async function getBillingOverview(scope: BillingScope) {
  const [plan, usageSnap, creditsSnap] = await Promise.all([
    getPlanForScope(scope),
    usageMonthlyCollection.doc(monthlyUsageId(scope)).get(),
    creditBalancesCollection.doc(scope.orgId).get(),
  ]);
  return {
    scope: { orgId: scope.orgId, userId: scope.userId },
    plan,
    month: currentMonthKey(),
    usage: usageSnap.exists ? usageSnap.data() : {},
    credits: creditsSnap.exists ? creditsSnap.data() : {},
  };
}

export function listBillingPlans() {
  return planCatalog.map(plan => ({
    ...plan,
    stripeConfigured: Boolean(getStripePriceId(plan)) || plan.id === 'free' || plan.id === 'enterprise',
  }));
}

const calculateAllocation = (planValue: string, grossRevenueCents: number) => {
  const plan = getPlan(planValue);
  const baseRevenue = plan.priceMonthlyCents && plan.priceMonthlyCents > 0 ? plan.priceMonthlyCents : grossRevenueCents;
  const scale = baseRevenue > 0 ? grossRevenueCents / baseRevenue : 1;
  const estimated = plan.estimatedCostsCents ?? { openAi: 0, backend: 0, otherOps: 0 };
  const openAiCents = Math.round(estimated.openAi * scale);
  const backendCents = Math.round(estimated.backend * scale);
  const otherOpsCents = Math.round(estimated.otherOps * scale);
  const directCostCents = openAiCents + backendCents + otherOpsCents;
  const operatingReserveCents = Math.max(Math.round(grossRevenueCents * 0.15), 0);
  return {
    plan,
    grossRevenueCents,
    providerCostReserveCents: {
      openAi: openAiCents,
      backendInfrastructure: backendCents,
      operationsAndSupport: otherOpsCents,
    },
    directCostReserveCents: directCostCents,
    grossProfitCents: grossRevenueCents - directCostCents,
    operatingReserveCents,
    netProfitCents: grossRevenueCents - directCostCents - operatingReserveCents,
  };
};

export async function recordFinancialAllocation(input: {
  scope: BillingScope;
  plan: string;
  amountPaidCents: number;
  currency?: string | null;
  stripeInvoiceId?: string | null;
  stripeSubscriptionId?: string | null;
  stripeCustomerId?: string | null;
  stripeChargeId?: string | null;
}) {
  const allocation = calculateAllocation(input.plan, input.amountPaidCents);
  const docId = input.stripeInvoiceId || `${input.scope.orgId}_${Date.now()}`;
  const payload = {
    orgId: input.scope.orgId,
    userId: input.scope.userId,
    planId: allocation.plan.id,
    planName: allocation.plan.name,
    currency: (input.currency ?? 'usd').toLowerCase(),
    grossRevenueCents: allocation.grossRevenueCents,
    providerCostReserveCents: allocation.providerCostReserveCents,
    directCostReserveCents: allocation.directCostReserveCents,
    grossProfitCents: allocation.grossProfitCents,
    operatingReserveCents: allocation.operatingReserveCents,
    netProfitCents: allocation.netProfitCents,
    providerPaymentMode: 'external_provider_billing',
    providerPaymentNote:
      'OpenAI, hosting, database, CDN, observability, and queue providers charge their own billing accounts. This ledger records the reserve that should be kept from Stripe revenue for those invoices.',
    profitDestination: process.env.STRIPE_PROFIT_PAYOUT_LABEL || 'Stripe default payout bank account',
    stripe: {
      invoiceId: input.stripeInvoiceId ?? null,
      subscriptionId: input.stripeSubscriptionId ?? null,
      customerId: input.stripeCustomerId ?? null,
      chargeId: input.stripeChargeId ?? null,
    },
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  await financialLedgerCollection.doc(docId).set(payload, { merge: true });
  return payload;
}

export async function createCheckoutSession(scope: BillingScope, requestedPlan: string, successUrl: string, cancelUrl: string) {
  if (!stripe) throw createHttpError(500, 'Stripe is not configured');
  const plan = getPlan(requestedPlan);
  if (plan.id === 'free') throw createHttpError(400, 'Free plan does not need checkout');
  if (plan.id === 'enterprise') throw createHttpError(400, 'Enterprise requires a custom contract');
  const priceId = getStripePriceId(plan);
  if (!priceId) throw createHttpError(400, `${plan.name} checkout is not configured yet`);
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer_email: scope.email,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      userId: scope.userId,
      orgId: scope.orgId,
      plan: plan.id,
    },
    subscription_data: {
      metadata: {
        userId: scope.userId,
        orgId: scope.orgId,
        plan: plan.id,
      },
    },
  });
  return { checkoutUrl: session.url, sessionId: session.id };
}

export async function applyPlan(scope: BillingScope, planValue: string, status: 'active' | 'past_due' | 'canceled' = 'active', stripeMeta?: Record<string, unknown>) {
  const plan = getPlan(planValue);
  const payload = {
    plan: plan.orgPlan,
    planId: plan.id,
    subscriptionStatus: status,
    billingUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    ...(stripeMeta ? { stripe: stripeMeta } : {}),
  };
  await Promise.all([
    orgsCollection.doc(scope.orgId).set(payload, { merge: true }),
    profilesCollection.doc(scope.userId).set(payload, { merge: true }),
    usersCollection.doc(scope.userId).set(payload, { merge: true }),
  ]);
  return plan;
}

export async function consumeUsage(scope: BillingScope, resource: UsageResource, amount = 1) {
  const overview = await getBillingOverview(scope);
  const plan = overview.plan;
  const usage = (overview.usage?.[resource] as number) ?? 0;
  const credits = (overview.credits?.[resource] as number) ?? 0;
  const limit = plan.limits[resource];
  if (limit !== null && usage + amount > limit + credits) {
    throw createHttpError(402, `${resource} limit reached. Upgrade or buy credits to continue.`);
  }
  const ref = usageMonthlyCollection.doc(monthlyUsageId(scope));
  await ref.set(
    {
      orgId: scope.orgId,
      userId: scope.userId,
      month: currentMonthKey(),
      [resource]: admin.firestore.FieldValue.increment(amount),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  return { ok: true, plan, resource, amount };
}

export async function consumeUsageForUserId(userId: string, resource: UsageResource, amount = 1, orgId?: string | null) {
  const userSnap = await usersCollection.doc(userId).get().catch(() => null);
  const userData = userSnap?.exists ? userSnap.data() : {};
  const email = typeof userData?.email === 'string' ? userData.email : undefined;
  const resolvedOrgId =
    orgId?.trim() ||
    (typeof userData?.orgId === 'string' && userData.orgId.trim() ? userData.orgId.trim() : undefined) ||
    userId;
  return consumeUsage(resolveBillingScope(userId, resolvedOrgId, email), resource, amount);
}

export async function applyStripeCheckoutCompleted(session: Stripe.Checkout.Session) {
  const metadata = session.metadata ?? {};
  if (!metadata.userId || !metadata.plan) return null;
  const scope = resolveBillingScope(metadata.userId, metadata.orgId, session.customer_details?.email ?? undefined);
  return applyPlan(scope, metadata.plan, 'active', {
    customerId: typeof session.customer === 'string' ? session.customer : session.customer?.id,
    subscriptionId: typeof session.subscription === 'string' ? session.subscription : session.subscription?.id,
    checkoutSessionId: session.id,
  });
}

export async function applyStripeSubscription(subscription: Stripe.Subscription) {
  const metadata = subscription.metadata ?? {};
  if (!metadata.userId || !metadata.plan) return null;
  const status = subscription.status === 'active' || subscription.status === 'trialing'
    ? 'active'
    : subscription.status === 'past_due' || subscription.status === 'unpaid'
      ? 'past_due'
      : 'canceled';
  const scope = resolveBillingScope(metadata.userId, metadata.orgId);
  return applyPlan(scope, normalizePlanId(metadata.plan), status, {
    customerId: typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id,
    subscriptionId: subscription.id,
    subscriptionStatus: subscription.status,
  });
}

export async function applyStripeInvoicePaid(invoice: Stripe.Invoice) {
  const subscriptionId =
    typeof (invoice as any).subscription === 'string'
      ? (invoice as any).subscription
      : (invoice as any).subscription?.id;
  if (!subscriptionId || !stripe) return null;
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  await applyStripeSubscription(subscription);
  const metadata = subscription.metadata ?? {};
  if (!metadata.userId || !metadata.plan) return null;
  const scope = resolveBillingScope(metadata.userId, metadata.orgId, invoice.customer_email ?? undefined);
  return recordFinancialAllocation({
    scope,
    plan: metadata.plan,
    amountPaidCents: invoice.amount_paid ?? 0,
    currency: invoice.currency,
    stripeInvoiceId: invoice.id,
    stripeSubscriptionId: subscription.id,
    stripeCustomerId: typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id,
    stripeChargeId:
      typeof (invoice as any).charge === 'string'
        ? (invoice as any).charge
        : (invoice as any).charge?.id,
  });
}

export async function listFinancialAllocations(scope: BillingScope, limit = 12) {
  const snap = await financialLedgerCollection
    .where('orgId', '==', scope.orgId)
    .orderBy('createdAt', 'desc')
    .limit(Math.min(Math.max(limit, 1), 50))
    .get();
  return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}
