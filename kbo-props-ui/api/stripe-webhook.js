import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import {
  mergeTier,
  computeStripeAccess,
  metadataSignalsDiscord,
  tierForStripePrice,
  TIER_BY_PRICE,
  chargeRevokesEntitlement,
  invoiceStillGrants,
  subscriptionPeriodBlocked,
  lifetimeChargeBlocksAccess,
} from './_stripeTier.js';
import { reportPurchaseToX } from './_xConversions.js';
import { safeDiscordSync, setDiscordOnlyFlag } from './_discordSync.js';
import { subscriptionDeletedClaimResult, writeTierClaim } from './_tierClaim.js';

function cleanEnv(value) {
  return (value || '').replace(/\\n/g, '').trim();
}

// Created on first use so unit tests can import this module without credentials.
let stripeClient = null;
function getStripe() {
  if (!stripeClient) {
    const key = cleanEnv(process.env.STRIPE_SECRET_KEY);
    if (!key) throw new Error('STRIPE_SECRET_KEY is not set');
    stripeClient = new Stripe(key);
  }
  return stripeClient;
}

let supabaseClient = null;
function getSupabase() {
  if (!supabaseClient) {
    const url = cleanEnv(process.env.VITE_SUPABASE_URL);
    const key = cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY);
    if (!url || !key) throw new Error('Supabase service credentials are not set');
    supabaseClient = createClient(url, key);
  }
  return supabaseClient;
}

// Infer tier from a Stripe price ID or unit amount (in cents)
// (tier inference now lives in ./_stripeTier.js via tierForPrice)

async function findUserByEmail(email, db = getSupabase()) {
  const target = (email || '').trim().toLowerCase();
  if (!target) return null;

  if (typeof db.auth.admin.getUserByEmail === 'function') {
    const { data, error } = await db.auth.admin.getUserByEmail(target);
    if (!error && data?.user) return data.user;
  }

  let page = 1;
  const perPage = 1000;
  while (true) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage });
    if (error) {
      const err = new Error('user lookup failed');
      err.lookup = true;
      throw err;
    }
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
async function setTierById(userId, incoming, db = getSupabase()) {
  const { data: rows } = await db
    .from('user_profiles')
    .select('tier')
    .eq('id', userId)
    .limit(1);
  const current = rows?.[0]?.tier || 'free';
  const tier = mergeTier(current, incoming);
  const { error } = await db
    .from('user_profiles')
    .upsert({ id: userId, tier }, { onConflict: 'id' });
  if (error) {
    console.error(`[webhook] tier update failed for ${userId}`);
    return { status: 500, body: { error: 'tier update failed' } };
  }
  console.log(`[webhook] ${userId}: ${current} + ${incoming} → ${tier}`);
  await writeTierClaim(db, userId, tier);
  // Discord-only sets the flag and never clears a site tier (mergeTier).
  // A Discord API failure is logged inside safeDiscordSync and does not throw.
  if (incoming === 'discord') await setDiscordOnlyFlag(db, userId, true);
  await safeDiscordSync(db, userId);
  return null;
}

// Look up Supabase user by email, then grant (merge) their tier.
async function setTierByEmail(email, tier) {
  const user = await findUserByEmail(email);
  if (!user) {
    console.warn(`[webhook] no Supabase user for email ${email} — tier will be set on first login via sync`);
    return;
  }
  return setTierById(user.id, tier);
}

function webhookDeps(deps = {}) {
  return {
    stripe: deps.stripe || getStripe(),
    supabase: deps.supabase || getSupabase(),
  };
}

function lookupFailure(err) {
  if (!err?.lookup) return null;
  return { status: 500, body: { error: 'user lookup failed' } };
}

