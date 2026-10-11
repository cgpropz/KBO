// Deep link from a static SEO page into the React app. Sport is stored in
// localStorage (`cg_sport`), not the URL, and /kbo, /nfl, /wnba, /nba, /nhl
// redirect to the public write-ups. `/?sport=` is the one query the app reads.

export const APP_SPORTS = ['kbo', 'wnba', 'nfl', 'nhl', 'nba']

export function sportFromSearch(search) {
  const value = new URLSearchParams(search || '').get('sport')
  return APP_SPORTS.includes(value) ? value : null
}

export function appBoardPath(sport) {
  return `/?sport=${sport}`
}
