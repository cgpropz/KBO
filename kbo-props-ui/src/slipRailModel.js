import { cgScore } from './cgScore.js'
import { fitImage } from './fitImage.js'
import { inkOn, landingHeadshotUrl, landingTeamFill } from './playerMark.js'
import { teamLogoUrl as nflLogo } from './nfl/nflTeams.js'
import { nhlHeadshotUrl, teamLogoUrl as nhlLogo } from './nhl/nhlTeams.js'
import { nbaLogoUrl } from './nba/nbaPropLines.js'
import { isPromoLine, isStandardLine } from './slipLines.js'
import { payoutFor } from './slipRank.js'

const KBO_LOGOS = {
  Doosan: 'doosan', Hanwha: 'hanwha', Lotte: 'lotte', Kia: 'kia', KIA: 'kia', Kiwoom: 'kiwoom',
  LG: 'lg', KT: 'kt', NC: 'nc', Samsung: 'samsung', SSG: 'ssg',
}
const ESPN_WNBA = {
  ATL: 'atl', CHI: 'chi', CON: 'conn', CONN: 'conn', DAL: 'dal', GS: 'gs', GSV: 'gs', IND: 'ind',
  LA: 'la', LAS: 'la', LV: 'lv', LVA: 'lv', MIN: 'min', NY: 'ny', NYL: 'ny', PHX: 'phx', PHO: 'phx',
  SEA: 'sea', WSH: 'wsh', WAS: 'wsh', TOR: 'tor', POR: 'por',
}

export const RAIL_SPORTS = [
  { id: 'nfl', label: 'NFL' },
  { id: 'kbo', label: 'KBO' },
  { id: 'wnba', label: 'WNBA' },
  { id: 'nhl', label: 'NHL' },
  { id: 'nba', label: 'NBA' },
]

export const LADDER_COUNTS = [2, 3, 4, 5, 6]
export const PAYOUT_ENTRY = 10
export const SLIP_CAP = 6

export function unpackSlipLoad(result) {
  if (Array.isArray(result)) return { props: result, empty: null }
  return {
    props: Array.isArray(result?.props) ? result.props : [],
    empty: result?.empty || null,
  }
}

export function shownCg(row) {
  const score = cgScore(row?.projection, row?.line, row?.prop ?? row?.stat)
  return score == null || !Number.isFinite(score) ? null : score
}

export function rankedRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => isStandardLine(row) && shownCg(row) != null)
    .slice()
    .sort((a, b) => shownCg(b) - shownCg(a))
}

export function rowKey(row) {
  return [row?.name, row?.team, row?.prop, row?.line, row?.odds_type].join('|')
}

export function railPlayerKey(row) {
  const id = row?.playerId || row?.player_id
  if (id != null && String(id).trim() !== '') return `id:${id}`
  const name = String(row?.name || row?.player || '').trim().toLowerCase()
  return name ? `name:${name}` : ''
}

export function addLeg(legs, row, side) {
  const current = Array.isArray(legs) ? legs : []
  if (!row || (side !== 'MORE' && side !== 'LESS')) return current
  if (isPromoLine(row) && side === 'LESS') return current
  const key = rowKey(row)
  const same = current.find((leg) => leg.key === key)
  if (same && same.side === side) return current.filter((leg) => leg.key !== key)
  const player = railPlayerKey(row)
  if (player && current.some((leg) => leg.key !== key && railPlayerKey(leg) === player)) return current
  const rest = current.filter((leg) => leg.key !== key)
  if (rest.length >= SLIP_CAP) return current
  return [...rest, { ...row, key, side }]
}

export function sideCounts(legs) {
  const list = Array.isArray(legs) ? legs : []
  return {
    more: list.filter((leg) => leg.side !== 'LESS').length,
    less: list.filter((leg) => leg.side === 'LESS').length,
  }
}

export function cardAverage(legs) {
  const scores = (Array.isArray(legs) ? legs : []).map(shownCg).filter((score) => score != null)
  if (!scores.length) return null
  return scores.reduce((sum, score) => sum + score, 0) / scores.length
}

