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
