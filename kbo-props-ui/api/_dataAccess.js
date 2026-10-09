// ─── Server-side data entitlement helpers (shared, NOT a route) ─────────────
// The leading underscore keeps Vercel from exposing this file as an endpoint.
// Imported by api/data.js. Kept free of Supabase/network code so the free-vs-
// paid trimming logic can be unit-tested with plain objects.
//
// Every paid dataset lives in a single-row (id = 1) jsonb snapshot table that
// the pipeline upserts with the service-role key. The browser no longer reads
// those tables (or /data/*.json) directly; it calls /api/data?ds=<name> and
// this module decides how much of the snapshot the caller may see.

export const FREE_ROW_LIMIT = 3;

// Tiers that unlock every sport (grandfathered all-access + combined plan).
// Must stay in sync with src/entitlements.js.
const ALL_ACCESS_TIERS = new Set([
  'owner', 'pro', 'monthly', 'weekly', 'season', 'all', 'combined',
]);

export function sportAccess(tier) {
  if (ALL_ACCESS_TIERS.has(tier)) return { kbo: true, wnba: true, nfl: true };
  return { kbo: tier === 'kbo', wnba: tier === 'wnba', nfl: false };
}

// Must match src/entitlements.js NBA_OWNER_EMAIL. Server-side gate only.
export const NBA_OWNER_EMAIL = 'cgpropz@gmail.com';
export const NBA_PUBLIC_FLAG = 'nba_public';

export function isNbaDataset(ds) {
  return typeof ds === 'string' && ds.startsWith('nba_');
}

/**
 * NBA visibility. Returns 'full', 'preview', or 'deny'.
 *
 * emailResolved false (bad token, missing email, timed-out auth) denies
 * everyone. flagResolved false (missing table, query error, timeout) does
 * not unlock the public; the owner email is still allowed. tierResolved
 * false denies non-owners even when the flag is on, so a profile blip
 * cannot fall open to a preview.
 *
 * Once nba_public is true, all-access tiers get full data. Legacy kbo/wnba
 * tiers and free accounts get the preview path. sportAccess() itself stays
 * { kbo, wnba, nfl } so existing boards are unchanged.
 */
export function nbaAccessDecision({
  emailResolved,
  email,
  tierResolved,
  tier,
  flagResolved,
  nbaPublic,
}) {
  if (emailResolved !== true) return 'deny';
  const normalized = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (normalized === NBA_OWNER_EMAIL) return 'full';
  if (flagResolved !== true || nbaPublic !== true) return 'deny';
  if (tierResolved !== true) return 'deny';
  if (ALL_ACCESS_TIERS.has(tier)) return 'full';
  return 'preview';
}

export const NHL_OWNER_EMAIL = NBA_OWNER_EMAIL;
export const NHL_PUBLIC_FLAG = 'nhl_public';

export function isNhlDataset(ds) {
  return typeof ds === 'string' && ds.startsWith('nhl_');
}

/**
 * Same rule as nbaAccessDecision, with the nhl_public flag.
 * 'full' | 'preview' | 'deny'. The owner email is always full.
 * Everyone else is denied until nhl_public is true, and then only
 * all-access tiers are full. sportAccess() stays { kbo, wnba, nfl }.
 */
export function nhlAccessDecision({
  emailResolved,
  email,
  tierResolved,
  tier,
  flagResolved,
  nhlPublic,
}) {
  return nbaAccessDecision({
    emailResolved,
    email,
    tierResolved,
    tier,
    flagResolved,
    nbaPublic: nhlPublic,
  });
}

export function nbaAllowed(email, tier, nbaPublic) {
  // A missing email is not a resolved caller. Anonymous preview is decided
  // separately in nbaAccessDecision once the API has confirmed there is no token.
  const emailResolved = typeof email === 'string' && email.trim() !== '';
  return nbaAccessDecision({
    emailResolved,
    email,
    tierResolved: true,
    tier,
    flagResolved: true,
    nbaPublic,
  }) === 'full';
}

// ── Scoring helpers (mirror each board's default "CG Score" sort) ──────────
function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function ratioScore(projection, line) {
  const p = num(projection);
  const l = num(line);
  return Number.isFinite(p) && l > 0 ? (p / l) * 50 : -Infinity;
}

