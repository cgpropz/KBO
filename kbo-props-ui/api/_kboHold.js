// Manual KBO hold (Code Green, 8:32 PM ET Oct 19, 2026): while it is on, the
// API serves every KBO prop as pulled, so the board, free top 3, hub/landing,
// projection pages and slip builder show no KBO lines, and the payload carries
// kbo_hold so the board can say "Lines not posted yet".
//
// It clears with no deploy once the published board comes from a fresh,
// complete PrizePicks pull (prizepicks_pull.status 'fresh', set by
// pipeline/kbo_pulled_lines.py) checked after `since` with at least one live
// prop. Setting active to false (or deleting the fields) also clears it.
import holdFile from './_kboHold.json' with { type: 'json' };

export const KBO_HOLD_DATASETS = new Set(['prizepicks_props', 'strikeout_projections', 'batter_projections']);
export const KBO_HOLD_REASON = 'kbo_hold';
export const KBO_HOLD_MESSAGE = 'Lines not posted yet';

let currentHold = holdFile;

// Tests only.
export function _setKboHold(hold) {
  currentHold = hold;
}

export function kboHold() {
  return currentHold;
}

function time(value) {
  const t = Date.parse(String(value || ''));
  return Number.isFinite(t) ? t : null;
}

function pulled(row) {
  return row?.removed === true || String(row?.pp_status || '').toLowerCase() === 'removed';
}

function hasLiveRow(ds, payload) {
  if (ds === 'prizepicks_props') {
    return (payload?.cards || []).some((card) => (card?.props || []).some((prop) => prop && !pulled(prop)));
  }
  return (payload?.projections || []).some((row) => row && !pulled(row));
}

// True when a fresh, complete pull after the hold has live KBO lines.
export function kboHoldCleared(hold, ds, payload) {
  const pull = payload?.prizepicks_pull;
  if (!pull || pull.status !== 'fresh') return false;
  const since = time(hold?.since);
  const checked = time(pull.checked_at);
  if (since == null || checked == null || checked <= since) return false;
  return hasLiveRow(ds, payload);
}

// Past expires_at the hold is off, so it cannot stick past the day it was
// set for. A hold with no readable expires_at is treated as expired.
export function kboHoldExpired(hold, now = new Date()) {
  const expires = time(hold?.expires_at);
  if (expires == null) return true;
  return now.getTime() >= expires;
}

export function kboHoldActive(ds, payload, hold = currentHold, now = new Date()) {
  if (!KBO_HOLD_DATASETS.has(ds) && ds !== 'matchup_data') return false;
  if (!hold || hold.active !== true) return false;
  if (kboHoldExpired(hold, now)) return false;
  // matchup_data has no pull stamp of its own: it stays held until the flag
  // is off or expires. The matchup page takes live lines from the board.
  if (ds === 'matchup_data') return true;
  return !kboHoldCleared(hold, ds, payload);
}

function noLine(row) {
  if (!row || typeof row !== 'object') return row;
  return { ...row, line: null, edge: null, recommendation: 'NO LINE' };
}

function holdRow(row) {
  if (!row || typeof row !== 'object') return row;
  return { ...row, removed: true, pp_status: 'removed', pulled_reason: KBO_HOLD_REASON };
}

// Same shape, every prop marked pulled. Nothing else (projection, score,
// price) changes. Returns the payload itself when the hold is off.
export function applyKboHold(ds, payload, hold = currentHold, now = new Date()) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  if (!kboHoldActive(ds, payload, hold, now)) return payload;
  const meta = { active: true, since: hold.since || null, expires_at: hold.expires_at, message: hold.message || KBO_HOLD_MESSAGE };
  if (ds === 'matchup_data') {
    return {
      ...payload,
      matchups: Array.isArray(payload.matchups)
        ? payload.matchups.map((game) => (game && typeof game === 'object' ? {
          ...game,
          props: Array.isArray(game.props) ? game.props.map(noLine) : game.props,
          away_pitcher: game.away_pitcher ? { ...game.away_pitcher, line: null } : game.away_pitcher,
          home_pitcher: game.home_pitcher ? { ...game.home_pitcher, line: null } : game.home_pitcher,
        } : game))
        : payload.matchups,
      kbo_hold: meta,
    };
  }
  if (ds === 'prizepicks_props') {
    return {
      ...payload,
      cards: (payload.cards || []).map((card) => (card && Array.isArray(card.props) ? { ...card, props: card.props.map(holdRow) } : card)),
      kbo_hold: meta,
    };
  }
  return {
    ...payload,
    projections: Array.isArray(payload.projections) ? payload.projections.map(holdRow) : payload.projections,
    kbo_hold: meta,
  };
}