async function resolveWebhookUser(customerId, deps = {}) {
  const { stripe: stripeApi, supabase: db } = webhookDeps(deps);
  if (!customerId) {
    console.warn('[webhook] missing customer');
    return { user: null };
  }
  const customer = await stripeApi.customers.retrieve(customerId);
  const email = typeof customer?.email === 'string' ? customer.email : '';
  if (!email) {
    console.warn(`[webhook] customer ${customerId} has no email`);
    return { user: null };
  }
  try {
    const user = await findUserByEmail(email, db);
    if (!user) {
      console.warn(`[webhook] no Supabase user for customer ${customerId}`);
      return { user: null };
    }
    return { user, email, stripeClient: stripeApi, db };
  } catch (err) {
    const failure = lookupFailure(err);
    if (failure) return { failure };
    throw err;
  }
}

async function persistResolvedTier(user, tier, discordOnly, db) {
  const { error } = await db
    .from('user_profiles')
    .upsert({ id: user.id, tier }, { onConflict: 'id' });
  if (error) {
    console.error(`[webhook] tier update failed for ${user.id}`);
    return { status: 500, body: { error: 'tier update failed' } };
  }
  const wrote = await writeTierClaim(db, user.id, tier);
  const failure = subscriptionDeletedClaimResult(wrote);
  if (failure) {
    console.error(`[webhook] tier claim failed for ${user.id}`);
    return failure;
  }
  console.log(`[webhook] ${user.id} → ${tier}`);
  await setDiscordOnlyFlag(db, user.id, discordOnly);
  await safeDiscordSync(db, user.id);
  return null;
}

// Recompute a user's tier from live Stripe state. Remaining plans and an
// unrefunded lifetime purchase stay. A profile or claim failure is 5xx so
// Stripe retries. Both writes repeat the same value, so the retry is safe.
export async function clearTierByCustomer(customerId, deps = {}) {
  return guardStripe(async () => {
    const resolved = await resolveWebhookUser(customerId, deps);
    if (resolved.failure) return resolved.failure;
    if (!resolved.user) return null;
    const access = await computeStripeAccess(resolved.stripeClient, resolved.email);
    return persistResolvedTier(resolved.user, access.tier, access.discordOnly, resolved.db);
  });
}

export async function clearTierByEmail(email, deps = {}) {
  return guardStripe(async () => {
    const { stripe: stripeApi, supabase: db } = webhookDeps(deps);
    const target = typeof email === 'string' ? email.trim() : '';
    if (!target) return null;
    let user;
    try {
      user = await findUserByEmail(target, db);
    } catch (err) {
      const failure = lookupFailure(err);
      if (failure) return failure;
      throw err;
    }
    if (!user) {
      console.warn('[webhook] no Supabase user for charge email');
      return null;
    }
    const access = await computeStripeAccess(stripeApi, target);
    return persistResolvedTier(user, access.tier, access.discordOnly, db);
  });
}

function customerIdOf(value) {
  if (typeof value === 'string' && value) return value;
  if (value && typeof value === 'object' && typeof value.id === 'string') return value.id;
  return '';
}

function chargeContactEmail(charge) {
  const billing = charge?.billing_details?.email;
  if (typeof billing === 'string' && billing.trim()) return billing.trim();
  const receipt = charge?.receipt_email;
  if (typeof receipt === 'string' && receipt.trim()) return receipt.trim();
  return '';
}

function invoiceSubscriptionId(invoice) {
  if (!invoice) return null;
  if (typeof invoice.subscription === 'string') return invoice.subscription;
  if (invoice.subscription?.id) return invoice.subscription.id;
  const parent = invoice.parent?.subscription_details?.subscription;
  if (typeof parent === 'string') return parent;
  return parent?.id || null;
}

function paymentIntentIdOf(value) {
  if (typeof value === 'string' && value) return value;
  if (value && typeof value === 'object' && typeof value.id === 'string') return value.id;
  return '';
}

