// ─── Per-sport entitlements (client) ─────────────────────────────────────────
// A user's access is derived from a single `tier` string on user_profiles plus
// their email (for owner overrides). New per-sport plans use 'kbo' | 'wnba' |
// 'combined'. Legacy/grandfathered all-access tiers ('monthly', 'season',
// 'weekly', 'pro', 'owner', 'all') unlock BOTH sports so existing subscribers
// keep everything they paid for.

export const OWNER_EMAILS = [
  'cgpropz@gmail.com',
  'vicelocksx@gmail.com',
  'brittaneycollard@yahoo.com',
  'gbaby_95@yahoo.com',
];

// Tiers that unlock both sports (grandfathered all-access + the combined plan).
const ALL_ACCESS_TIERS = new Set([
  'owner', 'pro', 'monthly', 'weekly', 'season', 'all', 'combined',
]);

export function isOwnerEmail(email) {
  return OWNER_EMAILS.includes((email || '').toLowerCase());
}

// Returns per-sport access for a given tier + email. NFL is an All Access / Pro feature.
export function sportAccess(tier, email) {
  if (isOwnerEmail(email)) return { kbo: true, wnba: true, nfl: true };
  if (ALL_ACCESS_TIERS.has(tier)) return { kbo: true, wnba: true, nfl: true };
  return { kbo: tier === 'kbo', wnba: tier === 'wnba', nfl: false };
}

export function hasAnyPaidAccess(tier, email) {
  const a = sportAccess(tier, email);
  return a.kbo || a.wnba || a.nfl;
}
