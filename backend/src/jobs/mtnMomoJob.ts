import { reconcileMtnPayments } from '../services/billing/mtnMomoCheckout';
import { mtnConfig } from '../services/billing/mtnMomoClient';

if (mtnConfig()) {
  let running = false;
  const reconcile = async () => {
    if (running) return;
    running = true;
    try {
      await reconcileMtnPayments();
    } catch {
      console.warn('[mtn-momo] Pending payment reconciliation is temporarily unavailable');
    } finally {
      running = false;
    }
  };
  setInterval(() => void reconcile(), 60_000).unref();
}
