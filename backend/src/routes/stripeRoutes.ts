import { Router } from 'express';
import Stripe from 'stripe';
import createHttpError from 'http-errors';
import { applyStripeCheckoutCompleted, applyStripeSubscription } from '../services/billing/billingService';

const router = Router();
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

router.post('/', async (req, res, next) => {
  try {
    if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) {
      throw createHttpError(500, 'Stripe webhook not configured');
    }
    const sig = req.headers['stripe-signature'] as string;
    const event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    if (event.type === 'checkout.session.completed') {
      await applyStripeCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
    }
    if (
      event.type === 'customer.subscription.updated' ||
      event.type === 'customer.subscription.deleted' ||
      event.type === 'invoice.payment_failed' ||
      event.type === 'invoice.payment_succeeded'
    ) {
      const payload = event.data.object as any;
      const subscriptionId =
        payload.object === 'subscription'
          ? payload.id
          : typeof payload.subscription === 'string'
            ? payload.subscription
            : payload.subscription?.id;
      if (subscriptionId && stripe) {
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        await applyStripeSubscription(subscription);
      }
    }
    res.json({ received: true });
  } catch (error) {
    next(error);
  }
});

export default router;
