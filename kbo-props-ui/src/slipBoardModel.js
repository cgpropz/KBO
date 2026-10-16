import { cgScore } from './cgScore.js'
import { fitImage, isPrizePicksHeadshot, isRemoteHeadshotOrLogo } from './fitImage.js'
import { inkOn, landingHeadshotUrl, landingTeamFill } from './playerMark.js'
import { NFL_LINE_FLOORS, nflCgScore } from './nfl/nflLineFloors.js'
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

// NFL uses the board floors (projection / max(line, floor) × 50). Other
// sports stay on the plain line. The More/Less side is still projection
// versus the posted line, so a short yardage over does not flip to Less.
export function slipCg(row) {
  const stat = row?.prop ?? row?.stat
  return nflSlipRow(row)
    ? nflCgScore(row?.projection, row?.line, stat)
    : cgScore(row?.projection, row?.line, stat)
}

export function naturalSide(row) {
  if (isPromoLine(row)) return 'MORE'
  const score = cgScore(row?.projection, row?.line, row?.prop ?? row?.stat)
  if (score == null) return Number(row?.edge) >= 0 ? 'MORE' : 'LESS'
  return score >= 50 ? 'MORE' : 'LESS'
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
const NFL_HEADSHOT = /^https:\/\/static\.www\.nfl\.com\/image\/(private|upload)\/(.+)$/i

// Full nfl.com headshots are about 3400×2450. Sharp refuses anything over 8
// megapixels, so ask Cloudinary for a small file before the image proxy.
function displayHeadshotUrl(url) {
  const value = String(url || '').trim()
  const match = value.match(NFL_HEADSHOT)
  if (!match) return value
  const [, kind, rest] = match
  if (/(^|[/,])w_\d+/.test(rest)) return value
  const parts = rest.split('/')
  const first = parts[0]
  if (first.includes(',') || /^(?:[fcgwqe]_|e_)/i.test(first)) parts[0] = `${first},w_200,c_limit`
  else parts.unshift('w_200,c_limit')
  const next = `https://static.www.nfl.com/image/${kind}/${parts.join('/')}`
  return isRemoteHeadshotOrLogo(next) ? next : value
}

// A board headshot already allowed by the image proxy. Team logos and PrizePicks
// team or manual art are not player photos.
function leagueHeadshotUrl(url) {
  const value = String(url || '').trim()
  if (!value || !isRemoteHeadshotOrLogo(value)) return ''
  if (/\/teamlogos\//i.test(value)) return ''
  if (/static\.prizepicks\.com/i.test(value) && !isPrizePicksHeadshot(value)) return ''
  return value
}

// PrizePicks player photo (the landing headshot), then the league photo already
// stored on the row, then the NHL mug. The caller uses the team logo after that.
export function headshotFor(sport, row) {
  const fields = HEADSHOT_FIELDS.map((key) => row?.[key])
  for (const url of fields) {
    const photo = landingHeadshotUrl({ ppImageUrl: url })
    if (photo) return displayHeadshotUrl(photo)
  }
  for (const url of fields) {
    const league = leagueHeadshotUrl(url)
    if (league) return displayHeadshotUrl(league)
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
