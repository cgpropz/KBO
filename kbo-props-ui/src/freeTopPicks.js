// Free top 3. Started, locked, and removed props are skipped. An NHL Points
// over is promoted only at 0.78 or above. The slice happens after that
// filter, so a started row does not take a slot that a live row should fill.

import { gameAlreadyStarted } from './gameStarted.js'
import { pointsOverDisposition } from './nhl/pointsGate.js'
import { compareSymmetric, rankable, symmetricRankOn } from './sideRank.js'

export function pickHasStarted(row, now = new Date()) {
  return gameAlreadyStarted(row, now)
}

export function isLiveFreePick(row, sport, now = new Date()) {
  if (!row?.player || !row?.stat) return false
  if (!Number.isFinite(row.score) || row.score === -Infinity) return false
  if (row.rankEligible === false || row.removed === true) return false
  if (pickHasStarted(row, now)) return false
  if (sport === 'nhl' && pointsOverDisposition({
    prop: row.stat,
    projection: row.projection,
    line: row.line,
  }) !== 'rank') return false
  return true
}

// NFL admin pilot (src/sideRank.js): a strong under ranks with a strong over,
// and rows that do not rank (projection 0 or less, an under under 5 games or
// not offered) take no slot. Every other sport is unchanged.
export function selectFreeTop3(rows, sport, now = new Date(), { symmetric = symmetricRankOn(sport) } = {}) {
  const live = (Array.isArray(rows) ? rows : [])
    .filter((row) => isLiveFreePick(row, sport, now))
  if (symmetric) {
    return live
      .filter((row) => rankable(row))
      .sort((a, b) => compareSymmetric(a, b))
      .slice(0, 3)
  }
  return live
    // Same shown score (several NFL rows at the 100 cap): the uncapped score decides.
    .sort((a, b) => (b.score - a.score) || ((Number.isFinite(b.rawScore) ? b.rawScore : 0) - (Number.isFinite(a.rawScore) ? a.rawScore : 0)))
    .slice(0, 3)
}
