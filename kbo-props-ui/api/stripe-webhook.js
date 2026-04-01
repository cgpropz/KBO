import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Admin client — bypasses RLS to update any user's tier
const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Map Stripe price IDs → tier names
// Update these after you create your products in Stripe
const PRICE_TO_TIER = {};

function tierFromSession(session) {
  // 1. Check price ID mapping
  const priceId = session.line_items?.data?.[0]?.price?.id;
  if (priceId && PRICE_TO_TIER[priceId]) return PRICE_TO_TIER[priceId];

  // 2. Fallback: infer from amount
  const amount = session.amount_total; // in cents
  if (amount >= 4000) return 'season';  // $49.99 → yearly/season
  return 'monthly';                      // $19.99 → monthly
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end('Method Not Allowed');
  }

  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    // req.body is already the raw buffer when using Vercel's config below
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const userId = session.client_reference_id;  // Supabase user ID
    const email = session.customer_details?.email || session.customer_email;

    if (!userId && !email) {
      console.error('No user ID or email in checkout session');
      return res.status(400).json({ error: 'Missing user identifier' });
    }

    const tier = tierFromSession(session);

    // Upsert tier — creates row if missing, updates if exists
    if (userId) {
      const { error } = await supabase
        .from('user_profiles')
        .upsert({ id: userId, tier }, { onConflict: 'id' });

      if (error) console.error('Error upserting tier by ID:', error);
      else console.log(`Set user ${userId} to tier: ${tier}`);
    } else if (email) {
      // Look up user by email in auth.users
      const { data: { users }, error: listErr } = await supabase.auth.admin.listUsers();
      if (listErr) {
        console.error('Error listing users:', listErr);
        return res.status(500).json({ error: 'User lookup failed' });
      }
      const user = users.find(u => u.email === email);
      if (user) {
        const { error } = await supabase
          .from('user_profiles')
          .upsert({ id: user.id, tier }, { onConflict: 'id' });

        if (error) console.error('Error upserting tier by email:', error);
        else console.log(`Set user ${email} to tier: ${tier}`);
      } else {
        console.error(`No Supabase user found for email: ${email}`);
      }
    }
  }

  return res.status(200).json({ received: true });
}

// Tell Vercel not to parse the body — Stripe needs the raw buffer for signature verification
export const config = {
  api: {
    bodyParser: false,
  },
};
