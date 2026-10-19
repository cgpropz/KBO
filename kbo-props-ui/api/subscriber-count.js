import Stripe from 'stripe';

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

  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  return res.status(200).json({ count: customerIds.size });
}
