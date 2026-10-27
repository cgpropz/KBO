import { canSeeCheatsheets } from '../entitlements.js'

// Sport tabs on the cheatsheets page. NFL upgrades to nfl_game_markets when
// a full (non-preview) snapshot loads. Other sports have no game-proj feed.
export const CHEATSHEET_SPORTS = [
  { id: 'nfl', name: 'NFL' },
  { id: 'nba', name: 'NBA' },
  { id: 'nhl', name: 'NHL' },
  { id: 'wnba', name: 'WNBA' },
  { id: 'kbo', name: 'KBO' },
]

export function cheatsheetsRequested(search) {
  return new URLSearchParams(search || '').get('cheatsheets') === '1'
}

export function stripCheatsheetsSearch(search) {
  const params = new URLSearchParams(search || '')
  params.delete('cheatsheets')
  params.delete('league')
  params.delete('gp')
  const text = params.toString()
  return text ? `?${text}` : ''
}

export function leagueFromSearch(search) {
  const league = String(new URLSearchParams(search || '').get('league') || '').toLowerCase()
  return CHEATSHEET_SPORTS.some((sport) => sport.id === league) ? league : 'nfl'
}

export function layoutFromSearch(search) {
  return new URLSearchParams(search || '').get('gp') === 'pro' ? 'pro' : 'standard'
}

export function cheatsheetsHref(search) {
  const current = new URLSearchParams(search || '')
  const next = new URLSearchParams()
  next.set('cheatsheets', '1')
  const preview = current.get('previewTier')
  if (preview) next.set('previewTier', preview)
  return `/?${next.toString()}`
}

export function homeHref(search) {
  const preview = new URLSearchParams(search || '').get('previewTier')
  return preview ? `/?previewTier=${encodeURIComponent(preview)}` : '/'
}

export function sportChrome(sportId, example) {
  const sport = CHEATSHEET_SPORTS.find((item) => item.id === sportId) || CHEATSHEET_SPORTS[0]
  const week = sport.id === 'nfl' && example?.sport && example?.week
    ? `${example.sport} · ${example.week}`
    : `${sport.name} · EXAMPLE`
  return { ...sport, week }
}

// allow: render the example dashboard.
// wait: signed-out until the session check finishes. Do not render numbers.
// deny: strip the URL and leave.
// null: this URL is not the cheatsheets route.
export function cheatsheetsGate({ search, user, sessionPending = false }) {
  if (!cheatsheetsRequested(search)) return null
  if (canSeeCheatsheets(user)) return 'allow'
  if (user) return 'deny'
  return sessionPending ? 'wait' : 'deny'
}
