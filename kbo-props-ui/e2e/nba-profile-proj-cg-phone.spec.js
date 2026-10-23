import { expect, test } from '@playwright/test'

// 390px NBA profile header: today's projection and CG Score beside the
// PrizePicks line, following the stat chip, and Pending when the board has
// no projection or no line. Dev server, owner preview, synthetic rows only.

function logs(points) {
  return points.map((pts, index) => ({
    date: `10/${21 - index}/2026`, team: 'DEN', matchup: 'DEN vs. LAL', season: '2027',
    min: 32 - index, usg: 20 + (index % 3), pts, reb: 6 + (index % 3), ast: 4, stl: 1, blk: 1, tov: 2, fg3m: 2,
  }))
}

const roster = [
  { athleteId: '1', name: 'Synth Guard', team: 'DEN', teamColor: '#0e2240', position: 'PG', gp: 70, pts: 21.4, reb: 4.1, ast: 7.2, gameLogs: logs([25, 22, 18, 30, 24, 19, 27, 21, 26, 23]) },
  { athleteId: '2', name: 'Synth Rookie', team: 'LAL', teamColor: '#552583', position: 'C', gp: 0, gameLogs: logs([10, 14]) },
  { athleteId: '3', name: 'Synth Bench', team: 'DEN', teamColor: '#0e2240', position: 'SF', gp: 50, pts: 6.1, reb: 3, ast: 1, gameLogs: logs([6, 4, 8]) },
]

const board = [
  { athleteId: '1', name: 'Synth Guard', team: 'DEN', ppAllProps: [
    { stat: 'Points', line: 20.5, projection: 25, opponent: 'LAL' },
    { stat: 'Rebounds', line: 6.5, projection: 5.2, opponent: 'LAL' },
  ] },
  // Held blank early in the season: a line, no projection yet.
  { athleteId: '2', name: 'Synth Rookie', team: 'LAL', ppAllProps: [{ stat: 'Points', line: 11.5, projection: '', opponent: 'DEN' }] },
]

const scoreboard = {
  events: [{
    date: '2026-10-23T23:30Z',
    status: { type: { state: 'pre' } },
    competitions: [{
      date: '2026-10-23T23:30Z',
      competitors: [
        { homeAway: 'home', team: { abbreviation: 'DEN' } },
        { homeAway: 'away', team: { abbreviation: 'LAL' } },
      ],
    }],
  }],
}

async function installFixtures(page) {
  await page.route('**/api/data**', async (route) => {
    const ds = new URL(route.request().url()).searchParams.get('ds')
    const data = ds === 'nba_players' ? roster : ds === 'nba_projections_standard' ? board : []
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data, updatedAt: '2026-10-23T12:00:00Z', preview: false, lockedCount: 0, tier: 'owner' }),
    })
  })
  await page.route('**/data/nba/*.json', async (route) => {
    const url = route.request().url()
    const data = url.includes('players.json') ? roster : url.includes('projections_standard') ? board : []
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
  })
  await page.route('https://site.api.espn.com/**', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(scoreboard),
  }))
  await page.route('**/api/img**', (route) => route.fulfill({
    status: 200,
    contentType: 'image/webp',
    body: Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AA/vuUAAA=', 'base64'),
  }))
}

async function openProfile(page, name) {
  await page.getByTestId('nba-player-card').filter({ hasText: name }).click()
  await expect(page.getByRole('heading', { name })).toBeVisible()
}

async function noOverflow(page) {
  const width = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth))
  expect(width).toBeLessThanOrEqual(390)
}

test('profile header shows projection and CG Score for the selected stat at 390px', async ({ page }) => {
  expect(page.viewportSize().width).toBe(390)
  await installFixtures(page)
  await page.goto('/?sport=nba&nbaTab=players&previewTier=owner', { waitUntil: 'load' })

  const cards = page.getByTestId('nba-player-card')
  await expect(cards).toHaveCount(3)
  // List card top prop carries the same projection and CG Score, under the height cap.
  const guardCard = cards.filter({ hasText: 'Synth Guard' })
  await expect(guardCard.getByTestId('nba-plist-prop-pick')).toHaveText(/^\s*25\.0\s*CG\s*61\.0\s*$/)
  await expect(cards.filter({ hasText: 'Synth Rookie' }).getByTestId('nba-plist-prop-pick')).toHaveCount(0)
  const heights = await cards.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height))
  // Same row cap as the Players list spec (MIN / USG row included).
  for (const height of heights) expect(height).toBeLessThan(125)
  await noOverflow(page)

  await openProfile(page, 'Synth Guard')
  const chart = page.locator('.nba-player-chart-card')
  const projection = chart.getByTestId('nba-player-projection')
  const cg = chart.getByTestId('nba-player-cg')
  await expect(chart).toContainText('20.5 Points')
  await expect(projection).toHaveText('25.0')
  await expect(cg).toHaveText('61.0')
  await expect(cg).toHaveClass(/is-over/)

  await chart.getByRole('button', { name: 'Rebounds', exact: true }).click()
  await expect(chart).toContainText('6.5 Rebounds')
  await expect(projection).toHaveText('5.2')
  await expect(cg).toHaveText('40.0')
  await expect(cg).toHaveClass(/is-under/)

  // The season pill names the season.
  const ranges = chart.locator('.nba-player-ranges')
  await expect(ranges).toContainText("'26-27")
  await expect(ranges).not.toContainText('Season')

  const pick = await chart.getByTestId('nba-player-pick').evaluate((el) => {
    const r = el.getBoundingClientRect()
    return { right: r.right, left: r.left }
  })
  expect(pick.left).toBeGreaterThanOrEqual(0)
  expect(pick.right).toBeLessThanOrEqual(390)
  await noOverflow(page)
})

test('blank projection and no line show Pending, never 0 or NaN', async ({ page }) => {
  await installFixtures(page)
  await page.goto('/?sport=nba&nbaTab=players&previewTier=owner', { waitUntil: 'load' })
  await expect(page.getByTestId('nba-player-card')).toHaveCount(3)

  await openProfile(page, 'Synth Rookie')
  let chart = page.locator('.nba-player-chart-card')
  await expect(chart).toContainText('11.5 Points')
  await expect(chart.getByTestId('nba-player-projection')).toHaveText('Pending')
  await expect(chart.getByTestId('nba-player-cg')).toHaveText('Pending')
  await expect(chart).not.toContainText(/NaN|\b0\.0\b|CG Score 0/)
  await expect(chart.locator('.cg-score-note')).toHaveCount(0)
  await noOverflow(page)

  await page.getByRole('button', { name: '← Players' }).click()
  await openProfile(page, 'Synth Bench')
  chart = page.locator('.nba-player-chart-card')
  await expect(chart).toContainText('No line today')
  // No line today keeps both: the header card and Minutes & Usage.
  await expect(page.locator('section[aria-label="Today\'s line"]')).toBeVisible()
  const mu = page.getByTestId('nba-minutes-usage')
  await expect(mu).toBeVisible()
  await expect(mu.getByTestId('nba-mu-min').locator('.nba-mu-col')).toHaveCount(3)
  await expect(mu.getByTestId('nba-mu-usg').locator('.nba-mu-col')).toHaveCount(3)
  await expect(chart.getByTestId('nba-player-projection')).toHaveText('Pending')
  await expect(chart.getByTestId('nba-player-cg')).toHaveText('Pending')
  await expect(chart).not.toContainText(/NaN|\b0\.0\b/)
  await noOverflow(page)
})
