// Shared matchup filter for the sport dashboards.
// A game is one slate matchup. The label is away @ home when the row says
// which side is home. Otherwise the two abbreviations sort alphabetically.
// The shareable id is that same order with a hyphen: MIN @ VGK -> MIN-VGK.

import { etDateKey } from './wnbaBoard.js'

export const ALL_GAMES_LABEL = 'All games'
export const GAME_FILTER_EVENT = 'cg-game-filter'

const TEAM_ALIASES = { JAC: 'JAX' }
const START_FIELDS = ['start_time', 'startTime', 'start_time_utc', 'commence_time', 'kickoff', 'kickoff_utc']
const DATE_FIELDS = ['gameDate', 'gameday', 'game_date']
const TIME_FIELDS = ['gametime', 'gameTime', 'game_time']

function text(value) {
  return String(value ?? '').trim()
}

function firstText(item, fields) {
  if (!item || typeof item !== 'object') return ''
  for (const field of fields) {
    const value = text(item[field])
    if (value) return value
  }
  return ''
}

export function teamCode(value) {
  const code = text(value).toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (code.length < 2 || code.length > 12) return ''
  return TEAM_ALIASES[code] || code
}

function samePair(away, home, team, opponent) {
  return [away, home].sort().join('@') === [team, opponent].sort().join('@')
}

