import { pillById } from './hitRateStrip.js'

// Hottest Streaks used every player with 5 logged games, so a 50% L10
// stayed on the list. A hot streak is a real L10 pill: pushes already left
// the rate, and the rate has to clear a coin flip by a visible margin.
export const HOT_L10_RATE = 60
export const HOT_L10_GAMES = 5

export function propsOnBoardCount(shown, locked) {
  const visible = Number(shown)
  const withheld = Number(locked)
  return (Number.isFinite(visible) ? visible : 0) + (Number.isFinite(withheld) && withheld > 0 ? withheld : 0)
}

export function sortWnbaRows(rows, sortBy, seasonLabel = '') {
  const list = Array.isArray(rows) ? rows : []
  const pillId = sortBy === `${seasonLabel} Hit Rate`
    ? 'season'
    : sortBy === 'H2H Hit Rate'
      ? 'h2h'
      : sortBy === 'CG Score' || sortBy === 'DVP Rank'
        ? null
        : 'l10'
  const valueOf = (row) => {
    if (sortBy === 'CG Score') return Number.isFinite(row?.score) ? row.score : null
    if (sortBy === 'DVP Rank') return Number.isFinite(Number(row?.dvpRank)) ? Number(row.dvpRank) : null
    const pill = pillById(row?.hitPills, pillId)
    return pill && Number.isFinite(Number(pill.rate)) ? Number(pill.rate) : null
  }
  return [...list].sort((a, b) => {
    const left = valueOf(a)
    const right = valueOf(b)
    if (left == null && right == null) return (b?.score ?? 0) - (a?.score ?? 0)
    if (left == null) return 1
    if (right == null) return -1
    return (right - left) || ((b?.score ?? 0) - (a?.score ?? 0))
  })
}

export function hotStreakRows(rows, { minRate = HOT_L10_RATE, minGames = HOT_L10_GAMES } = {}) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({ row, pill: pillById(row?.hitPills, 'l10') }))
    .filter(({ pill }) => pill && pill.rate >= minRate && pill.games >= minGames)
    .sort((a, b) => (b.pill.rate - a.pill.rate) || ((b.row?.score ?? 0) - (a.row?.score ?? 0)))
    .map(({ row }) => row)
}

export function etDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const read = (type) => parts.find((part) => part.type === type)?.value
  const year = read('year')
  const month = read('month')
  const day = read('day')
  if (!year || !month || !day) return null
  return `${year}-${month}-${day}`
}

export function formatSlateDate(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''))
  if (!match) return null
  const stamp = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 16, 0, 0))
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(stamp)
}

export function slateDateLabel(iso, now = new Date()) {
  if (!iso) return ''
  if (iso === etDateKey(now)) return "Today's slate"
  return formatSlateDate(iso) || ''
}

// The board was titling the next PrizePicks slate "Today's Slate" even when
// every game_date was a future Finals date. Say today only when that date is
// today in Eastern Time.
export function buildSlate(rows, now = new Date()) {
  const list = Array.isArray(rows) ? rows : []
  const dates = [...new Set(list.map((row) => row?.gameDate).filter(Boolean))].sort()
  const gameDate = dates[0] || null
  const source = gameDate ? list.filter((row) => row.gameDate === gameDate) : list
  const seen = new Map()
  source.forEach((row) => {
    const home = String(row?.team || '').toUpperCase()
    const away = String(row?.opponent || '').toUpperCase()
    if (!home || !away) return
    const [left, right] = [home, away].sort()
    const key = `${left}_${right}`
    const entry = seen.get(key) || { key, label: `${left} vs ${right}`, count: 0 }
    entry.count += 1
    seen.set(key, entry)
  })
  const matchups = [...seen.values()]
    .sort((a, b) => (b.count - a.count) || a.label.localeCompare(b.label))
    .slice(0, 8)
  const isToday = Boolean(gameDate) && gameDate === etDateKey(now)
  const title = !gameDate || isToday ? "Today's Slate" : (formatSlateDate(gameDate) || "Today's Slate")
  const noun = `${matchups.length} matchup${matchups.length === 1 ? '' : 's'}`
  const kicker = gameDate && !isToday ? `Next slate · ${noun}` : noun
  return { title, kicker, matchups, gameDate, isToday }
}
