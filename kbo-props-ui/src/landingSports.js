// The public landing fetches one board: the NFL free top 3. Row builders stay
// in publicBoard.js so this module can render the shell without shipping
// board code. Other leagues are links, not datasets.

export const LANDING_SPORTS = [
  { id: 'nfl', name: 'NFL', sportName: 'Football', props: 'Yards · Receptions · Rush att', ds: 'nfl_projections', dev: 'nfl/projections.json' },
]

// Featured sport on the public landing: the hero fetch and the phone.
export const HERO_LANDING_SPORT_ID = 'nfl'

// Teased on the landing. Opening one loads that sport's own free top 3.
// None of these datasets are requested with the landing.
export const LOCKED_LANDING_SPORTS = [
  { id: 'kbo', name: 'KBO', href: '/?sport=kbo' },
  { id: 'wnba', name: 'WNBA', href: '/?sport=wnba' },
  { id: 'nhl', name: 'NHL', href: '/?sport=nhl' },
]
