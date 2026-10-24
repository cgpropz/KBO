import crypto from 'node:crypto';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { isAutomatedClient, listOpenCheckoutSessions, reusableCheckoutUrl } from './_checkoutClient.js';
import { customersForEmail, DISCORD_MONTHLY_PRICE_ID, DISCORD_WEEKLY_PRICE_ID } from './_stripeTier.js';

export { isAutomatedClient };

function cleanEnv(value) {
  return (value || '').replace(/\\n/g, '').trim();
}

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
const UTM_VALUE_RE = /^[A-Za-z0-9_-]{1,150}$/;
const CLIENT_REF_RE = /^[A-Za-z0-9_-]{1,200}$/;
const PRICE_RE = /^price_[A-Za-z0-9]+$/;
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

const SUCCESS_URL = 'https://www.cgpropz.com/?checkout=success&session_id={CHECKOUT_SESSION_ID}';
const CANCEL_URL = 'https://www.cgpropz.com/';

const PLANS = {
  weekly: { envKey: 'STRIPE_PRICE_DISCORD_WEEKLY', fallback: DISCORD_WEEKLY_PRICE_ID, cgPlan: 'discord_weekly' },
  monthly: { envKey: 'STRIPE_PRICE_DISCORD_MONTHLY', fallback: DISCORD_MONTHLY_PRICE_ID, cgPlan: 'discord_monthly' },
};

let stripe = null;
function getStripe(env) {
  const key = cleanEnv(env?.STRIPE_SECRET_KEY);
  if (!key) return null;
  if (!stripe) stripe = new Stripe(key);
  return stripe;
}

let supabase = null;
function getSupabase(env) {
  const url = cleanEnv(env?.VITE_SUPABASE_URL);
  const key = cleanEnv(env?.SUPABASE_SERVICE_ROLE_KEY);
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

async function stripeCustomerId(client, email) {
  try {
    const matches = await customersForEmail(client, email);
    const id = matches[0]?.id;
    return id ? String(id) : null;
  } catch {
    return null;
  }
}

async function optionalUser(req, env, authenticate) {
  const token = String(req.headers?.authorization || req.headers?.Authorization || '')
    .replace(/^Bearer\s+/i, '')
    .trim();
  if (!token) return null;
  try {
    const lookup = authenticate || (async (jwt) => {
      const client = getSupabase(env);
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
 * POST /api/discord-checkout
 * Body: { plan: 'weekly' | 'monthly', utm_*? }
 *
 * Opens a subscription Checkout Session for Discord Only. A valid
 * STRIPE_PRICE_DISCORD_WEEKLY / STRIPE_PRICE_DISCORD_MONTHLY overrides the
 * live price; otherwise the session uses the live Discord Only price
 * ($5.99/week or $19.99/month). The client cannot choose a price id.
 * Session and subscription metadata are stamped cg_plan discord_weekly or
 * discord_monthly plus tier=discord_only, so the webhook cannot treat the
 * purchase as All-Access.
 *
 * Automatic tax is off, matching the weekly All-Access session. Phone is not
 * collected. Returns only { url }.
 *
 * The site calls this only from a Buy click. Requests from crawlers, link
 * previews, headless browsers and prefetch/prerender get 403 and no session.
 * A signed-in buyer with a Stripe customer gets their still-open session for
 * the same plan back instead of a new one.
 */
export async function handleDiscordCheckoutRequest(req, res, deps = {}) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (isAutomatedClient(req.headers || {})) {
    return res.status(403).json({ error: 'Checkout unavailable' });
  }

  const env = deps.env || process.env;
  const client = deps.stripe || getStripe(env);
  if (!client) return res.status(503).json({ error: 'Checkout unavailable' });

  const planKey = String(readBody(req).plan || '');
  const plan = PLANS[planKey];
  if (!plan) return res.status(503).json({ error: 'Discord checkout is not configured' });
  const configured = cleanEnv(env?.[plan.envKey]);
  const priceId = PRICE_RE.test(configured) ? configured : plan.fallback;

  const buyer = deps.user !== undefined ? deps.user : await optionalUser(req, env, deps.authenticate);
  const body = readBody(req);
  // price_id lets a later click verify an open session is for today's price.
  const metadata = { cg_plan: plan.cgPlan, tier: 'discord_only', price_id: priceId };
  for (const key of UTM_KEYS) {
    const value = String(body[key] || '').trim();
    if (UTM_VALUE_RE.test(value)) metadata[key] = value;
  }

  const params = {
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: SUCCESS_URL,
    cancel_url: CANCEL_URL,
    // Tax stays off, same as the weekly All-Access session. Enabling it
    // without an active Stripe Tax registration collects nothing.
    automatic_tax: { enabled: false },
    billing_address_collection: 'auto',
    metadata,
    subscription_data: { metadata: { cg_plan: plan.cgPlan, tier: 'discord_only' } },
    integration_identifier: `cgpropz_discord_${randomSuffix()}`,
  };
  if (buyer?.id && CLIENT_REF_RE.test(String(buyer.id))) {
    params.client_reference_id = String(buyer.id);
  }
  const email = String(buyer?.email || '').trim();
  const existingCustomerId = email.includes('@') ? await stripeCustomerId(client, email) : null;
  if (existingCustomerId) params.customer = existingCustomerId;
  else if (email.includes('@')) params.customer_email = email;

  const nowSec = Math.floor((deps.now ? deps.now() : Date.now()) / 1000);
  const open = await listOpenCheckoutSessions(client, existingCustomerId);
  // The list has no line_items; the price id stamped in metadata at creation
  // must match today's price. Older sessions without it are skipped.
  const reuse = reusableCheckoutUrl(open, nowSec, (session) => (
    session.mode === 'subscription'
    && session.metadata?.cg_plan === plan.cgPlan
    && session.metadata?.tier === 'discord_only'
    && session.metadata?.price_id === priceId
  ));
  if (reuse) return res.status(200).json({ url: reuse });

  let session;
  try {
    session = await client.checkout.sessions.create(params);
  } catch (err) {
    console.error('[discord-checkout] create failed:', err?.message);
    return res.status(502).json({ error: 'Checkout unavailable' });
  }

  const url = String(session?.url || '');
  if (!url.startsWith('https://checkout.stripe.com/')) {
    return res.status(502).json({ error: 'Checkout unavailable' });
  }
  return res.status(200).json({ url });
}

export default function handler(req, res) {
  return handleDiscordCheckoutRequest(req, res);
}
