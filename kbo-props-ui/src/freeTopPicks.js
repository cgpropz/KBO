// Free top 3. Started, locked, and removed props are skipped. An NHL Points
// over is promoted only at 0.86 or above. The slice happens after that
// filter, so a started row does not take a slot that a live row should fill.

import { pointsOverDisposition } from './nhl/pointsGate.js'

function etDay(now) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

export function pickHasStarted(row, now = new Date()) {
  if (!row || typeof row !== 'object') return false
  if (row.started === true || row.locked === true || row.removed === true) return true
  const raw = row.start_time ?? row.startTime ?? row.start_time_utc ?? row.kickoff_at
  if (raw != null && String(raw).trim() !== '') {
    const kick = Date.parse(String(raw))
    const nowMs = now instanceof Date ? now.getTime() : Date.parse(String(now))
    if (Number.isFinite(kick) && Number.isFinite(nowMs)) return kick <= nowMs
  }
  const day = row.game_date || row.gameDate || row.gameday
  if (typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return day < etDay(now instanceof Date ? now : new Date(now))
  }
  return false
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

export function selectFreeTop3(rows, sport, now = new Date()) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => isLiveFreePick(row, sport, now))
    // Same shown score (several NFL rows at the 100 cap): the uncapped score decides.
    .sort((a, b) => (b.score - a.score) || ((Number.isFinite(b.rawScore) ? b.rawScore : 0) - (Number.isFinite(a.rawScore) ? a.rawScore : 0)))
    .slice(0, 3)
}
