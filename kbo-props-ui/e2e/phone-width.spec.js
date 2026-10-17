import { expect, test } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { PHONE_BOARD_QUERY } from '../src/phoneBoardQuery.js'

const recent = [70, 80, 55, 90, 60, 75, 88, 40, 95, 62, 71, 83]
const seasons = Array(12).fill(2026)
const opponents = ['DAL', 'NYG', 'PHI', 'WAS', 'DAL', 'NYG', 'PHI', 'WAS', 'DAL', 'NYG', 'PHI', 'WAS']
const wnbaGames = Array.from({ length: 10 }, (_, index) => ({
  date: `2026-09-${String(index + 1).padStart(2, '0')}`,
  opponent: 'NYL',
  pts: 20 + index,
  reb: 8,
  ast: 3,
  ftm: 4 + (index % 3),
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
    ppAllProps: [
      { stat: 'Points', line: 22.5, projection: 24, opponent: 'NYL' },
      { stat: 'Free Throws Made', line: 4.5, projection: 5, opponent: 'NYL' },
    ],
    image: 'https://a.espncdn.com/i/headshots/wnba/players/full/3149391.png',
  }, {
    name: 'No Log',
    player: 'No Log',
    team: 'NYL',
    position: 'Guard',
    projPts: 20,
    gp: 0,
    recentGames: [],
    ppAllProps: [{ stat: 'Points', line: 18.5, projection: 20, opponent: 'LVA' }],
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

async function expectFits(page, label) {
  const box = await page.evaluate(() => ({
    scrollWidth: Math.max(
      document.documentElement.scrollWidth,
      document.body ? document.body.scrollWidth : 0,
    ),
    innerWidth: window.innerWidth,
  }))
  expect(box.scrollWidth, `${label} scrollWidth`).toBeLessThanOrEqual(box.innerWidth)
  return box
}

function touchProject(testInfo) {
  return testInfo.project.use.isMobile === true && testInfo.project.use.hasTouch === true
}

test.beforeEach(async ({ page }) => {
  await installFixtures(page)
})

for (const [name, path] of pages) {
  test(`${name} stays inside the viewport`, async ({ page }) => {
    await page.goto(path, { waitUntil: 'load' })
    await page.waitForTimeout(600)
    await expectFits(page, name)
  })
}

test('nfl game markets stays inside the viewport', async ({ page }) => {
  await page.goto('/?sport=nfl', { waitUntil: 'load' })
  // The phone menu mounts with the shell. click() waits for it. A desktop
  // window already shows the link, so a hidden menu is not an error.
  const menu = page.locator('.cg-menu-btn')
  if (await menu.waitFor({ state: 'visible', timeout: 3000 }).then(() => true, () => false)) await menu.click()
  await page.getByRole('button', { name: 'Game Markets' }).click()
  await page.waitForTimeout(400)
  await expectFits(page, 'nfl game markets')
})

for (const [sport, path, playerSelector] of boardShots) {
  test(`${sport} board screenshot and player page stay inside the viewport`, async ({ page }, testInfo) => {
    await page.goto(path, { waitUntil: 'load' })
    await page.waitForTimeout(600)
    await expectFits(page, `${sport} board`)
    if (testInfo.project.name === 'iphone-safari') {
      await mkdir('phone-screenshots', { recursive: true })
      await page.screenshot({ path: `phone-screenshots/${sport}-board.png`, fullPage: false })
    }
    const player = page.locator(playerSelector).first()
    await expect(player).toBeVisible()
    await player.click()
    await page.waitForTimeout(400)
    await expectFits(page, `${sport} player`)
  })
}

const fitSurfaces = [
  ['hub', '/'],
  ['nfl-dashboard', '/?sport=nfl'],
  ['nhl-dashboard', '/?sport=nhl'],
  ['nfl-board', '/?sport=nfl&page=projections'],
  ['nhl-board', '/?sport=nhl&page=projections'],
  ['kbo-board', '/?sport=kbo'],
  ['wnba-dashboard', '/?sport=wnba'],
  ['nba-dashboard', '/?sport=nba'],
]

for (const [name, path] of fitSurfaces) {
  test(`${name} is no wider than the viewport`, async ({ page }, testInfo) => {
    await page.goto(path, { waitUntil: 'load' })
    await page.waitForTimeout(600)
    const box = await expectFits(page, name)
    const touch = touchProject(testInfo)
    const dashboard = name === 'nfl-dashboard' || name === 'nhl-dashboard' || name === 'kbo-board' || name === 'wnba-dashboard' || name === 'nba-dashboard'
    if (!dashboard) return
    if (touch) {
      await expect(page.getByTestId('prop-line-card').first(), `${name} cards`).toBeVisible()
      await expect(page.getByTestId('prop-line-table')).toHaveCount(0)
      return
    }
    expect(box.innerWidth, `${name} desktop width`).toBeGreaterThan(767)
    await expect(page.getByTestId('prop-line-table'), `${name} table`).toBeVisible()
    await expect(page.getByTestId('prop-line-card')).toHaveCount(0)
  })
}

test('desktop-site iPhone keeps a 980px layout and coarse pointer', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone-desktop-site', 'desktop-site project only')
  await page.goto('/?sport=nfl', { waitUntil: 'load' })
  const info = await page.evaluate((query) => ({
    innerWidth: window.innerWidth,
    phone: window.matchMedia(query).matches,
    coarse: window.matchMedia('(hover: none) and (pointer: coarse)').matches,
    device: window.matchMedia('(max-device-width: 932px)').matches,
  }), PHONE_BOARD_QUERY)
  expect(info.innerWidth).toBe(980)
  expect(info.coarse).toBe(true)
  expect(info.device).toBe(true)
  expect(info.phone).toBe(true)
})

test('a desktop window from 768 to 1200 does not grow the page', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone-safari', 'once per run')
  const widths = [780, 980, 1100]
  const paths = [
    ['hub', '/'],
    ['nfl-dashboard', '/?sport=nfl'],
    ['nhl-dashboard', '/?sport=nhl'],
    ['nfl-board', '/?sport=nfl&page=projections'],
    ['nhl-board', '/?sport=nhl&page=projections'],
    ['kbo-board', '/?sport=kbo'],
    ['wnba-dashboard', '/?sport=wnba'],
  ]
  for (const width of widths) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      screen: { width: 1440, height: 900 },
      isMobile: false,
      hasTouch: false,
    })
    const page = await context.newPage()
    await installFixtures(page)
    for (const [name, path] of paths) {
      await page.goto(path, { waitUntil: 'load' })
      await page.waitForTimeout(400)
      const box = await page.evaluate((query) => ({
        scrollWidth: Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0),
        innerWidth: window.innerWidth,
        phone: window.matchMedia(query).matches,
      }), PHONE_BOARD_QUERY)
      expect(box.phone, `${name} at ${width} stays a desktop`).toBe(false)
      expect(box.scrollWidth, `${name} at ${width} scrollWidth`).toBeLessThanOrEqual(box.innerWidth)
    }
    await expect(page.getByTestId('prop-line-table')).toBeVisible()
    await expect(page.getByTestId('prop-line-card')).toHaveCount(0)
    await context.close()
  }
})