// KboPropBoard.scoreFor
function kboPropScore(prop) {
  const score = num(prop?.cg_projection ?? prop?.rating);
  if (Number.isFinite(score)) return score;
  return ratioScore(prop?.avg ?? prop?.projection, prop?.line);
}

// StrikeoutProjections / BatterProjections rows
function kboProjectionScore(row) {
  const score = num(row?.cg_projection ?? row?.rating);
  if (Number.isFinite(score)) return score;
  const edge = num(row?.edge);
  return Number.isFinite(edge) ? edge : -Infinity;
}

// WNBA Dashboard: score = projection / line × 50
function wnbaPropScore(player, prop) {
  const line = prop?.standardLine ?? prop?.line;
  const projection = prop?.projection ?? player?.propProjectionByStat?.[prop?.stat];
  return ratioScore(projection, line);
}

// NFL Prop Lines: score = projection / line × 50
function nflScore(row) {
  return ratioScore(row?.projection, row?.line);
}

// Unconfirmed goalies stay off the free top 3.
function nhlScore(row) {
  if (row?.rankEligible === false) return -Infinity;
  return ratioScore(row?.projection, row?.line);
}

function nhlSharpScore(row) {
  if (row?.rankEligible === false) return -Infinity;
  return nflSharpScore(row);
}

// PrizePicks odds board: free preview keeps the best Flex PP-edge rows.
// Older snapshots that only stored sportsbook EV still sort on that.
function nflGameMarketScore(row) {
  const edges = [row?.spread?.edge, row?.total?.edge, row?.moneyline?.edge]
    .map(num)
    .filter(Number.isFinite)
    .map((value) => Math.abs(value));
  return edges.length ? Math.max(...edges) : -Infinity;
}

function nflSharpScore(row) {
  const edge = num(row?.pp_edge_flex ?? row?.pp_edge_pct);
  if (Number.isFinite(edge)) return edge;
  const ev = num(row?.ev_pct);
  return Number.isFinite(ev) ? ev : -Infinity;
}

function wnbaSharpScore(row) {
  const books = num(row?.matched_books_count);
  if (Number.isFinite(books)) return books;
  const outcomes = num(row?.matched_outcomes_count);
  return Number.isFinite(outcomes) ? outcomes : -Infinity;
}

function topN(items, scoreFn, n = FREE_ROW_LIMIT) {
  return items
    .map((item, index) => ({ item, index, score: scoreFn(item) }))
    .sort((a, b) => (b.score - a.score) || (a.index - b.index))
    .slice(0, n);
}

// ── Preview builders: return { data, lockedCount } ─────────────────────────
// Every builder keeps the original payload shape so the existing UI code can
// render the preview without special cases.

function previewList(scoreFn) {
  return (payload) => {
    const rows = Array.isArray(payload) ? payload : [];
    const kept = topN(rows, scoreFn).map(({ item }) => item);
    return { data: kept, lockedCount: Math.max(0, rows.length - kept.length) };
  };
}

function previewObjectList(key, scoreFn) {
  return (payload) => {
    const obj = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
    const rows = Array.isArray(obj[key]) ? obj[key] : [];
    const kept = scoreFn
      ? topN(rows, scoreFn).map(({ item }) => item)
      : rows.slice(0, FREE_ROW_LIMIT);
    return {
      data: { ...obj, [key]: kept },
      lockedCount: Math.max(0, rows.length - kept.length),
    };
  };
}

// prizepicks_props: { cards: [{ ...player, props: [...] }] } → keep the best
// FREE_ROW_LIMIT props across all cards, regrouped under their cards.
function previewPrizepicks(payload) {
  const obj = payload && typeof payload === 'object' ? payload : {};
  const cards = Array.isArray(obj.cards) ? obj.cards : [];
  const flat = [];
  cards.forEach((card, cardIndex) => {
    (Array.isArray(card?.props) ? card.props : []).forEach((prop) => flat.push({ cardIndex, prop }));
  });
  const kept = topN(flat, ({ prop }) => kboPropScore(prop));
  const byCard = new Map();
  kept.forEach(({ item }) => {
    if (!byCard.has(item.cardIndex)) byCard.set(item.cardIndex, []);
    byCard.get(item.cardIndex).push(item.prop);
  });
  const trimmedCards = [...byCard.entries()].map(([cardIndex, props]) => ({ ...cards[cardIndex], props }));
  return {
    data: { ...obj, cards: trimmedCards, total_props: kept.length },
    lockedCount: Math.max(0, flat.length - kept.length),
  };
}

