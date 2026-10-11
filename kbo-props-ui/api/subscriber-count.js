import Stripe from 'stripe';
import { foundersOfferStatus } from './_offerCheckout.js';

function cleanEnv(value) {
  return (value || '').replace(/\\n/g, '').trim();
}

const stripe = new Stripe(cleanEnv(process.env.STRIPE_SECRET_KEY));

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const subscriptions = await Promise.all(
    ['active', 'trialing'].map((status) => stripe.subscriptions.list({ status, limit: 100 }))
  );
  const customerIds = new Set(
    subscriptions.flatMap(({ data }) => data.map((subscription) => String(subscription.customer)))
  );

  let founders = null;
  try {
    const offer = await foundersOfferStatus(stripe);
    founders = {
      open: offer.open,
      reason: offer.reason,
      sold: offer.sold,
      cap: offer.cap,
      spotsLeft: offer.spotsLeft,
      deadline: new Date(offer.deadlineMs).toISOString(),
    };
  } catch {
    founders = { open: false, reason: 'unavailable', sold: null, cap: 25, spotsLeft: 0, deadline: null };
  }

  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  return res.status(200).json({ count: customerIds.size, founders });
}
