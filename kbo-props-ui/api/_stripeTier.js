// ─── Stripe → tier entitlement helpers (server, shared) ──────────────────────
// NOT a route: the leading underscore keeps Vercel from exposing this as an API
// endpoint. Imported by api/stripe-webhook.js and api/sync-subscription.js.
//
// Plans are now sold by billing cadence (Weekly / Monthly / Lifetime), not by
// sport — every current price grants 'combined' (all-access: KBO+WNBA+NFL+NHL).
// The old single-sport prices ('kbo' / 'wnba') are kept here only so legacy
// subscribers' renewals still resolve correctly; mergeTier() never downgrades
// an existing all-access tier, and mergeTier() unions two single-sport tiers
// into 'combined' if a legacy subscriber ever adds the other sport.
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

function cleanEnv(value) {
  return (value || '').replace(/\\n/g, '').trim();
}

export const TIER_BY_PRICE = {
  'price_1TtFFePwL0k9PEMvPJUUwuTr': 'combined', // Monthly All-Access $29.99 / mo
  'price_1TtFErPwL0k9PEMvIrEJajK1': 'combined', // Weekly All-Access  $9.99  / wk (was KBO Weekly)
  'price_1TtFEPPwL0k9PEMvc8kcK6Ut': 'wnba',      // WNBA Monthly      $19.99 / mo (legacy)
  'price_1TtFDNPwL0k9PEMvEzCTHBbL': 'wnba',      // WNBA Weekly       $9.99  / wk (legacy)
  'price_1THCokPwL0k9PEMvcWwT7F2c': 'kbo',       // KBO Monthly       $19.99 / mo (legacy)
  'price_1THZjaPwL0k9PEMvARtuGG1F': 'combined', // Lifetime All-Access $99.99 once (was KBO Lifetime)
  'price_1THCpZPwL0k9PEMvPlLqiIDu': 'kbo',       // KBO Full Season   $49.99 / yr (legacy)
};

// One-time lifetime price + amount (cents) used to detect lifetime charges.
export const LIFETIME_AMOUNT = 9999;

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
  if (!priceId || Object.prototype.hasOwnProperty.call(TIER_BY_PRICE, priceId)) return false;
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
  if (id && Object.prototype.hasOwnProperty.call(TIER_BY_PRICE, id)) return false;
  if (isDiscordPrice(id, env)) return true;
  if (typeof productRef === 'string') return productRef === DISCORD_ONLY_PRODUCT_ID;
  if (productRef && typeof productRef === 'object') return productRef.id === DISCORD_ONLY_PRODUCT_ID;
  return false;
}

export function tierForPrice(priceId, env = process.env) {
  if (isDiscordPrice(priceId, env)) return 'discord';
  if (priceId && TIER_BY_PRICE[priceId]) return TIER_BY_PRICE[priceId];
  // Unknown price — never under-deliver to a paying customer.
  return 'combined';
}

// Checkout metadata wins when it names a Discord-only plan, so that purchase
// cannot fall through to the unknown-price 'combined' fallback.
export function resolvePurchaseTier({ priceId, price, product, metadata, env = process.env } = {}) {
  if (signalsDiscordOnly({ price, priceId, product, metadata, env })) return 'discord';
  const id = priceId || (typeof price === 'string' ? price : price?.id);
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
  if (priceId && Object.prototype.hasOwnProperty.call(TIER_BY_PRICE, priceId)) return direct;
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

// A paid $99.99 charge is Lifetime All-Access, unless we can see it belongs to
// a Discord-only price or a Discord-only checkout. When the charge has no
// invoice (the historical Lifetime PaymentIntent), the amount rule is unchanged.
async function chargeGrantsSiteLifetime(stripe, charge, env) {
  if (metadataSignalsDiscord(charge?.metadata)) return false;
  const invoiceRef = charge?.invoice;
  const invoiceId = typeof invoiceRef === 'string' ? invoiceRef : invoiceRef?.id;
  if (!invoiceId || typeof stripe.invoices?.retrieve !== 'function') return true;
  try {
    const invoice = typeof invoiceRef === 'object' && invoiceRef?.lines
      ? invoiceRef
      : await stripe.invoices.retrieve(invoiceId);
    if (
      metadataSignalsDiscord(invoice?.metadata)
      || metadataSignalsDiscord(invoice?.subscription_details?.metadata)
      || metadataSignalsDiscord(invoice?.parent?.subscription_details?.metadata)
    ) return false;
    const lines = invoice?.lines?.data || [];
    if (lines.length > 0 && lines.every((line) => signalsDiscordOnly({
      price: line?.price,
      priceId: typeof line?.price === 'string' ? line.price : line?.price?.id,
      metadata: line?.metadata,
      env,
    }))) return false;
  } catch {
    // Can't prove the charge is Discord-only, so the $99.99 rule still applies.
  }
  return true;
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

    // One-time Lifetime All-Access purchase (no subscription) — detect via a
    // paid, non-refunded charge matching the lifetime amount. Grants both
    // sports since Lifetime is now an all-access plan. Discord-only charges
    // are excluded above so they cannot become Lifetime.
    try {
      const charges = await stripe.charges.list({ customer: c.id, limit: 50 });
      for (const ch of charges.data) {
        if (!(ch.paid && !ch.refunded && ch.amount === LIFETIME_AMOUNT)) continue;
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
  499: 'weekly',   // Weekly All-Access with XWEEK ($5 off once) → $4.99 first week
  999: 'weekly',    // Weekly All-Access   $9.99  / wk
  2999: 'monthly',  // Monthly All-Access  $29.99 / mo
  9999: 'lifetime', // Lifetime All-Access $99.99 once
};

const CHECKOUT_PLANS = new Set([
  'weekly', 'monthly', 'lifetime', 'discord_weekly', 'discord_monthly',
]);

export function planForAmount(amountCents) {
  return PLAN_BY_AMOUNT[Number(amountCents)] || 'other';
}

// Prefer the plan stamped on a Checkout Session (weekly + XWEEK is $4.99 before
// tax, and tax can move the charged total off the table above).
export function planForCheckout(session) {
  const tagged = session?.metadata?.cg_plan;
  if (CHECKOUT_PLANS.has(tagged)) return tagged;
  return planForAmount(session?.amount_total);
}
