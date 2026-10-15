// Sport tabs on the public landing. Row builders stay in publicBoard.js so
// this module can render the shell without shipping board code.

export const LANDING_SPORTS = [
  { id: 'nfl', name: 'NFL', sportName: 'Football', props: 'Yards · Receptions · Rush att', ds: 'nfl_projections', dev: 'nfl/projections.json', lineups: 'nfl_lineups', lineupsDev: 'nfl/lineups.json' },
  { id: 'kbo', name: 'KBO', sportName: 'Baseball', props: 'Hits · RBIs · Strikeouts', ds: 'prizepicks_props', dev: 'prizepicks_props.json' },
  { id: 'wnba', name: 'WNBA', sportName: 'Basketball', props: 'Points · Rebounds · PRA', ds: 'wnba_projections_standard', dev: 'wnba/projections_standard.json', lineups: 'wnba_lineups', lineupsDev: 'wnba/lineups.json' },
  { id: 'nhl', name: 'NHL', sportName: 'Hockey', props: 'Shots · Points · Saves', ds: 'nhl_projections', dev: 'nhl/projections.json', lineups: 'nhl_lineups', lineupsDev: 'nhl/lineups.json' },
]

// NFL is the default sport on this landing. The free preview is off, so the
// phone can be empty. One dataset still loads with the hero; the other
// boards wait for a scroll.
export const HERO_LANDING_SPORT_ID = 'nfl'
