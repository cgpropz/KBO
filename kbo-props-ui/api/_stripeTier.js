// ─── Stripe → tier entitlement helpers (server, shared) ──────────────────────
// NOT a route: the leading underscore keeps Vercel from exposing this as an API
// endpoint. Imported by api/stripe-webhook.js and api/sync-subscription.js.
//
// Plans are now sold by billing cadence (Weekly / Monthly / Lifetime), not by
// sport — every current price grants 'combined' (all-access: KBO+WNBA+NFL).
// The old single-sport prices ('kbo' / 'wnba') are kept here only so legacy
// subscribers' renewals still resolve correctly; mergeTier() never downgrades
// an existing all-access tier, and mergeTier() unions two single-sport tiers
// into 'combined' if a legacy subscriber ever adds the other sport.

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

export function tierForPrice(priceId) {
  if (priceId && TIER_BY_PRICE[priceId]) return TIER_BY_PRICE[priceId];
  // Unknown price — never under-deliver to a paying customer.
  return 'combined';
}

// Higher rank = more access. All-access/grandfathered tiers sit at 3+ so they
// are never downgraded by a single-sport purchase event.
const RANK = {
  free: 0, kbo: 1, wnba: 1, combined: 2,
  weekly: 3, monthly: 3, season: 3, pro: 3, all: 3, owner: 4,
};
const rank = (t) => RANK[t] ?? 0;

// Merge an incoming purchase tier with the user's current stored tier.
// - Grandfathered all-access (rank >= 3) is preserved.
// - Two different single-sport plans union into 'combined'.
export function mergeTier(current, incoming) {
  if (!current || current === 'free') return incoming;
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

// Authoritative recompute of a user's tier from their live Stripe state:
// active/trialing subscriptions + any one-time lifetime charge. Returns
// 'free' | 'kbo' | 'wnba' | 'combined'. Used on cancellation and self-heal.
export async function computeStripeTier(stripe, email) {
  const sports = new Set();
  let hasAny = false;

  const customers = await stripe.customers.list({ email, limit: 10 });
  for (const c of customers.data) {
    const subs = await stripe.subscriptions.list({ customer: c.id, status: 'all', limit: 20 });
    for (const s of subs.data) {
      if (s.status !== 'active' && s.status !== 'trialing') continue;
      hasAny = true;
      const t = tierForPrice(s.items?.data?.[0]?.price?.id);
      if (t === 'combined') { sports.add('kbo'); sports.add('wnba'); }
      else sports.add(t);
    }

    // One-time Lifetime All-Access purchase (no subscription) — detect via a
    // paid, non-refunded charge matching the lifetime amount. Grants both
    // sports since Lifetime is now an all-access plan.
    try {
      const charges = await stripe.charges.list({ customer: c.id, limit: 50 });
      for (const ch of charges.data) {
        if (ch.paid && !ch.refunded && ch.amount === LIFETIME_AMOUNT) {
          sports.add('kbo');
          sports.add('wnba');
          hasAny = true;
        }
      }
    } catch (_) { /* charges optional */ }
  }

  return tierFromSports(sports, hasAny);
}
