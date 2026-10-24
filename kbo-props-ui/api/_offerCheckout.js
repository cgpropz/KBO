// Checkout Sessions for Lifetime ($249.99) and Founders ($99.99).
// Not a route. Wired from api/checkout/[action].js.
//
// Founders is not a static Payment Link: the Payment Link's own 25-sale cap
// and end date do not apply to a Checkout Session created here. The cap and
// the 18 Oct 2026 11:59 PM ET deadline are enforced before a session is
// created. Past 25 Founders purchases (in-site sessions, charges, and
// Payment Link sales, one shared count), or after the deadline, the handler
// refuses. It does not open a $249.99 Lifetime session in that case.
// Neither Lifetime nor Founders has a free trial.

import crypto from 'node:crypto';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { foundersOfferState } from '../src/foundersOffer.js';
import { isAutomatedClient, listOpenCheckoutSessions, reusableCheckoutUrl } from './_checkoutClient.js';
import { customersForEmail, activeFoundersPriceId, activeLifetimePriceId } from './_stripeTier.js';
import { countFoundersPurchases } from './_foundersCount.js';

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

function readBody(req) {
  const body = req.body;
  if (body && typeof body === 'object') return body;
  if (typeof body === 'string') {
    try { return JSON.parse(body); } catch { return {}; }
  }
  return {};
}

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

async function stripeCustomerId(client, email) {
  try {
    const matches = await customersForEmail(client, email);
    return matches[0]?.id ? String(matches[0].id) : null;
  } catch {
    return null;
  }
}

export async function foundersOfferStatus(client, env = process.env, now = Date.now()) {
  let sold = null;
  try {
    sold = await countFoundersPurchases(client, env);
  } catch {
    sold = null;
  }
  if (sold == null) {
    return { ...foundersOfferState({ now, sold: 0 }), open: false, reason: 'unavailable', spotsLeft: 0, sold: null };
  }
  return foundersOfferState({ now, sold });
}

async function createPaymentSession(client, { priceId, plan, buyer, body, nowSec }) {
  const metadata = { cg_plan: plan, tier: 'combined', price_id: priceId };
  for (const key of UTM_KEYS) {
    const value = String(body[key] || '').trim();
    if (UTM_VALUE_RE.test(value)) metadata[key] = value;
  }
  const params = {
    mode: 'payment',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: SUCCESS_URL,
    cancel_url: CANCEL_URL,
    automatic_tax: { enabled: false },
    billing_address_collection: 'auto',
    metadata,
    payment_intent_data: { metadata: { ...metadata } },
    integration_identifier: `cgpropz_${plan}_${randomSuffix()}`,
  };
  if (buyer?.id && CLIENT_REF_RE.test(String(buyer.id))) {
    params.client_reference_id = String(buyer.id);
  }
  const email = String(buyer?.email || '').trim();
  const existingCustomerId = email.includes('@') ? await stripeCustomerId(client, email) : null;
  if (existingCustomerId) params.customer = existingCustomerId;
  else if (email.includes('@')) params.customer_email = email;

  const open = await listOpenCheckoutSessions(client, existingCustomerId);
  const reuse = reusableCheckoutUrl(open, nowSec, (session) => (
    session.mode === 'payment'
    && session.metadata?.cg_plan === plan
    && session.metadata?.price_id === priceId
  ));
  if (reuse) return { url: reuse, id: null };

  const session = await client.checkout.sessions.create(params);
  const url = String(session?.url || '');
  if (!url.startsWith('https://checkout.stripe.com/')) {
    const err = new Error('unexpected checkout url');
    err.code = 'bad_url';
    throw err;
  }
  return { url, id: session.id };
}

function foundersClosedBody(offer) {
  if (offer.reason === 'sold_out') {
    return { status: 409, error: 'Founders deal has sold out', reason: 'sold_out' };
  }
  if (offer.reason === 'expired') {
    return { status: 409, error: 'Founders deal has ended', reason: 'expired' };
  }
  return { status: 503, error: 'Checkout unavailable', reason: offer.reason || 'unavailable' };
}

/**
 * POST /api/checkout/lifetime and POST /api/checkout/founders.
 * One-time payment mode. No subscription and no free trial.
 * Founders past the cap or the deadline is refused. No Checkout Session
 * is created, and the $249.99 Lifetime price is not substituted.
 *
 * Called from a Buy click. Crawlers get 403 and no session. An open session
 * for the same customer and price is returned instead of creating another.
 */
export async function handleOfferCheckoutRequest(req, res, deps = {}) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (isAutomatedClient(req.headers || {})) {
    return res.status(403).json({ error: 'Checkout unavailable' });
  }

  const requested = deps.plan === 'founders' ? 'founders' : 'lifetime';
  const client = deps.stripe || getStripe();
  if (!client) return res.status(503).json({ error: 'Checkout unavailable' });

  const env = deps.env || process.env;
  const now = typeof deps.now === 'number' ? deps.now : Date.now();
  const plan = requested;

  if (requested === 'founders') {
    const offer = await foundersOfferStatus(client, env, now);
    if (!offer.open) {
      const closed = foundersClosedBody(offer);
      return res.status(closed.status).json({
        error: closed.error,
        reason: closed.reason,
        open: false,
      });
    }
  }

  const priceId = plan === 'founders' ? activeFoundersPriceId(env) : activeLifetimePriceId(env);
  const buyer = deps.user !== undefined ? deps.user : await optionalUser(req, deps.authenticate);
  try {
    const session = await createPaymentSession(client, {
      priceId,
      plan,
      buyer,
      body: readBody(req),
      nowSec: Math.floor(now / 1000),
    });
    return res.status(200).json({
      url: session.url,
      plan,
      fallback: false,
      reason: null,
    });
  } catch (err) {
    console.error(`[offer-checkout] ${plan} create failed:`, err?.message);
    return res.status(502).json({ error: 'Checkout unavailable' });
  }
}
