// Display helpers for the NBA Players list. Nothing here scores or ranks a
// prop: the top prop is the first row of the prop board's own CG Score order
// (buildPropRows + filterAndSortRows with the board defaults).

import { NBA_DVP_POSITIONS } from './positions.js'
import { DEFAULT_FILTERS, buildPropRows, filterAndSortRows } from './nbaPropLines.js'

export const POSITION_SLOTS = NBA_DVP_POSITIONS.map((slot) => slot.id)
export const UNSET = 'Unset'
export const SORTS = [
  { id: 'cg', label: 'CG Score' },
  { id: 'l10', label: 'L10 hit rate' },
  { id: 'minutes', label: 'Minutes' },
  { id: 'name', label: 'Name' },
]
export const SUMMARY_SEASON = '2025-26'
const SUMMARY_SEASON_CODE = '2026'

const STAT_SHORT = {
  Points: 'PTS',
  Rebounds: 'REB',
  Assists: 'AST',
  '3-PT Made': '3PM',
  Steals: 'STL',
  Blocks: 'BLK',
  'Blocked Shots': 'BLK',
  Turnovers: 'TO',
  'Fantasy Score': 'FPTS',
  'Pts+Rebs+Asts': 'PRA',
  'Pts+Rebs': 'P+R',
  'Pts+Asts': 'P+A',
  'Rebs+Asts': 'R+A',
  'Reb+Asts': 'R+A',
  'Blks+Stls': 'B+S',
  'Free Throws Made': 'FTM',
  'FG Made': 'FGM',
  'FG Attempted': 'FGA',
  '3-PT Attempted': '3PA',
  'Offensive Rebounds': 'OREB',
  'Defensive Rebounds': 'DREB',
}

export function statShort(stat) {
  return STAT_SHORT[stat] || String(stat || '')
}

function key(value) {
  return String(value ?? '').trim()
}

function nameKey(value) {
  return key(value).toLowerCase()
}

export function playerKey(player) {
  const id = key(player?.athleteId)
  return id ? `id:${id}` : `name:${nameKey(player?.name)}`
}

// All, the five slots, and Unset only when some player has no slot.
export function positionChips(players) {
  const hasUnset = (players || []).some((player) => !POSITION_SLOTS.includes(key(player?.position)))
  return ['All', ...POSITION_SLOTS, ...(hasUnset ? [UNSET] : [])]
}

export function teamOptions(players) {
  return [...new Set((players || []).map((player) => key(player?.team)).filter(Boolean))].sort()
}

// One entry per projected player: the first of his rows in the board's CG
// Score order. rank is that row's place in the whole board's order.
export function topProps(projections, players) {
  const rows = buildPropRows(projections, players)
  const ordered = filterAndSortRows(rows, 'All Props', { ...DEFAULT_FILTERS, sortBy: 'CG Score' })
  const byPlayer = new Map()
  const idByName = new Map()
  ;(projections || []).forEach((row) => {
    const id = key(row?.athleteId)
    if (id) idByName.set(nameKey(row?.name), id)
  })
  ordered.forEach((row, rank) => {
    const id = idByName.get(nameKey(row.player))
    const k = id ? `id:${id}` : `name:${nameKey(row.player)}`
    if (byPlayer.has(k)) return
    byPlayer.set(k, {
      rank,
      stat: row.prop,
      short: statShort(row.prop),
      line: row.line,
      side: row.side,
      opponent: row.opponent || null,
      hitRate: row._hit || row.gamesPlayed ? row.hitRate : null,
      hits: row._hit ? row._hit.hits : null,
      games: row._hit ? row._hit.total : null,
      last5: (row.recent || []).slice(-5),
    })
  })
  return byPlayer
}

export function topPropFor(map, player) {
  if (!map || !player) return null
  return map.get(playerKey(player)) || map.get(`name:${nameKey(player.name)}`) || null
}

// ESPN scoreboard → team → today's game. Opponent, home/away, tip (ISO), state.
export function scheduleFromScoreboard(payload) {
  const schedule = new Map()
  ;(payload?.events || []).forEach((event) => {
    const competition = event?.competitions?.[0]
    const competitors = competition?.competitors || []
    if (competitors.length !== 2) return
    const state = event?.status?.type?.state || competition?.status?.type?.state || 'pre'
    const tip = competition?.date || event?.date || null
    competitors.forEach((side, index) => {
      const team = key(side?.team?.abbreviation).toUpperCase()
      const other = competitors[1 - index]
      const opponent = key(other?.team?.abbreviation).toUpperCase()
      if (!team || !opponent) return
      schedule.set(team, { opponent, home: side?.homeAway === 'home', tip, state })
    })
  })
  return schedule
}

