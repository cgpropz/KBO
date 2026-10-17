// Deep link from a static SEO page into the React app. An explicit member
// pick is stored in localStorage (`cg_member_sport`, see memberSport.js).
// The old `cg_sport` key is ignored. /kbo, /nfl, /wnba, /nba, /nhl redirect
// to the public write-ups. `/?sport=` applies to this visit only.
// `/?s=NHL` opens that sport's slip. `&d=1` opens the slip drawer.
// `/?account=1` opens the member account page (subscription management).

export const APP_SPORTS = ['kbo', 'wnba', 'nfl', 'nhl', 'nba']

function sportToken(value) {
  const sport = String(value || '').trim().toLowerCase()
  return APP_SPORTS.includes(sport) ? sport : null
}

export function sportFromSearch(search) {
  const params = new URLSearchParams(search || '')
  return sportToken(params.get('sport')) || sportToken(params.get('s'))
}

export function slipLinkFromSearch(search) {
  const params = new URLSearchParams(search || '')
  const sport = sportToken(params.get('s'))
  if (!sport) return null
  return { sport, view: 'slip', drawer: params.get('d') === '1' }
}

export function accountFromSearch(search) {
  return new URLSearchParams(search || '').get('account') === '1'
}

const PAGE_VIEWS = {
  board: 'board',
  slip: 'slip',
  odds: 'sharp',
  player: 'player',
  projections: 'projections',
}

// Cold-load a board, slip, odds, player log, or projections view.
// `/?results=1` and `?page=results` stay on the hub and are not an entry.
export function pageEntryFromSearch(search) {
  const params = new URLSearchParams(search || '')
  const view = PAGE_VIEWS[String(params.get('page') || '').trim().toLowerCase()]
  if (!view) return null
  const sport = sportToken(params.get('sport')) || sportToken(params.get('s'))
  if (!sport) return null
  const player = String(params.get('player') || '').trim()
  return {
    sport,
    view,
    player: player || null,
    prop: params.get('prop') || null,
    drawer: params.get('d') === '1',
  }
}

export function resultsFromSearch(search) {
  const params = new URLSearchParams(search || '')
  return params.get('results') === '1' || String(params.get('page') || '').trim().toLowerCase() === 'results'
}

// Maps a page entry onto a sport shell's view id. Sports without a PP Odds
// page pass their board id as oddsId so the link still opens a real board.
export function sportViewFromEntry(entry, { slipId = 'slip', boardId = 'dashboard', oddsId = 'sharp', playerId = 'player' } = {}) {
  if (!entry?.view) return null
  if (entry.view === 'slip') return slipId
  if (entry.view === 'player' && (entry.player || entry.item)) return playerId
  if (entry.view === 'sharp' || entry.view === 'odds') return oddsId
  if (entry.view === 'projections') return 'projections'
  if (entry.view === 'board') return boardId
  return null
}

export function appBoardPath(sport) {
  return `/?sport=${sport}`
}
