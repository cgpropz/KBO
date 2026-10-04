import crypto from 'node:crypto';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { WEEKLY_PRICE_ID, XWEEK_PROMOTION_CODE_ID } from '../src/pricingTiers.js';

function cleanEnv(value) {
  return (value || '').replace(/\\n/g, '').trim();
}

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
const UTM_VALUE_RE = /^[A-Za-z0-9_-]{1,150}$/;
const CLIENT_REF_RE = /^[A-Za-z0-9_-]{1,200}$/;
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

const SUCCESS_URL = 'https://www.cgpropz.com/?checkout=success&session_id={CHECKOUT_SESSION_ID}';
const CANCEL_URL = 'https://www.cgpropz.com/';

let stripe = null;
function getStripe() {
  const key = cleanEnv(process.env.STRIPE_SECRET_KEY);
  if (!key) return null;
  if (!stripe) stripe = new Stripe(key);
  return stripe;
}

let supabase = null;
function getSupabase() {
  const url = cleanEnv(process.env.VITE_SUPABASE_URL);
  const key = cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !key) return null;
  if (!supabase) supabase = createClient(url, key);
  return supabase;
}

function randomSuffix() {
  const bytes = crypto.randomBytes(8);
  return [...bytes].map((b) => LETTERS[b % 26]).join('');
}

// Stripe: "This promotion code cannot be redeemed because the associated
// customer has prior transactions."
function isPromoRejected(err) {
  const msg = String(err?.message || err?.raw?.message || '').toLowerCase();
  return msg.includes('prior transaction') || msg.includes('promotion code') || msg.includes('coupon');
}

async function stripeCustomerId(client, email) {
  if (typeof client.customers?.list !== 'function') return null;
  try {
    const listed = await client.customers.list({ email, limit: 1 });
    const id = listed?.data?.[0]?.id;
    return id ? String(id) : null;
  } catch {
    return null;
  }
}

function readBody(req) {
  const body = req.body;
  if (body && typeof body === 'object') return body;
  if (typeof body === 'string') {
    try { return JSON.parse(body); } catch { return {}; }
  }
  return {};
}

// Logged-out buyers can still check out. A bad or missing token is treated as
// logged out rather than blocking the weekly button.
async function optionalUser(req, authenticate) {
  const token = String(req.headers?.authorization || req.headers?.Authorization || '')
    .replace(/^Bearer\s+/i, '')
    .trim();
  if (!token) return null;
  try {
    const lookup = authenticate || (async (jwt) => {
      const client = getSupabase();
      if (!client) return null;
      const { data, error } = await client.auth.getUser(jwt);
      if (error || !data?.user?.id) return null;
      return data.user;
    });
    const user = await lookup(token);
    if (!user?.id) return null;
    return { id: user.id, email: user.email || null };
  } catch {
    return null;
  }
}

/**
 * POST /api/weekly-checkout
 *
 * Opens the existing Weekly All-Access price with promo XWEEK already applied.
 * Stripe Payment Links reject `prefilled_promo_code=XWEEK` (the field shows
 * "This code is invalid" and the $9.99 price is unchanged). Creating a Checkout
 * Session with discounts[promotion_code] applies the same $5-off code, so the
 * first week is $4.99 and renewals stay $9.99.
 *
 * Returns only `{ url }`. The client cannot choose a different price or code.
 */
export async function handleWeeklyCheckoutRequest(req, res, deps = {}) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const client = deps.stripe || getStripe();
  if (!client) return res.status(503).json({ error: 'Checkout unavailable' });

  const buyer = deps.user !== undefined ? deps.user : await optionalUser(req, deps.authenticate);
  const body = readBody(req);
  const metadata = { cg_plan: 'weekly' };
  for (const key of UTM_KEYS) {
    const value = String(body[key] || '').trim();
    if (UTM_VALUE_RE.test(value)) metadata[key] = value;
  }

  const params = {
    mode: 'subscription',
    line_items: [{ price: WEEKLY_PRICE_ID, quantity: 1 }],
    discounts: [{ promotion_code: XWEEK_PROMOTION_CODE_ID }],
    success_url: SUCCESS_URL,
    cancel_url: CANCEL_URL,
    automatic_tax: { enabled: true },
    billing_address_collection: 'auto',
    metadata,
    integration_identifier: `cgpropz_weekly_${randomSuffix()}`,
  };
  if (buyer?.id && CLIENT_REF_RE.test(String(buyer.id))) {
    params.client_reference_id = String(buyer.id);
  }
  const email = String(buyer?.email || '').trim();
  // An existing Stripe customer with prior payments cannot redeem XWEEK
  // (first_time_transaction). Attach them so Stripe rejects the promo at
  // session creation, then retry below at the full weekly price.
  const existingCustomerId = email.includes('@') ? await stripeCustomerId(client, email) : null;
  if (existingCustomerId) params.customer = existingCustomerId;
  else if (email.includes('@')) params.customer_email = email;

  let session;
  try {
    session = await client.checkout.sessions.create(params);
  } catch (err) {
    if (!isPromoRejected(err)) {
      console.error('[weekly-checkout] create failed:', err?.message);
      return res.status(502).json({ error: 'Checkout unavailable' });
    }
    // XWEEK is not valid for this buyer. Same weekly price, no discount,
    // so they can still pay $9.99.
    delete params.discounts;
    params.integration_identifier = `cgpropz_weekly_${randomSuffix()}`;
    try {
      session = await client.checkout.sessions.create(params);
    } catch (retryErr) {
      console.error('[weekly-checkout] create failed:', retryErr?.message);
      return res.status(502).json({ error: 'Checkout unavailable' });
    }
  }

  const url = String(session?.url || '');
  if (!url.startsWith('https://checkout.stripe.com/')) {
    return res.status(502).json({ error: 'Checkout unavailable' });
  }
  return res.status(200).json({ url });
}

export default function handler(req, res) {
  return handleWeeklyCheckoutRequest(req, res);
}
