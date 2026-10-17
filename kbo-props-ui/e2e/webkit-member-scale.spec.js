import { mkdirSync } from 'node:fs'
import { expect, test, devices } from '@playwright/test'

const recent = [70, 80, 55, 90, 60, 75, 88, 40, 95, 62, 71, 83]
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
    dvpRank: 4,
    line_type: 'standard',
  }],
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
    dvpRank: 3,
    oddsType: 'standard',
  }],
  prizepicks_props: {
    cards: [{
      name: 'Kim Do-yeong',
      team: 'KIA',
      type: 'batter',
      opponent: 'LG',
      games: [],
      props: [{ stat: 'Hits', line: 1.5, projection: 1.8, hit_rate_l10: 70, odds_type: 'standard', recent_values: [2, 1, 0, 1, 2, 1, 3, 0, 1, 2] }],
    }],
  },
  wnba_projections_standard: [{
    name: 'Aja Wilson',
    player: 'Aja Wilson',
    team: 'LVA',
    position: 'Forward',
    avgMins: 32,
    projPts: 24,
    gp: 20,
    recentGames: [],
    ppAllProps: [{ stat: 'Points', line: 22.5, projection: 24, opponent: 'NYL' }],
  }],
  wnba_players: [{ name: 'Aja Wilson', team: 'LVA', position: 'F' }],
  nba_projections_standard: [],
  nba_players: [],
  nfl_sharp_odds: { records: [], status: 'ok' },
  nhl_sharp_odds: { records: [], status: 'ok' },
}

const pages = [
  ['hub', '/?previewTier=owner'],
  ['nhl-dashboard', '/?sport=nhl&previewTier=owner'],
  ['nfl-dashboard', '/?sport=nfl&previewTier=owner'],
  ['wnba-dashboard', '/?sport=wnba&previewTier=owner'],
  ['kbo-board', '/?sport=kbo&previewTier=owner'],
  ['nhl-board', '/?sport=nhl&page=projections&previewTier=owner'],
  ['nfl-board', '/?sport=nfl&page=projections&previewTier=owner'],
  ['wnba-board', '/?sport=wnba&page=projections&previewTier=owner'],
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

function measure() {
  const screenWidth = window.screen.width
  const offenders = []
  for (const el of document.querySelectorAll('*')) {
    const style = getComputedStyle(el)
    if (style.display === 'none' || style.visibility === 'hidden') continue
    const rect = el.getBoundingClientRect()
    const scrolls = el.scrollWidth > el.clientWidth + 1 && el.scrollWidth > screenWidth
    const pastScreen = rect.width > 0 && rect.right > screenWidth + 1
    if (scrolls || pastScreen) {
      offenders.push(`${el.tagName}.${String(el.className || '').slice(0, 48)} right=${Math.round(rect.right)} scroll=${el.scrollWidth}/${el.clientWidth}`)
    }
  }
  const meta = document.querySelector('meta[name="viewport"]')
  return {
    inner: window.innerWidth,
    scroll: document.documentElement.scrollWidth,
    screen: screenWidth,
    scale: window.visualViewport ? window.visualViewport.scale : 1,
    viewport: meta ? meta.getAttribute('content') : '',
    cards: document.querySelectorAll('[data-testid="prop-line-card"]').length,
    tables: document.querySelectorAll('[data-testid="prop-line-table"]').length,
    offenders,
  }
}

test.beforeEach(async ({ page }) => {
  await installFixtures(page)
})

test('a wide layout viewport still keeps member boards inside the phone screen', async ({ page }) => {
  for (const [name, path] of pages) {
    await page.goto(path)
    await page.waitForTimeout(400)
    const box = await page.evaluate(measure)
    expect(box.scale, name).toBeGreaterThan(0.95)
    expect(box.scale, name).toBeLessThan(1.05)
    expect(box.scroll, name).toBeLessThanOrEqual(box.inner + 1)
    expect(box.offenders, `${name} overflows the ${box.screen}px screen`).toEqual([])
    expect(box.tables, name).toBe(0)
    expect(box.viewport, name).toContain('width=device-width')
    expect(box.viewport, name).toContain('initial-scale=1')
    expect(box.viewport, name).not.toContain('viewport-fit')
  }
})

test('the free preview banner sits above the prop chips', async ({ page }) => {
  await page.goto('/?sport=nfl')
  const banner = page.locator('.ff-preview-bar')
  const chip = page.getByRole('button', { name: 'All Props' }).first()
  await expect(banner).toBeVisible()
  await expect(chip).toBeVisible()
  const overlap = await page.evaluate(() => {
    const bar = document.querySelector('.ff-preview-bar').getBoundingClientRect()
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === 'All Props')
    const chipBox = button.getBoundingClientRect()
    return bar.bottom > chipBox.top + 1 && bar.top < chipBox.bottom - 1
  })
  expect(overlap).toBe(false)
})

test('WebKit at the iPhone screen stays at scale 1', async ({ browser }) => {
  const context = await browser.newContext({
    ...devices['iPhone 15'],
    isMobile: true,
    hasTouch: true,
    baseURL: 'http://127.0.0.1:5173',
  })
  const page = await context.newPage()
  await installFixtures(page)
  await page.goto('/?sport=nhl&previewTier=owner')
  await expect(page.getByTestId('prop-line-card').first()).toBeVisible()
  const box = await page.evaluate(measure)
  expect(box.scale).toBeGreaterThan(0.95)
  expect(box.scale).toBeLessThan(1.05)
  expect(box.scroll).toBeLessThanOrEqual(box.screen + 1)
  expect(box.offenders).toEqual([])
  expect(box.tables).toBe(0)
  mkdirSync('webkit-screenshots', { recursive: true })
  await page.screenshot({ path: 'webkit-screenshots/nhl-member-phone.png' })
  await context.close()
})
