import { boundCg, cgScore, lineMatchesStat } from '../src/cgScore.js';
import { kboRawRating, modelProjection as kboModelNumber, scoreFor as kboBoardScore } from '../src/kboBoardScore.js';
import { nflCgScore, nflRawScore } from '../src/nfl/nflLineFloors.js';
import { NFL_FREE_PREVIEW_ENABLED } from '../src/nflPreviewFlag.js';
import { NBA_FREE_PREVIEW_ENABLED } from '../src/nbaPreviewFlag.js';
import { applyPointsOverGate, dropPulledRows, pointsOverDisposition, prizepicksPulled } from '../src/nhl/pointsGate.js';
import { filterStandardBoard, isStandardBoardLine, summaryForGradedRows } from '../src/standardBoard.js';
import { mergeLivePrizePicks } from '../src/kboLiveLines.js';
import { wnbaCgScore } from '../src/wnba/wnbaScore.js';

export { NFL_FREE_PREVIEW_ENABLED };

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

// Total-edge calls inside the free NFL game-markets preview. Paid
// All-Access does not read this. NFL_FREE_TOTAL_EDGES_ENABLED=true sends
// them again and lets a total rank a game into the preview. Unset or any
// other value withholds the number. Spreads are unchanged.
export function nflFreeTotalEdgesEnabled(env = process.env) {
  const raw = String(env?.NFL_FREE_TOTAL_EDGES_ENABLED ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

const NFL_FREE_PREVIEW_DATASETS = new Set([
  'nfl_projections',
  'nfl_sharp_odds',
  'nfl_game_markets',
]);

// Tiers that unlock every sport (grandfathered all-access + combined plan).
// Must stay in sync with src/entitlements.js. The 'discord' tier is absent on
// purpose: Discord-only membership does not unlock any site dataset.
const ALL_ACCESS_TIERS = new Set([
  'owner', 'pro', 'monthly', 'weekly', 'season', 'all', 'combined',
]);

export function sportAccess(tier) {
  if (ALL_ACCESS_TIERS.has(tier)) return { kbo: true, wnba: true, nfl: true, nhl: true };
  return { kbo: tier === 'kbo', wnba: tier === 'wnba', nfl: false, nhl: false };
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
 * tiers and free accounts get the preview path. sportAccess() still has no
 * nba key. NHL uses the same all-access flag as NFL.
 */
export function nbaAccessDecision({
  emailResolved,
  email,
  tierResolved,
  tier,
  flagResolved,
  nbaPublic,
  freePreview = NBA_FREE_PREVIEW_ENABLED,
  freeTop3Dataset = false,
}) {
  if (emailResolved !== true) return 'deny';
  const normalized = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (normalized === NBA_OWNER_EMAIL) return 'full';
  if (flagResolved === true && nbaPublic === true) {
    // nba_public on: exactly main's behavior whatever the free top 3 flag is.
    // All-access is full; every other resolved caller (free, legacy,
    // logged-out) gets the free preview of any NBA dataset.
    if (tierResolved !== true) return 'deny';
    if (ALL_ACCESS_TIERS.has(tier)) return 'full';
    return 'preview';
  }
  // nba_public off (or its read failed): main denies. Only the free NBA top 3
  // flag (src/nbaPreviewFlag.js, off by default) opens anything here, and only
  // the free top 3 dataset, through the preview trimmer.
  if (freePreview !== true || freeTop3Dataset !== true) return 'deny';
  if (tierResolved !== true) return 'deny';
  return 'preview';
}

// The one NBA dataset the homepage free top 3 reads.
export const NBA_FREE_TOP3_DATASETS = new Set(['nba_projections_standard']);

export const NHL_OWNER_EMAIL = NBA_OWNER_EMAIL;
export const NHL_PUBLIC_FLAG = 'nhl_public';

export function isNhlDataset(ds) {
  return typeof ds === 'string' && ds.startsWith('nhl_');
}

/**
 * NHL uses the same entitlement as KBO, WNBA, and NFL.
 *
 * 'full' when the resolved session is the admin email, or the resolved tier
 * is all-access (sportAccess().nhl). Discord-only, legacy single-sport,
 * free, and anonymous callers get 'preview' — the same trimmed snapshot the
 * other sports return, not a hard deny. A missing or failed auth check never
 * counts as full, including a caller who claims the admin address or an
 * all-access tier without a resolved session. nhl_public is not consulted.
 */
export function nhlAccessDecision({
  emailResolved,
  email,
  tierResolved,
  tier,
}) {
  if (emailResolved !== true) return 'preview';
  const normalized = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (normalized === NHL_OWNER_EMAIL) return 'full';
  if (tierResolved === true && sportAccess(tier).nhl === true) return 'full';
  return 'preview';
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

function ratioScore(projection, line, stat) {
  if (!lineMatchesStat(stat, line)) return -Infinity;
  const p = num(projection);
  const l = num(line);
  return Number.isFinite(p) && l > 0 ? (p / l) * 50 : -Infinity;
}

// KboPropBoard.scoreFor. Confidence (`cg_projection`) and the season mean
// (`avg`) are not the CG Score.
function kboPropScore(prop) {
  const score = kboBoardScore(prop);
  return score == null ? -Infinity : score;
}

// StrikeoutProjections / BatterProjections rows. `rating` is already the
// board score. The confidence score is not a rank key.
function kboProjectionScore(row) {
  const stat = row?.prop ?? row?.stat;
  if (!lineMatchesStat(stat, row?.line)) return -Infinity;
  // No model number (formula_source 'none', or a projection field that is
  // explicitly empty): never ranked, even if a stray rating is present.
  if (row?.formula_source === 'none') return -Infinity;
  // A line PrizePicks pulled never takes a free slot.
  if (prizepicksPulled(row)) return -Infinity;
  if (row && Object.prototype.hasOwnProperty.call(row, 'projection') && kboModelNumber(row) == null) return -Infinity;
  const rating = num(row?.rating);
  if (Number.isFinite(rating)) return boundCg(rating);
  const score = ratioScore(row?.projection, row?.line, stat);
  return Number.isFinite(score) ? boundCg(score) : score;
}

// Shared player-prop preview score. `scoreFn` is the board's CG Score.
function boardPropScore(player, prop, scoreFn) {
  const projection = prop?.projection ?? player?.propProjectionByStat?.[prop?.stat];
  const score = scoreFn(projection, prop);
  if (score == null) return -Infinity;
  const line = num(prop?.line);
  if (!Number.isFinite(num(projection)) || !(line > 0)) return -Infinity;
  return score;
}

// WNBA preview score. standardLine is not the denominator. The stored line is not rewritten.
function wnbaPropScore(player, prop) {
  return boardPropScore(player, prop, wnbaCgScore);
}

// HIGH RISK (free NBA top 3 selection only; the member board, its ranking and
// the score are unchanged). The exclusion uses the ESPN injury tag written by
// nba/availability.py plus the fields the projection step writes on each player:
//   matched !== true                    PrizePicks name not tied to a roster player
//   projectionStatus !== 'projected'    no projection from a game log
//   gp < NBA_MIN_GAMES (10)             fewer than 10 games with minutes logged
//   avgMins missing or < NBA_MIN_AVG_MINUTES (20)   low or unknown minutes role
//   injuryChecked !== true              ESPN injury report not read for this row
//   injuryStatus set                    ESPN Out, Suspended, Doubtful, Questionable,
//                                       Day-To-Day or GTD
// Any one of these keeps every prop of that player out of the free top 3.
export const NBA_MIN_GAMES = 10;
export const NBA_MIN_AVG_MINUTES = 20;

// Tags nba/availability.py writes. Any non-empty injuryStatus is treated as a
// risk (an unknown tag counts too), and a row whose report was not read
// (injuryChecked !== true) fails closed.
export const NBA_RISK_INJURY_STATUSES = new Set(['out', 'suspended', 'doubtful', 'questionable', 'day-to-day', 'gtd']);

export function nbaHighRisk(player) {
  if (!player || typeof player !== 'object') return true;
  if (player.injuryChecked !== true) return true;
  if (player.injuryStatus != null && String(player.injuryStatus).trim() !== '') return true;
  if (player.matched !== true) return true;
  if (player.projectionStatus !== 'projected') return true;
  const gp = num(player.gp);
  if (!Number.isFinite(gp) || gp < NBA_MIN_GAMES) return true;
  const mins = num(player.avgMins);
  if (!Number.isFinite(mins) || mins < NBA_MIN_AVG_MINUTES) return true;
  return false;
}

// NBA uses the same preview shape and still divides by the pick's own line.
// WNBA floors do not apply. Bounded 0-100 like KBO and NFL. Only the free
// preview calls this; high-risk players never take a free slot.
function nbaPropScore(player, prop) {
  if (nbaHighRisk(player)) return -Infinity;
  return boardPropScore(player, prop, (projection, row) => boundCg(cgScore(projection, row?.line, row?.stat ?? row?.prop)));
}

// Unbounded score of the same pick: the tie-break at the 100 cap, as the
// landing's publicFreeTopRows (and #312 for KBO) do.
function nbaPropRawScore(player, prop) {
  if (nbaHighRisk(player)) return -Infinity;
  return boardPropScore(player, prop, (projection, row) => cgScore(projection, row?.line, row?.stat ?? row?.prop));
}

// NFL Prop Lines preview score.
// Receiving and rushing yards use the Middle floors (15.5 and 18.5).
// A yardage line at or below 0.5 still does not score.
// Exactly 50 is no pick (projection on the line, or a short over the floor
// holds at 50), so it never takes a free slot.
function nflScore(row) {
  const score = nflCgScore(row?.projection, row?.line, row?.prop ?? row?.stat);
  return score == null || score === 50 ? -Infinity : score;
}

// Tie-break for rows that share a shown score (several at the 100 cap).
function nflRaw(row) {
  const raw = nflRawScore(row?.projection, row?.line, row?.prop ?? row?.stat);
  return raw == null ? -Infinity : raw;
}

function nflPlayerKey(row, index) {
  const name = String(row?.player ?? '').trim().toLowerCase();
  return name || `\0${index}`;
}

// Free NFL board: each player's highest-scoring eligible prop, then the top 3
// distinct players. Started games and unmatched yardage lines are not eligible.
function previewNflProjections(payload) {
  const rows = (Array.isArray(payload) ? payload : []).filter((row) => (
    lineMatchesStat(row?.prop ?? row?.stat, row?.line) && !gameAlreadyStarted(row)
  ));
  const bestByPlayer = new Map();
  rows.forEach((item, index) => {
    const score = nflScore(item);
    const raw = nflRaw(item);
    const key = nflPlayerKey(item, index);
    const current = bestByPlayer.get(key);
    if (!current || score > current.score || (score === current.score && (raw > current.raw || (raw === current.raw && index < current.index)))) {
      bestByPlayer.set(key, { item, index, score, raw });
    }
  });
  const kept = [...bestByPlayer.values()]
    .filter((row) => Number.isFinite(row.score))
    .sort((a, b) => (b.score - a.score) || (b.raw === a.raw ? 0 : b.raw - a.raw) || (a.index - b.index))
    .slice(0, FREE_ROW_LIMIT)
    .map(({ item }) => item);
  return { data: kept, lockedCount: Math.max(0, rows.length - kept.length) };
}

// Kickoff has arrived. `now` is the server clock at the moment the preview
// is built, which is the /api/data request. A missing or unparseable
// start_time stays eligible: there is no kickoff that has passed.
function etDayKey(now) {
  const date = now instanceof Date ? now : new Date(now);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function gameAlreadyStarted(row, now = new Date()) {
  if (row?.started === true || row?.locked === true || row?.removed === true) return true;
  const raw = row?.start_time ?? row?.startTime ?? row?.start_time_utc ?? row?.kickoff_at;
  if (raw != null && String(raw).trim() !== '') {
    const kick = Date.parse(String(raw));
    const nowMs = now instanceof Date ? now.getTime() : Date.parse(String(now));
    if (Number.isFinite(kick) && Number.isFinite(nowMs)) return kick <= nowMs;
  }
  const day = row?.game_date || row?.gameDate || row?.gameday;
  if (typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day)) return day < etDayKey(now);
  return false;
}

// A pulled line (removed flag or a pulled pp_status) never enters a free pool.
function propStillLive(player, prop) {
  return !gameAlreadyStarted(prop) && !gameAlreadyStarted(player) && !prizepicksPulled(prop) && prop?.rankEligible !== false;
}

// Points overs under 0.69 are already gone. Held overs (0.69 up to 0.78)
// and unconfirmed goalies stay off the free top 3.
function nhlScore(row) {
  if (row?.rankEligible === false || gameAlreadyStarted(row)) return -Infinity;
  if (pointsOverDisposition(row) !== 'rank') return -Infinity;
  return ratioScore(row?.projection, row?.line, row?.stat ?? row?.prop);
}

// Prop boards a member actually scrolls. The free preview and the paid
// payload both start from this set: standard lines only, then pulled and
// removed PrizePicks rows. The NHL Points-over gate runs only for
// nhl_projections.
const MEMBER_BOARD_DATASETS = new Set([
  'prizepicks_props',
  'wnba_projections_standard',
  'nfl_projections',
  'nhl_projections',
]);

function memberBoardRows(ds, rows) {
  const live = dropPulledRows(rows);
  if (ds !== 'nhl_projections') return live;
  return live.map(applyPointsOverGate).filter(Boolean);
}

function sameRows(next, prev) {
  if (!Array.isArray(prev) || next.length !== prev.length) return false;
  for (let i = 0; i < next.length; i += 1) {
    if (next[i] !== prev[i]) return false;
  }
  return true;
}

function prepareMemberBoard(ds, payload) {
  if (ds === 'nfl_projections' || ds === 'nhl_projections') {
    if (!Array.isArray(payload)) return payload;
    const rows = memberBoardRows(ds, payload);
    return sameRows(rows, payload) ? payload : rows;
  }
  if (ds === 'prizepicks_props') {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
    const cards = Array.isArray(payload.cards) ? payload.cards : [];
    let changed = false;
    const nextCards = [];
    for (const card of cards) {
      const prev = Array.isArray(card?.props) ? card.props : [];
      const props = memberBoardRows(ds, prev);
      if (!props.length) {
        changed = true;
        continue;
      }
      if (!sameRows(props, prev)) {
        changed = true;
        nextCards.push({ ...card, props });
      } else {
        nextCards.push(card);
      }
    }
    if (!changed) return payload;
    const total = nextCards.reduce((sum, card) => sum + card.props.length, 0);
    return {
      ...payload,
      cards: nextCards,
      ...(payload.total_props != null ? { total_props: total } : {}),
    };
  }
  if (ds === 'wnba_projections_standard') {
    if (!Array.isArray(payload)) return payload;
    let changed = false;
    const next = [];
    for (const player of payload) {
      if (!player || typeof player !== 'object' || !Array.isArray(player.ppAllProps)) {
        next.push(player);
        continue;
      }
      const props = memberBoardRows(ds, player.ppAllProps);
      const hadProps = player.ppAllProps.length > 0;
      if (hadProps && props.length === 0) {
        changed = true;
        continue;
      }
      if (!sameRows(props, player.ppAllProps)) {
        changed = true;
        next.push({ ...player, ppAllProps: props });
      } else {
        next.push(player);
      }
    }
    return changed ? next : payload;
  }
  return payload;
}

function countMemberBoardRows(ds, payload) {
  if (ds === 'nfl_projections' || ds === 'nhl_projections') {
    return Array.isArray(payload) ? payload.length : 0;
  }
  if (ds === 'prizepicks_props') {
    const cards = Array.isArray(payload?.cards) ? payload.cards : [];
    return cards.reduce((sum, card) => sum + (Array.isArray(card?.props) ? card.props.length : 0), 0);
  }
  if (ds === 'wnba_projections_standard') {
    const players = Array.isArray(payload) ? payload : [];
    return players.reduce((sum, player) => sum + (Array.isArray(player?.ppAllProps) ? player.ppAllProps.length : 0), 0);
  }
  return 0;
}

function nhlSharpScore(row) {
  if (row?.rankEligible === false) return -Infinity;
  return nflSharpScore(row);
}

function marketEdgeMagnitude(row, keys) {
  const edges = keys
    .map((key) => num(row?.[key]?.edge))
    .filter(Number.isFinite)
    .map((value) => Math.abs(value));
  return edges.length ? Math.max(...edges) : -Infinity;
}

// Biggest absolute spread, total, or moneyline edge. Used only when
// NFL_FREE_TOTAL_EDGES_ENABLED is on.
function nflGameMarketScore(row) {
  return marketEdgeMagnitude(row, ['spread', 'total', 'moneyline']);
}

// Same ranking with the total left out, so a total edge cannot feature a game.
function nflGameMarketSpreadScore(row) {
  return marketEdgeMagnitude(row, ['spread', 'moneyline']);
}

// Copy. The cached snapshot is shared with paid readers and must keep its edge.
function withoutTotalEdge(game) {
  if (!game || typeof game !== 'object' || !game.total || typeof game.total !== 'object') return game;
  const total = { ...game.total };
  delete total.edge;
  return { ...game, total };
}

// Book prices on game markets are for member grading (units). The free
// preview never carries them.
export const NFL_GAME_MARKET_PRICE_FIELDS = Object.freeze({
  spread: ['price', 'priceSide', 'homePrice'],
  total: ['overPrice', 'underPrice'],
  moneyline: ['homePrice', 'awayPrice'],
});

export function withoutGameMarketPrices(game) {
  if (!game || typeof game !== 'object') return game;
  const next = { ...game };
  for (const [market, fields] of Object.entries(NFL_GAME_MARKET_PRICE_FIELDS)) {
    if (!next[market] || typeof next[market] !== 'object') continue;
    const copy = { ...next[market] };
    for (const field of fields) delete copy[field];
    next[market] = copy;
  }
  return next;
}

export function gameMarketHasPrices(game) {
  return Object.entries(NFL_GAME_MARKET_PRICE_FIELDS).some(([market, fields]) => (
    game?.[market] && typeof game[market] === 'object' && fields.some((field) => Object.hasOwn(game[market], field))
  ));
}

// Free game-markets preview. Total edges stay off unless the flag is on.
export function previewNflGameMarkets(payload, options = {}) {
  const totalEdges = Object.hasOwn(options, 'totalEdges')
    ? options.totalEdges === true
    : nflFreeTotalEdgesEnabled();
  const games = Array.isArray(payload?.games) ? payload.games.filter((game) => !gameAlreadyStarted(game)) : [];
  const live = payload && typeof payload === 'object' && !Array.isArray(payload) ? { ...payload, games } : payload;
  const preview = previewObjectList(
    'games',
    totalEdges ? nflGameMarketScore : nflGameMarketSpreadScore,
  )(live);
  if (totalEdges) {
    const priced = Array.isArray(preview.data?.games) ? preview.data.games.map(withoutGameMarketPrices) : preview.data?.games;
    return { ...preview, data: { ...preview.data, games: priced } };
  }
  const trimmed = Array.isArray(preview.data?.games) ? preview.data.games.map((game) => withoutGameMarketPrices(withoutTotalEdge(game))) : [];
  return {
    data: { ...preview.data, games: trimmed },
    lockedCount: preview.lockedCount,
  };
}

// PrizePicks odds board: free preview keeps the best Flex PP-edge rows.
// Older snapshots that only stored sportsbook EV still sort on that.

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

// rawFn breaks ties on the shown score (several props at the 100 cap) the way
// the landing does (publicFreeTopRows: score, then raw score, then board
// order), so the server's 3 and the landing's 3 are the same rows.
function topN(items, scoreFn, n = FREE_ROW_LIMIT, rawFn = null) {
  const rawOf = (item) => {
    if (!rawFn) return -Infinity;
    const raw = rawFn(item);
    return Number.isFinite(raw) ? raw : -Infinity;
  };
  return items
    .map((item, index) => ({ item, index, score: scoreFn(item), raw: rawOf(item) }))
    .filter((row) => Number.isFinite(row.score))
    .sort((a, b) => (b.score - a.score) || (b.raw === a.raw ? 0 : b.raw - a.raw) || (a.index - b.index))
    .slice(0, n);
}

// ── Preview builders: return { data, lockedCount } ─────────────────────────
// Every builder keeps the original payload shape so the existing UI code can
// render the preview without special cases.

function previewList(scoreFn, keep) {
  return (payload) => {
    const rows = (Array.isArray(payload) ? payload : []).filter((row) => (keep ? keep(row) : true));
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
    // A pulled line (or every KBO row under the manual hold) is not a
    // hidden pick, so it is not counted as locked.
    const lockable = rows.filter((row) => !prizepicksPulled(row)).length;
    return {
      data: { ...obj, [key]: kept },
      lockedCount: Math.max(0, lockable - kept.length),
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
    if (gameAlreadyStarted(card)) return;
    (Array.isArray(card?.props) ? card.props : []).forEach((prop) => {
      if (!propStillLive(card, prop)) return;
      flat.push({ cardIndex, prop });
    });
  });
  const kept = topN(flat, ({ prop }) => kboPropScore(prop), FREE_ROW_LIMIT, ({ prop }) => kboRawRating(prop?.projection, prop?.line, prop?.stat));
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

// projections_*: [{ ...player, ppAllProps: [...] }] → best props, regrouped.
// NBA preview rows carry only the player's scalar fields (name, team, image,
// minutes, status) and the props that are shown, so no other projection for a
// kept player leaves the server. WNBA keeps its full player row because its
// free board reads the per-stat maps.
function nbaPreviewPlayer(player, props) {
  const out = {};
  for (const [key, value] of Object.entries(player || {})) {
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) out[key] = value;
  }
  out.ppAllProps = props;
  return out;
}

function previewPlayerProps(payload, scoreFn, { trimPlayer = null, rawFn = null } = {}) {
  const players = Array.isArray(payload) ? payload : [];
  const flat = [];
  players.forEach((player, playerIndex) => {
    if (gameAlreadyStarted(player)) return;
    (Array.isArray(player?.ppAllProps) ? player.ppAllProps : []).forEach((prop) => {
      if (!propStillLive(player, prop)) return;
      flat.push({ playerIndex, prop });
    });
  });
  if (!flat.length) {
    // No lines posted yet: expose at most FREE_ROW_LIMIT player rows. A
    // trimmed (NBA) row then shows no props, since none of them is live.
    const kept = players.slice(0, FREE_ROW_LIMIT).map((player) => (trimPlayer ? trimPlayer(player, []) : player));
    return { data: kept, lockedCount: Math.max(0, players.length - kept.length) };
  }
  const kept = topN(
    flat,
    ({ playerIndex, prop }) => scoreFn(players[playerIndex], prop),
    FREE_ROW_LIMIT,
    rawFn ? ({ playerIndex, prop }) => rawFn(players[playerIndex], prop) : null,
  );
  const byPlayer = new Map();
  kept.forEach(({ item }) => {
    if (!byPlayer.has(item.playerIndex)) byPlayer.set(item.playerIndex, []);
    byPlayer.get(item.playerIndex).push(item.prop);
  });
  const keptKeys = new Set(kept.map(({ item }) => item.prop));
  const data = [...byPlayer.entries()].map(([playerIndex, props]) => {
    const player = players[playerIndex];
    if (trimPlayer) return trimPlayer(player, props);
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

function previewWnbaProjections(payload) {
  return previewPlayerProps(payload, wnbaPropScore);
}

function previewNbaProjections(payload) {
  return previewPlayerProps(payload, nbaPropScore, { trimPlayer: nbaPreviewPlayer, rawFn: nbaPropRawScore });
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

// Only a prop with a live line counts as locked. Under the manual KBO hold
// nothing is locked, and a pulled or line-less row (NO LINE) never counts,
// so the paywall cannot imply hidden picks that do not exist.
function matchupPropLocked(prop) {
  if (!prop || typeof prop !== 'object') return false;
  if (prop.removed === true || String(prop.pp_status || '').toLowerCase() === 'removed') return false;
  if (prop.line == null || prop.line === '' || !Number.isFinite(Number(prop.line))) return false;
  return true;
}

function previewMatchups(payload) {
  const obj = payload && typeof payload === 'object' ? payload : {};
  const matchups = Array.isArray(obj.matchups) ? obj.matchups : [];
  const held = obj.kbo_hold?.active === true;
  let lockedCount = 0;
  const data = matchups.map((game) => {
    if (!held && Array.isArray(game?.props)) lockedCount += game.props.filter(matchupPropLocked).length;
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

// matchup_data props are never marked removed, so their stored lines alone
// overcount. With the live PrizePicks board, count only the props the matchup
// page would show with a line: the same standard-only, exact-name match as
// mergeLivePrizePicks. A missing or failed board, or the KBO hold, counts 0.
export function matchupLiveLockedCount(matchupPayload, prizepicksBoard) {
  const obj = matchupPayload && typeof matchupPayload === 'object' ? matchupPayload : {};
  if (obj.kbo_hold?.active === true) return 0;
  if (!prizepicksBoard || typeof prizepicksBoard !== 'object') return 0;
  const merged = mergeLivePrizePicks(obj, prizepicksBoard);
  let count = 0;
  for (const game of merged?.matchups || []) {
    if (Array.isArray(game?.props)) count += game.props.filter(matchupPropLocked).length;
  }
  return count;
}

// graded_props_history: the settled record (graded rows and the summary)
// is paid. Free and logged-out callers get today's open picks only, trimmed
// to FREE_ROW_LIMIT. No hit rate is included.
const GRADED_RECORD_KEYS = new Set([
  'graded',
  'summary',
  'hits',
  'misses',
  'pushes',
  'overall_hit_rate',
  'hit_rate',
  'over_hit_rate',
  'under_hit_rate',
]);

function previewGradedHistory(payload) {
  const obj = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  const pending = Array.isArray(obj.pending) ? obj.pending : [];
  const kept = pending.slice(0, FREE_ROW_LIMIT);
  const data = { pending: kept };
  for (const [key, value] of Object.entries(obj)) {
    if (key === 'pending' || GRADED_RECORD_KEYS.has(key)) continue;
    data[key] = value;
  }
  return {
    data,
    lockedCount: Math.max(0, pending.length - kept.length),
  };
}

// Member hub recap. Same per-sport gate as the paid boards. A free or
// logged-out caller gets no slate counts.
export function memberRecapForTier(recap, tier) {
  const sports = recap?.sports && typeof recap.sports === 'object' && !Array.isArray(recap.sports) ? recap.sports : {};
  const access = sportAccess(tier);
  const member = Object.values(access).some((open) => open === true);
  const allowed = {};
  if (member) {
    for (const [sport, record] of Object.entries(sports)) {
      if (access[sport] !== true || !record || typeof record !== 'object') continue;
      allowed[sport] = {
        slate_date_iso: typeof record.slate_date_iso === 'string' ? record.slate_date_iso : null,
        graded_at: record.graded_at || null,
        hits: Number(record.hits) || 0,
        misses: Number(record.misses) || 0,
        pushes: Number(record.pushes) || 0,
      };
    }
  }
  return {
    data: {
      generated_at: recap?.generated_at || null,
      sports: allowed,
    },
    preview: !member,
    lockedCount: 0,
  };
}

function previewCorrelations(payload) {
  const obj = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  const pairs = Array.isArray(obj.pairs) ? obj.pairs : [];
  return {
    data: { ...obj, pairs: [] },
    lockedCount: pairs.length,
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
  correlations_kbo: { table: 'correlations_kbo', sport: 'kbo', free: previewCorrelations },
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
  correlations_wnba: { table: 'correlations_wnba', sport: 'wnba', free: previewCorrelations },
  // NFL
  nfl_projections: {
    table: 'nfl_projections',
    sport: 'nfl',
    // The NFL board's free top 3 is this list. There is no second ranker.
    free: previewNflProjections,
  },
  nfl_lineups: { table: 'nfl_lineups', sport: 'nfl', free: previewList(() => 0) },
  nfl_sharp_odds: { table: 'nfl_sharp_odds', sport: 'nfl', free: previewObjectList('records', nflSharpScore) },
  nfl_game_markets: { table: 'nfl_game_markets', sport: 'nfl', free: previewNflGameMarkets },
  correlations_nfl: { table: 'correlations_nfl', sport: 'nfl', free: previewCorrelations },
  // Opponent-adjusted defense vs position (nflverse play-by-play). Team-level
  // matchup context only, no player rows, CG Score or projections: free.
  nfl_matchup_defense: { table: 'nfl_matchup_defense', sport: 'nfl', free: FULL },
  // NBA. The /api/data gate still denies these unless the caller is full access.
  // The free builder is only the preview path after nba_public is on.
  nba_players: { table: 'nba_players', sport: 'nba', free: previewList(() => 0) },
  nba_teams: { table: 'nba_teams', sport: 'nba', free: previewList(() => 0) },
  nba_dvp_pg: { table: 'nba_dvp_pg', sport: 'nba', free: previewObjectList('teams', () => 0) },
  nba_dvp_sg: { table: 'nba_dvp_sg', sport: 'nba', free: previewObjectList('teams', () => 0) },
  nba_dvp_sf: { table: 'nba_dvp_sf', sport: 'nba', free: previewObjectList('teams', () => 0) },
  nba_dvp_pf: { table: 'nba_dvp_pf', sport: 'nba', free: previewObjectList('teams', () => 0) },
  nba_dvp_c: { table: 'nba_dvp_c', sport: 'nba', free: previewObjectList('teams', () => 0) },
  nba_projections_standard: { table: 'nba_projections_standard', sport: 'nba', free: previewNbaProjections },
  nba_projections_demon: { table: 'nba_projections_demon', sport: 'nba', free: previewNbaProjections },
  nba_projections_goblin: { table: 'nba_projections_goblin', sport: 'nba', free: previewNbaProjections },
  nba_correlations: { table: 'nba_correlations', sport: 'nba', free: previewCorrelations },
  // NHL. Full rows for all-access and the admin email; everyone else gets the preview.
  nhl_projections: { table: 'nhl_projections', sport: 'nhl', free: previewList(nhlScore) },
  nhl_lineups: { table: 'nhl_lineups', sport: 'nhl', free: previewList(() => 0) },
  nhl_sharp_odds: { table: 'nhl_sharp_odds', sport: 'nhl', free: previewObjectList('records', nhlSharpScore) },
  nhl_dvp_f: { table: 'nhl_dvp_f', sport: 'nhl', free: previewObjectList('teams', () => 0) },
  nhl_dvp_d: { table: 'nhl_dvp_d', sport: 'nhl', free: previewObjectList('teams', () => 0) },
  nhl_dvp_g: { table: 'nhl_dvp_g', sport: 'nhl', free: previewObjectList('teams', () => 0) },
  nhl_correlations: { table: 'nhl_correlations', sport: 'nhl', free: previewCorrelations },
};

export function datasetIsFullyPublic(ds) {
  const spec = Object.hasOwn(DATASETS, ds) ? DATASETS[ds] : null;
  return !!spec && spec.free === FULL;
}

function countList(payload, key) {
  if (key) {
    const rows = payload && typeof payload === 'object' ? payload[key] : null;
    return Array.isArray(rows) ? rows.length : 0;
  }
  return Array.isArray(payload) ? payload.length : 0;
}

function isStandardProp(row) {
  return isStandardBoardLine(row);
}

function filterLineMap(value) {
  if (Array.isArray(value)) return filterPropList(value);
  if (!value || typeof value !== 'object') return value;
  let changed = false;
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry && typeof entry === 'object' && !isStandardProp(entry)) {
      changed = true;
      continue;
    }
    out[key] = entry;
  }
  return changed ? out : value;
}

function filterPropList(rows) {
  if (!Array.isArray(rows)) return rows;
  let changed = false;
  const kept = [];
  for (const row of rows) {
    if (!isStandardProp(row)) {
      changed = true;
      continue;
    }
    const next = stripNonStandardLines(row);
    if (next !== row) changed = true;
    kept.push(next);
  }
  return changed ? kept : rows;
}

// Standard PrizePicks lines only. Demon and goblin rows are removed before
// the free trim and before a paid board is returned. Rows with no odds-type
// field stay, so rankings, lineups, and NFL game totals keep their order and
// their original object when nothing was removed.
function stripNonStandardLines(payload) {
  if (Array.isArray(payload)) return filterPropList(payload);
  if (!payload || typeof payload !== 'object') return payload;
  let changed = false;
  const next = { ...payload };
  for (const key of ['props', 'ppAllProps', 'projections', 'records', 'pending', 'graded']) {
    if (!Array.isArray(payload[key])) continue;
    const filtered = filterPropList(payload[key]);
    if (filtered !== payload[key]) {
      changed = true;
      next[key] = filtered;
    }
  }
  for (const key of ['ppLines', 'ppLinesStandard']) {
    if (payload[key] == null) continue;
    const filtered = filterLineMap(payload[key]);
    if (filtered !== payload[key]) {
      changed = true;
      next[key] = filtered;
    }
  }
  if (Array.isArray(payload.cards)) {
    const filtered = filterPropList(payload.cards);
    const nonempty = filtered.filter((card) => !Array.isArray(card?.props) || card.props.length > 0);
    const finalCards = nonempty.length === filtered.length ? filtered : nonempty;
    if (finalCards !== payload.cards) {
      changed = true;
      next.cards = finalCards;
    }
  }
  if (Array.isArray(payload.matchups)) {
    const filtered = filterPropList(payload.matchups);
    if (filtered !== payload.matchups) {
      changed = true;
      next.matchups = filtered;
    }
  }
  if (changed && payload.summary && typeof payload.summary === 'object' && (next.graded || next.pending)) {
    next.summary = summaryForGradedRows(next.graded ?? payload.graded, next.pending ?? payload.pending);
  }
  return changed ? next : payload;
}

export function standardLinesOnly(payload) {
  return stripNonStandardLines(payload);
}

// Same snapshot shape the board already renders, with the pick rows removed.
// lockedCount stays positive so the page shows the paywall instead of an error
// or an empty-board message.
function hiddenNflPreview(ds, payload) {
  if (ds === 'nfl_projections') {
    return { data: [], lockedCount: countList(payload) };
  }
  const key = ds === 'nfl_sharp_odds' ? 'records' : 'games';
  const obj = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  return { data: { ...obj, [key]: [] }, lockedCount: countList(obj, key) };
}

// Code Green, 7:53 AM ET on Oct 17, 2026: standard lines only for everyone,
// including free and logged-out visitors. The filter runs before the
// free-preview trim. Set this to false only to restore the old preview order.
export const FILTER_STANDARD_BEFORE_FREE_PREVIEW = true;

let tierShapeFilters = 0;

export function _tierShapeFilters() {
  return tierShapeFilters;
}

export function _resetTierShapeFilters() {
  tierShapeFilters = 0;
}

// Decide what the caller receives for one dataset snapshot.
// alreadyStandard means the cached board was filtered once for this entry.
// The hot path must not walk the rows again.
export function shapeForTier(ds, payload, tier, { alreadyStandard = false } = {}) {
  const spec = Object.hasOwn(DATASETS, ds) ? DATASETS[ds] : null;
  if (!spec) throw new Error(`Unknown dataset: ${ds}`);
  // Standard lines are removed before the trim on paid boards and, while
  // FILTER_STANDARD_BEFORE_FREE_PREVIEW is on, on free and logged-out boards.
  const paid = sportAccess(tier)[spec.sport] === true;
  if (!alreadyStandard && (paid || FILTER_STANDARD_BEFORE_FREE_PREVIEW)) {
    tierShapeFilters += 1;
    payload = filterStandardBoard(ds, payload);
  }
  // Same row set for the paid board and the free denominator. Pulled,
  // removed, and non-standard lines are already gone on every paid board.
  // Only nhl_projections then drops Points overs under 0.69 and leaves
  // overs from 0.69 up to 0.78 on the board with rankEligible false.
  if (MEMBER_BOARD_DATASETS.has(ds)) payload = prepareMemberBoard(ds, payload);
  if (paid || spec.free === FULL) {
    return { data: payload, preview: false, lockedCount: 0 };
  }
  if (!NFL_FREE_PREVIEW_ENABLED && NFL_FREE_PREVIEW_DATASETS.has(ds)) {
    const hidden = hiddenNflPreview(ds, payload);
    return { data: hidden.data, preview: true, lockedCount: hidden.lockedCount };
  }
  const preview = spec.free(payload);
  if (!MEMBER_BOARD_DATASETS.has(ds)) {
    return { data: preview.data, preview: true, lockedCount: preview.lockedCount };
  }
  // Started games and other rows the top-3 skip are still on the member
  // board, so they stay in the locked remainder.
  const memberRows = countMemberBoardRows(ds, payload);
  const shown = countMemberBoardRows(ds, preview.data);
  return {
    data: preview.data,
    preview: true,
    lockedCount: Math.max(0, memberRows - shown),
  };
}
