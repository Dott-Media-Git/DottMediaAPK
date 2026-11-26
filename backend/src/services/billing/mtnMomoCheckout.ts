import admin from 'firebase-admin';
import { randomUUID } from 'node:crypto';
import createHttpError from 'http-errors';
import { firestore } from '../../db/firestore';
import { getPlan } from './planCatalog';
import { buildFinancialAllocationRecord } from './billingService';
import { resolveUsablePlan } from './billingPolicy';
import { classifyMtnPayment, createMtnClient, mtnConfig, normalizeMtnPayer, type MtnConfig, type MtnMode } from './mtnMomoClient';

type State = 'pending' | 'failed' | 'successful' | 'review';
type Payment = {
  id: string;
  uid: string;
  mode: MtnMode;
  state: State;
  planId: string;
  planName: string;
  amountUgx: number;
  priceUsdCents: number;
  amount: number;
  currency: 'EUR' | 'UGX';
  lastSubmitAt: number;
  submission: 'uncertain' | 'accepted';
};

const transactions = firestore.collection('mtnMomoPayments');
const locks = firestore.collection('mtnMomoCheckoutLocks');
const orgs = firestore.collection('orgs');
const profiles = firestore.collection('profiles');
const users = firestore.collection('users');
const ledger = firestore.collection('financialLedger');

let client: ReturnType<typeof createMtnClient> | undefined;
const getClient = (config: MtnConfig) => client ??= createMtnClient(config);

const accessibleConfig = (uid: string) => {
  const config = mtnConfig();
  return config && (config.mode === 'production' || config.testers.includes(uid)) ? config : null;
};
const requireConfig = (uid: string) => {
  const config = accessibleConfig(uid);
  if (!config) throw createHttpError(503, 'MTN MoMo checkout is unavailable.');
  return config;
};

export const mtnCheckoutMode = (uid: string) => accessibleConfig(uid)?.mode ?? null;

export const createMtnQuote = (uid: string, planId: string) => {
  const config = requireConfig(uid);
  if (planId !== 'creator' && planId !== 'agency') throw createHttpError(400, 'Choose Creator or Agency.');
  const plan = getPlan(planId);
  const amountUgx = Math.ceil((Number(plan.priceMonthlyCents) / 100) * config.usdToUgx);
  if (!Number.isSafeInteger(amountUgx) || amountUgx <= 0) throw createHttpError(503, 'The UGX price is unavailable.');
  return { planId, planName: plan.name, amountUgx, mode: config.mode };
};

const publicPayment = (payment: Payment) => ({
  id: payment.id, state: payment.state, mode: payment.mode,
  planId: payment.planId, planName: payment.planName, amountUgx: payment.amountUgx, submission: payment.submission,
});
const lockRef = (uid: string, mode: MtnMode) => locks.doc(mode + '_' + uid);
const timestamp = (ms = Date.now()) => admin.firestore.Timestamp.fromMillis(ms);

async function getCurrentPlan(transaction: admin.firestore.Transaction, uid: string) {
  const [org, profile] = await transaction.getAll(orgs.doc(uid), profiles.doc(uid));
  const primary = org.data();
  return resolveUsablePlan(primary?.plan || primary?.planId ? primary : profile.data());
}

export async function currentMtnPayment(uid: string) {
  const config = requireConfig(uid);
  const lock = await lockRef(uid, config.mode).get();
  const id = lock.data()?.paymentId;
  if (typeof id !== 'string') return null;
  const snapshot = await transactions.doc(id).get();
  const payment = snapshot.data() as Payment | undefined;
  return payment?.uid === uid && payment.mode === config.mode ? publicPayment(payment) : null;
}

