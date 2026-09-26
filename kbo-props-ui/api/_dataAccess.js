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
  // NFL
  nfl_projections: { table: 'nfl_projections', sport: 'nfl', free: previewList(nflScore) },
  nfl_lineups: { table: 'nfl_lineups', sport: 'nfl', free: previewList(() => 0) },
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
