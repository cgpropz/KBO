// Deep link from a static SEO page into the React app. An explicit member
// pick is stored in localStorage (`cg_member_sport`, see memberSport.js).
// The old `cg_sport` key is ignored. /kbo, /nfl, /wnba, /nba, /nhl redirect
// to the public write-ups. `/?sport=` is the one query the app reads, and it
// applies to this visit only.

export const APP_SPORTS = ['kbo', 'wnba', 'nfl', 'nhl', 'nba']

export function sportFromSearch(search) {
  const value = new URLSearchParams(search || '').get('sport')
  return APP_SPORTS.includes(value) ? value : null
}

export function appBoardPath(sport) {
  return `/?sport=${sport}`
}
