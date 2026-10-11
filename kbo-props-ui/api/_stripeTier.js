// ─── Stripe → tier entitlement helpers (server, shared) ──────────────────────
// NOT a route: the leading underscore keeps Vercel from exposing this as an API
// endpoint. Imported by api/stripe-webhook.js and api/sync-subscription.js.
//
// Plans are sold by billing cadence (Weekly / Monthly / Yearly / Lifetime),
// not by sport — every current price grants 'combined' (all-access:
// KBO+WNBA+NFL+NHL). The old single-sport prices ('kbo' / 'wnba') are kept
// here only so legacy subscribers' renewals still resolve correctly;
// mergeTier() never downgrades an existing all-access tier, and mergeTier()
// unions two single-sport tiers into 'combined' if a legacy subscriber ever
// adds the other sport.
//
// TODO: set these Vercel env vars before deploy if the live Stripe prices
// change. Defaults live in src/foundersOffer.js and stay recognized even
// when an env var points checkout at a replacement id:
//   STRIPE_PRICE_LIFETIME   $249.99 one-time Lifetime (price_1UPJ78PwL0k9PEMvnZPU3k5a)
//   STRIPE_PRICE_FOUNDERS   $99.99 Founders lifetime (price_1THZjaPwL0k9PEMvARtuGG1F)
//   STRIPE_PRICE_YEARLY     $149.99/yr All-Access (price_1UPJ7DPwL0k9PEMv2Z9Ca8B5)
//   STRIPE_PRODUCT_LIFETIME Lifetime product (prod_UG5v4BQ2Mo0wie)
// The old KBO yearly price price_1THCpZPwL0k9PEMvPlLqiIDu ($49.99/yr) stays
// tier 'kbo'. Do not point STRIPE_PRICE_YEARLY at it.
// Lifetime is granted by price id or product id (or price/product metadata
// tier=combined on a one-time price). The $99.99 amount fallback is only for
// legacy charges that have no price attached — payment links add sales tax,
// so a taxed buyer never hits exactly 9999 cents.
//
// Discord-only prices are NOT in the map below. Env
// (STRIPE_PRICE_DISCORD_WEEKLY / STRIPE_PRICE_DISCORD_MONTHLY) can point at
// them, and the live Discord Only prices are the default when those vars are
// empty. They resolve to 'discord', which does not unlock the site. A price
// id already in this map stays a site plan even if an env var is pointed at
// it. Unknown prices still fall back to 'combined' so an unlisted All-Access
// price is not under-delivered — unless the Stripe product is Discord Only
// (product id below, or product metadata tier=discord_only). A Checkout
// Session stamped cg_plan discord_weekly / discord_monthly, or tier
// discord_only, is Discord-only even when the price id is missing.

import {
  DEFAULT_FOUNDERS_PRICE_ID,
  DEFAULT_LIFETIME_PRICE_ID,
  DEFAULT_LIFETIME_PRODUCT_ID,
  DEFAULT_YEARLY_PRICE_ID,
  LEGACY_LIFETIME_PRICE_ID,
} from '../src/foundersOffer.js';

function cleanEnv(value) {
  return (value || '').replace(/\\n/g, '').trim();
}

function uniqueIds(values) {
  return [...new Set(values.filter(Boolean))];
}

function envPriceId(value) {
  const cleaned = cleanEnv(value);
  return /^price_[A-Za-z0-9]+$/.test(cleaned) ? cleaned : '';
}

function envProductId(value) {
  const cleaned = cleanEnv(value);
  return /^prod_[A-Za-z0-9]+$/.test(cleaned) ? cleaned : '';
}

export const TIER_BY_PRICE = {
  'price_1TtFFePwL0k9PEMvPJUUwuTr': 'combined', // Monthly All-Access $29.99 / mo
  'price_1TtFErPwL0k9PEMvIrEJajK1': 'combined', // Weekly All-Access  $9.99  / wk (was KBO Weekly)
  'price_1TtFEPPwL0k9PEMvc8kcK6Ut': 'wnba',      // WNBA Monthly      $19.99 / mo (legacy)
  'price_1TtFDNPwL0k9PEMvEzCTHBbL': 'wnba',      // WNBA Weekly       $9.99  / wk (legacy)
  'price_1THCokPwL0k9PEMvcWwT7F2c': 'kbo',       // KBO Monthly       $19.99 / mo (legacy)
  [LEGACY_LIFETIME_PRICE_ID]: 'combined', // Lifetime / Founders $99.99 once (was KBO Lifetime)
  'price_1THCpZPwL0k9PEMvPlLqiIDu': 'kbo',       // KBO Full Season   $49.99 / yr (legacy). Leave as KBO-only.
};