// Eastern calendar day, YYYYMMDD, for the scoreboard query.
export function easternDateKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now)
  const get = (type) => parts.find((part) => part.type === type)?.value || ''
  return `${get('year')}${get('month')}${get('day')}`
}

export function formatTip(iso) {
  if (!iso) return ''
  const when = new Date(iso)
  if (Number.isNaN(when.getTime())) return ''
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit',
  }).format(when)
  return `${time.replace(':00 ', ' ')} ET`
}

// Today's game for a player. The scoreboard wins; the prop board's opponent
// stands in (no tip time) when the scoreboard did not load.
export function todayGame(player, schedule, top) {
  const team = key(player?.team).toUpperCase()
  const game = schedule?.get?.(team)
  if (game) return game
  if (top?.opponent) return { opponent: top.opponent, home: null, tip: null, state: 'pre' }
  return null
}

export function gameText(game) {
  if (!game) return ''
  const versus = game.home === false ? '@' : 'vs'
  const tail = game.state === 'in' ? 'Live' : game.state === 'post' ? 'Final' : formatTip(game.tip)
  return [`${versus} ${game.opponent}`, tail].filter(Boolean).join(' · ')
}

export function isGameDay(schedule, tops) {
  return Boolean(schedule?.size) || Boolean(tops?.size)
}

export function averageMinutes(player, games = 10) {
  const values = (player?.gameLogs || [])
    .slice(0, games)
    .map((game) => Number(game?.min))
    .filter((value) => Number.isFinite(value) && value > 0)
  if (!values.length) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

// The 2025-26 line is from the player's 2025-26 team. Name that team when it
// is not the one he plays for now.
export function summaryTeam(player) {
  const stored = key(player?.summaryTeam)
  if (stored) return stored
  const game = (player?.gameLogs || []).find((log) => key(log?.season) === SUMMARY_SEASON_CODE)
  return key(game?.team)
}

export function priorTeam(player) {
  const before = summaryTeam(player).toUpperCase()
  const now = key(player?.team).toUpperCase()
  return before && now && before !== now ? before : ''
}

export function filterPlayers(players, filters, context = {}) {
  const search = nameKey(filters?.search)
  const position = filters?.position || 'All'
  const team = filters?.team || 'All'
  return (players || []).filter((player) => {
    if (search && !nameKey(player?.name).includes(search)) return false
    const slot = key(player?.position)
    if (position === UNSET ? POSITION_SLOTS.includes(slot) : position !== 'All' && slot !== position) return false
    if (team !== 'All' && key(player?.team) !== team) return false
    if (filters?.playingToday && !todayGame(player, context.schedule, topPropFor(context.tops, player))) return false
    return true
  })
}

function byName(a, b) {
  return key(a?.name).localeCompare(key(b?.name))
}

function nullsLast(a, b, valueOf, tie) {
  const av = valueOf(a)
  const bv = valueOf(b)
  if (av == null && bv == null) return tie(a, b)
  if (av == null) return 1
  if (bv == null) return -1
  return bv - av || tie(a, b)
}

export function sortPlayers(players, sortBy, context = {}) {
  const tops = context.tops
  const list = [...(players || [])]
  if (sortBy === 'name') return list.sort(byName)
  if (sortBy === 'minutes') return list.sort((a, b) => nullsLast(a, b, averageMinutes, byName))
  if (sortBy === 'l10') {
    return list.sort((a, b) => nullsLast(a, b, (p) => topPropFor(tops, p)?.hitRate ?? null, (x, y) => {
      const rx = topPropFor(tops, x)?.rank
      const ry = topPropFor(tops, y)?.rank
      if (rx != null && ry != null) return rx - ry
      return byName(x, y)
    }))
  }
  // CG Score: the board's order of each player's top prop, then by name.
  return list.sort((a, b) => {
    const ra = topPropFor(tops, a)?.rank
    const rb = topPropFor(tops, b)?.rank
    if (ra == null && rb == null) return byName(a, b)
    if (ra == null) return 1
    if (rb == null) return -1
    return ra - rb
  })
}

export function hitTone(rate) {
  if (rate == null) return 'none'
  if (rate >= 60) return 'good'
  if (rate >= 40) return 'mid'
  return 'bad'
}

// Five bars, oldest → newest, scaled against the line.
export function sparkBars(values, line, height = 18) {
  const numbers = (values || []).map(Number).filter(Number.isFinite)
  const target = Number(line)
  const top = Math.max(...numbers, Number.isFinite(target) ? target * 1.25 : 0, 1)
  return {
    bars: numbers.map((value) => ({
      value,
      height: Math.max(2, Math.round((value / top) * height)),
      hit: Number.isFinite(target) ? value > target : null,
    })),
    lineY: Number.isFinite(target) ? height - Math.round((target / top) * height) : null,
  }
}
