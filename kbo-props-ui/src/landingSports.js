// Sport tabs on the public landing. Row builders stay in publicBoard.js so
// this module can render the shell without shipping board code.

export const LANDING_SPORTS = [
  { id: 'nfl', name: 'NFL', sportName: 'Football', props: 'Yards · Receptions · Rush att', ds: 'nfl_projections', dev: 'nfl/projections.json', lineups: 'nfl_lineups', lineupsDev: 'nfl/lineups.json' },
  { id: 'kbo', name: 'KBO', sportName: 'Baseball', props: 'Hits · RBIs · Strikeouts', ds: 'prizepicks_props', dev: 'prizepicks_props.json' },
  { id: 'wnba', name: 'WNBA', sportName: 'Basketball', props: 'Points · Rebounds · PRA', ds: 'wnba_projections_standard', dev: 'wnba/projections_standard.json', lineups: 'wnba_lineups', lineupsDev: 'wnba/lineups.json' },
  { id: 'nhl', name: 'NHL', sportName: 'Hockey', props: 'Shots · Points · Saves', ds: 'nhl_projections', dev: 'nhl/projections.json', lineups: 'nhl_lineups', lineupsDev: 'nhl/lineups.json' },
]

// KBO is the one dataset requested while the hero paints. NFL's free preview
// is off, so an NFL fetch would not fill the phone. KBO has no lineup file.
export const HERO_LANDING_SPORT_ID = 'kbo'