// Legacy pre-change charges with no price id attached. Taxed Checkout
// charges are matched by price or product id, not this amount.
export const LIFETIME_AMOUNT = 9999;

export const LEGACY_KBO_YEARLY_PRICE_ID = 'price_1THCpZPwL0k9PEMvPlLqiIDu';

export function lifetimePriceIds(env = process.env) {
  return uniqueIds([
    LEGACY_LIFETIME_PRICE_ID,
    DEFAULT_LIFETIME_PRICE_ID,
    DEFAULT_FOUNDERS_PRICE_ID,
    envPriceId(env?.STRIPE_PRICE_LIFETIME),
    envPriceId(env?.STRIPE_PRICE_FOUNDERS),
  ]);
}

export function foundersPriceIds(env = process.env) {
  return uniqueIds([
    DEFAULT_FOUNDERS_PRICE_ID,
    envPriceId(env?.STRIPE_PRICE_FOUNDERS),
  ]);
}

export function yearlyPriceIds(env = process.env) {
  return uniqueIds([
    DEFAULT_YEARLY_PRICE_ID,
    envPriceId(env?.STRIPE_PRICE_YEARLY),
  ]);
}

export function lifetimeProductIds(env = process.env) {
  return uniqueIds([
    DEFAULT_LIFETIME_PRODUCT_ID,
    envProductId(env?.STRIPE_PRODUCT_LIFETIME),
  ]);
}

// Price charged at checkout. Defaults stay in the recognition lists above.
export function activeLifetimePriceId(env = process.env) {
  return envPriceId(env?.STRIPE_PRICE_LIFETIME) || DEFAULT_LIFETIME_PRICE_ID;
}

export function activeFoundersPriceId(env = process.env) {
  return envPriceId(env?.STRIPE_PRICE_FOUNDERS) || DEFAULT_FOUNDERS_PRICE_ID;
}

export function activeYearlyPriceId(env = process.env) {
  return envPriceId(env?.STRIPE_PRICE_YEARLY) || DEFAULT_YEARLY_PRICE_ID;
}

export function isKnownSitePrice(priceId, env = process.env) {
  if (!priceId) return false;
  if (Object.prototype.hasOwnProperty.call(TIER_BY_PRICE, priceId)) return true;
  if (lifetimePriceIds(env).includes(priceId)) return true;
  if (yearlyPriceIds(env).includes(priceId)) return true;
  return false;
}

// Live Discord Only product on acct_1TGUv1PwL0k9PEMv. Env vars override the
// price used at checkout; these ids are always recognized so a missing env
// var cannot turn them into All-Access.
export const DISCORD_ONLY_PRODUCT_ID = 'prod_VPwxqlhggnjQZ5';
export const DISCORD_WEEKLY_PRICE_ID = 'price_1UP73vPwL0k9PEMvDVDtXWzq'; // $5.99 / week
export const DISCORD_MONTHLY_PRICE_ID = 'price_1UP73wPwL0k9PEMv5Pobm6nU'; // $19.99 / month

const DISCORD_PRICE_DEFAULTS = [DISCORD_WEEKLY_PRICE_ID, DISCORD_MONTHLY_PRICE_ID];

export function discordPriceIds(env = process.env) {
  const ids = [
    ...DISCORD_PRICE_DEFAULTS,
    cleanEnv(env?.STRIPE_PRICE_DISCORD_WEEKLY),
    cleanEnv(env?.STRIPE_PRICE_DISCORD_MONTHLY),
  ].filter(Boolean);
  return [...new Set(ids)];
}

// Hardcoded All-Access and legacy prices stay site plans. A mis-set Discord
// env var must not steal one of them.
export function isDiscordPrice(priceId, env = process.env) {
  if (!priceId || isKnownSitePrice(priceId, env)) return false;
  return discordPriceIds(env).includes(priceId);
}

export function metadataSignalsDiscord(metadata) {
  if (!metadata || typeof metadata !== 'object') return false;
  const plan = metadata.cg_plan;
  if (plan === 'discord_weekly' || plan === 'discord_monthly') return true;
  // Discord Only product metadata: { tier: 'discord_only' }.
  return metadata.tier === 'discord_only';
}

