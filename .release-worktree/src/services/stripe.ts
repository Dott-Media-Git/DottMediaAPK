import { env } from '@services/env';

const delay = (ms = 700) => new Promise(resolve => setTimeout(resolve, ms));

export const startCheckoutSession = async () => {
  await delay();
  if (!env.stripeApiKey) {
    console.warn('Stripe API key not configured. Running in mock mode.');
  }
  console.log('Checkout session started');
};