export function payoutDollars(payout, entry = PAYOUT_ENTRY) {
  if (!payout) return ''
  return String(payout).split('/').map((part) => {
    const multiplier = Number(String(part).trim().replace(/x$/i, ''))
    if (!Number.isFinite(multiplier)) return String(part).trim()
    const dollars = multiplier * entry
    return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`
  }).join(' / ')
}

export function ladderFor(mode) {
  return LADDER_COUNTS.map((picks) => {
    const row = payoutFor(mode, picks)
    return {
      picks,
      dollars: row ? payoutDollars(row.payout) : '—',
      breakeven: row?.breakeven ?? null,
      payout: row?.payout ?? null,
    }
  })
}

export function estimateFor(mode, count) {
  const row = payoutFor(mode, count)
  if (!row) return { dollars: '—', breakeven: null, payout: null }
  return { dollars: payoutDollars(row.payout), breakeven: row.breakeven, payout: row.payout }
}

export function l10Text(row) {
  const games = Number(row?.gamesL10)
  const rate = Number(row?.hitRate)
  if (Number.isFinite(games) && games > 0 && Number.isFinite(rate)) {
    return `${Math.round((rate / 100) * games)}/${games}`
  }
  const recent = Array.isArray(row?.recent) ? row.recent.slice(-10) : []
  const line = Number(row?.line)
  if (!recent.length || !Number.isFinite(line)) return '—'
  let hits = 0
  let decided = 0
  for (const value of recent) {
    const n = Number(value)
    if (!Number.isFinite(n) || n === line) continue
    decided += 1
    if (n > line) hits += 1
  }
  return decided ? `${hits}/${decided}` : '—'
}

export function slateLabel(rows) {
  const games = []
  for (const row of Array.isArray(rows) ? rows : []) {
    const away = row?.awayTeam || row?.team || ''
    const home = row?.homeTeam || row?.opponent || ''
    if (!away || !home) continue
    const key = `${away}|${home}`
    if (games.some((game) => game.key === key)) continue
    games.push({ key, away, home, start: row?.start_time || null })
  }
  if (!games.length) return ''
  if (games.length === 1) {
    const when = formatEt(games[0].start)
    return when ? `${games[0].away} @ ${games[0].home} · ${when}` : `${games[0].away} @ ${games[0].home}`
  }
  return games.slice(0, 4).map((game) => `${game.away} vs ${game.home}`).join(' · ')
}

function formatEt(value) {
  const date = new Date(value || '')
  if (Number.isNaN(date.getTime())) return ''
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: 'h12',
  }).formatToParts(date).map((part) => [part.type, part.value]))
  return `${parts.weekday} ${parts.hour}:${parts.minute} ${parts.dayPeriod} ET`
}

export function wnbaLogoUrl(team) {
  const slug = ESPN_WNBA[String(team || '').trim().toUpperCase()]
  return slug ? `https://a.espncdn.com/i/teamlogos/wnba/500/${slug}.png` : ''
}

export function logoFor(sport, team) {
  const id = String(sport || '').toLowerCase()
  if (id === 'nfl') return nflLogo(team) || ''
  if (id === 'nhl') return nhlLogo(team) || ''
  if (id === 'wnba') return wnbaLogoUrl(team) || ''
  if (id === 'nba') return nbaLogoUrl(team) || ''
  if (id === 'kbo') {
    const file = KBO_LOGOS[team]
    return file ? `/team-logos/${file}.webp` : ''
  }
  return ''
}

export function headshotFor(sport, row) {
  const photo = landingHeadshotUrl(row)
  if (photo) return photo
  if (String(sport || '').toLowerCase() === 'nhl') return nhlHeadshotUrl(row?.playerId) || ''
  return ''
}

export function markSources(sport, row, size = 44) {
  const head = headshotFor(sport, row)
  const logo = logoFor(sport, row?.team)
  const fill = landingTeamFill(sport, row?.team)
  return {
    head: head ? fitImage(head, size) : '',
    logo: logo ? fitImage(logo, size) : '',
    fill,
    ink: inkOn(fill),
    abbr: String(row?.team || '').trim() || '?',
  }
}
