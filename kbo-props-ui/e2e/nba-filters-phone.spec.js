import { expect, test } from '@playwright/test'

// 390px iPhone viewport on the dev server, owner preview, synthetic rows.
// The production phone-width bundle keeps NBA closed for logged-out visitors,
// so this check lives with the dev mobile project.

const stats = ['Points', 'Rebounds', 'Assists']

function player(index, { name, avgMins, props }) {
  return {
    athleteId: String(index),
    name,
    team: 'DEN',
    position: 'C',
    gp: 10,
    avgMins,
    ppAllProps: (props || stats).map((stat) => ({
      stat,
      line: 10.5,
      projection: name === 'High Score' ? 28 : 12.2,
      opponent: 'LAL',
      effectiveDvpRank: 12,
      hitRates: { L10: 60, FULL: 55 },
    })),
  }
}

const players = [
  player(0, { name: 'High Score', avgMins: 12, props: ['Points'] }),
  player(1, { name: 'High Minutes', avgMins: 36.2, props: ['Points', 'Rebounds'] }),
  player(2, { name: 'Thirty Line', avgMins: 29.5, props: ['Points'] }),
  player(3, { name: 'Twenty Line', avgMins: 19.6, props: ['Points'] }),
  player(4, { name: 'Low Minutes', avgMins: 19.4, props: ['Points'] }),
  player(5, { name: 'No Minutes', avgMins: null, props: ['Points'] }),
  ...Array.from({ length: 18 }, (_, index) => player(index + 6, {
    name: `Bench ${index + 1}`,
    avgMins: 22 + (index % 5),
    props: ['Points'],
  })),
]

async function installFixtures(page) {
  await page.route('**/api/data**', async (route) => {
    const ds = new URL(route.request().url()).searchParams.get('ds')
    const data = ds === 'nba_projections_standard'
      ? players
      : ds === 'nba_sharp_odds'
        ? { records: [], status: 'ok' }
        : []
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data,
        updatedAt: '2026-10-11T20:00:00Z',
        preview: false,
        lockedCount: 0,
        tier: 'owner',
      }),
    })
  })
  await page.route('**/api/img**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'image/webp',
      body: Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AA/vuUAAA=', 'base64'),
    })
  })
}

function boxOf(locator) {
  return locator.evaluate((el) => {
    const rect = el.getBoundingClientRect()
    return { top: rect.top, left: rect.left, width: rect.width, height: rect.height, bottom: rect.bottom, right: rect.right }
  })
}

test('NBA filters panel opens on screen at 390px and minutes compose with a stat chip', async ({ page }) => {
  const viewport = page.viewportSize()
  expect(viewport.width).toBe(390)
  await installFixtures(page)
  await page.goto('/?sport=nba&previewTier=owner', { waitUntil: 'load' })
  await expect(page.getByRole('heading', { name: 'Prop Lines' })).toBeVisible()
  await expect(page.locator('.wnba-player-link').first()).toHaveText('High Score')

  await page.getByRole('button', { name: 'Filters', exact: true }).click()
  const panel = page.getByTestId('nba-filters-panel')
  await expect(panel).toBeVisible()
  const panelBox = await boxOf(panel)
  expect(panelBox.top).toBeGreaterThanOrEqual(0)
  expect(panelBox.left).toBeGreaterThanOrEqual(0)
  expect(panelBox.bottom).toBeLessThanOrEqual(viewport.height + 1)
  expect(panelBox.right).toBeLessThanOrEqual(viewport.width + 1)
  expect(panelBox.height).toBeGreaterThan(200)

  const heading = panel.getByRole('heading', { name: 'Filters' })
  const close = panel.getByRole('button', { name: 'Close' })
  const show = panel.getByRole('button', { name: /^Show \d+ lines$/ })
  await expect(heading).toBeInViewport({ ratio: 1 })
  await expect(close).toBeInViewport({ ratio: 1 })
  await expect(show).toBeInViewport({ ratio: 1 })

  const hit = await heading.evaluate((el) => {
    const rect = el.getBoundingClientRect()
    const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    return el.contains(target)
  })
  expect(hit).toBe(true)

  await panel.getByRole('button', { name: /^Minutes/ }).click()
  const thirty = panel.getByRole('group', { name: 'Minutes' }).getByRole('button', { name: '30+', exact: true })
  await expect(thirty).toBeInViewport({ ratio: 1 })
  await thirty.click()
  await expect(show).toHaveText('Show 3 lines')

  await panel.getByRole('button', { name: /^Sort By/ }).click()
  await panel.getByLabel('Sort by').selectOption('Minutes high to low')
  await show.click()
  await expect(panel).toHaveCount(0)

  const header = page.locator('.wnba-lines-header-actions')
  await expect(header).toContainText('3 lines')
  await expect(header).toContainText('sorted by Minutes high to low')
  await expect(page.locator('.wnba-player-link').first()).toHaveText('High Minutes')
  await expect(page.getByRole('button', { name: 'No Minutes' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Twenty Line' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Rebounds', exact: true }).click()
  await expect(header).toContainText('1 line')
  await expect(page.locator('.wnba-player-link').first()).toHaveText('High Minutes')
  await expect(page.getByRole('button', { name: 'Thirty Line' })).toHaveCount(0)

  const fit = await page.evaluate(() => ({
    scrollWidth: Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0),
    innerWidth: window.innerWidth,
  }))
  expect(fit.scrollWidth).toBeLessThanOrEqual(fit.innerWidth)
})

