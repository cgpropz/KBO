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

// Display shortcut for the owner email. The landing card, switcher, and stored
// sport also follow GET /api/nba-access, which is full access from api/data.js
// (owner always, all-access tiers only after nba_public). Paid rows stay on
// the nba_* 403 gate.
export const NBA_OWNER_EMAIL = 'cgpropz@gmail.com';

export function canSeeNba(user) {
  const email = typeof user?.email === 'string' ? user.email.trim().toLowerCase() : '';
  return email === NBA_OWNER_EMAIL;
}

// NHL is not decided here. The hub asks GET /api/nhl-access, which checks the
// Supabase session against the admin allowlist. A matching email in the
// browser is not enough, and a paid tier is not enough.

// Local screenshots only. Production builds set DEV to false, so this cannot
// open the live tab.
export function nhlDevBypass(isDev, search) {
  if (!isDev) return false;
  const params = new URLSearchParams(typeof search === 'string' ? search : '');
  return params.get('nhl') === '1';
}

// Landing cards. NBA and NHL open only when their access check says full.
export function landingSportOpens(sportId, nbaOpen, nhlOpen) {
  if (sportId === 'nba') return nbaOpen === true;
  if (sportId === 'nhl') return nhlOpen === true;
  return sportId === 'kbo' || sportId === 'wnba' || sportId === 'nfl';
}

export function hasAnyPaidAccess(tier) {
  const a = sportAccess(tier);
  return a.kbo || a.wnba || a.nfl;
}
