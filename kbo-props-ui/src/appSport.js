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

export function appBoardPath(sport) {
  return `/?sport=${sport}`
}