// WNBA projections_*: [{ ...player, ppAllProps: [...] }] → best props, regrouped.
function previewWnbaProjections(payload) {
  const players = Array.isArray(payload) ? payload : [];
  const flat = [];
  players.forEach((player, playerIndex) => {
    (Array.isArray(player?.ppAllProps) ? player.ppAllProps : []).forEach((prop) => flat.push({ playerIndex, prop }));
  });
  if (!flat.length) {
    // No lines posted yet: expose at most FREE_ROW_LIMIT player rows.
    const kept = players.slice(0, FREE_ROW_LIMIT);
    return { data: kept, lockedCount: Math.max(0, players.length - kept.length) };
  }
  const kept = topN(flat, ({ playerIndex, prop }) => wnbaPropScore(players[playerIndex], prop));
  const byPlayer = new Map();
  kept.forEach(({ item }) => {
    if (!byPlayer.has(item.playerIndex)) byPlayer.set(item.playerIndex, []);
    byPlayer.get(item.playerIndex).push(item.prop);
  });
  const keptKeys = new Set(kept.map(({ item }) => item.prop));
  const data = [...byPlayer.entries()].map(([playerIndex, props]) => {
    const player = players[playerIndex];
    const out = { ...player, ppAllProps: props };
    // Line maps duplicate the prop list; drop the entries that were not kept.
    for (const key of ['ppLines', 'ppLinesStandard']) {
      if (Array.isArray(player?.[key])) out[key] = player[key].filter((p) => keptKeys.has(p));
      else if (player?.[key] && typeof player[key] === 'object') {
        const stats = new Set(props.map((p) => p?.stat));
        out[key] = Object.fromEntries(Object.entries(player[key]).filter(([stat]) => stats.has(stat)));
      }
    }
    return out;
  });
  return { data, lockedCount: Math.max(0, flat.length - kept.length) };
}

// matchup_data: the slate itself (teams, venue, weather, probable pitchers'
// public stat lines, team/park stats) backs the free Pitcher Rankings tab, so
// every game is kept, but all CG projections, lines and graded props — the
// paid part — are removed.
function stripPitcher(pitcher) {
  if (!pitcher || typeof pitcher !== 'object') return pitcher;
  // eslint-disable-next-line no-unused-vars
  const { line, k_projection, projection, edge, rating, recommendation, ...rest } = pitcher;
  return rest;
}

function previewMatchups(payload) {
  const obj = payload && typeof payload === 'object' ? payload : {};
  const matchups = Array.isArray(obj.matchups) ? obj.matchups : [];
  let lockedCount = 0;
  const data = matchups.map((game) => {
    lockedCount += Array.isArray(game?.props) ? game.props.length : 0;
    return {
      ...game,
      props: [],
      market: null,
      away_pitcher: stripPitcher(game?.away_pitcher),
      home_pitcher: stripPitcher(game?.home_pitcher),
    };
  });
  return { data: { ...obj, matchups: data }, lockedCount };
}

// graded_props_history: settled results (graded + summary) are the public
// track record shown on the free Tracker tab; today's open picks (pending)
// are paid content and are trimmed to FREE_ROW_LIMIT.
function previewGradedHistory(payload) {
  const obj = payload && typeof payload === 'object' ? payload : {};
  const pending = Array.isArray(obj.pending) ? obj.pending : [];
  const kept = pending.slice(0, FREE_ROW_LIMIT);
  return {
    data: { ...obj, pending: kept },
    lockedCount: Math.max(0, pending.length - kept.length),
  };
}

const FULL = 'full';

