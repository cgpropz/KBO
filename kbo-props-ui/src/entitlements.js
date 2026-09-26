// ─── Per-sport entitlements (client, display only) ───────────────────────────
// A user's access is derived solely from the `tier` string the server stores on
// user_profiles. There are no client-side overrides: owner/staff accounts get
// tier 'owner' in the database. New per-sport plans use 'kbo' | 'wnba' |
// 'combined'. Legacy/grandfathered all-access tiers ('monthly', 'season',
// 'weekly', 'pro', 'owner', 'all') unlock every sport.
//
// NOTE: this only controls UI chrome. Paid data itself is gated server-side in
// api/data.js (see api/_dataAccess.js, which must stay in sync with this file).

// Tiers that unlock every sport (grandfathered all-access + the combined plan).
const ALL_ACCESS_TIERS = new Set([
  'owner', 'pro', 'monthly', 'weekly', 'season', 'all', 'combined',
]);

// Returns per-sport access for a given tier. NFL is an All Access / Pro feature.
export function sportAccess(tier) {
  if (ALL_ACCESS_TIERS.has(tier)) return { kbo: true, wnba: true, nfl: true };
  return { kbo: tier === 'kbo', wnba: tier === 'wnba', nfl: false };
}

export function hasAnyPaidAccess(tier) {
  const a = sportAccess(tier);
  return a.kbo || a.wnba || a.nfl;
}
