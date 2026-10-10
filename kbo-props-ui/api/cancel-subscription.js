import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { customersForEmail } from './_stripeTier.js';

function cleanEnv(value) {
  return (value || '').replace(/\\n/g, '').trim();
}

const stripe = new Stripe(cleanEnv(process.env.STRIPE_SECRET_KEY));

const supabase = createClient(
  cleanEnv(process.env.VITE_SUPABASE_URL),
  cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY)
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end('Method Not Allowed');
  }

  // Authenticate via Supabase JWT
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return res.status(401).json({ error: 'Missing authorization token' });
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  const email = (user.email || '').trim().toLowerCase();
  if (!email) {
    return res.status(400).json({ error: 'No email associated with this account' });
  }

  try {
    // Case-insensitive: Checkout may have stored KLAW1193@icloud.com while
    // this account's email is lowercase.
    const customers = await customersForEmail(stripe, email);
    if (!customers.length) {
      return res.status(404).json({ error: 'No Stripe subscription found for this account' });
    }

    const subscriptions = new Map();
    for (const customer of customers) {
      for (const status of ['active', 'trialing']) {
        const page = await stripe.subscriptions.list({
          customer: customer.id,
          status,
          limit: 10,
        });
        for (const sub of page.data || []) subscriptions.set(sub.id, sub);
      }
    }

    if (!subscriptions.size) {
      return res.status(404).json({ error: 'No active subscription found' });
    }

    // Cancel at period end (user keeps access until billing period ends)
    const results = [];
    for (const sub of subscriptions.values()) {
      const updated = await stripe.subscriptions.update(sub.id, {
        cancel_at_period_end: true,
      });
      results.push({
        id: updated.id,
        cancel_at_period_end: updated.cancel_at_period_end,
        current_period_end: updated.current_period_end,
      });
    }

    const periodEnd = results[0]?.current_period_end;
    const endDate = periodEnd ? new Date(periodEnd * 1000).toISOString() : null;

    console.log(`[cancel] Scheduled cancellation for ${email} — access until ${endDate}`);

    return res.status(200).json({
      success: true,
      message: 'Subscription will cancel at end of billing period',
      access_until: endDate,
    });
  } catch (err) {
    console.error('[cancel] Error:', err.message);
    return res.status(500).json({ error: 'Failed to cancel subscription' });
  }
}
