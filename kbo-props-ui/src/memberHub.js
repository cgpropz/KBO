// Paid-member Command Center (C5): turns each sport's live board snapshot into
// the few standard-line rows the hub shows. Pure functions, no fetching.
// Scores match the sport boards: KBO cg_projection (falls back to rating),
// NFL nflCgScore, NHL cgScore, WNBA wnbaCgScore, NBA prop.rating.
import { cgScore, lineMatchesStat } from './cgScore.js'
import { nflCgScore } from './nfl/nflLineFloors.js'
import { wnbaCgScore } from './wnba/wnbaScore.js'

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : NaN
}

const isStandard = (type) => type == null || String(type).toLowerCase() === 'standard'

function sideFor(projection, line, rec) {
  const r = String(rec || '').toUpperCase()
  if (r === 'OVER' || r === 'UNDER') return r
  const p = num(projection)
  const l = num(line)
  if (!Number.isFinite(p) || !Number.isFinite(l)) return null
  return p >= l ? 'OVER' : 'UNDER'
}

export function kboHubRows(data, photos = {}) {
  const rows = []
  for (const card of Array.isArray(data?.cards) ? data.cards : []) {
    for (const prop of Array.isArray(card?.props) ? card.props : []) {
      if (!isStandard(prop?.odds_type)) continue
      if (!lineMatchesStat(prop?.stat, prop?.line)) continue
      const score = num(prop?.cg_projection ?? prop?.rating)
      rows.push({
        player: card.name,
        team: card.team,
        opponent: card.opponent,
        stat: prop.stat,
        line: prop.line,
        projection: prop.projection ?? prop.avg,
        side: sideFor(prop.projection ?? prop.avg, prop.line, prop.recommendation),
        score,
        image: photos?.[card.name] || null,
        start: card.start_time || card.game_time || null,
      })
    }
  }
  return rows
}

export function nflHubRows(data) {
  return (Array.isArray(data) ? data : [])
    .filter((row) => isStandard(row?.line_type ?? row?.oddsType))
    .map((row) => ({
      player: row.player,
      team: row.team,
      opponent: row.opponent,
      stat: row.prop ?? row.stat,
      line: row.line,
      projection: row.projection,
      side: sideFor(row.projection, row.line),
      score: num(nflCgScore(row.projection, row.line, row.prop ?? row.stat)),
      image: row.imageUrl || null,
      start: row.start_time || null,
    }))
}

export function nhlHubRows(data) {
  return (Array.isArray(data) ? data : [])
    .filter((row) => isStandard(row?.oddsType ?? row?.odds_type) && row?.rankEligible !== false)
    .map((row) => ({
      player: row.player,
      team: row.team,
      opponent: row.opponent,
      stat: row.prop ?? row.stat,
      line: row.line,
      projection: row.projection,
      side: sideFor(row.projection, row.line),
      score: num(cgScore(row.projection, row.line, row.prop ?? row.stat)),
      image: row.imageUrl || null,
      playerId: row.playerId || null,
      start: row.start_time || null,
    }))
}

function basketballRows(data, scoreFn) {
  const rows = []
  for (const player of Array.isArray(data) ? data : []) {
    for (const prop of Array.isArray(player?.ppAllProps) ? player.ppAllProps : []) {
      if (!isStandard(prop?.odds_type ?? prop?.oddsType)) continue
      if (prop?.standardLine != null && num(prop.standardLine) !== num(prop.line)) continue
      rows.push({
        player: player.name,
        team: player.team,
        opponent: prop.opponent || prop.versus,
        stat: prop.stat,
        line: prop.line,
        projection: prop.projection,
        side: sideFor(prop.projection, prop.line),
        score: num(scoreFn(prop)),
        image: player.image || null,
        start: prop.start_time || prop.gameDate || null,
      })
    }
  }
  return rows
}

export const wnbaHubRows = (data) => basketballRows(data, (prop) => wnbaCgScore(prop.projection, prop))
export const nbaHubRows = (data) => basketballRows(data, (prop) => prop.rating)

// Highest CG Score first, one row per player so the list is not one star's props.
export function topHubRows(rows, limit = 5) {
  const valid = rows
    .filter((r) => r.player && r.stat && Number.isFinite(num(r.line)) && Number.isFinite(r.score))
    .sort((a, b) => b.score - a.score)
  const seen = new Set()
  const out = []
  for (const row of valid) {
    if (seen.has(row.player)) continue
    seen.add(row.player)
    out.push(row)
    if (out.length >= limit) break
  }
  return out
}

export function countPlayable(rows) {
  return rows.filter((r) => r.player && Number.isFinite(r.score)).length
}

// "Yesterday" in ET. A slate older than that is shown as the last graded slate.
export function etDateIso(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

export function recapLabel(slateIso, now = new Date()) {
  if (!slateIso) return null
  const today = etDateIso(now)
  const y = new Date(`${today}T12:00:00Z`)
  y.setUTCDate(y.getUTCDate() - 1)
  const yesterday = y.toISOString().slice(0, 10)
  if (slateIso === yesterday) return 'Yesterday'
  if (slateIso === today) return 'Today'
  const d = new Date(`${slateIso}T12:00:00Z`)
  return `Last graded ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}`
}

export function formatRecord(r) {
  if (!r) return null
  return `${r.hits}-${r.misses}${r.pushes ? `-${r.pushes}` : ''}`
}
