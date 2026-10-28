import { boundCg, cgScore } from './cgScore.js'
import { fitImage, isPrizePicksHeadshot, isRemoteHeadshotOrLogo, manualPlayerPng } from './fitImage.js'
import { inkOn, landingHeadshotUrl, landingTeamFill } from './playerMark.js'
import { NFL_LINE_FLOORS, nflCgScore, nflRawScore } from './nfl/nflLineFloors.js'
import { teamLogoUrl as nflLogo } from './nfl/nflTeams.js'
import { nhlHeadshotUrl, teamLogoUrl as nhlLogo } from './nhl/nhlTeams.js'
import { nbaLogoUrl } from './nba/nbaPropLines.js'
import { isPromoLine, isStandardLine } from './slipLines.js'
import { PAYOUT_ENTRY, averageCg, payoutDollars, payoutFor, playerKey } from './slipRank.js'

const KBO_LOGOS = {
  Doosan: 'doosan', Hanwha: 'hanwha', Lotte: 'lotte', Kia: 'kia', KIA: 'kia', Kiwoom: 'kiwoom',
  LG: 'lg', KT: 'kt', NC: 'nc', Samsung: 'samsung', SSG: 'ssg',
}

const ESPN_WNBA = {
  ATL: 'atl', CHI: 'chi', CON: 'conn', CONN: 'conn', DAL: 'dal', GS: 'gs', GSV: 'gs', IND: 'ind',
  LA: 'la', LAS: 'la', LV: 'lv', LVA: 'lv', MIN: 'min', NY: 'ny', NYL: 'ny', PHX: 'phx', PHO: 'phx',
  SEA: 'sea', WSH: 'wsh', WAS: 'wsh', TOR: 'tor', POR: 'por',
}

export const SLIP_RAIL = [
  { id: 'nfl', label: 'NFL' },
  { id: 'kbo', label: 'KBO' },
  { id: 'wnba', label: 'WNBA' },
  { id: 'nhl', label: 'NHL' },
]

export const LADDER_COUNTS = [2, 3, 4, 5, 6]
export const SLIP_CAP = 6

export function unpackSlipLoad(result) {
  if (Array.isArray(result)) return { props: result, empty: null }
  return {
    props: Array.isArray(result?.props) ? result.props : [],
    empty: result?.empty || null,
  }
}

export function rowKey(row) {
  return [row?.name, row?.team, row?.prop, row?.line, row?.odds_type].join('|')
}

function nflSlipRow(row) {
  if (String(row?.sport || '').toLowerCase() === 'nfl') return true
  const stat = row?.prop ?? row?.stat
  return Object.hasOwn(NFL_LINE_FLOORS, stat)
}

function nbaSlipRow(row) {
  return String(row?.sport || '').toLowerCase() === 'nba'
}

function kboSlipRow(row) {
  return String(row?.sport || '').toLowerCase() === 'kbo'
}

// NFL uses the board floors. Other
// sports stay on the plain line. NBA is bounded 0-100 like its board.
// The More/Less side is still projection versus the posted line, so a
// short yardage over does not flip to Less.
const slipCgCache = new WeakMap()

export function slipCg(row) {
  if (row && typeof row === 'object' && slipCgCache.has(row)) return slipCgCache.get(row)
  const stat = row?.prop ?? row?.stat
  const score = nflSlipRow(row)
    ? nflCgScore(row?.projection, row?.line, stat)
    : cgScore(row?.projection, row?.line, stat)
  // NBA and KBO are bounded 0-100 like their boards; rawSlipCg breaks ties at the cap.
  const shown = !nflSlipRow(row) && (nbaSlipRow(row) || kboSlipRow(row)) ? boundCg(score) : score
  if (row && typeof row === 'object') slipCgCache.set(row, shown)
  return shown
}

// Side of the shown CG. Exactly 50 is no pick: EVEN, so it is not a MORE
// (a held short NFL over or a projection on the line).
export function naturalSide(row) {
  if (isPromoLine(row)) return 'MORE'
  const score = shownCg(row)
  if (score == null) return Number(row?.edge) >= 0 ? 'MORE' : 'LESS'
  if (score === 50) return 'EVEN'
  return score > 50 ? 'MORE' : 'LESS'
}

// Uncapped score behind the shown one. Breaks ties at the 100 cap.
export function rawSlipCg(row) {
  const stat = row?.prop ?? row?.stat
  const p = Number(row?.projection)
  const l = Number(row?.line)
  if (nflSlipRow(row)) return nflRawScore(row?.projection, row?.line, stat)
  return Number.isFinite(p) && l > 0 ? (p / l) * 50 : null
}

export function shownCg(row) {
  const score = slipCg(row)
  return score == null || !Number.isFinite(score) ? null : score
}

function tieText(row, primary, fallback = '') {
  return String(row?.[primary] || (fallback ? row?.[fallback] : '') || '')
}

