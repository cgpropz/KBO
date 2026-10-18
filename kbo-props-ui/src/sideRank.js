// Side-symmetric CG ranking. NFL only, admin-only pilot flag.
//
// CG Score itself is unchanged: 50 is projection on the line, an over scores
// above 50 and an under scores below it. Today every list sorts on the raw
// score, highest first, so a strong under (a low score) never reaches the top
// of the board, the free top 3, or the hub lists.
//
// With the flag on (NFL, admin email only), a row ranks by how far its score
// sits from 50 on its own side, so an under at 30 ranks with an over at 70.
// Unders show their strength as 100 minus the score next to an UNDER tag, so
// a strong under reads 70+ like a strong over. Stored and graded scores are
// not touched.
//
// Rank rules under the flag:
// - A row whose projection is 0 or less never ranks (either side). It stays
//   on the board, after every rankable row, and takes no top-list slot.
// - An under needs 5+ games played (the board's own games window) to rank.
// - An under on a standard line PrizePicks posts as over-only cannot be
//   played and does not rank. Boards are standard lines only already.
//
// Under qualifying (free-play) rule: a standard under that ranks under the
// rules above with a raw score of 30 or lower. Free plays are picked outside
// this app; the rule lives here so the site and the bots agree on it.
//
// NHL, KBO, WNBA and NBA keep today's order. The NHL Points-over gate and
// the NFL game-market (totals) ranking are not part of this.

import { NBA_OWNER_EMAIL } from './entitlements.js'

export const NEUTRAL = 50
export const UNDER_MIN_GAMES = 5
export const QUALIFY_UNDER_MAX_CG = 30
export const SYMMETRIC_SPORTS = new Set(['nfl'])

// ── Flag ────────────────────────────────────────────────────────────────
// Admin only. Members and logged-out visitors keep today's order and
// numbers. `?unders=0` turns it off for the admin (before/after screenshots).
let viewerEmail = ''

export function setSymmetricRankViewer(email) {
  viewerEmail = typeof email === 'string' ? email.trim().toLowerCase() : ''
}

export function symmetricRankAllowed(sport, email, search) {
  if (!SYMMETRIC_SPORTS.has(String(sport || '').toLowerCase())) return false
  const normalized = typeof email === 'string' ? email.trim().toLowerCase() : ''
  if (normalized !== NBA_OWNER_EMAIL) return false
  const params = new URLSearchParams(typeof search === 'string' ? search : '')
  return params.get('unders') !== '0'
}

export function symmetricRankOn(sport) {
  const search = typeof window === 'undefined' ? '' : window.location.search
  return symmetricRankAllowed(sport, viewerEmail, search)
}

// ── Side and strength ───────────────────────────────────────────────────
const toNum = (value) => {
  if (value == null || value === '') return NaN
  const n = Number(value)
  return Number.isFinite(n) ? n : NaN
}

export function sideOfScore(score) {
  const value = toNum(score)
  if (!Number.isFinite(value) || value === NEUTRAL) return null
  return value > NEUTRAL ? 'OVER' : 'UNDER'
}

function normalSide(side) {
  const s = String(side || '').toUpperCase()
  if (s === 'OVER' || s === 'MORE') return 'OVER'
  if (s === 'UNDER' || s === 'LESS') return 'UNDER'
  return null
}

export function rowSide(row) {
  return normalSide(row?.side) || sideOfScore(row?.score)
}

// Same-side strength on the 50-100 scale. Neutral or missing is -Infinity.
export function sideStrength(score, side) {
  const value = toNum(score)
  if (!Number.isFinite(value) || value === NEUTRAL) return -Infinity
  const s = normalSide(side) || sideOfScore(value)
  return s === 'UNDER' ? (100 - value) : value
}

// Number shown for a row. Overs unchanged; unders flip to 100 minus score.
export function displayScore(score, side) {
  const value = toNum(score)
  if (!Number.isFinite(value)) return null
  const s = normalSide(side) || sideOfScore(value)
  return s === 'UNDER' ? 100 - value : value
}

export function displayScoreText(score, side, digits = 1) {
  const shown = displayScore(score, side)
  return shown == null ? null : shown.toFixed(digits)
}

// ── Rank eligibility ────────────────────────────────────────────────────
// Games played in the board's own window: NFL `gamesPlayed` (L10 decided
// games), falling back to the length of the logged series.
export function gamesPlayed(row) {
  const games = toNum(row?.gamesPlayed ?? row?.games_played)
  if (Number.isFinite(games)) return games
  return Array.isArray(row?.recent) ? row.recent.length : 0
}

// PrizePicks posts some standard lines as over-only (allowed wager types
// "over"). Rows without the field are two-sided, the standard default.
export function underOffered(row) {
  const raw = row?.wagerTypes ?? row?.allowedWagerTypes ?? row?.allowed_wager_types
  if (raw == null || raw === '') return true
  const list = Array.isArray(raw) ? raw : String(raw).split(/[^a-z]+/i)
  return list.map((v) => String(v).toLowerCase()).some((v) => v === 'under' || v === 'less')
}

export function isStandardLine(row) {
  const type = row?.line_type ?? row?.lineType ?? row?.oddsType ?? row?.odds_type
  return type == null || type === '' || String(type).toLowerCase() === 'standard'
}

// Why a row does not rank under the flag, or null when it does.
export function rankBlock(row, scoreOf = (r) => r?.score) {
  const score = scoreOf(row)
  const side = normalSide(row?.side) || sideOfScore(score)
  if (!Number.isFinite(sideStrength(score, side))) return 'neutral'
  const projection = toNum(row?.projection)
  if (!Number.isFinite(projection) || projection <= 0) return 'projection'
  if (side === 'UNDER') {
    if (!isStandardLine(row) || !underOffered(row)) return 'not_offered'
    if (gamesPlayed(row) < UNDER_MIN_GAMES) return 'games'
  }
  return null
}

export function rankable(row, scoreOf) {
  return rankBlock(row, scoreOf) == null
}

// Rankable rows first by same-side strength; the rest keep their place after
// them, still in strength order.
export function rankKey(row, scoreOf = (r) => r?.score) {
  const score = scoreOf(row)
  const strength = sideStrength(score, normalSide(row?.side) || sideOfScore(score))
  if (!Number.isFinite(strength)) return -Infinity
  return rankBlock(row, scoreOf) == null ? strength : strength - 1000
}

// Raw tie-break on the same side (several NFL rows pinned at 100 or 0).
function rawStrength(row) {
  const raw = toNum(row?.rawScore)
  if (!Number.isFinite(raw)) return 0
  return rowSide(row) === 'UNDER' ? 100 - raw : raw
}

export function compareSymmetric(a, b, scoreOf) {
  const diff = rankKey(b, scoreOf) - rankKey(a, scoreOf)
  if (diff) return diff
  return rawStrength(b) - rawStrength(a)
}

// ── Under qualifying rule ───────────────────────────────────────────────
export function underQualifies(row) {
  const score = toNum(row?.score)
  if (!Number.isFinite(score) || rowSide(row) !== 'UNDER') return false
  return score <= QUALIFY_UNDER_MAX_CG && rankable(row)
}
