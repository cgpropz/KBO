import { expect, test } from '@playwright/test'
import { mkdir } from 'node:fs/promises'

const recent = [70, 80, 55, 90, 60, 75, 88, 40, 95, 62, 71, 83]
const seasons = Array(12).fill(2026)
const opponents = ['DAL', 'NYG', 'PHI', 'WAS', 'DAL', 'NYG', 'PHI', 'WAS', 'DAL', 'NYG', 'PHI', 'WAS']
const wnbaGames = Array.from({ length: 10 }, (_, index) => ({
  date: `2026-09-${String(index + 1).padStart(2, '0')}`,
  opponent: 'NYL',
  pts: 20 + index,
  reb: 8,
  ast: 3,
}))

const fixtures = {
  nfl_projections: [{
    id: 'nfl-0',
    player: 'Amon-Ra St. Brown',
    team: 'DET',
    opponent: 'CHI',
    position: 'WR',
    prop: 'Receiving Yards',
    line: 64.5,
    projection: 71.2,
    recent,
    gameSeasons: seasons,
    gameOpponents: opponents,
    dvpRank: 4,
    imageUrl: 'https://a.espncdn.com/i/headshots/nfl/players/full/4374302.png',
    line_type: 'standard',
  }],
  nfl_game_markets: {
    generated_at: '2026-10-11T20:00:00Z',
    status: 'ok',
    games: [{
      id: 'det-chi',
      awayTeam: 'CHI',
      homeTeam: 'DET',
      spread: { line: -3.5, edge: 1.2 },
      total: { line: 45.5, edge: 0.4 },
      moneyline: { line: -160, edge: 0.2 },
    }],
  },
  nhl_projections: [{
    id: 'nhl-0',
    player: 'Connor McDavid',
    team: 'EDM',
    opponent: 'CGY',
    position: 'C',
    prop: 'Shots On Goal',
    line: 3.5,
    projection: 4.2,
    recent: [4, 5, 3, 2, 6, 4, 1, 5, 3, 4],
    hitRateL5: 0.8,
    gamesL5: 5,
    hitRate: 0.7,
    gamesL10: 10,
    hitRateL20: 0.65,
    gamesL20: 20,
    h2hHitRate: 0.6,
    h2hGames: 5,
    seasonHitRate: 0.72,
    seasonGames: 40,
    dvpRank: 3,
    imageUrl: 'https://assets.nhle.com/mugs/nhl/edm/8478402.png',
    oddsType: 'standard',
  }],
  prizepicks_props: {
    cards: [{
      name: 'Kim Do-yeong',
      team: 'Kia',
      type: 'batter',
      opponent: 'LG',
      games: [],
      props: [{ stat: 'Hits', line: 1.5, projection: 1.8, hit_rate_l10: 70, hit_rate_all: 60, odds_type: 'standard', recent_values: [2, 1, 0, 1, 2, 1, 3, 0, 1, 2] }],
    }],
  },
  wnba_projections_standard: [{
    name: 'Aja Wilson',
    player: 'Aja Wilson',
    team: 'LVA',
    position: 'Forward',
    projPts: 24,
    gp: 20,
    recentGames: wnbaGames,
    ppAllProps: [{ stat: 'Points', line: 22.5, projection: 24, opponent: 'NYL' }],
    image: 'https://a.espncdn.com/i/headshots/wnba/players/full/3149391.png',
  }],
  wnba_players: [{ name: 'Aja Wilson', team: 'LVA', position: 'F' }],
  nba_projections_standard: [{
    name: 'Nikola Jokic',
    team: 'DEN',
    position: 'C',
    gp: 10,
    ppAllProps: [{ stat: 'Points', line: 26.5, projection: 28.4, opponent: 'LAL' }],
  }],
  nba_players: [],
  nfl_sharp_odds: { records: [], status: 'ok' },
  nhl_sharp_odds: { records: [], status: 'ok' },
}

const pages = [
  ['landing', '/'],
  ['nfl-board', '/?sport=nfl'],
  ['nhl-board', '/?sport=nhl'],
  ['kbo-board', '/?sport=kbo'],
  ['wnba-board', '/?sport=wnba'],
  ['nba-entry', '/?sport=nba'],
  ['pricing', '/pricing'],
  ['start-here', '/guides/start-here'],
  ['cg-score', '/guides/cg-score'],
  ['policies', '/policies'],
]

const boardShots = [
  ['nfl', '/?sport=nfl', '.nfl-player-link'],
  ['nhl', '/?sport=nhl', '.nfl-player-link'],
  ['kbo', '/?sport=kbo', '.kbo-player-cell'],
  ['wnba', '/?sport=wnba', '.wnba-player-link'],
]

async function installFixtures(page) {
  await page.route('**/api/data**', async (route) => {
    const ds = new URL(route.request().url()).searchParams.get('ds')
    const data = Object.prototype.hasOwnProperty.call(fixtures, ds) ? fixtures[ds] : []
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data,
        updatedAt: '2026-10-11T20:00:00Z',
        preview: true,
        lockedCount: 12,
        tier: 'free',
      }),
    })
  })
  await page.route('**/api/img**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'image/webp', body: Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AA/vuUAAA=', 'base64') })
  })
}

async function pageWidth(page) {
  return page.evaluate(() => Math.max(
    document.documentElement.scrollWidth,
    document.body ? document.body.scrollWidth : 0,
  ))
}

test.beforeEach(async ({ page }) => {
  await installFixtures(page)
})

for (const [name, path] of pages) {
  test(`${name} stays inside 390px`, async ({ page }) => {
    await page.goto(path, { waitUntil: 'load' })
    await page.waitForTimeout(600)
    const width = await pageWidth(page)
    expect(width, `${name} scrollWidth`).toBeLessThanOrEqual(390)
  })
}

test('nfl game markets stays inside 390px', async ({ page }) => {
  await page.goto('/?sport=nfl', { waitUntil: 'load' })
  await page.locator('.cg-menu-btn').click()
  await page.getByRole('button', { name: 'Game Markets' }).click()
  await page.waitForTimeout(400)
  const width = await pageWidth(page)
  expect(width, 'nfl game markets scrollWidth').toBeLessThanOrEqual(390)
})

for (const [sport, path, playerSelector] of boardShots) {
  test(`${sport} board screenshot and player page stay inside 390px`, async ({ page }, testInfo) => {
    await page.goto(path, { waitUntil: 'load' })
    await page.waitForTimeout(600)
    expect(await pageWidth(page), `${sport} board scrollWidth`).toBeLessThanOrEqual(390)
    if (testInfo.project.name === 'iphone-safari') {
      await mkdir('phone-screenshots', { recursive: true })
      await page.screenshot({ path: `phone-screenshots/${sport}-board.png`, fullPage: false })
    }
    const player = page.locator(playerSelector).first()
    await expect(player).toBeVisible()
    await player.click()
    await page.waitForTimeout(400)
    expect(await pageWidth(page), `${sport} player scrollWidth`).toBeLessThanOrEqual(390)
  })
}
