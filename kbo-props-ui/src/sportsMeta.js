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

// Owner-only hub card. Kept out of SPORTS so the public landing, trust strip,
// and logged-out marketing never list NBA. The logged-in hub appends it only
// when canSeeNba(user) is true.
export const NBA_OWNER_CARD = {
  id: 'nba',
  emoji: '🏀',
  name: 'NBA',
  full: 'Pro Basketball',
  tagline: 'Owner preview. Rosters, logs, and five-position DVP are not public yet.',
  accent: '#38bdf8',
  glow: 'rgba(56, 189, 248, 0.35)',
  features: ['PrizePicks edge board', 'Player and team stats', 'PG / SG / SF / PF / C DVP'],
  portrait: '/sport-cards/wnba-card.webp',
  portraitAlt: 'Illustrated basketball player in a dark jersey',
};