// ds → { table, sport, free }. `free` is either FULL (dataset only contains
// public stats that back free tabs) or a preview builder.
export const DATASETS = {
  // KBO
  prizepicks_props: { table: 'prizepicks_props', sport: 'kbo', free: previewPrizepicks },
  strikeout_projections: { table: 'strikeout_projections', sport: 'kbo', free: previewObjectList('projections', kboProjectionScore) },
  batter_projections: { table: 'batter_projections', sport: 'kbo', free: previewObjectList('projections', kboProjectionScore) },
  matchup_data: { table: 'matchup_data', sport: 'kbo', free: previewMatchups },
  pitcher_rankings: { table: 'pitcher_rankings', sport: 'kbo', free: FULL },
  graded_props_history: { table: 'graded_props_history', sport: 'kbo', free: previewGradedHistory },
  // WNBA
  wnba_projections_standard: { table: 'wnba_projections_standard', sport: 'wnba', free: previewWnbaProjections },
  wnba_projections_demon: { table: 'wnba_projections_demon', sport: 'wnba', free: previewWnbaProjections },
  wnba_projections_goblin: { table: 'wnba_projections_goblin', sport: 'wnba', free: previewWnbaProjections },
  wnba_lineups: { table: 'wnba_lineups', sport: 'wnba', free: previewList(() => 0) },
  wnba_players: { table: 'wnba_players', sport: 'wnba', free: FULL },
  wnba_dvp_guard: { table: 'wnba_dvp_guard', sport: 'wnba', free: FULL },
  wnba_dvp_forward: { table: 'wnba_dvp_forward', sport: 'wnba', free: FULL },
  wnba_dvp_center: { table: 'wnba_dvp_center', sport: 'wnba', free: FULL },
  wnba_sharp_odds: { table: 'wnba_sharp_odds', sport: 'wnba', free: previewObjectList('records', wnbaSharpScore) },
  // NFL
  nfl_projections: { table: 'nfl_projections', sport: 'nfl', free: previewList(nflScore) },
  nfl_lineups: { table: 'nfl_lineups', sport: 'nfl', free: previewList(() => 0) },
  nfl_sharp_odds: { table: 'nfl_sharp_odds', sport: 'nfl', free: previewObjectList('records', nflSharpScore) },
  nfl_game_markets: { table: 'nfl_game_markets', sport: 'nfl', free: previewObjectList('games', nflGameMarketScore) },
  // NBA. The /api/data gate still denies these unless the caller is full access.
  // The free builder is only the preview path after nba_public is on.
  nba_players: { table: 'nba_players', sport: 'nba', free: previewList(() => 0) },
  nba_teams: { table: 'nba_teams', sport: 'nba', free: previewList(() => 0) },
  nba_dvp_pg: { table: 'nba_dvp_pg', sport: 'nba', free: previewObjectList('teams', () => 0) },
  nba_dvp_sg: { table: 'nba_dvp_sg', sport: 'nba', free: previewObjectList('teams', () => 0) },
  nba_dvp_sf: { table: 'nba_dvp_sf', sport: 'nba', free: previewObjectList('teams', () => 0) },
  nba_dvp_pf: { table: 'nba_dvp_pf', sport: 'nba', free: previewObjectList('teams', () => 0) },
  nba_dvp_c: { table: 'nba_dvp_c', sport: 'nba', free: previewObjectList('teams', () => 0) },
  nba_projections_standard: { table: 'nba_projections_standard', sport: 'nba', free: previewWnbaProjections },
  nba_projections_demon: { table: 'nba_projections_demon', sport: 'nba', free: previewWnbaProjections },
  nba_projections_goblin: { table: 'nba_projections_goblin', sport: 'nba', free: previewWnbaProjections },
  // NHL. Denied unless the caller is full access. Preview is only after nhl_public.
  nhl_projections: { table: 'nhl_projections', sport: 'nhl', free: previewList(nhlScore) },
  nhl_lineups: { table: 'nhl_lineups', sport: 'nhl', free: previewList(() => 0) },
  nhl_sharp_odds: { table: 'nhl_sharp_odds', sport: 'nhl', free: previewObjectList('records', nhlSharpScore) },
};

// Decide what the caller receives for one dataset snapshot.
export function shapeForTier(ds, payload, tier) {
  const spec = Object.hasOwn(DATASETS, ds) ? DATASETS[ds] : null;
  if (!spec) throw new Error(`Unknown dataset: ${ds}`);
  const paid = sportAccess(tier)[spec.sport] === true;
  if (paid || spec.free === FULL) {
    return { data: payload, preview: false, lockedCount: 0 };
  }
  const { data, lockedCount } = spec.free(payload);
  return { data, preview: true, lockedCount };
}
