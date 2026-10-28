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
  nba_game_markets: {
    slate_date: '2026-11-02',
    status: 'lines_unavailable',
    proven: false,
    games: [
      {
        id: '2026-11-02-BOS-NY',
        gameday: '2026-11-02',
        weekday: 'Monday',
        gametime: '19:00',
        awayTeam: 'BOS',
        homeTeam: 'NY',
        awayName: 'Celtics',
        homeName: 'Knicks',
        proj_away: 112.2,
        proj_home: 114.4,
        proj_spread: 2.2,
        proj_total: 226.6,
        market_total: null,
        market_spread: null,
        edge_total: 6,
        lean_total: 'over',
        lean_spread: 'home',
        game_edge_score: 88,
        missing_market: true,
        spread: { line: 9.5, projection: 2.2, edge: 4, book: 'Circa' },
        total: { line: 220, projection: 226.6, edge: 6, book: 'Circa' },
      },
      {
        id: '2026-11-02-MIL-CHI',
        gameday: '2026-11-02',
        weekday: 'Monday',
        gametime: '20:00',
        awayTeam: 'MIL',
        homeTeam: 'CHI',
        awayName: 'Bucks',
        homeName: 'Bulls',
        proj_away: 118.1,
        proj_home: 113.3,
        proj_spread: -4.8,
        proj_total: 231.4,
        missing_market: true,
        lean_total: 'under',
        edge_total: 12,
        game_edge_score: 90,
      },
    ],
  },
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
  await expect(page.getByTestId('cheatsheets-page')).toHaveAttribute('data-model', 'game-markets')
  await expect(page.getByTestId('cheatsheets-page')).toHaveAttribute('data-projection', 'only')
  await expect(page.getByTestId('cheatsheet-source')).toHaveText('Live game markets')
  await expect(page.getByTestId('game-proj-match')).toHaveText(/BOS\s*@\s*NY/)
  await expect(page.getByTestId('game-proj-standard')).toContainText('226.6')
  await expect(page.getByTestId('game-proj-standard')).toContainText('112.2')
  await expect(page.getByTestId('game-proj-standard')).toContainText('no posted line')
  await expect(page.getByTestId('game-proj-standard')).not.toContainText('Circa')
  await expect(page.getByTestId('game-proj-standard')).not.toContainText('9.5')
  await expect(page.getByTestId('game-proj-standard')).not.toContainText('OVER')
  await expect(page.getByTestId('game-proj-standard')).not.toContainText('CG 88')
  await expect(page.getByTestId('sort-games-edge')).toHaveCount(0)
  await expect(page.getByTestId('cheatsheet-filter-edge')).toBeDisabled()
  await page.getByTestId('cheatsheet-game-2026-11-02-MIL-CHI').locator('td').last().click()
  await expect(page.getByTestId('game-proj-match')).toHaveText(/MIL\s*@\s*CHI/)
  await expect(page.getByTestId('cheatsheet-game-2026-11-02-MIL-CHI')).toHaveClass(/on/)

  await page.getByTestId('game-proj-toggle-pro').click()
  await expect(page.getByTestId('game-proj-pro')).toBeVisible()
  await page.getByTestId('game-proj-panel-pace').click()
  await expect(page.getByTestId('game-proj-pro')).toHaveAttribute('data-panel', 'pace')
  await expect(page.locator('.gp-pro-head')).toContainText('Milwaukee')
  await expect(page.locator('.gp-pro-head')).toContainText('Chicago')
  await expect(page.getByTestId('cheatsheet-detail-note')).toContainText('no game CG Score')
  await expect(page.getByTestId('game-proj-pro')).not.toContainText('UNDER')
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
    nba_game_markets: { games: [] },
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
