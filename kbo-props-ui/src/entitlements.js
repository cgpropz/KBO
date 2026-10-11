// ─── Per-sport entitlements (client, display only) ───────────────────────────
// A user's access is derived solely from the `tier` string the server stores on
// user_profiles. There are no client-side overrides: owner/staff accounts get
// tier 'owner' in the database. New per-sport plans use 'kbo' | 'wnba' |
// 'combined'. Legacy/grandfathered all-access tiers ('monthly', 'season',
// 'weekly', 'pro', 'owner', 'all') unlock every live sport, including NHL.
// 'discord' is the
// Discord-only membership: it is not in ALL_ACCESS_TIERS and unlocks nothing
// on the site.
//
// NOTE: this only controls UI chrome. Paid data itself is gated server-side in
// api/data.js (see api/_dataAccess.js, which must stay in sync with this file).

// Tiers that unlock every sport (grandfathered all-access + the combined plan).
const ALL_ACCESS_TIERS = new Set([
  'owner', 'pro', 'monthly', 'weekly', 'season', 'all', 'combined',
]);

// Returns per-sport access for a given tier. NFL and NHL are All Access features.
export function sportAccess(tier) {
  if (ALL_ACCESS_TIERS.has(tier)) return { kbo: true, wnba: true, nfl: true, nhl: true };
  return { kbo: tier === 'kbo', wnba: tier === 'wnba', nfl: false, nhl: false };
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

// Local screenshots only. Production builds set DEV to false, so this cannot
// open the live tab or pretend to be a subscriber.
const DEV_PREVIEW_TIERS = new Set([
  'free', 'discord', 'kbo', 'wnba', 'combined', 'weekly', 'monthly', 'season', 'pro', 'all', 'owner',
]);

export function nhlDevBypass(isDev, search) {
  if (!isDev) return false;
  const params = new URLSearchParams(typeof search === 'string' ? search : '');
  return params.get('nhl') === '1';
}

export function devTierOverride(isDev, search) {
  if (!isDev) return null;
  const params = new URLSearchParams(typeof search === 'string' ? search : '');
  const tier = params.get('previewTier');
  return DEV_PREVIEW_TIERS.has(tier) ? tier : null;
}

// Landing cards. NBA stays closed until its access check says full.
// NHL is a live sport, same as KBO, WNBA, and NFL.
export function landingSportOpens(sportId, nbaOpen) {
  if (sportId === 'nba') return nbaOpen === true;
  return sportId === 'kbo' || sportId === 'wnba' || sportId === 'nfl' || sportId === 'nhl';
}

export function hasAnyPaidAccess(tier) {
  const a = sportAccess(tier);
  return a.kbo || a.wnba || a.nfl || a.nhl;
}
