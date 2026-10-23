// Game date under a hit-rate bar: M/DD, no year ("10/20", "9/05").
// Feeds ship YYYY-MM-DD (KBO batters, ISO stamps), MM/DD/YYYY (KBO pitchers,
// NBA box scores, WNBA), or M/D and MM/DD (NFL, NHL). The calendar date in
// the text is used as is, so a UTC stamp is never moved to another day.
export function formatGameDate(value) {
  const text = String(value ?? '').trim()
  if (!text) return ''
  let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (match) return monthDay(match[2], match[3]) || text
  match = text.match(/^(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?(?!\d)/)
  if (match) return monthDay(match[1], match[2]) || text
  if (/[a-z]/i.test(text) && !/[zZ]$|[+-]\d{2}:?\d{2}$/.test(text)) {
    const parsed = new Date(text)
    if (!Number.isNaN(parsed.getTime())) return monthDay(parsed.getMonth() + 1, parsed.getDate()) || text
  }
  return text
}

function monthDay(month, day) {
  const m = Number(month)
  const d = Number(day)
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return ''
  return `${m}/${String(d).padStart(2, '0')}`
}

// Opponent abbreviation shown when there is no logo for the team.
export function opponentAbbr(team) {
  return String(team ?? '').trim() || '—'
}

// "LVA @ CHI" / "LVA vs. CHI" -> "CHI" (the team after the separator).
export function matchupOpponent(matchup) {
  const text = String(matchup ?? '').replace(/vs\.?/gi, '@')
  const parts = text.split('@')
  return parts.length > 1 ? parts[parts.length - 1].trim().toUpperCase() : ''
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch])
}

// HTML twin of <GameDateLogo> for chart libraries that take label markup
// (Highcharts). src is the already-sized logo URL, or '' to show the
// abbreviation.
export function gameDateLabelHtml({ date, team, src }) {
  const day = escapeHtml(formatGameDate(date) || '—')
  const name = escapeHtml(team || '')
  const mark = src
    ? `<img class="hr-game-logo" src="${escapeHtml(src)}" alt="${name}" width="14" height="14">`
    : `<span class="hr-game-abbr">${escapeHtml(opponentAbbr(team))}</span>`
  return `<span class="hr-game"><span class="hr-game-date">${day}</span>${mark}</span>`
}
