import { Router } from 'express';
import createHttpError from 'http-errors';
import { applyFlutterwavePayment } from '../services/billing/billingService';

const router = Router();

router.post('/', async (req, res, next) => {
  try {
    const expectedHash = process.env.FLUTTERWAVE_WEBHOOK_HASH?.trim();
    const receivedHash = String(req.header('verif-hash') || req.header('verify-hash') || '').trim();
    if (expectedHash && receivedHash !== expectedHash) {
      throw createHttpError(401, 'Invalid Flutterwave webhook hash');
    }

    const payload = req.body ?? {};
    const data = payload.data ?? payload;
    const txRef = typeof data.tx_ref === 'string' ? data.tx_ref : undefined;
    const transactionId = data.id ?? data.transaction_id ?? payload.transaction_id;
    const event = String(payload.event ?? '').toLowerCase();
    const status = String(data.status ?? '').toLowerCase();

    if (event && event !== 'charge.completed') {
      return res.json({ received: true, ignored: true });
    }
    if (status && status !== 'successful') {
      return res.json({ received: true, status });
    }

    const result = await applyFlutterwavePayment({ txRef, transactionId });
    res.json({ received: true, result });
  } catch (error) {
    next(error);
  }
});

export default router;