function kickoffMillis(item) {
  const direct = firstText(item, START_FIELDS)
  if (direct) {
    const parsed = Date.parse(direct)
    if (Number.isFinite(parsed)) return parsed
  }
  const date = firstText(item, DATE_FIELDS).slice(0, 10)
  const time = firstText(item, TIME_FIELDS)
  if (/^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{2}:\d{2}/.test(time)) {
    const parsed = Date.parse(`${date}T${time.slice(0, 5)}:00Z`)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function rowDate(item, kickoff) {
  const explicit = firstText(item, DATE_FIELDS)
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(explicit)
  if (iso) return iso[1]
  if (kickoff != null) return etDateKey(new Date(kickoff)) || ''
  return ''
}

function orientFromText(value, team, opponent) {
  const cleaned = text(value).toUpperCase().replace(/\./g, ' ').replace(/\s+/g, ' ').trim()
  const at = cleaned.match(/^([A-Z0-9]{2,12})\s*@\s*([A-Z0-9]{2,12})$/)
  if (at) {
    const away = teamCode(at[1])
    const home = teamCode(at[2])
    if (away && home && samePair(away, home, team, opponent)) return { away, home, oriented: true }
  }
  const versus = cleaned.match(/^([A-Z0-9]{2,12})\s+VS\s+([A-Z0-9]{2,12})$/)
  if (versus) {
    const home = teamCode(versus[1])
    const away = teamCode(versus[2])
    if (away && home && samePair(away, home, team, opponent)) return { away, home, oriented: true }
  }
  return null
}

function cardOf(item) {
  return item?.card && typeof item.card === 'object' ? item.card : null
}

function viewOf(item) {
  const card = cardOf(item)
  const team = teamCode(item?.team || card?.team)
  const opponent = teamCode(item?.opponent || card?.opponent || item?.prop?.opponent)
  const kickoff = kickoffMillis(item) ?? kickoffMillis(card)
  return {
    team,
    opponent,
    awayTeam: teamCode(item?.awayTeam || item?.away_team || card?.awayTeam || card?.away_team),
    homeTeam: teamCode(item?.homeTeam || item?.home_team || card?.homeTeam || card?.home_team),
    home: item?.home ?? card?.home,
    versus: item?.versus || item?.matchup || card?.versus || card?.matchup || '',
    date: rowDate(item, kickoff) || rowDate(card, kickoff),
    kickoff,
  }
}

function orient(view) {
  const { team, opponent } = view
  if (view.awayTeam && view.homeTeam && samePair(view.awayTeam, view.homeTeam, team, opponent)) {
    return { away: view.awayTeam, home: view.homeTeam, oriented: true }
  }
  if (typeof view.home === 'boolean') {
    return view.home
      ? { away: opponent, home: team, oriented: true }
      : { away: team, home: opponent, oriented: true }
  }
  const fromText = orientFromText(view.versus, team, opponent)
  if (fromText) return fromText
  const [away, home] = [team, opponent].sort()
  return { away, home, oriented: false }
}

export function describeGame(item) {
  const view = viewOf(item)
  if (!view.team || !view.opponent || view.team === view.opponent) return null
  const side = orient(view)
  return {
    id: `${side.away}-${side.home}`,
    label: `${side.away} @ ${side.home}`,
    away: side.away,
    home: side.home,
    oriented: side.oriented,
    date: view.date,
    kickoff: view.kickoff,
  }
}

function propView(player, prop) {
  return {
    team: player?.team || prop?.team,
    opponent: prop?.opponent || player?.opponent,
    awayTeam: prop?.awayTeam || prop?.away_team || player?.awayTeam || player?.away_team,
    homeTeam: prop?.homeTeam || prop?.home_team || player?.homeTeam || player?.home_team,
    home: prop?.home ?? player?.home,
    versus: prop?.versus || prop?.matchup || player?.versus || player?.matchup,
    gameDate: prop?.gameDate || player?.gameDate,
    gameday: prop?.gameday || player?.gameday,
    game_date: prop?.game_date || player?.game_date,
    start_time: prop?.start_time || prop?.startTime || player?.start_time || player?.startTime,
    gametime: prop?.gametime || prop?.gameTime || player?.gametime,
  }
}

function expand(records) {
  const flat = []
  for (const item of Array.isArray(records) ? records : []) {
    if (Array.isArray(item?.ppAllProps) && item.ppAllProps.length) {
      for (const prop of item.ppAllProps) flat.push(propView(item, prop))
    } else {
      flat.push(item)
    }
  }
  return flat
}

export function slateDay(dates, now = new Date()) {
  const unique = [...new Set((dates || []).filter(Boolean))].sort()
  if (!unique.length) return null
  const today = etDateKey(now)
  if (today && unique.includes(today)) return today
  const upcoming = today ? unique.find((day) => day > today) : null
  return upcoming || unique[unique.length - 1]
}

export function listGames(records, now = new Date()) {
  const described = expand(records).map(describeGame).filter(Boolean)
  const day = slateDay(described.map((game) => game.date), now)
  const pool = day ? described.filter((game) => game.date === day) : described
  const games = new Map()
  for (const game of pool) {
    const existing = games.get(game.id)
    if (!existing) {
      games.set(game.id, { ...game })
      continue
    }
    if (game.oriented && !existing.oriented) {
      existing.label = game.label
      existing.away = game.away
      existing.home = game.home
      existing.oriented = true
    }
    if (game.kickoff != null && (existing.kickoff == null || game.kickoff < existing.kickoff)) {
      existing.kickoff = game.kickoff
    }
  }
  return [...games.values()]
    .sort((a, b) => {
      if (a.kickoff != null && b.kickoff != null && a.kickoff !== b.kickoff) return a.kickoff - b.kickoff
      if (a.kickoff != null && b.kickoff == null) return -1
      if (a.kickoff == null && b.kickoff != null) return 1
      return a.label.localeCompare(b.label)
    })
    .map(({ id, label, kickoff }) => ({ id, label, kickoff }))
}

export function matchesGame(item, gameId) {
  if (!gameId) return true
  if (Array.isArray(item?.ppAllProps) && item.ppAllProps.length) {
    return item.ppAllProps.some((prop) => describeGame(propView(item, prop))?.id === gameId)
  }
  return describeGame(item)?.id === gameId
}

export function filterRows(records, gameId) {
  const list = Array.isArray(records) ? records : []
  if (!gameId) return list
  return list.filter((item) => matchesGame(item, gameId))
}

export function readGameParam(search) {
  const value = new URLSearchParams(search || '').get('game')
  return value ? value.trim() : ''
}

export function resolveGameId(param, games) {
  const raw = text(param)
  if (!raw || /^(all|all games|all-games)$/i.test(raw)) return ''
  const wanted = raw.toUpperCase()
  const game = (games || []).find((item) => item.id.toUpperCase() === wanted)
  return game ? game.id : ''
}

// The free top-3 is the first rows of the already sorted board, after the
// game filter. An unknown id leaves the full list alone.
export function previewRows(rows, param, limit = 3) {
  const selected = resolveGameId(param, listGames(rows))
  const matched = filterRows(rows, selected)
  const cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : matched.length
  return matched.slice(0, cap)
}

export function writeGameParam(gameId, loc = globalThis.window) {
  if (!loc?.location || !loc.history) return
  const url = new URL(loc.location.href)
  if (gameId) url.searchParams.set('game', gameId)
  else url.searchParams.delete('game')
  const next = `${url.pathname}${url.search}${url.hash}`
  const current = `${loc.location.pathname}${loc.location.search}${loc.location.hash}`
  if (next !== current) loc.history.replaceState(loc.history.state, '', next)
  loc.dispatchEvent?.(new Event(GAME_FILTER_EVENT))
}