// True when this purchase is Discord-only. Checkout/product metadata wins
// even over a known site price id, so a Discord checkout cannot fall through
// to All-Access. A known site price with no Discord metadata stays a site plan.
export function signalsDiscordOnly({ price, priceId, product, metadata, env = process.env } = {}) {
  if (metadataSignalsDiscord(metadata)) return true;
  const id = priceId || (typeof price === 'string' ? price : price?.id) || null;
  if (price && typeof price === 'object' && metadataSignalsDiscord(price.metadata)) return true;
  const productRef = product || (price && typeof price === 'object' ? price.product : null);
  if (productRef && typeof productRef === 'object' && metadataSignalsDiscord(productRef.metadata)) return true;
  if (id && isKnownSitePrice(id, env)) return false;
  if (isLifetimeProductId(productRef, env)) return false;
  if (isDiscordPrice(id, env)) return true;
  if (typeof productRef === 'string') return productRef === DISCORD_ONLY_PRODUCT_ID;
  if (productRef && typeof productRef === 'object') return productRef.id === DISCORD_ONLY_PRODUCT_ID;
  return false;
}

export function tierForPrice(priceId, env = process.env) {
  if (isDiscordPrice(priceId, env)) return 'discord';
  if (priceId && TIER_BY_PRICE[priceId]) return TIER_BY_PRICE[priceId];
  if (priceId && (lifetimePriceIds(env).includes(priceId) || yearlyPriceIds(env).includes(priceId))) {
    return 'combined';
  }
  // Unknown price — never under-deliver to a paying customer.
  return 'combined';
}

// Checkout metadata wins when it names a Discord-only plan, so that purchase
// cannot fall through to the unknown-price 'combined' fallback.
function metadataSignalsCombined(metadata) {
  return Boolean(metadata && typeof metadata === 'object' && metadata.tier === 'combined');
}

function productIdOf(productRef) {
  if (!productRef) return null;
  if (typeof productRef === 'string') return productRef;
  return productRef.id || null;
}

export function isLifetimeProductId(productRef, env = process.env) {
  const id = productIdOf(productRef);
  return Boolean(id && lifetimeProductIds(env).includes(id));
}

function isKnownRecurringPrice(priceId, env) {
  if (!priceId || lifetimePriceIds(env).includes(priceId)) return false;
  if (yearlyPriceIds(env).includes(priceId)) return true;
  return Object.prototype.hasOwnProperty.call(TIER_BY_PRICE, priceId);
}

// One-time Lifetime / Founders access. Recurring prices (including the new
// yearly plan and the legacy $49.99 KBO year) are not lifetime, even when
// their metadata says tier=combined — the subscription grants access only
// while it is active.
export function signalsLifetimePurchase({ priceId, price, product, metadata, env = process.env } = {}) {
  if (metadataSignalsDiscord(metadata)) return false;
  const priceObj = price && typeof price === 'object' ? price : null;
  if (priceObj && metadataSignalsDiscord(priceObj.metadata)) return false;
  const id = priceId || priceObj?.id || (typeof price === 'string' ? price : null);
  const productRef = product || priceObj?.product || null;
  const productObj = productRef && typeof productRef === 'object' ? productRef : null;
  if (productObj && metadataSignalsDiscord(productObj.metadata)) return false;
  if (metadata?.cg_plan === 'discord_weekly' || metadata?.cg_plan === 'discord_monthly') return false;
  if (id && lifetimePriceIds(env).includes(id)) return true;
  if (isLifetimeProductId(productRef, env)) return true;
  if (metadata?.cg_plan === 'lifetime' || metadata?.cg_plan === 'founders') return true;
  if (isKnownRecurringPrice(id, env)) return false;
  if (priceObj?.recurring || priceObj?.type === 'recurring') return false;
  return metadataSignalsCombined(metadata)
    || metadataSignalsCombined(priceObj?.metadata)
    || metadataSignalsCombined(productObj?.metadata);
}

export function resolvePurchaseTier({ priceId, price, product, metadata, env = process.env } = {}) {
  if (signalsDiscordOnly({ price, priceId, product, metadata, env })) return 'discord';
  const id = priceId || (typeof price === 'string' ? price : price?.id);
  if (signalsLifetimePurchase({ priceId: id, price, product, metadata, env })) return 'combined';
  if (
    metadataSignalsCombined(metadata)
    || metadataSignalsCombined(price?.metadata)
    || (product && typeof product === 'object' && metadataSignalsCombined(product.metadata))
  ) {
    if (!id || TIER_BY_PRICE[id] === 'combined' || !TIER_BY_PRICE[id]) return 'combined';
  }
  return tierForPrice(id, env);
}

