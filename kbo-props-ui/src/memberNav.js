// A sport-tab click opens that sport's dashboard. A URL or slip entry that
// names a sub-page still opens that page on load and on a slip-sport switch.

const VIEWS = {
  kbo: new Set(['board', 'projections', 'batters', 'rankings', 'tracker', 'optimizer', 'matchups', 'pricing', 'player']),
  wnba: new Set(['projections', 'dashboard', 'players', 'teams', 'lineups', 'slip', 'playerDetail']),
  nfl: new Set(['dashboard', 'projections', 'sharp', 'markets', 'lineups', 'slip', 'player']),
  nhl: new Set(['dashboard', 'projections', 'sharp', 'lineups', 'dvp', 'slip', 'player']),
  nba: new Set(['projections', 'dashboard', 'players', 'teams', 'lineups', 'slip']),
}

export function homeViewForSport(sport) {
  return sport === 'kbo' ? 'board' : 'dashboard'
}

function mapPage(sport, page) {
  const token = String(page || '').trim()
  const lower = token.toLowerCase()
  if (lower === 'dashboard' || lower === 'home') return homeViewForSport(sport)
  if (lower === 'board') return sport === 'kbo' ? 'board' : 'projections'
  if (lower === 'prizepicks' || lower === 'edge') return 'projections'
  return token
}

export function explicitMemberView({ sport, entry, search }) {
  if (entry?.view === 'slip') return sport === 'kbo' ? 'optimizer' : 'slip'
  if (entry?.view === 'player') {
    if (sport === 'wnba') return 'playerDetail'
    if (sport === 'nba') return 'players'
    return 'player'
  }
  const params = new URLSearchParams(search || '')
  if (sport === 'nba') {
    const tab = params.get('nbaTab')
    if (tab) return tab
  }
  const page = params.get('page')
  if (!page) return null
  return mapPage(sport, page)
}

export function viewOnLoad({ sport, entry, search, forceHome }) {
  if (forceHome) return homeViewForSport(sport)
  const explicit = explicitMemberView({ sport, entry, search })
  const allowed = VIEWS[sport]
  if (explicit && allowed?.has(explicit)) return explicit
  return homeViewForSport(sport)
}

// Sport-tab navigation drops a named sub-page. An explicit ?sort= stays.
export function sportTabSearch(currentSearch, sport) {
  const params = new URLSearchParams(currentSearch || '')
  params.delete('page')
  params.delete('nbaTab')
  params.delete('s')
  params.delete('d')
  params.set('sport', sport)
  const text = params.toString()
  return text ? `?${text}` : ''
}

export function slipTabSearch(sport) {
  return `?s=${sport}`
}
