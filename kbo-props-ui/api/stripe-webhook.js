import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { tierForPrice, mergeTier, computeStripeTier } from './_stripeTier.js';

function cleanEnv(value) {
  return (value || '').replace(/\\n/g, '').trim();
}

const stripe = new Stripe(cleanEnv(process.env.STRIPE_SECRET_KEY));

// Admin client — bypasses RLS to update any user's tier
const supabase = createClient(
  cleanEnv(process.env.VITE_SUPABASE_URL),
  cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY)
);

// Infer tier from a Stripe price ID or unit amount (in cents)
// (tier inference now lives in ./_stripeTier.js via tierForPrice)

async function findUserByEmail(email) {
  const target = (email || '').trim().toLowerCase();
  if (!target) return null;

  if (typeof supabase.auth.admin.getUserByEmail === 'function') {
    const { data, error } = await supabase.auth.admin.getUserByEmail(target);
    if (!error && data?.user) return data.user;
  }

  let page = 1;
  const perPage = 1000;
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) return null;
    const users = data?.users || [];
    const match = users.find((u) => (u.email || '').trim().toLowerCase() === target);
    if (match) return match;
    if (users.length < perPage) break;
    page += 1;
  }

  return null;
}

// Grant a tier to a user, merging with their current tier so grandfathered
// all-access subscribers are never downgraded and single-sport plans union.
async function setTierById(userId, incoming) {
  const { data: rows } = await supabase
    .from('user_profiles')
    .select('tier')
    .eq('id', userId)
    .limit(1);
  const current = rows?.[0]?.tier || 'free';
  const tier = mergeTier(current, incoming);
  const { error } = await supabase
    .from('user_profiles')
    .upsert({ id: userId, tier }, { onConflict: 'id' });
  if (error) console.error(`[webhook] upsert by ID failed for ${userId}:`, error);
  else console.log(`[webhook] ${userId}: ${current} + ${incoming} → ${tier}`);
}

// Look up Supabase user by email, then grant (merge) their tier.
async function setTierByEmail(email, tier) {
  const user = await findUserByEmail(email);
  if (!user) {
    console.warn(`[webhook] no Supabase user for email ${email} — tier will be set on first login via sync`);
    return;
  }
  await setTierById(user.id, tier);
}

// Recompute a user's tier authoritatively from their live Stripe state when a
// subscription is cancelled/expires, so remaining plans + lifetime are honoured.
async function clearTierByCustomer(customerId) {
  const customer = await stripe.customers.retrieve(customerId);
  const email = customer.email;
  if (!email) return;
  const user = await findUserByEmail(email);
  if (!user) return;
  const tier = await computeStripeTier(stripe, email);
  const { error } = await supabase
    .from('user_profiles')
    .upsert({ id: user.id, tier }, { onConflict: 'id' });
  if (error) console.error(`[webhook] recompute failed for ${email}:`, error);
  else console.log(`[webhook] recomputed ${email} → ${tier} (subscription change)`);
}

// Read the raw body from the request stream (Vercel serverless doesn't
// honour the Next.js bodyParser:false config, so we must collect it manually).
function getRawBody(req) {
  return new Promise((resolve, reject) => {
    if (typeof req.body === 'string' || Buffer.isBuffer(req.body)) {
      return resolve(req.body);
    }
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end('Method Not Allowed');
  }

  const sig = req.headers['stripe-signature'];
  const webhookSecret = cleanEnv(process.env.STRIPE_WEBHOOK_SECRET);

  // Stripe signature verification MUST use the raw, unparsed request body.
  const rawBody = await getRawBody(req);

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    console.error('[webhook] signature verification failed:', err.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  const obj = event.data.object;

  // ── checkout.session.completed ──────────────────────────────────────────
  // Fires immediately when the user completes checkout. Has client_reference_id
  // set to the Supabase user ID (added by SubscriptionPage.jsx).
  if (event.type === 'checkout.session.completed') {
    const userId = obj.client_reference_id;
    const email  = obj.customer_details?.email || obj.customer_email;

    // checkout.session.completed does NOT include line_items by default, so
    // resolve the real price from the subscription (or fetch line items for
    // one-time purchases) before mapping to a sport-specific tier.
    let priceId = obj.line_items?.data?.[0]?.price?.id;
    if (!priceId && obj.subscription) {
      try {
        const sub = await stripe.subscriptions.retrieve(obj.subscription);
        priceId = sub.items?.data?.[0]?.price?.id;
      } catch (err) {
        console.error('[webhook] could not retrieve subscription for price:', err.message);
      }
    }
    if (!priceId) {
      try {
        const li = await stripe.checkout.sessions.listLineItems(obj.id, { limit: 1 });
        priceId = li.data?.[0]?.price?.id;
      } catch (err) {
        console.error('[webhook] could not list checkout line items:', err.message);
      }
    }
    const tier = tierForPrice(priceId);

    if (userId) {
      await setTierById(userId, tier);
    } else if (email) {
      await setTierByEmail(email, tier);
    } else {
      console.error('[webhook] checkout.session.completed: no user ID or email');
    }
  }

  // ── customer.subscription.created ──────────────────────────────────────
  // Fires when any subscription is created (catches cases where checkout event
  // was missed or user subscribed via a direct Stripe link without being logged in).
  else if (event.type === 'customer.subscription.created') {
    const priceId = obj.items?.data?.[0]?.price?.id;
    const tier    = tierForPrice(priceId);
    const customer = await stripe.customers.retrieve(obj.customer);
    if (customer.email) await setTierByEmail(customer.email, tier);
  }

  // ── invoice.payment_succeeded ───────────────────────────────────────────
  // Fires on every successful payment (initial + renewals). Keeps tier current
  // even if previous events failed.
  else if (event.type === 'invoice.payment_succeeded') {
    if (obj.billing_reason === 'subscription_create' || obj.billing_reason === 'subscription_cycle') {
      const line  = obj.lines?.data?.[0];
      const priceId = line?.price?.id;
      const tier    = tierForPrice(priceId);
      const customer = await stripe.customers.retrieve(obj.customer);
      if (customer.email) await setTierByEmail(customer.email, tier);
    }
  }

  // ── customer.subscription.deleted ──────────────────────────────────────
  // Fires when a subscription is cancelled/expires. Revoke access.
  else if (event.type === 'customer.subscription.deleted') {
    await clearTierByCustomer(obj.customer);
  }

  return res.status(200).json({ received: true });
}