export async function startMtnPayment(uid: string, input: { planId: string; amountUgx: number; mode: MtnMode; phone: string }) {
  const config = requireConfig(uid);
  const quote = createMtnQuote(uid, input.planId);
  if (input.mode !== quote.mode) {
    throw createHttpError(409, 'The payment quote changed. Request a new quote.');
  }
  const phone = normalizeMtnPayer(input.phone, config.mode);
  const api = getClient(config);
  // Verify MTN credentials before recording a pending attempt.
  const authorization = await api.authorize().catch(() => {
    throw createHttpError(503, 'MTN MoMo is temporarily unavailable. Please try again later.');
  });
  const id = randomUUID();
  const lock = lockRef(uid, config.mode);

  const { payment, send, retrying } = await firestore.runTransaction(async transaction => {
    const lockSnap = await transaction.get(lock);
    const existingId = lockSnap.data()?.paymentId;
    if (typeof existingId === 'string') {
      const previous = await transaction.get(transactions.doc(existingId));
      const data = previous.data() as (Payment & { phone?: string }) | undefined;
      if (data?.uid === uid && data.mode === config.mode && (data.state === 'pending' || data.state === 'review')) {
        const now = Date.now();
        if (data.state !== 'pending' || data.submission === 'accepted' || now - data.lastSubmitAt < 20_000 ||
            data.planId !== input.planId || data.amountUgx !== input.amountUgx || data.phone !== phone) {
          return { payment: data, send: false, retrying: false };
        }
        const retry = { ...data, lastSubmitAt: now };
        transaction.update(previous.ref, { lastSubmitAt: now });
        return { payment: retry, send: true, retrying: true };
      }
    }

    if (input.amountUgx !== quote.amountUgx) throw createHttpError(409, 'The payment quote changed. Request a new quote.');
    if (config.mode === 'production' && (await getCurrentPlan(transaction, uid)).id !== 'free') {
      throw createHttpError(409, 'MTN MoMo is available when your current paid plan ends.');
    }

    const attempt: Payment = {
      ...quote, id, uid, state: 'pending', lastSubmitAt: Date.now(), submission: 'uncertain',
      priceUsdCents: Number(getPlan(quote.planId).priceMonthlyCents),
      amount: config.mode === 'sandbox' ? 1 : quote.amountUgx, currency: config.mode === 'sandbox' ? 'EUR' : 'UGX',
    };
    transaction.create(transactions.doc(id), { ...attempt, phone, createdAt: timestamp(), nextCheckAt: timestamp(Date.now() + 20_000) });
    transaction.set(lock, { paymentId: id });
    return { payment: attempt, send: true, retrying: false };
  });

  if (!send) return publicPayment(payment);
  const sendResult = await api.requestPayment({ ...payment, phone }, authorization).catch(() => 'uncertain' as const);
  if (sendResult === 'uncertain') return publicPayment(payment);
  if (sendResult === 'rejected') {
    return retrying ? publicPayment(payment) : updatePayment(payment, 'failed');
  }
  await transactions.doc(payment.id).update({ submission: 'accepted', phone: admin.firestore.FieldValue.delete() });
  return publicPayment({ ...payment, submission: 'accepted' });
}

async function updatePayment(original: Payment, state: State, providerReference?: string) {
  const ref = transactions.doc(original.id);
  return firestore.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    const payment = snapshot.data() as Payment;
    if (payment.state !== 'pending') return publicPayment(payment);
    if (state === 'pending') {
      transaction.update(ref, { nextCheckAt: timestamp(Date.now() + 45_000) });
      return publicPayment(payment);
    }
    if (state === 'successful' && payment.mode === 'production') {
      const plan = getPlan(payment.planId);
      if ((await getCurrentPlan(transaction, payment.uid)).id !== 'free') {
        state = 'review';
      } else {
        const payload = {
          plan: plan.orgPlan, planId: plan.id, subscriptionStatus: 'active',
          billingProvider: 'mtn_momo', billingCycleEndsAt: timestamp(Date.now() + 30 * 86_400_000),
          billingUpdatedAt: timestamp(), mtnMomo: { paymentId: payment.id, providerReference, amount: payment.amount, currency: payment.currency },
        };
        for (const collection of [orgs, profiles, users]) transaction.set(collection.doc(payment.uid), payload, { merge: true });
        transaction.create(ledger.doc('mtn_momo_' + payment.id), buildFinancialAllocationRecord({
          scope: { orgId: payment.uid, userId: payment.uid },
          plan: plan.id, provider: 'mtn_momo', amountPaidCents: payment.priceUsdCents, currency: 'usd',
          providerPayment: { reference: payment.id, transactionId: providerReference, currency: payment.currency, amount: payment.amount },
        }));
      }
    }
    transaction.update(ref, {
      state, providerReference: providerReference ?? null, finishedAt: timestamp(),
      nextCheckAt: admin.firestore.FieldValue.delete(), phone: admin.firestore.FieldValue.delete(),
    });
    return publicPayment({ ...payment, state });
  });
}

async function verifyPayment(config: MtnConfig, payment: Payment) {
  if (payment.state !== 'pending' || payment.mode !== config.mode) return publicPayment(payment);
  const result = await getClient(config).checkPayment(payment.id);
  const state = classifyMtnPayment(result, payment);
  return updatePayment(payment, state, result?.financialTransactionId);
}

export async function checkMtnPayment(uid: string, id: string) {
  const config = requireConfig(uid);
  const snapshot = await transactions.doc(id).get();
  const payment = snapshot.data() as Payment | undefined;
  if (!payment || payment.uid !== uid || payment.mode !== config.mode) throw createHttpError(404, 'MTN MoMo payment not found.');
  try {
    return await verifyPayment(config, payment);
  } catch {
    throw createHttpError(503, 'MTN MoMo verification is temporarily unavailable. Check the same payment again shortly.');
  }
}

export async function reconcileMtnPayments() {
  const config = mtnConfig();
  if (!config) return;
  const due = await transactions.where('nextCheckAt', '<=', timestamp()).limit(24).get();
  for (const document of due.docs) {
    const payment = document.data() as Payment;
    if (payment.mode !== config.mode) {
      await document.ref.update({ nextCheckAt: timestamp(Date.now() + 86_400_000) });
      continue;
    }
    try {
      await verifyPayment(config, payment);
    } catch {
      // Defer a provider outage without starving later payments.
      await updatePayment(payment, 'pending');
    }
  }
}
