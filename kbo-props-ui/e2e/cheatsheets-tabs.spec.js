import { expect, test } from '@playwright/test'

const SPORTS = ['nfl', 'nba', 'nhl', 'wnba', 'kbo']

const LIVE = {
  nfl_game_markets: {
    week: 9,
    games: [
      {
        id: '2026-11-02-DAL-PHI',
        gameday: '2026-11-02',
        weekday: 'Sunday',
        gametime: '16:25',
        awayTeam: 'DAL',
        homeTeam: 'PHI',
        awayName: 'Cowboys',
        homeName: 'Eagles',
        awayScore: 22,
        homeScore: 28,
        spread: { line: 3.5, projection: 6, edge: -2.5, book: 'Circa' },
        total: { line: 47.5, projection: 50, edge: 2.5, book: 'Circa' },
        moneyline: { homePrice: -165, awayPrice: 140, book: 'Circa' },
      },
      {
        id: '2026-11-02-KC-BUF',
        gameday: '2026-11-02',
        weekday: 'Sunday',
        gametime: '20:20',
        awayTeam: 'KC',
        homeTeam: 'BUF',
        awayName: 'Chiefs',
        homeName: 'Bills',
        awayScore: 24,
        homeScore: 27,
        spread: { line: 1.5, projection: 3, edge: -1.5, book: 'Circa' },
        total: { line: 51, projection: 53, edge: 2, book: 'Circa' },
        moneyline: { homePrice: -130, awayPrice: 110, book: 'Circa' },
      },
    ],
  },
  nfl_lineups: [{
    awayTeam: 'DAL',
    homeTeam: 'PHI',
    awayRecord: '4-4',
    homeRecord: '6-2',
    roof: 'outdoors',
    spreadLine: -99,
    totalLine: 99,
  }],
  nba_teams: [
    { abbr: 'BOS', fullName: 'Boston Celtics', color: '#007A33', game: { date: '2026-11-02', opponent: 'NYK', home: false, tip: '2026-11-02T23:00:00Z' } },
    { abbr: 'NYK', fullName: 'New York Knicks', color: '#006BB6', game: { date: '2026-11-02', opponent: 'BOS', home: true, tip: '2026-11-02T23:00:00Z' } },
    { abbr: 'MIL', fullName: 'Milwaukee Bucks', color: '#00471B', game: { date: '2026-11-02', opponent: 'CHI', home: false, tip: '2026-11-03T01:00:00Z' } },
    { abbr: 'CHI', fullName: 'Chicago Bulls', color: '#CE1141', game: { date: '2026-11-02', opponent: 'MIL', home: true, tip: '2026-11-03T01:00:00Z' } },
  ],
  nhl_lineups: [{
    gameday: '2026-10-27',
    weekday: 'Monday',
    gametime: '7:00 PM ET',
    start_time: '2026-10-27T23:00:00Z',
    awayTeam: 'EDM',
    homeTeam: 'CGY',
    awayName: 'Oilers',
    homeName: 'Flames',
  }],
  nhl_projections: [],
  wnba_lineups: [{ gameTime: '7:00 PM ET', visitor: { abbr: 'LVA', name: 'Aces' }, home: { abbr: 'NYL', name: 'Liberty' } }],
  matchup_data: {
    game_date: '2026-10-27',
    matchups: [{
      away: 'Kia',
      home: 'LG',
      stadium: 'Jamsil Baseball Stadium',
      market: {
        total: 8.5,
        spread: { away: 1.5, home: -1.5 },
        moneyline: { away: 130, home: -150 },
      },
    }],
  },
  game_lines: { games: [] },
}

function payload(data) {
  return {
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ data, updatedAt: '2026-10-27T20:00:00Z', preview: false, lockedCount: 0, tier: 'owner' }),
  }
}

async function installFeeds(page, feeds) {
  await page.route('**/api/data**', async (route) => {
    const ds = new URL(route.request().url()).searchParams.get('ds')
    const data = Object.prototype.hasOwnProperty.call(feeds, ds) ? feeds[ds] : []
    await route.fulfill(payload(data))
  })
}

async function openCheatsheets(page) {
  await page.goto('/?cheatsheets=1&previewTier=owner', { waitUntil: 'load' })
  await expect(page.getByTestId('cheatsheets-page')).toBeVisible()
}

async function settle(page, sport) {
  const root = page.getByTestId('cheatsheets-page')
  await expect(root).toHaveAttribute('data-sport', sport)
  await expect(root).toHaveAttribute('data-source', 'live')
  await expect(page.getByTestId('game-proj-banner')).toHaveCount(0)
}