// Classify a Stripe price. Known site and Discord price ids resolve locally.
// Any other id is retrieved once so product metadata tier=discord_only (or
// the Discord Only product id) cannot fall through to All-Access. A failed
// lookup keeps the unknown-price combined fallback.
export async function tierForStripePrice(stripe, priceOrId, { metadata, env = process.env } = {}) {
  const price = priceOrId && typeof priceOrId === 'object' ? priceOrId : null;
  const priceId = price?.id || (typeof priceOrId === 'string' ? priceOrId : null);
  const direct = resolvePurchaseTier({ priceId, price, metadata, env });
  if (direct === 'discord') return 'discord';
  if (priceId && isKnownSitePrice(priceId, env)) return direct;
  const product = price?.product;
  const expanded = product && typeof product === 'object';
  if (!expanded && priceId && typeof stripe?.prices?.retrieve === 'function') {
    try {
      const full = await stripe.prices.retrieve(priceId, { expand: ['product'] });
      return resolvePurchaseTier({ priceId: full?.id || priceId, price: full, metadata, env });
    } catch {
      // Leave the combined fallback in place when Stripe can't be asked.
    }
  }
  return direct;
}

// Higher rank = more access. All-access/grandfathered tiers sit at 3+ so they
// are never downgraded by a single-sport purchase event.
const RANK = {
  free: 0, kbo: 1, wnba: 1, combined: 2,
  weekly: 3, monthly: 3, season: 3, pro: 3, all: 3, owner: 4,
};
const rank = (t) => RANK[t] ?? 0;

// Merge an incoming purchase tier with the user's current stored tier.
// - Discord-only never replaces a site tier. A site tier replaces discord-only.
// - Grandfathered all-access (rank >= 3) is preserved.
// - Two different single-sport plans union into 'combined'.
export function mergeTier(current, incoming) {
  if (incoming === 'discord') {
    if (!current || current === 'free' || current === 'discord') return 'discord';
    return current;
  }
  if (!current || current === 'free' || current === 'discord') return incoming;
  if (rank(current) >= 3) return current;
  if (current === 'combined') return 'combined';
  if (incoming === 'combined' || rank(incoming) >= 3) return incoming;
  const s = new Set([current, incoming]);
  if (s.has('kbo') && s.has('wnba')) return 'combined';
  return incoming;
}

export function tierFromSports(sports, hasAny) {
  if (!hasAny) return 'free';
  const kbo = sports.has('kbo');
  const wnba = sports.has('wnba');
  if (kbo && wnba) return 'combined';
  if (kbo) return 'kbo';
  if (wnba) return 'wnba';
  return 'free';
}

// Stripe Customer.list({ email }) is an exact, case-sensitive filter. Checkout
// stores the address the buyer typed (`KLAW1193@icloud.com`), while Supabase
// login emails are lowercase, so a list-only lookup returns nobody and a paid
// subscriber stays on the free tier. Customer Search matches email regardless
// of case. Search can lag a new customer by about a minute, so list is tried
// first for both casings.
function escapeSearchValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export async function customersForEmail(stripe, email) {
  const raw = (email || '').trim();
  const key = raw.toLowerCase();
  if (!key.includes('@')) return [];

  const byId = new Map();
  const consider = (rows) => {
    for (const row of rows || []) {
      const rowEmail = (row?.email || '').trim().toLowerCase();
      if (row?.id && rowEmail === key) byId.set(row.id, row);
    }
  };

  if (typeof stripe.customers?.list === 'function') {
    for (const query of new Set([raw, key])) {
      const page = await stripe.customers.list({ email: query, limit: 10 });
      consider(page?.data);
    }
  }

  if (byId.size === 0 && typeof stripe.customers?.search === 'function') {
    const found = await stripe.customers.search({
      query: `email:"${escapeSearchValue(key)}"`,
      limit: 10,
    });
    consider(found?.data);
  }

  return [...byId.values()];
}

function lineCommerce(line) {
  const price = line?.price && (typeof line.price === 'string' || line.price.id)
    ? line.price
    : null;
  const details = line?.pricing?.price_details;
  const priceId = typeof price === 'string'
    ? price
    : price?.id || (typeof details?.price === 'string' ? details.price : details?.price?.id) || null;
  const product = (price && typeof price === 'object' ? price.product : null)
    || details?.product
    || null;
  return { price: price || (priceId ? { id: priceId, product } : null), priceId, product };
}