async function loadChargeContext(charge, stripeApi) {
  const invoiceRef = charge?.invoice;
  let invoice = invoiceRef && typeof invoiceRef === 'object' && (invoiceRef.lines || invoiceRef.payments)
    ? invoiceRef
    : null;
  const invoiceId = typeof invoiceRef === 'string' ? invoiceRef : invoiceRef?.id;
  if (!invoice && invoiceId && typeof stripeApi.invoices?.retrieve === 'function') {
    invoice = await stripeApi.invoices.retrieve(invoiceId);
  }
  if (!invoice) {
    const paymentIntentId = paymentIntentIdOf(charge?.payment_intent);
    if (paymentIntentId && typeof stripeApi.invoicePayments?.list === 'function') {
      const page = await stripeApi.invoicePayments.list({
        payment: { type: 'payment_intent', payment_intent: paymentIntentId },
        limit: 1,
      });
      const linked = page?.data?.[0]?.invoice;
      if (linked && typeof linked === 'object' && (linked.lines || linked.payments)) invoice = linked;
      else if (typeof linked === 'string' && typeof stripeApi.invoices?.retrieve === 'function') {
        invoice = await stripeApi.invoices.retrieve(linked);
      }
    }
  }
  let subscription = null;
  const subscriptionId = invoiceSubscriptionId(invoice);
  if (subscriptionId && typeof stripeApi.subscriptions?.retrieve === 'function') {
    subscription = await stripeApi.subscriptions.retrieve(subscriptionId);
  }
  return { invoice, subscription };
}

function stripeReadFailure(err) {
  console.error(`[webhook] stripe read failed: ${err?.type || err?.code || 'error'}`);
  return { status: 500, body: { error: 'stripe read failed' } };
}

async function guardStripe(work) {
  try {
    return await work();
  } catch (err) {
    const failure = lookupFailure(err);
    if (failure) return failure;
    return stripeReadFailure(err);
  }
}

async function recomputeCharge(charge, deps) {
  const customerId = customerIdOf(charge?.customer);
  if (customerId) return clearTierByCustomer(customerId, deps);
  const email = chargeContactEmail(charge);
  if (!email) {
    console.warn(`[webhook] charge ${charge?.id || ''} has no customer`);
    return null;
  }
  return clearTierByEmail(email, deps);
}

export async function handleChargeRefunded(charge, deps = {}) {
  return guardStripe(async () => {
    const { stripe: stripeApi } = webhookDeps(deps);
    const context = await loadChargeContext(charge, stripeApi);
    const revokes = await chargeRevokesEntitlement(stripeApi, charge, context);
    if (!revokes) {
      console.log(`[webhook] refund on ${charge?.id || 'unknown charge'} keeps access`);
      return null;
    }
    return recomputeCharge(charge, deps);
  });
}

async function chargeForDispute(dispute, stripeApi) {
  const charge = dispute?.charge;
  if (charge && typeof charge === 'object') return charge;
  const chargeId = typeof charge === 'string' ? charge : null;
  if (!chargeId || typeof stripeApi.charges?.retrieve !== 'function') return null;
  return stripeApi.charges.retrieve(chargeId);
}

export async function handleDisputeEvent(event, deps = {}) {
  return guardStripe(async () => {
    const dispute = event.data.object;
    const { stripe: stripeApi } = webhookDeps(deps);
    if (event.type === 'charge.dispute.closed') {
      if (dispute?.status !== 'won') return null;
      const loaded = await chargeForDispute(dispute, stripeApi);
      if (!loaded) {
        console.warn(`[webhook] dispute ${dispute?.id || ''} has no charge`);
        return null;
      }
      const charge = { ...loaded };
      if (!charge.customer && dispute?.customer) charge.customer = dispute.customer;
      return recomputeCharge(charge, deps);
    }
    if (event.type !== 'charge.dispute.created' && event.type !== 'charge.dispute.funds_withdrawn') {
      return null;
    }
    const loaded = await chargeForDispute(dispute, stripeApi);
    if (!loaded) {
      console.warn(`[webhook] dispute ${dispute?.id || ''} has no charge`);
      return null;
    }
    const charge = { ...loaded, disputed: true };
    if (!charge.customer && dispute?.customer) charge.customer = dispute.customer;
    const context = await loadChargeContext(charge, stripeApi);
    const revokes = await chargeRevokesEntitlement(stripeApi, charge, { ...context, forceDisputed: true });
    if (!revokes) {
      console.log(`[webhook] dispute ${dispute?.id || ''} keeps access`);
      return null;
    }
    return recomputeCharge(charge, deps);
  });
}

