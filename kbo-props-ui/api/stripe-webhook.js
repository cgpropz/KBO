import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

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
function inferTier(priceId, unitAmount) {
  const SEASON_PRICE = cleanEnv(process.env.STRIPE_SEASON_PRICE_ID);
  const MONTHLY_PRICE = cleanEnv(process.env.STRIPE_MONTHLY_PRICE_ID);
  if (SEASON_PRICE && priceId === SEASON_PRICE) return 'season';
  if (MONTHLY_PRICE && priceId === MONTHLY_PRICE) return 'monthly';
  // Fallback: infer from amount ($40+ = season/yearly, otherwise monthly)
  if (unitAmount >= 4000) return 'season';
  return 'monthly';
}

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

// Upsert user_profiles by Supabase user ID
async function setTierById(userId, tier) {
  const { error } = await supabase
    .from('user_profiles')
    .upsert({ id: userId, tier }, { onConflict: 'id' });
  if (error) console.error(`[webhook] upsert by ID failed for ${userId}:`, error);
  else console.log(`[webhook] set ${userId} → tier=${tier}`);
}

// Look up Supabase user by email, then upsert their tier
async function setTierByEmail(email, tier) {
  const user = await findUserByEmail(email);
  if (!user) {
    console.warn(`[webhook] no Supabase user for email ${email} — tier will be set on first login via sync`);
    return;
  }
  await setTierById(user.id, tier);
}

// Remove or downgrade tier when subscription is cancelled
async function clearTierByCustomer(customerId) {
  const customer = await stripe.customers.retrieve(customerId);
  const email = customer.email;
  if (!email) return;
  const user = await findUserByEmail(email);
  if (!user) return;
  const { error } = await supabase
    .from('user_profiles')
    .upsert({ id: user.id, tier: 'free' }, { onConflict: 'id' });
  if (error) console.error(`[webhook] clear tier failed for ${email}:`, error);
  else console.log(`[webhook] cleared tier for ${email} (subscription cancelled)`);
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
    const priceId = obj.line_items?.data?.[0]?.price?.id;
    const amount  = obj.amount_total;
    const tier    = inferTier(priceId, amount);

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
    const amount  = obj.items?.data?.[0]?.price?.unit_amount;
    const tier    = inferTier(priceId, amount);
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
      const amount  = line?.price?.unit_amount;
      const tier    = inferTier(priceId, amount);
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