function applyCommerceLines(target, lines, metadata, env) {
  if (!lines?.length) return;
  target.resolved = true;
  const infos = lines.map((line) => ({ ...lineCommerce(line), metadata: line?.metadata }));
  const discord = infos.every((info) => signalsDiscordOnly({
    price: info.price,
    priceId: info.priceId,
    product: info.product,
    metadata: info.metadata,
    env,
  }));
  if (discord) {
    target.discord = true;
    return;
  }
  if (infos.some((info) => signalsLifetimePurchase({
    price: info.price,
    priceId: info.priceId,
    product: info.product,
    metadata: info.metadata || metadata,
    env,
  }))) {
    target.lifetime = true;
  }
}

// Resolve a charge to a price/product. Lifetime links add sales tax, so the
// charged total is not a reliable signal. Legacy charges that predate price
// ids have neither an invoice nor a Checkout Session.
async function resolveChargeCommerce(stripe, charge, env) {
  const target = { resolved: false, discord: false, lifetime: false };
  if (metadataSignalsDiscord(charge?.metadata)) {
    target.discord = true;
    target.resolved = true;
    return target;
  }
  if (signalsLifetimePurchase({ metadata: charge?.metadata, env })) {
    target.lifetime = true;
    target.resolved = true;
    return target;
  }

  const invoiceRef = charge?.invoice;
  const invoiceId = typeof invoiceRef === 'string' ? invoiceRef : invoiceRef?.id;
  if (invoiceId && typeof stripe.invoices?.retrieve === 'function') {
    try {
      const invoice = typeof invoiceRef === 'object' && invoiceRef?.lines
        ? invoiceRef
        : await stripe.invoices.retrieve(invoiceId);
      if (
        metadataSignalsDiscord(invoice?.metadata)
        || metadataSignalsDiscord(invoice?.subscription_details?.metadata)
        || metadataSignalsDiscord(invoice?.parent?.subscription_details?.metadata)
      ) {
        target.discord = true;
        target.resolved = true;
        return target;
      }
      applyCommerceLines(target, invoice?.lines?.data, invoice?.metadata, env);
      if (target.lifetime || target.discord) return target;
    } catch {
      // Fall through. A legacy $99.99 charge with an unreadable invoice still
      // uses the amount fallback below.
    }
  }

  const pi = typeof charge?.payment_intent === 'string'
    ? charge.payment_intent
    : charge?.payment_intent?.id;
  if (!target.resolved && pi && typeof stripe.checkout?.sessions?.list === 'function') {
    try {
      const found = await stripe.checkout.sessions.list({
        payment_intent: pi,
        limit: 1,
        expand: ['data.line_items.data.price'],
      });
      const session = found?.data?.[0];
      if (session) {
        if (metadataSignalsDiscord(session.metadata)) {
          target.discord = true;
          target.resolved = true;
          return target;
        }
        applyCommerceLines(target, session.line_items?.data, session.metadata, env);
        if (!target.resolved && (session.metadata?.cg_plan === 'lifetime' || session.metadata?.cg_plan === 'founders')) {
          target.lifetime = true;
          target.resolved = true;
        }
      }
    } catch {
      // Leave unresolved so the legacy amount fallback can still apply.
    }
  }
  return target;
}

async function chargeGrantsSiteLifetime(stripe, charge, env) {
  if (!(charge?.paid && !charge.refunded)) return false;
  const commerce = await resolveChargeCommerce(stripe, charge, env);
  if (commerce.discord) return false;
  if (commerce.lifetime) return true;
  // Price was visible and it is not a lifetime price/product.
  if (commerce.resolved) return false;
  // Legacy pre-change PaymentIntent: no invoice, no Checkout price.
  return charge.amount === LIFETIME_AMOUNT;
}

