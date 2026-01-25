import { Router } from 'express';
import Stripe from 'stripe';
import createHttpError from 'http-errors';
import { updateOrg } from '../services/admin/adminService.js';
const router = Router();
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
router.post('/', async (req, res, next) => {
    try {
        if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) {
            throw createHttpError(500, 'Stripe webhook not configured');
        }
        const sig = req.headers['stripe-signature'];
        const event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
        if (event.type === 'checkout.session.completed') {
            const metadata = event.data.object.metadata ?? {};
            if (metadata.orgId && metadata.plan) {
                await updateOrg(metadata.orgId, { plan: metadata.plan });
            }
        }
        res.json({ received: true });
    }
    catch (error) {
        next(error);
    }
});
export default router;