test('WNBA phone cards match the other sports and chart the game log', async ({ page }) => {
  async function cardWidth(path) {
    await page.goto(path, { waitUntil: 'load' })
    const card = page.getByTestId('prop-line-card').first()
    await expect(card).toBeVisible()
    return card.evaluate((el) => el.getBoundingClientRect().width)
  }

  const nfl = await cardWidth('/?sport=nfl')
  const nhl = await cardWidth('/?sport=nhl')
  const wnba = await cardWidth('/?sport=wnba')
  expect(Math.abs(wnba - nfl)).toBeLessThanOrEqual(2)
  expect(Math.abs(wnba - nhl)).toBeLessThanOrEqual(2)

  const ftm = page.getByTestId('prop-line-card').filter({ hasText: 'Free Throws Made' })
  await expect(ftm).toBeVisible()
  const lineCount = await ftm.locator('.wnba-lines-line').evaluate((el) => {
    const range = document.createRange()
    range.selectNodeContents(el)
    return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size
  })
  expect(lineCount).toBeGreaterThan(0)
  expect(lineCount).toBeLessThanOrEqual(2)
  await expect(ftm.locator('.wnba-lines-chart span')).toHaveCount(10)
  await expect(page.getByText('No data')).toHaveCount(0)
  const empty = page.getByTestId('prop-line-card').filter({ hasText: 'No Log' })
  await expect(empty.locator('.hit-rate-chart')).toHaveCount(0)

  const clear = await page.evaluate(() => {
    const overlaps = (a, b) => a.width > 0 && b.width > 0
      && a.left < b.right - 1 && a.right > b.left + 1
      && a.top < b.bottom - 1 && a.bottom > b.top + 1
    return [...document.querySelectorAll('[data-testid="prop-line-card"]')].every((card) => {
      const toggle = card.querySelector('.nfl-odds-toggle')?.getBoundingClientRect()
      const score = card.querySelector('.cg-score-cell')?.getBoundingClientRect()
      return !toggle || !score || !overlaps(toggle, score)
    })
  })
  expect(clear).toBe(true)

  await page.getByRole('button', { name: 'Filters' }).click()
  await page.getByRole('button', { name: /Sort By/ }).click()
  await page.locator('.wnba-filters-apply').evaluate((el) => el.scrollIntoView({ block: 'nearest' }))
  const filterFit = await page.evaluate(() => {
    const topIsToggle = (el) => {
      const box = el.getBoundingClientRect()
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
      return Boolean(hit?.closest('.nfl-odds-toggle'))
    }
    const panel = document.querySelector('.wnba-filters-panel')
    const panelBox = panel.getBoundingClientRect()
    const select = panel.querySelector('select')
    const apply = panel.querySelector('.wnba-filters-apply')
    const inside = (box) => box.top >= -1 && box.bottom <= window.innerHeight + 1 && box.height > 0
    return {
      panelInside: inside(panelBox),
      selectInside: inside(select.getBoundingClientRect()),
      applyInside: inside(apply.getBoundingClientRect()),
      toggleCoversSelect: topIsToggle(select),
      toggleCoversApply: topIsToggle(apply),
    }
  })
  expect(filterFit).toEqual({
    panelInside: true,
    selectInside: true,
    applyInside: true,
    toggleCoversSelect: false,
    toggleCoversApply: false,
  })
})

test('zoomed iPhone keeps a 780px layout and the phone board', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'width-780', '780px project only')
  await page.goto('/?sport=nfl', { waitUntil: 'load' })
  const info = await page.evaluate((query) => ({
    innerWidth: window.innerWidth,
    phone: window.matchMedia(query).matches,
    narrow: window.matchMedia('(max-width: 767px)').matches,
  }), PHONE_BOARD_QUERY)
  expect(info.innerWidth).toBe(780)
  expect(info.narrow).toBe(false)
  expect(info.phone).toBe(true)
  await expect(page.getByTestId('prop-line-card').first()).toBeVisible()
})
