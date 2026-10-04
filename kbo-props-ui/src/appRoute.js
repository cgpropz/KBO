// Sport board routes. The in-app view used to live only in React state, so a
// browser refresh always reopened the marketing hub. These helpers map the
// address bar onto that view and back.
//
//   /nfl/lineups   NFL Starting Lineups
//   /wnba/lineups  WNBA Lineups
//   /kbo/board     KBO PrizePicks board (KBO has no lineups view)

export const BOARD_VIEWS = {
  nfl: ['dashboard', 'projections', 'sharp', 'lineups'],
  wnba: ['dashboard', 'projections', 'players', 'teams', 'lineups'],
  kbo: ['board', 'projections', 'batters', 'rankings', 'tracker', 'optimizer', 'matchups', 'pricing', 'tutorial'],
}

export function defaultBoardView(sport) {
  return sport === 'kbo' ? 'board' : 'dashboard'
}

export function isBoardView(sport, view) {
  return Array.isArray(BOARD_VIEWS[sport]) && BOARD_VIEWS[sport].includes(view)
}

function normalizeBase(base) {
  if (!base || base === '/') return ''
  return base.endsWith('/') ? base.slice(0, -1) : base
}

export function stripBase(pathname, base = '/') {
  const prefix = normalizeBase(base)
  let path = pathname || '/'
  if (prefix && (path === prefix || path.startsWith(`${prefix}/`))) {
    path = path.slice(prefix.length) || '/'
  }
  if (!path.startsWith('/')) path = `/${path}`
  return path.length > 1 ? path.replace(/\/+$/, '') : path
}

export function hubPath(base = '/') {
  const prefix = normalizeBase(base)
  return prefix ? `${prefix}/` : '/'
}

export function parseAppRoute(pathname, base = '/') {
  const parts = stripBase(pathname, base).split('/').filter(Boolean)
  if (parts.length === 0) return { screen: 'hub', sport: null, view: null }
  const [sport, view, extra] = parts
  if (extra || !BOARD_VIEWS[sport]) return { screen: 'hub', sport: null, view: null }
  if (!view) return { screen: 'home', sport, view: defaultBoardView(sport) }
  if (!isBoardView(sport, view)) return { screen: 'hub', sport: null, view: null }
  return { screen: 'home', sport, view }
}

export function buildAppPath(sport, view, base = '/') {
  if (!isBoardView(sport, view)) return null
  const prefix = normalizeBase(base)
  const suffix = view === defaultBoardView(sport) ? `/${sport}` : `/${sport}/${view}`
  return `${prefix}${suffix}`
}
