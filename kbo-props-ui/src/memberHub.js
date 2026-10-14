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

// Same normalisation the KBO board (PlayerPropsUI) uses for player_photos.json keys.
export function normalizePlayerName(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’`]/g, "'")
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

// Same compact rule as nhl/availability.py blocked_status. OUT, IR, LTIR,
// scratched, and suspended come off. GTD, questionable, and probable stay.
export function blockedAvailability(value) {
  const compact = String(value || '').toUpperCase().replace(/[^A-Z]/g, '')
  if (!compact) return null
  if (compact.includes('LTIR') || compact === 'LONGTERMIR' || compact === 'LONGTERMINJUREDRESERVE' || compact === 'IRLT') return 'LTIR'
  if (compact === 'IR' || compact === 'INJUREDRESERVE') return 'IR'
  if (compact === 'OUT' || compact.startsWith('OUT')) return 'OUT'
  if (compact.includes('SCRATCH')) return 'SCRATCHED'
  if (compact.startsWith('SUSPEN')) return 'SUSPENDED'
  return null
}

const HELD_STATUS = new Set(['held', 'hold', 'onhold', 'suspended', 'removed'])

function statusText(value) {
  return String(value || '').toLowerCase().replace(/[^a-z]/g, '')
}

function availabilityOf(source) {
  const src = source && typeof source === 'object' ? source : {}
  return {
    status: src.status ?? src.injury_status ?? null,
    injury: src.injury ?? src.injuryStatus ?? null,
    ppStatus: src.pp_status ?? src.ppStatus ?? src.board_status ?? src.boardStatus ?? src.line_status ?? src.lineStatus ?? null,
    held: src.held === true || src.isHeld === true || src.onHold === true || src.on_hold === true || src.is_held === true,
  }
}

// Held lines (PrizePicks hold / suspended / removed, or an explicit flag) and
// OUT / IR / LTIR / scratched / suspended players. Does not touch the score.
export function rowIsHeldOrOut(row) {
  if (!row || typeof row !== 'object') return false
  const flags = availabilityOf(row)
  if (flags.held) return true
  for (const value of [flags.status, flags.injury, flags.ppStatus]) {
    if (blockedAvailability(value)) return true
    if (HELD_STATUS.has(statusText(value))) return true
  }
  return false
}

export function playableRows(rows, unavailableNames) {
  const blocked = unavailableNames instanceof Set ? unavailableNames : new Set()
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    if (rowIsHeldOrOut(row)) return false
    if (row?.player && blocked.has(normalizePlayerName(row.player))) return false
    return true
  })
}

function addBlockedName(names, name, status) {
  if (!name || !blockedAvailability(status)) return
  names.add(normalizePlayerName(name))
}

// Players the lineup snapshots already mark unavailable. WNBA "out" matches
// Lineups.jsx; inactive names are the same list that page groups with OUT.
// NFL and NHL read the injury report and any lineup row carrying that status.
export function unavailableFromLineups(sport, payload) {
  const names = new Set()
  const games = Array.isArray(payload) ? payload : []
  if (sport === 'wnba') {
    for (const game of games) {
      for (const side of ['visitor', 'home', 'away']) {
        const team = game?.[side]
        if (!team || typeof team !== 'object') continue
        for (const player of team.players || []) addBlockedName(names, player?.name, player?.status)
        for (const player of team.inactive || []) {
          if (player?.name) names.add(normalizePlayerName(player.name))
        }
      }
    }
    return names
  }
  if (sport === 'nfl' || sport === 'nhl') {
    for (const game of games) {
      for (const list of Object.values(game?.injuries || {})) {
        for (const player of list || []) addBlockedName(names, player?.name, player?.status)
      }
      for (const list of Object.values(game?.lineups || {})) {
        for (const player of list || []) addBlockedName(names, player?.name, player?.status || player?.injury)
      }
    }
  }
  return names
}

export function kboHubRows(data, photos = {}) {
  const lookup = {}
  for (const [name, url] of Object.entries(photos || {})) lookup[normalizePlayerName(name)] = url
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
        image: photos?.[card.name] || lookup[normalizePlayerName(card.name)] || null,
        start: card.start_time || card.game_time || null,
        ...availabilityOf({ ...card, ...prop }),
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
      ...availabilityOf(row),
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
      ...availabilityOf(row),
    }))
}

// Roster image first, then the board row's own image, same as nbaPropLines.buildPropRows.
function rosterImages(roster) {
  const byId = new Map()
  const byName = new Map()
  for (const p of Array.isArray(roster) ? roster : []) {
    if (!p?.image) continue
    if (p.athleteId != null && p.athleteId !== '') byId.set(String(p.athleteId), p.image)
    const name = String(p.name || '').trim().toLowerCase()
    if (name) byName.set(name, p.image)
  }
  return (player) => {
    const id = player?.athleteId == null ? '' : String(player.athleteId)
    return (id && byId.get(id)) || byName.get(String(player?.name || '').trim().toLowerCase()) || null
  }
}

function basketballRows(data, scoreFn, roster) {
  const rows = []
  const imageFor = rosterImages(roster)
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
        image: imageFor(player) || player.image || null,
        start: prop.start_time || prop.gameDate || null,
        ...availabilityOf({ ...player, ...prop }),
      })
    }
  }
  return rows
}

export const wnbaHubRows = (data, roster) => basketballRows(data, (prop) => wnbaCgScore(prop.projection, prop), roster)
export const nbaHubRows = (data, roster) => basketballRows(data, (prop) => prop.rating, roster)

// Highest CG Score first, one row per player so the list is not one star's props.
export function topHubRows(rows, limit = 5) {
  const valid = playableRows(rows)
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
  return playableRows(rows).filter((r) => r.player && Number.isFinite(r.score)).length
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
