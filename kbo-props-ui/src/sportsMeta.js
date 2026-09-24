// Shared sport metadata — used by CgpropzLanding (post-login hub) and
// PublicLanding (pre-login marketing page) so copy/colors stay in sync.
export const SPORTS = [
  {
    id: 'kbo',
    emoji: '⚾',
    name: 'KBO',
    full: 'Korea Baseball',
    tagline: 'Strikeout & batter projections, prop cards, slip builder, and matchup breakdowns.',
    accent: '#22c55e',
    glow: 'rgba(34, 197, 94, 0.35)',
    features: ['Pitcher K projections', 'Batter props & hit rates', 'Slip builder + tracker'],
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
  },
];