async function exerciseTabs(page) {
  for (const id of SPORTS) {
    const tab = page.getByTestId(`cheatsheets-sport-${id}`)
    await tab.click()
    await expect(page.getByTestId('cheatsheets-page')).toHaveAttribute('data-sport', id)
    await expect(tab).toHaveAttribute('aria-selected', 'true')
    await settle(page, id)
  }

  await page.getByTestId('cheatsheets-sport-nfl').click()
  await settle(page, 'nfl')
  await expect(page.getByTestId('cheatsheet-source')).toHaveText('Live game markets')
  await expect(page.getByTestId('game-proj-match')).toHaveText(/DAL\s*@\s*PHI/)
  await expect(page.getByTestId('cheatsheets-page')).toContainText('21+ · Play responsibly')
  await page.getByTestId('cheatsheet-game-2026-11-02-KC-BUF').locator('td').last().click()
  await expect(page.getByTestId('game-proj-match')).toHaveText(/KC\s*@\s*BUF/)

  await page.getByTestId('cheatsheets-sport-nba').click()
  await settle(page, 'nba')
  await expect(page.getByTestId('cheatsheet-source')).toHaveText('Live slate')
  await expect(page.getByTestId('game-proj-match')).toHaveText(/BOS\s*@\s*NYK/)
  await page.getByTestId('cheatsheet-game-nba-2026-11-02-MIL-CHI').locator('td').last().click()
  await expect(page.getByTestId('game-proj-match')).toHaveText(/MIL\s*@\s*CHI/)
  await expect(page.getByTestId('cheatsheet-game-nba-2026-11-02-MIL-CHI')).toHaveClass(/on/)

  await page.getByTestId('game-proj-toggle-pro').click()
  await expect(page.getByTestId('game-proj-pro')).toBeVisible()
  await page.getByTestId('game-proj-panel-pace').click()
  await expect(page.getByTestId('game-proj-pro')).toHaveAttribute('data-panel', 'pace')
  await expect(page.locator('.gp-pro-head')).toContainText('Milwaukee')
  await expect(page.locator('.gp-pro-head')).toContainText('Chicago')
  await expect(page.getByTestId('cheatsheet-detail-note')).toContainText('no game-total model')
  await page.getByTestId('game-proj-toggle-standard').click()
  await expect(page.getByTestId('game-proj-standard')).toBeVisible()

  await page.getByTestId('cheatsheets-sport-nhl').click()
  await settle(page, 'nhl')
  await expect(page.getByTestId('game-proj-match')).toHaveText(/EDM\s*@\s*CGY/)

  await page.getByTestId('cheatsheets-sport-wnba').click()
  await settle(page, 'wnba')
  await expect(page.getByTestId('game-proj-match')).toHaveText(/LVA\s*@\s*NYL/)

  await page.getByTestId('cheatsheets-sport-kbo').click()
  await settle(page, 'kbo')
  await expect(page.getByTestId('game-proj-match')).toHaveText(/KIA\s*@\s*LG/)
  await expect(page.getByTestId('game-proj-standard')).toContainText('8.5')
  await expect(page.getByTestId('game-proj-standard')).not.toContainText('EXAMPLE')
}

test('admin cheatsheet sport tabs and game rows switch on a phone', async ({ page }) => {
  expect(page.viewportSize().width).toBe(390)
  await installFeeds(page, LIVE)
  await openCheatsheets(page)
  await exerciseTabs(page)
})

test('an empty live feed stays blank instead of the example sheet', async ({ page }) => {
  await installFeeds(page, {
    nfl_game_markets: { week: 9, games: [] },
    nfl_lineups: [],
    nba_teams: [],
    nhl_lineups: [],
    nhl_projections: [],
    wnba_lineups: [],
    matchup_data: { matchups: [] },
    game_lines: { games: [] },
  })
  await openCheatsheets(page)
  await expect(page.getByTestId('cheatsheets-page')).toHaveAttribute('data-source', 'unavailable')
  await expect(page.getByTestId('game-proj-banner')).toHaveCount(0)
  await expect(page.getByTestId('cheatsheet-source')).toHaveText('Live board unavailable')
  await expect(page.getByTestId('cheatsheet-empty-board')).toContainText('No games are on the NFL game-markets feed')
  await expect(page.getByTestId('game-proj-match')).toHaveCount(0)

  await page.getByTestId('cheatsheets-sport-nba').click()
  await expect(page.getByTestId('cheatsheets-page')).toHaveAttribute('data-sport', 'nba')
  await expect(page.getByTestId('cheatsheets-page')).toHaveAttribute('data-source', 'unavailable')
  await expect(page.getByTestId('cheatsheet-empty-board')).toContainText('not used as a game total')
  await expect(page.getByText('DEN @ LAL')).toHaveCount(0)
})

test.describe('desktop', () => {
  test.use({
    viewport: { width: 1440, height: 900 },
    isMobile: false,
    hasTouch: false,
    deviceScaleFactor: 1,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  })

  test('admin cheatsheet sport tabs and game rows switch on a desktop', async ({ page }) => {
    expect(page.viewportSize().width).toBe(1440)
    await installFeeds(page, LIVE)
    await openCheatsheets(page)
    await exerciseTabs(page)
  })
})
