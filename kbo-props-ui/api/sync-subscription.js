import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

function cleanEnv(value) {
  return (value || '').replace(/\\n/g, '').trim();
}

const stripe = new Stripe(cleanEnv(process.env.STRIPE_SECRET_KEY));

const supabase = createClient(
  cleanEnv(process.env.VITE_SUPABASE_URL),
  cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY)
);

function inferTier(priceId, unitAmount) {
  const SEASON_PRICE = cleanEnv(process.env.STRIPE_SEASON_PRICE_ID);
  const MONTHLY_PRICE = cleanEnv(process.env.STRIPE_MONTHLY_PRICE_ID);
  if (SEASON_PRICE && priceId === SEASON_PRICE) return 'season';
  if (MONTHLY_PRICE && priceId === MONTHLY_PRICE) return 'monthly';
  if (unitAmount >= 4000) return 'season';
  return 'monthly';
}

/**
 * POST /api/sync-subscription
 *
 * Called by the frontend on login when no paid tier is found in user_profiles.
 * Verifies the user's Supabase JWT, looks up their email in Stripe, and grants
 * the correct tier if they have an active subscription.
 *
 * Returns: { tier: 'monthly' | 'season' | 'free', synced: boolean }
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end('Method Not Allowed');
  }

  // Verify caller via Supabase JWT
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return res.status(401).json({ error: 'Missing token' });

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: 'Unauthorized' });

  // Check if they already have a paid tier — skip Stripe lookup if so
  const { data: rows } = await supabase
    .from('user_profiles')
    .select('tier')
    .eq('id', user.id)
    .limit(1);

  const currentTier = rows?.[0]?.tier;
  if (currentTier && currentTier !== 'free') {
    return res.status(200).json({ tier: currentTier, synced: false });
  }

  // Look up active Stripe subscription by the user's email
  let tier = null;
  try {
    const customers = await stripe.customers.list({ email: user.email, limit: 10 });
    outer: for (const customer of customers.data) {
      const subs = await stripe.subscriptions.list({
        customer: customer.id,
        status: 'active',
        limit: 5,
      });
      for (const sub of subs.data) {
        const price = sub.items.data[0]?.price;
        tier = inferTier(price?.id, price?.unit_amount);
        break outer;
      }
    }
  } catch (err) {
    console.error('[sync-subscription] Stripe lookup failed:', err.message);
    return res.status(500).json({ error: 'Stripe lookup failed' });
  }

  if (!tier) {
    return res.status(200).json({ tier: 'free', synced: false });
  }

  // Grant access
  const { error: upsertError } = await supabase
    .from('user_profiles')
    .upsert({ id: user.id, tier }, { onConflict: 'id' });

  if (upsertError) {
    console.error('[sync-subscription] upsert failed:', upsertError);
    return res.status(500).json({ error: 'DB write failed' });
  }

  console.log(`[sync-subscription] granted ${tier} to ${user.email}`);
  return res.status(200).json({ tier, synced: true });
}