// Authoritative recompute from live Stripe state: active/trialing
// subscriptions + any one-time lifetime charge.
// Returns { tier, discordOnly }.
// tier is 'free' | 'discord' | 'kbo' | 'wnba' | 'combined'.
// discordOnly means an active Discord-only subscription is present. It can be
// true alongside a site tier (All-Access + Discord Only → both roles).
// Email matching is case-insensitive (see customersForEmail).
export async function computeStripeAccess(stripe, email, env = process.env) {
  const sports = new Set();
  let hasSite = false;
  let discordOnly = false;

  const customers = await customersForEmail(stripe, email);
  for (const c of customers) {
    const subs = await stripe.subscriptions.list({ customer: c.id, status: 'all', limit: 20 });
    for (const s of subs.data) {
      if (s.status !== 'active' && s.status !== 'trialing') continue;
      const rawPrice = s.items?.data?.[0]?.price;
      const t = await tierForStripePrice(stripe, rawPrice, { metadata: s.metadata, env });
      if (t === 'discord') {
        discordOnly = true;
        continue;
      }
      hasSite = true;
      if (t === 'combined') { sports.add('kbo'); sports.add('wnba'); }
      else if (t !== 'discord') sports.add(t);
    }

    // One-time Lifetime / Founders purchase (no subscription). Matched by
    // price id, product id, or one-time price/product metadata tier=combined.
    // The exact $99.99 amount is only a fallback for legacy charges that have
    // no price attached. Taxed totals never match 9999, so they must not be
    // required to. Grants both sports: Lifetime is all-access.
    try {
      const charges = await stripe.charges.list({ customer: c.id, limit: 50 });
      for (const ch of charges.data) {
        if (!(ch.paid && !ch.refunded)) continue;
        const tagged = ch.metadata?.cg_plan === 'lifetime' || ch.metadata?.cg_plan === 'founders';
        if (!tagged && ch.amount < LIFETIME_AMOUNT) continue;
        if (!(await chargeGrantsSiteLifetime(stripe, ch, env))) continue;
        sports.add('kbo');
        sports.add('wnba');
        hasSite = true;
      }
    } catch { /* charges optional */ }
  }

  let tier = tierFromSports(sports, hasSite);
  if (tier === 'free' && discordOnly) tier = 'discord';
  return { tier, discordOnly };
}

export async function computeStripeTier(stripe, email, env = process.env) {
  const access = await computeStripeAccess(stripe, email, env);
  return access.tier;
}

// Current plans keyed by charged amount (cents). Used for analytics/purchase
// tracking only (never for entitlement): api/_checkoutSession.js and the X
// Conversions API report in api/stripe-webhook.js.
export const PLAN_BY_AMOUNT = {
  499: 'weekly',    // Weekly All-Access with XWEEK ($5 off once) → $4.99 first week
  999: 'weekly',    // Weekly All-Access   $9.99  / wk
  2999: 'monthly',   // Monthly All-Access  $29.99 / mo
  14999: 'yearly',    // Yearly All-Access   $149.99 / yr (pre-tax subtotal)
  9999: 'lifetime',  // Founders / legacy Lifetime $99.99 (pre-tax subtotal)
  24999: 'lifetime',  // Lifetime All-Access $249.99 (pre-tax subtotal)
};

const CHECKOUT_PLANS = new Set([
  'weekly', 'monthly', 'yearly', 'lifetime', 'founders', 'discord_weekly', 'discord_monthly',
]);

const WEEKLY_PRICE_ID = 'price_1TtFErPwL0k9PEMvIrEJajK1';
const MONTHLY_PRICE_ID = 'price_1TtFFePwL0k9PEMvPJUUwuTr';

export function planForAmount(amountCents) {
  return PLAN_BY_AMOUNT[Number(amountCents)] || 'other';
}

export function planForPriceId(priceId, env = process.env) {
  if (!priceId) return null;
  if (priceId === WEEKLY_PRICE_ID) return 'weekly';
  if (priceId === MONTHLY_PRICE_ID) return 'monthly';
  if (yearlyPriceIds(env).includes(priceId)) return 'yearly';
  if (lifetimePriceIds(env).includes(priceId)) return 'lifetime';
  return null;
}

function sessionPriceId(session) {
  const line = session?.line_items?.data?.[0];
  const price = line?.price;
  if (typeof price === 'string') return price;
  if (price?.id) return price.id;
  const ref = line?.pricing?.price_details?.price;
  return typeof ref === 'string' ? ref : ref?.id || null;
}

// Prefer the plan stamped on a Checkout Session (weekly + XWEEK is $4.99 before
// tax, and tax can move the charged total off the table above). Price id is
// next, then the pre-tax subtotal, then the charged total.
export function planForCheckout(session, env = process.env) {
  const tagged = session?.metadata?.cg_plan;
  if (CHECKOUT_PLANS.has(tagged)) return tagged;
  const fromPrice = planForPriceId(sessionPriceId(session), env);
  if (fromPrice) return fromPrice;
  if (session?.amount_subtotal != null && PLAN_BY_AMOUNT[Number(session.amount_subtotal)]) {
    return PLAN_BY_AMOUNT[Number(session.amount_subtotal)];
  }
  return planForAmount(session?.amount_total);
}
