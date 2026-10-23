import { expect, test } from '@playwright/test'

// 390px Players list on the dev server, owner preview, synthetic rows only.

function logs(points) {
  return points.map((pts, index) => ({
    date: `10/${21 - index}/2026`, team: 'DEN', matchup: 'DEN vs. LAL', season: '2027',
    min: 32 - index, pts, reb: 6, ast: 4, stl: 1, blk: 1, tov: 2, fg3m: 2,
  }))
}

const roster = [
  { athleteId: '1', name: 'Synth Guard', team: 'DEN', teamColor: '#0e2240', position: 'PG', gp: 70, pts: 21.4, reb: 4.1, ast: 7.2, gameLogs: logs([25, 22, 18, 30, 24, 19, 27, 21, 26, 23]) },
  { athleteId: '2', name: 'Synth Center', team: 'LAL', teamColor: '#552583', position: 'C', gp: 64, pts: 12.2, reb: 10.5, ast: 2.1, summaryTeam: 'BOS', gameLogs: logs([10, 14, 9, 12, 8, 11, 13, 7, 12, 10]) },
  { athleteId: '3', name: 'Synth Bench', team: 'MIA', teamColor: '#98002e', position: 'SF', gp: 0, gameLogs: [] },
]

const board = [
  { athleteId: '1', name: 'Synth Guard', team: 'DEN', ppAllProps: [{ stat: 'Points', line: 20.5, projection: 25, opponent: 'LAL' }] },
  { athleteId: '2', name: 'Synth Center', team: 'LAL', ppAllProps: [{ stat: 'Rebounds', line: 9.5, projection: 11, opponent: 'DEN' }] },
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

test('NBA Players list fits 390px, filters, sorts, and opens a profile', async ({ page }) => {
  expect(page.viewportSize().width).toBe(390)
  await installFixtures(page)
  await page.goto('/?sport=nba&nbaTab=players&previewTier=owner', { waitUntil: 'load' })

  const cards = page.getByTestId('nba-player-card')
  // Game day: Playing today starts on, so the player with no game is hidden.
  await expect(cards).toHaveCount(2)
  await expect(page.getByRole('switch', { name: 'Playing today' })).toHaveAttribute('aria-checked', 'true')
  await expect(cards.first()).toContainText('Synth Guard')
  await expect(cards.first()).toContainText('vs LAL')
  await expect(cards.first()).toContainText('L10')
  await expect(cards.nth(1)).toContainText('@ DEN')
  await expect(cards.nth(1)).toContainText('BOS')

  // No player without a slot, so there is no Unset chip.
  await expect(page.locator('.nba-plist-chip', { hasText: 'Unset' })).toHaveCount(0)

  await page.getByRole('switch', { name: 'Playing today' }).click()
  await expect(cards).toHaveCount(3)

  await page.getByLabel('Sort by').selectOption('name')
  await expect(cards.first()).toContainText('Synth Bench')

  await page.locator('.nba-plist-chip', { hasText: 'C' }).first().click()
  await expect(cards).toHaveCount(1)
  await expect(cards.first()).toContainText('Synth Center')

  const fit = await page.evaluate(() => {
    const card = document.querySelector('[data-testid="nba-player-card"]').getBoundingClientRect()
    return {
      scrollWidth: Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0),
      innerWidth: window.innerWidth,
      cardRight: card.right,
      cardHeight: card.height,
    }
  })
  expect(fit.scrollWidth).toBeLessThanOrEqual(fit.innerWidth)
  expect(fit.cardRight).toBeLessThanOrEqual(fit.innerWidth)
  expect(fit.cardHeight).toBeLessThan(90)

  await cards.first().click()
  await expect(page.getByRole('heading', { name: 'Synth Center' })).toBeVisible()
  await expect(page.getByRole('button', { name: '← Players' })).toBeVisible()
})
