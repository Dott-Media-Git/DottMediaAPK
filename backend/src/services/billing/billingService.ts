import admin from 'firebase-admin';
import Stripe from 'stripe';
import createHttpError from 'http-errors';
import axios from 'axios';
import { randomBytes } from 'crypto';
import { firestore } from '../../db/firestore';
import { getPlan, getStripePriceId, normalizePlanId, planCatalog, UsageResource } from './planCatalog';
import { assertUsageAllowed, canActivateCheckoutSession, resolveUsablePlan } from './billingPolicy';

const orgsCollection = firestore.collection('orgs');
const profilesCollection = firestore.collection('profiles');
const usersCollection = firestore.collection('users');
const usageMonthlyCollection = firestore.collection('usageMonthly');
const creditBalancesCollection = firestore.collection('creditBalances');
const financialLedgerCollection = firestore.collection('financialLedger');
const paymentTransactionsCollection = firestore.collection('paymentTransactions');

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

type CheckoutProvider = 'stripe' | 'flutterwave_mobile_money';

export type BillingScope = {
  userId: string;
  orgId: string;
  email?: string;
};

export type UsageCharge = {
  resource: UsageResource;
  amount: number;
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
  const orgData = orgSnap?.exists ? orgSnap.data() : null;
  if (orgPlan) {
    return resolveUsablePlan(orgData);
  }
  const profileSnap = await profilesCollection.doc(scope.userId).get().catch(() => null);
  const profileData = profileSnap?.exists ? profileSnap.data() : null;
  return resolveUsablePlan(profileData);
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
  const flutterwaveConfigured = Boolean(process.env.FLUTTERWAVE_SECRET_KEY);
  return planCatalog.map(plan => ({
    ...plan,
    stripeConfigured: Boolean(getStripePriceId(plan)) || plan.id === 'free' || plan.id === 'enterprise',
    mobileMoneyConfigured: flutterwaveConfigured && plan.id !== 'free' && plan.id !== 'enterprise',
    paymentProviders: {
      stripe: Boolean(getStripePriceId(plan)) || plan.id === 'free' || plan.id === 'enterprise',
      mobileMoney: flutterwaveConfigured && plan.id !== 'free' && plan.id !== 'enterprise',
    },
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
  provider?: 'stripe' | 'flutterwave';
  stripeInvoiceId?: string | null;
  stripeSubscriptionId?: string | null;
  stripeCustomerId?: string | null;
  stripeChargeId?: string | null;
  providerPayment?: Record<string, unknown> | null;
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
    paymentProvider: input.provider ?? 'stripe',
    providerPayment: input.providerPayment ?? null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  await financialLedgerCollection.doc(docId).set(payload, { merge: true });
  return payload;
}

const getFlutterwaveSecretKey = () => process.env.FLUTTERWAVE_SECRET_KEY?.trim() || '';

const getFlutterwaveCurrency = () => (process.env.FLUTTERWAVE_CURRENCY?.trim() || 'UGX').toUpperCase();

const resolveFlutterwaveAmount = (priceMonthlyCents: number) => {
  const currency = getFlutterwaveCurrency();
  if (currency === 'USD') {
    return { currency, amount: Number((priceMonthlyCents / 100).toFixed(2)) };
  }
  if (currency === 'UGX') {
    const rate = Number(process.env.FLUTTERWAVE_USD_TO_UGX_RATE ?? 3800);
    if (!Number.isFinite(rate) || rate <= 0) {
      throw createHttpError(500, 'Invalid FLUTTERWAVE_USD_TO_UGX_RATE');
    }
    return { currency, amount: Math.ceil((priceMonthlyCents / 100) * rate) };
  }
  return { currency, amount: Number((priceMonthlyCents / 100).toFixed(2)) };
};

const buildFlutterwaveTxRef = (planId: string, orgId: string) =>
  `dott_${planId}_${orgId}_${Date.now()}_${randomBytes(4).toString('hex')}`.replace(/[^a-zA-Z0-9_-]/g, '_');

async function createFlutterwaveCheckoutSession(
  scope: BillingScope,
  requestedPlan: string,
  successUrl: string,
  phoneNumber?: string | null,
) {
  const secretKey = getFlutterwaveSecretKey();
  if (!secretKey) throw createHttpError(500, 'Flutterwave is not configured');
  const plan = getPlan(requestedPlan);
  if (plan.id === 'free') throw createHttpError(400, 'Free plan does not need checkout');
  if (plan.id === 'enterprise' || plan.priceMonthlyCents === null) {
    throw createHttpError(400, 'Enterprise requires a custom contract');
  }

  const { currency, amount } = resolveFlutterwaveAmount(plan.priceMonthlyCents);
  const txRef = buildFlutterwaveTxRef(plan.id, scope.orgId);
  const email = scope.email || `${scope.userId}@dottmedia.local`;
  const payload = {
    tx_ref: txRef,
    amount,
    currency,
    redirect_url: successUrl,
    payment_options: currency === 'UGX' ? 'mobilemoneyuganda' : 'card,mobilemoneyuganda,banktransfer',
    customer: {
      email,
      phonenumber: phoneNumber || undefined,
      name: email.split('@')[0],
    },
    customizations: {
      title: 'Dott Media',
      description: `${plan.name} monthly package`,
      logo: process.env.DOTT_PAYMENT_LOGO_URL || undefined,
    },
    meta: {
      userId: scope.userId,
      orgId: scope.orgId,
      plan: plan.id,
      provider: 'flutterwave_mobile_money',
      expectedAmount: amount,
      expectedCurrency: currency,
    },
  };

  await paymentTransactionsCollection.doc(txRef).set({
    txRef,
    provider: 'flutterwave',
    providerMethod: 'mobile_money',
    status: 'pending',
    orgId: scope.orgId,
    userId: scope.userId,
    email,
    planId: plan.id,
    planName: plan.name,
    expectedAmount: amount,
    expectedCurrency: currency,
    expectedUsdCents: plan.priceMonthlyCents,
    phoneNumber: phoneNumber || null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  const response = await axios.post('https://api.flutterwave.com/v3/payments', payload, {
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json',
    },
    timeout: 30000,
  });
  const checkoutUrl = response.data?.data?.link;
  if (!checkoutUrl) {
    throw createHttpError(502, response.data?.message || 'Flutterwave did not return a checkout link');
  }
  await paymentTransactionsCollection.doc(txRef).set({
    checkoutUrl,
    providerResponse: response.data,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  return { checkoutUrl, sessionId: txRef, provider: 'flutterwave_mobile_money' };
}

export async function createCheckoutSession(
  scope: BillingScope,
  requestedPlan: string,
  successUrl: string,
  cancelUrl: string,
  options: { provider?: CheckoutProvider; phoneNumber?: string | null } = {},
) {
  if (options.provider === 'flutterwave_mobile_money') {
    return createFlutterwaveCheckoutSession(scope, requestedPlan, successUrl, options.phoneNumber);
  }
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
  return { checkoutUrl: session.url, sessionId: session.id, provider: 'stripe' };
}

export async function applyPlan(
  scope: BillingScope,
  planValue: string,
  status: 'active' | 'past_due' | 'canceled' = 'active',
  stripeMeta?: Record<string, unknown>,
  extraMeta?: Record<string, unknown>,
) {
  const plan = getPlan(planValue);
  const payload = {
    plan: plan.orgPlan,
    planId: plan.id,
    subscriptionStatus: status,
    billingUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    ...(stripeMeta ? { stripe: stripeMeta } : {}),
    ...(extraMeta ?? {}),
  };
  await Promise.all([
    orgsCollection.doc(scope.orgId).set(payload, { merge: true }),
    profilesCollection.doc(scope.userId).set(payload, { merge: true }),
    usersCollection.doc(scope.userId).set(payload, { merge: true }),
  ]);
  return plan;
}

export async function consumeUsage(scope: BillingScope, resource: UsageResource, amount = 1) {
  const result = await consumeUsageBatch(scope, [{ resource, amount }]);
  return { ...result, resource, amount };
}

export async function consumeUsageBatch(scope: BillingScope, charges: UsageCharge[]) {
  const normalized = new Map<UsageResource, number>();
  for (const charge of charges) {
    const amount = Number(charge.amount);
    if (!Number.isInteger(amount) || amount <= 0) {
      throw createHttpError(400, `Invalid usage amount for ${charge.resource}`);
    }
    normalized.set(charge.resource, (normalized.get(charge.resource) ?? 0) + amount);
  }
  if (!normalized.size) throw createHttpError(400, 'At least one usage charge is required');

  const orgRef = orgsCollection.doc(scope.orgId);
  const profileRef = profilesCollection.doc(scope.userId);
  const usageRef = usageMonthlyCollection.doc(monthlyUsageId(scope));
  const creditsRef = creditBalancesCollection.doc(scope.orgId);
  const month = currentMonthKey();

  return firestore.runTransaction(async transaction => {
    const [orgSnap, profileSnap, usageSnap, creditsSnap] = await Promise.all([
      transaction.get(orgRef),
      transaction.get(profileRef),
      transaction.get(usageRef),
      transaction.get(creditsRef),
    ]);
    const orgData = orgSnap.exists ? orgSnap.data() : null;
    const profileData = profileSnap.exists ? profileSnap.data() : null;
    const billingData = orgData?.plan || orgData?.planId ? orgData : profileData;
    const plan = resolveUsablePlan(billingData);
    const usage = usageSnap.exists ? usageSnap.data() ?? {} : {};
    const credits = creditsSnap.exists ? creditsSnap.data() ?? {} : {};

    assertUsageAllowed(plan, usage, credits, normalized);

    const increments: Record<string, unknown> = {
      orgId: scope.orgId,
      userId: scope.userId,
      month,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    for (const [resource, amount] of normalized) {
      increments[resource] = admin.firestore.FieldValue.increment(amount);
    }
    transaction.set(usageRef, increments, { merge: true });
    return {
      ok: true,
      plan,
      month,
      charges: [...normalized].map(([resource, amount]) => ({ resource, amount })),
    };
  });
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
  if (!canActivateCheckoutSession(session.payment_status)) return null;
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
  const currentPeriodEnd = (subscription as any).current_period_end;
  return applyPlan(scope, normalizePlanId(metadata.plan), status, {
    customerId: typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id,
    subscriptionId: subscription.id,
    subscriptionStatus: subscription.status,
  }, {
    billingProvider: 'stripe',
    billingCycleEndsAt:
      typeof currentPeriodEnd === 'number'
        ? admin.firestore.Timestamp.fromMillis(currentPeriodEnd * 1000)
        : null,
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

async function verifyFlutterwaveTransaction(transactionId: string | number) {
  const secretKey = getFlutterwaveSecretKey();
  if (!secretKey) throw createHttpError(500, 'Flutterwave is not configured');
  const response = await axios.get(`https://api.flutterwave.com/v3/transactions/${transactionId}/verify`, {
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json',
    },
    timeout: 30000,
  });
  return response.data?.data ?? null;
}

export async function applyFlutterwavePayment(input: { txRef?: string | null; transactionId?: string | number | null }) {
  const txRef = input.txRef?.trim();
  const transactionId = input.transactionId;
  if (!txRef && !transactionId) return null;

  let paymentSnap = txRef ? await paymentTransactionsCollection.doc(txRef).get() : null;
  let paymentData = paymentSnap?.exists ? paymentSnap.data() : null;
  if (!paymentData && txRef) {
    return null;
  }
  if (!paymentData && transactionId) {
    const snap = await paymentTransactionsCollection.where('providerTransactionId', '==', String(transactionId)).limit(1).get();
    paymentSnap = snap.docs[0] ?? null;
    paymentData = paymentSnap?.exists ? paymentSnap.data() : null;
  }
  if (!paymentSnap?.ref || !paymentData) return null;
  if (paymentData.status === 'successful' || paymentData.status === 'completed') {
    return { ok: true, status: paymentData.status, duplicate: true };
  }

  if (!transactionId) {
    await paymentSnap.ref.set({ status: 'pending_verification', updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    return { ok: false, status: 'pending_verification' };
  }

  const verified = await verifyFlutterwaveTransaction(transactionId);
  const verifiedTxRef = String(verified?.tx_ref ?? '');
  const expectedAmount = Number(paymentData.expectedAmount ?? 0);
  const expectedCurrency = String(paymentData.expectedCurrency ?? '').toUpperCase();
  const amount = Number(verified?.amount ?? verified?.charged_amount ?? 0);
  const currency = String(verified?.currency ?? '').toUpperCase();
  const status = String(verified?.status ?? '').toLowerCase();

  if (verifiedTxRef !== paymentData.txRef || status !== 'successful' || currency !== expectedCurrency || amount < expectedAmount) {
    await paymentSnap.ref.set({
      status: status || 'failed',
      providerTransactionId: String(transactionId),
      verified,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    return { ok: false, status: status || 'failed' };
  }

  const scope = resolveBillingScope(String(paymentData.userId), String(paymentData.orgId), String(paymentData.email ?? ''));
  const billingCycleEndsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await applyPlan(
    scope,
    String(paymentData.planId),
    'active',
    undefined,
    {
      billingProvider: 'flutterwave',
      billingCycleEndsAt: admin.firestore.Timestamp.fromDate(billingCycleEndsAt),
      flutterwave: {
        txRef: paymentData.txRef,
        transactionId: String(transactionId),
        currency,
        amount,
        paymentType: verified?.payment_type ?? null,
      },
    },
  );
  await recordFinancialAllocation({
    scope,
    plan: String(paymentData.planId),
    amountPaidCents: Number(paymentData.expectedUsdCents ?? getPlan(paymentData.planId).priceMonthlyCents ?? 0),
    currency: 'usd',
    provider: 'flutterwave',
    providerPayment: {
      txRef: paymentData.txRef,
      transactionId: String(transactionId),
      currency,
      amount,
      amountSettled: verified?.amount_settled ?? null,
      chargedAmount: verified?.charged_amount ?? null,
      appFee: verified?.app_fee ?? null,
      paymentType: verified?.payment_type ?? null,
    },
  });

  await paymentSnap.ref.set({
    status: 'successful',
    providerTransactionId: String(transactionId),
    verified,
    billingCycleEndsAt,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  return { ok: true, status: 'successful' };
}

export async function listFinancialAllocations(scope: BillingScope, limit = 12) {
  const snap = await financialLedgerCollection
    .where('orgId', '==', scope.orgId)
    .orderBy('createdAt', 'desc')
    .limit(Math.min(Math.max(limit, 1), 50))
    .get();
  return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}
