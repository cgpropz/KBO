// Shared sport metadata — used by CgpropzLanding (post-login hub) and
// PublicLanding (pre-login marketing page) so copy/colors stay in sync.
export const SPORTS = [
  {
    id: 'kbo',
    emoji: '⚾',
    name: 'KBO',
    full: 'Korean Baseball',
    tagline: 'Strikeout & batter projections, prop cards, slip builder, and matchup breakdowns.',
    accent: '#22c55e',
    glow: 'rgba(34, 197, 94, 0.35)',
    features: ['Pitcher K projections', 'Batter props & hit rates', 'Slip builder + tracker'],
    // Original illustration of a fictional player. Not a real athlete and not a league logo.
    portrait: '/sport-cards/kbo-card.webp',
    portraitAlt: 'Illustrated baseball player in a navy helmet and white jersey',
  },
  {
    id: 'wnba',
    emoji: '🏀',
    name: 'WNBA',
    full: 'Women\'s Basketball',
    tagline: 'PrizePicks edge board, player projections, defense vs position, and daily lineups.',
    accent: '#4ade80',
    glow: 'rgba(74, 222, 128, 0.35)',
    features: ['PrizePicks edge board', 'Points / reb / ast projections', 'DvP & daily lineups'],
    portrait: '/sport-cards/wnba-card.webp',
    portraitAlt: 'Illustrated basketball player in a dark jersey',
  },
  {
    id: 'nfl',
    emoji: '🏈',
    name: 'NFL',
    full: 'Pro Football',
    tagline: 'PrizePicks prop edges built from weighted recent form and live lines.',
    accent: '#7fff68',
    glow: 'rgba(127, 255, 104, 0.35)',
    features: ['Top 3 daily props', 'Full PrizePicks edge board', '2025 + 2026 game logs'],
    portrait: '/sport-cards/nfl-card.webp',
    portraitAlt: 'Illustrated football player in a dark helmet',
  },
];

// Shown beside SPORTS on both landings. Kept out of SPORTS so the trust strip
// does not list NBA as a live sport. The card stays blurred until nbaSectionOpen.
export const NBA_CARD = {
  id: 'nba',
  emoji: '🏀',
  name: 'NBA',
  full: 'Pro Basketball',
  tagline: 'PrizePicks edge board, player projections, and defense vs position.',
  accent: '#38bdf8',
  glow: 'rgba(56, 189, 248, 0.35)',
  features: ['PrizePicks edge board', 'Player and team stats', 'PG / SG / SF / PF / C DVP'],
  // Original illustration of a fictional player. Not a real athlete and not a league logo.
  portrait: '/sport-cards/nba-card.webp',
  portraitAlt: 'Illustrated basketball player in a dark jersey',
};

// Shown beside SPORTS, locked the same way as NBA. Not a league logo.
export const NHL_CARD = {
  id: 'nhl',
  emoji: '🏒',
  name: 'NHL',
  full: 'Pro Hockey',
  tagline: 'Shots, saves, points, and power-play points from the PrizePicks board.',
  accent: '#7dd3fc',
  glow: 'rgba(125, 211, 252, 0.35)',
  features: ['Shots and saves model', 'Points and power-play points', 'Lines and starting goalies'],
  portrait: '/sport-cards/nhl-card.svg',
  portraitAlt: 'Illustrated hockey player in a dark helmet',
};
