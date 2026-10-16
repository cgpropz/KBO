// Freshness for the public prop boards.
//
// The clock on screen is the time that board was last published. On the live
// site that is the Supabase snapshot row's updated_at, which /api/data returns
// as updatedAt. Dict snapshots may also carry published_at (the cohort stamp)
// or generated_at (when the model output was built). A list snapshot such as
// the NFL or NHL board has no stamp inside the JSON; the row time is the one
// that counts.
//
// Stale means the publish is old enough that the board no longer looks tended.
// The windows follow how often each sport is actually republished, not the
// optimistic cron. GitHub drops most of the "every 30 minutes" schedules, so
// those jobs often land every few hours. A threshold inside that gap would
// mark a healthy board stale all day.
//
//   KBO  18h  Daily Korea slate. The dependable publish cluster is afternoon
//             ET, and the odds job is often several hours apart. 18h flags a
//             missed day without calling a normal gap stale.
//   WNBA 12h  Lines are meant to move before tip. 12h means the pre-tip
//             publish did not land.
//   NFL  18h  The slate is weekly, but lines are rebuilt through the week.
//             18h means the board was touched yesterday; a silent day is stale.
//   NBA  12h  Nightly tips, with full refreshes at 6pm, 9pm, and 4am ET.
//             12h covers one missed cycle and still flags a skipped slate.
//   NHL  12h  Nightly games, same half-hour refresh pattern as the NFL board.
//             12h means tonight's publish did not land.
//
// Keep these hours in sync with pipeline/board_status.py.

export const STALE_AFTER_HOURS = {
  kbo: 18,
  wnba: 12,
  nfl: 18,
  nba: 12,
  nhl: 12,
}

export const BOARD_SPORTS = ['kbo', 'wnba', 'nfl', 'nba', 'nhl']

const ET = 'America/New_York'

const PUBLISH_KEYS = ['published_at', 'updated_at', 'generated_at']
// Only an explicit check field counts. A lineup file's own publish time is
// not an injury check, and scraped_at on the KBO starter sidecar is a lineup
// scrape, not an injury report.
const INJURY_KEYS = ['injuries_checked_at', 'injury_checked_at', 'lineups_checked_at']

function partsOf(date, options) {
  return Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: ET, ...options })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  )
}

export function parseBoardTime(iso) {
  const date = new Date(iso || '')
  return Number.isNaN(date.getTime()) ? null : date
}

export function stampFromPayload(data, keys) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  for (const key of keys) {
    const value = data[key]
    if (typeof value === 'string' && parseBoardTime(value)) return value
  }
  return null
}

export function publishedAtFromPayload(data) {
  return stampFromPayload(data, PUBLISH_KEYS)
}

export function injuryCheckedAtFromPayload(data) {
  return stampFromPayload(data, INJURY_KEYS)
}

export function formatBoardClock(iso) {
  const date = parseBoardTime(iso)
  if (!date) return ''
  const parts = partsOf(date, { hour: 'numeric', minute: '2-digit', hour12: true })
  if (!parts.hour || !parts.minute || !parts.dayPeriod) return ''
  return `${parts.hour}:${parts.minute} ${parts.dayPeriod} ET`
}

function etDayKey(date) {
  const parts = partsOf(date, { year: 'numeric', month: '2-digit', day: '2-digit' })
  return `${parts.year}-${parts.month}-${parts.day}`
}

function formatBoardDay(iso) {
  const date = parseBoardTime(iso)
  if (!date) return ''
  const parts = partsOf(date, { month: 'short', day: 'numeric' })
  return `${parts.month} ${parts.day}`
}

export function isBoardStale(iso, sport, now = new Date()) {
  const date = parseBoardTime(iso)
  const hours = STALE_AFTER_HOURS[sport]
  if (!date || !hours) return !date
  return now.getTime() - date.getTime() >= hours * 60 * 60 * 1000
}