async function paymentChargeBlocks(stripeApi, paymentIntent) {
  let intent = paymentIntent;
  if (typeof intent === 'string') {
    if (typeof stripeApi.paymentIntents?.retrieve !== 'function') return false;
    intent = await stripeApi.paymentIntents.retrieve(intent, { expand: ['latest_charge'] });
  }
  const charge = intent && typeof intent === 'object' && typeof intent.latest_charge === 'object'
    ? intent.latest_charge
    : null;
  return lifetimeChargeBlocksAccess(charge, stripeApi);
}

function discordMetadata(metas) {
  return (metas || []).find((metadata) => metadataSignalsDiscord(metadata)) || null;
}

// Unknown prices fall back to full access. Before that fallback, classify the
// price (live Discord Only ids, product id, and product metadata
// tier=discord_only) and, if it is still unknown, the subscription itself so
// a Discord-only renewal cannot be granted the site. Known All-Access and
// legacy price ids skip the extra calls.
async function tierForInvoice(obj) {
  const line = obj.lines?.data?.[0];
  const rawPrice = line?.price;
  const priceId = rawPrice?.id || (typeof rawPrice === 'string' ? rawPrice : null);
  const metas = [
    obj.metadata,
    obj.subscription_details?.metadata,
    obj.parent?.subscription_details?.metadata,
    line?.metadata,
  ];
  let tier = await tierForStripePrice(getStripe(), rawPrice || priceId, { metadata: discordMetadata(metas) });
  const knownSitePrice = Boolean(priceId && TIER_BY_PRICE[priceId]);
  if (tier !== 'discord' && !knownSitePrice && obj.subscription) {
    try {
      const subscriptionId = typeof obj.subscription === 'string' ? obj.subscription : obj.subscription.id;
      const sub = await getStripe().subscriptions.retrieve(subscriptionId);
      const subPrice = sub.items?.data?.[0]?.price;
      tier = await tierForStripePrice(getStripe(), subPrice || rawPrice || priceId, {
        metadata: discordMetadata([sub.metadata, ...metas]),
      });
    } catch (err) {
      console.error('[webhook] could not confirm invoice plan:', err.message);
    }
  }
  return tier;
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
    event = getStripe().webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    console.error('[webhook] signature verification failed:', err.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  const obj = event.data.object;

  try {
  // ── checkout.session.completed ──────────────────────────────────────────
  // Fires immediately when the user completes checkout. Has client_reference_id
  // set to the Supabase user ID (added by SubscriptionPage.jsx).
  if (event.type === 'checkout.session.completed') {
    const userId = obj.client_reference_id;
    const email  = obj.customer_details?.email || obj.customer_email;

    // checkout.session.completed does NOT include line_items by default, so
    // resolve the real price from the subscription (or fetch line items for
    // one-time purchases) before mapping to a sport-specific tier.
    let price = obj.line_items?.data?.[0]?.price || null;
    if (!price && obj.subscription) {
      try {
        const sub = await getStripe().subscriptions.retrieve(obj.subscription);
        price = sub.items?.data?.[0]?.price || null;
      } catch (err) {
        console.error('[webhook] could not retrieve subscription for price:', err.message);
      }
    }
    if (!price) {
      try {
        const li = await getStripe().checkout.sessions.listLineItems(obj.id, { limit: 1 });
        price = li.data?.[0]?.price || null;
      } catch (err) {
        console.error('[webhook] could not list checkout line items:', err.message);
      }
    }
    // Lifetime ($249.99 and Founders $99.99) and Yearly ($149.99) resolve here
    // by price id / product id, including taxed totals that are not the list price.
    const tier = await tierForStripePrice(getStripe(), price, { metadata: obj.metadata });

    let replayBlocked = false;
    if (obj.subscription) {
      const sub = await getStripe().subscriptions.retrieve(
        typeof obj.subscription === 'string' ? obj.subscription : obj.subscription.id,
      );
      replayBlocked = await subscriptionPeriodBlocked(getStripe(), sub);
    }
    if (!replayBlocked && obj.payment_intent) {
      replayBlocked = await paymentChargeBlocks(getStripe(), obj.payment_intent);
    }
    let grantFailure = null;
    if (replayBlocked) {
      grantFailure = await clearTierByCustomer(customerIdOf(obj.customer));
    } else if (userId) {
      grantFailure = await setTierById(userId, tier);
    } else if (email) {
      grantFailure = await setTierByEmail(email, tier);
    } else {
      console.error('[webhook] checkout.session.completed: no user ID or email');
    }
    if (grantFailure) return res.status(grantFailure.status).json(grantFailure.body);

    // Server-side X purchase conversion (same Event ID + conversion_id = session
    // id as the browser pixel, so X de-duplicates). No-op unless the X_* env
    // vars are set; never throws, so it cannot fail the webhook.
    const reported = price && !obj.line_items
      ? { ...obj, line_items: { data: [{ price }] } }
      : obj;
    await reportPurchaseToX(reported, { conversionTime: (event.created || 0) * 1000 || undefined });
  }

  // ── customer.subscription.created ──────────────────────────────────────
  // Fires when any subscription is created (catches cases where checkout event
  // was missed or user subscribed via a direct Stripe link without being logged in).
  else if (event.type === 'customer.subscription.created') {
    if (await subscriptionPeriodBlocked(getStripe(), obj)) {
      const failure = await clearTierByCustomer(obj.customer);
      if (failure) return res.status(failure.status).json(failure.body);
    } else {
      const rawPrice = obj.items?.data?.[0]?.price;
      const tier = await tierForStripePrice(getStripe(), rawPrice, { metadata: obj.metadata });
      const customer = await getStripe().customers.retrieve(obj.customer);
      if (customer.email) {
        const grantFailure = await setTierByEmail(customer.email, tier);
        if (grantFailure) return res.status(grantFailure.status).json(grantFailure.body);
      }
    }
  }

  // ── invoice.payment_succeeded ───────────────────────────────────────────
  // Fires on every successful payment (initial + renewals). Keeps tier current
  // even if previous events failed.
  else if (event.type === 'invoice.payment_succeeded') {
    if (obj.billing_reason === 'subscription_create' || obj.billing_reason === 'subscription_cycle') {
      const failure = await handleInvoicePaymentSucceeded(obj);
      if (failure) return res.status(failure.status).json(failure.body);
    }
  }

  // ── customer.subscription.deleted ──────────────────────────────────────
  // Fires when a subscription is cancelled/expires. Revoke access.
  else if (event.type === 'customer.subscription.deleted') {
    const failure = await clearTierByCustomer(obj.customer);
    if (failure) return res.status(failure.status).json(failure.body);
  }

  else if (event.type === 'charge.refunded') {
    const failure = await handleChargeRefunded(obj);
    if (failure) return res.status(failure.status).json(failure.body);
  }

  else if (
    event.type === 'charge.dispute.created'
    || event.type === 'charge.dispute.funds_withdrawn'
    || event.type === 'charge.dispute.closed'
  ) {
    const failure = await handleDisputeEvent(event);
    if (failure) return res.status(failure.status).json(failure.body);
  }

  return res.status(200).json({ received: true });
  } catch (err) {
    const failure = lookupFailure(err) || stripeReadFailure(err);
    return res.status(failure.status).json(failure.body);
  }
}

export async function handleInvoicePaymentSucceeded(obj, deps = {}) {
  return guardStripe(async () => {
    const { stripe: stripeApi } = webhookDeps(deps);
    if (!(await invoiceStillGrants(stripeApi, obj))) {
      console.log(`[webhook] invoice ${obj.id || ''} charge is refunded or disputed`);
      return clearTierByCustomer(obj.customer, deps);
    }
    const tier = await tierForInvoice(obj);
    const customer = await stripeApi.customers.retrieve(obj.customer);
    if (customer?.email) {
      const failure = await setTierByEmail(customer.email, tier);
      if (failure) return failure;
    }
    return null;
  });
}
