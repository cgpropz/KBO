import { expect, test } from '@playwright/test'

const rows = [
  {
    id: 'over',
    player: 'Over Skater',
    team: 'EDM',
    opponent: 'CGY',
    position: 'F',
    prop: 'Shots On Goal',
    line: 1.5,
    projection: 3,
    hitRate: 80,
    gamesL10: 10,
    home: false,
    dvpRank: 30,
    oddsType: 'standard',
  },
  {
    id: 'under',
    player: 'Under Skater',
    team: 'TOR',
    opponent: 'BOS',
    position: 'D',
    prop: 'Points',
    line: 1.5,
    projection: 0.4,
    hitRate: 40,
    gamesL10: 4,
    home: true,
    dvpRank: 16,
    oddsType: 'standard',
  },
  {
    id: 'goalie',
    player: 'Goalie Mask',
    team: 'STL',
    opponent: 'WPG',
    position: 'G',
    prop: 'Goalie Saves',
    line: 24.5,
    projection: 28,
    hitRate: 90,
    gamesL10: 8,
    home: false,
    dvpRank: 1,
    oddsType: 'standard',
  },
  {
    id: 'even',
    player: 'Even Skater',
    team: 'EDM',
    opponent: 'CGY',
    position: 'F',
    prop: 'Power Play Points',
    line: 0.5,
    projection: 0.5,
    hitRate: null,
    gamesL10: 0,
    home: false,
    dvpRank: 30,
    oddsType: 'standard',
  },
]

async function installFixtures(page) {
  await page.route('**/api/data**', async (route) => {
    const ds = new URL(route.request().url()).searchParams.get('ds')
    const data = ds === 'nhl_projections' ? rows : ds === 'nhl_sharp_odds' ? { records: [], status: 'ok' } : []
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data,
        updatedAt: '2026-10-27T20:00:00Z',
        preview: false,
        lockedCount: 0,
        tier: 'owner',
      }),
    })
  })
  const pixel = { status: 200, contentType: 'image/webp', body: Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AA/vuUAAA=', 'base64') }
  await page.route('**/api/img**', (route) => route.fulfill(pixel))
  await page.route('https://a.espncdn.com/**', (route) => route.fulfill(pixel))
  await page.route('https://assets.nhle.com/**', (route) => route.fulfill(pixel))
}

test.beforeEach(async ({ page }) => {
  await installFixtures(page)
})

test('NHL prop lines filters match the other sports on a phone', async ({ page }) => {
  const viewport = page.viewportSize()
  expect(viewport.width).toBe(390)
  await page.goto('/?sport=nhl&previewTier=owner', { waitUntil: 'load' })
  const player = (name) => page.locator('.nfl-player-link', { hasText: name })
  await expect(page.getByRole('heading', { name: 'Prop Lines' })).toBeVisible()
  await expect(player('Over Skater')).toBeVisible()
  await expect(player('Under Skater')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Goalie Saves', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /Face Off/i })).toHaveCount(0)

  await page.getByTestId('nhl-filters-open').click()
  const panel = page.getByTestId('nhl-filters-panel')
  await expect(panel).toBeVisible()
  const panelBox = await panel.evaluate((el) => {
    const rect = el.getBoundingClientRect()
    return { top: rect.top, left: rect.left, bottom: rect.bottom, right: rect.right, height: rect.height }
  })
  expect(panelBox.top).toBeGreaterThanOrEqual(0)
  expect(panelBox.left).toBeGreaterThanOrEqual(0)
  expect(panelBox.right).toBeLessThanOrEqual(viewport.width + 1)
  expect(panelBox.bottom).toBeLessThanOrEqual(viewport.height + 1)
  expect(panelBox.height).toBeGreaterThan(200)
  await expect(panel.getByRole('button', { name: /^Show 4 lines$/ })).toBeInViewport()

  await panel.getByRole('button', { name: 'Unders', exact: true }).click()
  const showUnder = panel.getByRole('button', { name: /^Show 1 line$/ })
  await expect(showUnder).toBeVisible()
  await showUnder.click()
  await expect(panel).toHaveCount(0)
  await expect(player('Under Skater')).toBeVisible()
  await expect(player('Over Skater')).toHaveCount(0)

  await page.getByRole('button', { name: 'Shots On Goal', exact: true }).click()
  await expect(page.getByText('No lines match these filters.')).toBeVisible()
  await page.getByRole('button', { name: 'All Props', exact: true }).click()

  await page.getByTestId('nhl-filters-open').click()
  await panel.getByRole('button', { name: 'Reset', exact: true }).click()
  await panel.getByRole('button', { name: /^Positions/ }).click()
  await panel.getByRole('group', { name: 'Positions' }).getByRole('button', { name: 'G', exact: true }).click()
  await expect(panel.getByRole('button', { name: /^Show 1 line$/ })).toBeVisible()
  await panel.getByRole('button', { name: /^Show 1 line$/ }).click()
  await expect(player('Goalie Mask')).toBeVisible()
  await expect(player('Over Skater')).toHaveCount(0)

  const fit = await page.evaluate(() => ({
    scrollWidth: Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0),
    innerWidth: window.innerWidth,
  }))
  expect(fit.scrollWidth).toBeLessThanOrEqual(fit.innerWidth + 1)
})

test('NHL board search, matchup, and filters use the same rows', async ({ page }) => {
  await page.goto('/?sport=nhl&page=projections&previewTier=owner', { waitUntil: 'load' })
  await expect(page.getByRole('heading', { name: 'Board' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Over Skater' })).toBeVisible()
  await page.getByLabel('Matchup').first().selectOption('EDM @ CGY')
  await expect(page.getByRole('heading', { name: 'Over Skater' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Even Skater' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Goalie Mask' })).toHaveCount(0)
  await page.getByLabel('Search player').fill('even')
  await expect(page.getByRole('heading', { name: 'Even Skater' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Over Skater' })).toHaveCount(0)

  await page.getByTestId('nhl-filters-open').click()
  const panel = page.getByTestId('nhl-filters-panel')
  await panel.getByRole('button', { name: /^Team/ }).click()
  await panel.getByTestId('nhl-filter-team').selectOption('STL')
  await expect(panel.getByRole('button', { name: /^Show 0 lines$/ })).toBeVisible()
  await panel.getByRole('button', { name: 'Reset', exact: true }).click()
  await expect(panel.getByRole('button', { name: /^Show 1 line$/ })).toBeVisible()
})