// Equal CG scores sort by name, prop, line, then team. The secondary key
// does not follow the high/low toggle, so a tie lands in the same place
// either way and does not follow the feed order.
export function compareSlipRows(a, b, sortDesc = true) {
  const left = shownCg(a)
  const right = shownCg(b)
  const av = left == null ? (sortDesc ? -Infinity : Infinity) : left
  const bv = right == null ? (sortDesc ? -Infinity : Infinity) : right
  if (av !== bv) return sortDesc ? bv - av : av - bv
  // Same shown score (e.g. two rows at the 100 cap): the uncapped score decides.
  const ar = rawSlipCg(a)
  const br = rawSlipCg(b)
  if (Number.isFinite(ar) && Number.isFinite(br) && ar !== br) return sortDesc ? br - ar : ar - br
  const name = tieText(a, 'name', 'player').localeCompare(tieText(b, 'name', 'player'))
  if (name) return name
  const prop = tieText(a, 'prop', 'stat').localeCompare(tieText(b, 'prop', 'stat'))
  if (prop) return prop
  const line = (Number(a?.line) || 0) - (Number(b?.line) || 0)
  if (line) return line
  return tieText(a, 'team').localeCompare(tieText(b, 'team'))
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

export function matchupLabel(rows) {
  const seen = []
  for (const row of Array.isArray(rows) ? rows : []) {
    let label = ''
    if (row?.awayTeam && row?.homeTeam) label = `${row.awayTeam} vs ${row.homeTeam}`
    else if (row?.team && row?.opponent) label = `${row.team} vs ${row.opponent}`
    if (label && !seen.includes(label)) seen.push(label)
  }
  return seen.slice(0, 4).join(' · ')
}

export function boardRows(rows, { standardOnly = true, moreOnly = false, propId = 'all', filters = [], sortDesc = true } = {}) {
  const match = filters.find((chip) => chip.id === propId)?.match
  let list = (Array.isArray(rows) ? rows : []).filter((row) => shownCg(row) != null)
  if (standardOnly) list = list.filter(isStandardLine)
  if (typeof match === 'function' && propId !== 'all') list = list.filter(match)
  if (moreOnly) list = list.filter((row) => naturalSide(row) === 'MORE')
  list.sort((a, b) => compareSlipRows(a, b, sortDesc))
  return list
}

export function addLeg(legs, row, side) {
  const current = Array.isArray(legs) ? legs : []
  if (!row || (side !== 'MORE' && side !== 'LESS')) return current
  if (isPromoLine(row) && side === 'LESS') return current
  const key = rowKey(row)
  const same = current.find((leg) => leg.key === key)
  if (same && same.side === side) return current.filter((leg) => leg.key !== key)
  const player = playerKey(row)
  if (player && current.some((leg) => leg.key !== key && playerKey(leg) === player)) return current
  const rest = current.filter((leg) => leg.key !== key)
  if (rest.length >= SLIP_CAP) return current
  return [...rest, { ...row, key, side }]
}

export function ladderFor(mode, altered = false) {
  return LADDER_COUNTS.map((picks) => {
    const row = payoutFor(mode, picks, { altered })
    return {
      picks,
      dollars: row ? payoutDollars(row.payout) : '—',
      breakeven: row?.breakeven ?? null,
      altered: altered === true,
    }
  })
}

export function estimateFor(mode, count, altered = false) {
  const row = payoutFor(mode, count, { altered })
  if (!row) return { dollars: '—', breakeven: null, altered: altered === true, payout: null }
  return {
    dollars: payoutDollars(row.payout),
    breakeven: row.breakeven,
    altered: altered === true,
    payout: row.payout,
  }
}

export function slipAverage(legs) {
  const rows = (Array.isArray(legs) ? legs : []).map((leg) => ({
    ...leg,
    side: leg.side === 'LESS' ? 'LESS' : 'MORE',
  }))
  return averageCg(rows)
}

export function cardAverage(legs) {
  const scores = (Array.isArray(legs) ? legs : []).map(shownCg).filter((score) => score != null)
  if (!scores.length) return null
  return scores.reduce((sum, score) => sum + score, 0) / scores.length
}

export function kboLogoUrl(team) {
  const file = KBO_LOGOS[team]
  return file ? `/team-logos/${file}.webp` : ''
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
  if (id === 'kbo') return kboLogoUrl(team) || ''
  return ''
}

const HEADSHOT_FIELDS = ['ppImageUrl', 'image_url', 'imageUrl', 'image', 'photoUrl']

// A board headshot already allowed by the image proxy. Team logos and PrizePicks
// team jerseys or generic assets are not player photos. The image proxy turns
// an unsized nfl.com file into a thumbnail before sharp sees it.
function leagueHeadshotUrl(url) {
  const value = String(url || '').trim()
  if (!value || !isRemoteHeadshotOrLogo(value)) return ''
  if (/\/teamlogos\//i.test(value)) return ''
  if (/static\.prizepicks\.com/i.test(value) && !isPrizePicksHeadshot(value) && !manualPlayerPng(value)) return ''
  return value
}

// PrizePicks player webp, then a hand-uploaded player PNG, then the league
// photo already stored on the row, then the NHL mug. The caller uses the team
// logo after that.
export function headshotFor(sport, row) {
  const fields = HEADSHOT_FIELDS.map((key) => row?.[key])
  for (const url of fields) {
    const photo = landingHeadshotUrl({ ppImageUrl: url })
    if (photo) return photo
  }
  for (const url of fields) {
    const manual = manualPlayerPng(url)
    if (manual) return manual
  }
  for (const url of fields) {
    const league = leagueHeadshotUrl(url)
    if (league) return league
  }
  if (String(sport || '').toLowerCase() === 'nhl') return nhlHeadshotUrl(row?.playerId) || ''
  return ''
}

export function markSources(sport, row, size = 52) {
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

export { PAYOUT_ENTRY }