function rangedPlayer(index, { name, avgMins, projection, props }) {
  return {
    athleteId: String(index),
    name,
    team: 'DEN',
    position: 'C',
    gp: 10,
    avgMins,
    ppAllProps: (props || ['Points']).map((stat) => ({
      stat,
      line: 10.5,
      projection,
      opponent: 'LAL',
      effectiveDvpRank: 12,
      hitRates: { L10: 60, FULL: 55 },
    })),
  }
}

const rangedPlayers = [
  rangedPlayer(0, { name: 'High Score', avgMins: 12, projection: 28, props: ['Points'] }),
  rangedPlayer(1, { name: 'High Minutes', avgMins: 36.2, projection: 16, props: ['Points', 'Rebounds'] }),
  rangedPlayer(2, { name: 'Mid Band', avgMins: 32, projection: 13, props: ['Points'] }),
  rangedPlayer(3, { name: 'Thirty Line', avgMins: 29.5, projection: 11, props: ['Points'] }),
  rangedPlayer(4, { name: 'Low Score', avgMins: 33, projection: 8, props: ['Points'] }),
  rangedPlayer(5, { name: 'Twenty Line', avgMins: 19.6, projection: 12.2, props: ['Points'] }),
  rangedPlayer(6, { name: 'No Minutes', avgMins: null, projection: 12.2, props: ['Points'] }),
]

test('CG Score min and max combine with minutes, sort, and a stat chip', async ({ page }) => {
  expect(page.viewportSize().width).toBe(390)
  await page.route('**/api/data**', async (route) => {
    const ds = new URL(route.request().url()).searchParams.get('ds')
    const data = ds === 'nba_projections_standard'
      ? rangedPlayers
      : ds === 'nba_sharp_odds'
        ? { records: [], status: 'ok' }
        : []
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data,
        updatedAt: '2026-10-11T20:00:00Z',
        preview: false,
        lockedCount: 0,
        tier: 'owner',
      }),
    })
  })
  await page.route('**/api/img**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'image/webp',
      body: Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AA/vuUAAA=', 'base64'),
    })
  })
  await page.goto('/?sport=nba&previewTier=owner', { waitUntil: 'load' })
  await expect(page.locator('.wnba-player-link').first()).toHaveText('High Score')

  await page.getByRole('button', { name: 'Filters', exact: true }).tap()
  const panel = page.getByTestId('nba-filters-panel')
  await expect(panel).toBeVisible()
  const viewport = page.viewportSize()
  const panelBox = await boxOf(panel)
  expect(panelBox.top).toBeGreaterThanOrEqual(0)
  expect(panelBox.bottom).toBeLessThanOrEqual(viewport.height + 1)
  expect(panelBox.left).toBeGreaterThanOrEqual(0)
  expect(panelBox.right).toBeLessThanOrEqual(viewport.width + 1)

  await panel.getByRole('button', { name: /^CG Score/ }).tap()
  const minInput = panel.getByLabel('CG Score low bound')
  const maxInput = panel.getByLabel('CG Score high bound')
  await minInput.fill('150')
  await expect(minInput).toHaveValue('100')
  await maxInput.fill('80')
  await minInput.fill('60')
  await expect(minInput).toHaveValue('60')
  await expect(maxInput).toHaveValue('80')
  const show = panel.getByRole('button', { name: /^Show \d+ lines$/ })
  await expect(show).toHaveText('Show 3 lines')

  await maxInput.fill('')
  await expect(maxInput).toHaveValue('')
  await expect(show).toHaveText('Show 4 lines')
  await maxInput.fill('80')
  await expect(show).toHaveText('Show 3 lines')

  await panel.getByRole('button', { name: /^Minutes/ }).tap()
  await panel.getByRole('group', { name: 'Minutes' }).getByRole('button', { name: '30+', exact: true }).tap()
  await expect(show).toHaveText('Show 3 lines')

  await panel.getByRole('button', { name: /^Sort By/ }).tap()
  await panel.getByLabel('Sort by').selectOption('Minutes high to low')
  await show.tap()
  await expect(panel).toHaveCount(0)

  const header = page.locator('.wnba-lines-header-actions')
  await expect(header).toContainText('3 lines')
  await expect(header).toContainText('sorted by Minutes high to low')
  await expect(page.locator('.wnba-player-link').nth(0)).toHaveText('High Minutes')
  await expect(page.locator('.wnba-player-link').nth(2)).toHaveText('Mid Band')
  await expect(page.getByRole('button', { name: 'High Score', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Low Score', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Thirty Line', exact: true })).toHaveCount(0)

  await page.getByRole('button', { name: 'Rebounds', exact: true }).tap()
  await expect(header).toContainText('1 line')
  await expect(page.locator('.wnba-player-link')).toHaveText(['High Minutes'])

  await page.getByRole('button', { name: 'Filters', exact: true }).tap()
  await expect(panel).toBeVisible()
  await panel.getByRole('button', { name: /^CG Score/ }).tap()
  await expect(panel.getByLabel('CG Score low bound')).toHaveValue('60')
  await expect(panel.getByLabel('CG Score high bound')).toHaveValue('80')
  await panel.getByRole('button', { name: 'Reset', exact: true }).tap()
  await expect(panel.getByLabel('CG Score low bound')).toHaveValue('')
  await expect(panel.getByLabel('CG Score high bound')).toHaveValue('')
  await panel.getByRole('button', { name: /^Show \d+ / }).tap()

  await page.getByRole('button', { name: 'All Props', exact: true }).tap()
  await expect(header).toContainText('8 lines')
  await expect(page.locator('.wnba-player-link').first()).toHaveText('High Score')
  await expect(page.getByRole('button', { name: 'Low Score', exact: true })).toHaveCount(1)
})