export function isoWithEtOffset(iso) {
  const date = parseBoardTime(iso)
  if (!date) return null
  const parts = partsOf(date, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'longOffset',
  })
  let offset = String(parts.timeZoneName || '').replace(/^GMT/, '')
  if (!offset || offset === 'Z') offset = '+00:00'
  if (/^[+-]\d$/.test(offset)) offset = `${offset[0]}0${offset[1]}:00`
  if (/^[+-]\d{2}$/.test(offset)) offset = `${offset}:00`
  if (/^[+-]\d{4}$/.test(offset)) offset = `${offset.slice(0, 3)}:${offset.slice(3)}`
  const hour = parts.hour === '24' ? '00' : parts.hour
  return `${parts.year}-${parts.month}-${parts.day}T${hour}:${parts.minute}:${parts.second}${offset}`
}

export function cheatsheetWarningLine(payload, sport) {
  const rows = (Array.isArray(payload?.warnings) ? payload.warnings : [])
    .filter((row) => row?.sport === sport && Number(row.minutes_older) > 60)
  if (!rows.length) return ''
  const worst = rows.reduce((best, row) => (
    Number(row.minutes_older) > Number(best.minutes_older) ? row : best
  ))
  return `Cheat sheet is ${Math.round(Number(worst.minutes_older))} min older than this board`
}

export function propCountFor(sport, data) {
  if (sport === 'kbo') {
    const cards = data && typeof data === 'object' ? data.cards : null
    if (!Array.isArray(cards)) return 0
    return cards.reduce((total, card) => total + (Array.isArray(card?.props) ? card.props.length : 0), 0)
  }
  if (sport === 'wnba' || sport === 'nba') {
    if (!Array.isArray(data)) return 0
    return data.reduce((total, player) => total + (Array.isArray(player?.ppAllProps) ? player.ppAllProps.length : 0), 0)
  }
  if (sport === 'nfl' || sport === 'nhl') return Array.isArray(data) ? data.length : 0
  return 0
}

// snapshots[sport] is { data, publishedAt } or null when that file is absent.
// publishedAt, when passed, is the publish clock (Supabase updated_at) and
// wins over a stamp inside the JSON. previous entries fill sports this run
// did not rebuild, so a WNBA-only publish does not blank the NFL row.
export function buildBoardStatus({ snapshots = {}, previous = [], now = new Date() } = {}) {
  const prior = new Map((Array.isArray(previous) ? previous : []).filter((row) => row && row.sport).map((row) => [row.sport, row]))
  const boards = BOARD_SPORTS.map((sport) => {
    const snap = snapshots[sport]
    const prev = prior.get(sport) || null
    const present = snap != null
    let raw = present ? (snap.publishedAt || publishedAtFromPayload(snap.data)) : null
    let count = present ? propCountFor(sport, snap.data) : null
    let injury = present ? (snap.injuriesCheckedAt || injuryCheckedAtFromPayload(snap.data)) : null
    if (!raw && prev) raw = prev.board_updated_at
    if (count == null) count = Number.isInteger(prev?.prop_count) ? prev.prop_count : 0
    if (!injury && !present && prev) injury = prev.injuries_checked_at
    return {
      sport,
      board_updated_at: raw ? isoWithEtOffset(raw) : null,
      injuries_checked_at: injury ? isoWithEtOffset(injury) : null,
      prop_count: count,
      stale: raw ? isBoardStale(raw, sport, now) : true,
    }
  })
  return { boards }
}

export function boardStatusLine({ updatedAt, sport, injuriesCheckedAt = null, now = new Date() } = {}) {
  const clock = formatBoardClock(updatedAt)
  if (!clock) return ''
  const when = parseBoardTime(updatedAt) && etDayKey(parseBoardTime(updatedAt)) === etDayKey(now)
    ? clock
    : `${formatBoardDay(updatedAt)}, ${clock}`
  let line = `Board updated ${when}`
  if (isBoardStale(updatedAt, sport, now)) line += ' · stale'
  const injuryClock = formatBoardClock(injuriesCheckedAt)
  if (injuryClock) line += ` · injuries checked ${injuryClock}`
  return line
}
