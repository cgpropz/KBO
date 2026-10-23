// Made-up NFL players for the NFL player-page parity specs. No real names,
// teams or numbers.

const seasons = [2025, 2025, 2025, 2025, 2026, 2026, 2026, 2026, 2026, 2026, 2026]
const backBase = {
  team: 'AAA',
  opponent: 'BBB',
  homeTeam: 'BBB',
  awayTeam: 'AAA',
  position: 'RB',
  gameDates: ['12/7', '12/14', '12/21', '12/28', '9/6', '9/13', '9/20', '9/27', '10/4', '10/11', '10/18'],
  gameSeasons: seasons,
  gameOpponents: ['CCC', 'DDD', 'BBB', 'CCC', 'DDD', 'BBB', 'CCC', 'DDD', 'EEE', 'CCC', 'DDD'],
  recentSnapPercents: [60, 62, 58, 65, 70, 72, 75, 80, 82, 85, 88],
  recentUsage: [12, 14, 10, 13, 15, 16, 18, 20, 22, 21, 24],
  recentDvpRanks: [5, 12, 25, 30, 3, 8, 15, 20, 26, 31, 10],
  usageLabel: 'Rush Att',
  priorSeasonLabel: 2025,
  currentSeasonGames: 7,
  snapCount: 82,
  dvpRank: 14,
  line_type: 'standard',
}

const rookieBase = {
  team: 'EEE',
  opponent: 'FFF',
  homeTeam: 'EEE',
  awayTeam: 'FFF',
  position: 'WR',
  gameDates: ['10/4', '10/11', '10/18'],
  gameSeasons: [2026, 2026, 2026],
  gameOpponents: ['CCC', 'DDD', 'BBB'],
  recentSnapPercents: [55, 60, 65],
  recentUsage: [5, 6, 7],
  recentDvpRanks: [12, 18, 22],
  usageLabel: 'Targets',
  priorSeasonLabel: 2025,
  currentSeasonGames: 3,
  snapCount: 60,
  dvpRank: 20,
  line_type: 'standard',
}

export const nflParityRows = [
  { ...backBase, id: 'nflp-1', player: 'Synth Back', prop: 'Rush Yards', line: 70.5, projection: 75, recent: [50, 60, 40, 55, 62, 70, 81, 90, 99, 95, 110] },
  { ...backBase, id: 'nflp-2', player: 'Synth Back', prop: 'Receptions', line: 3.5, projection: 3.8, recent: [2, 3, 1, 2, 2, 3, 3, 4, 4, 5, 4] },
  { ...backBase, id: 'nflp-5', player: 'Synth Back', prop: 'Receiving Yards', line: 22.5, projection: 21, recent: [10, 18, 6, 15, 14, 20, 22, 30, 28, 35, 26] },
  { ...backBase, id: 'nflp-3', player: 'Synth Back', prop: 'Rec Targets', line: 4.5, projection: 4.2, recent: [3, 4, 2, 3, 3, 4, 4, 5, 5, 6, 5] },
  { ...rookieBase, id: 'nflp-4', player: 'Synth Rookie', prop: 'Receiving Yards', line: 40.5, projection: null, recent: [30, 45, 52] },
]

// Serves the made-up NFL rows on top of the shared fixtures (later routes win).
export async function installNflParityRows(page, { member = false } = {}) {
  await page.route('**/api/data**', async (route) => {
    const url = new URL(route.request().url())
    if (url.searchParams.get('ds') !== 'nfl_projections') {
      await route.fallback()
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: nflParityRows, updatedAt: '2026-10-21T20:00:00Z', preview: !member, lockedCount: 0, tier: member ? 'combined' : 'free' }),
    })
  })
}
