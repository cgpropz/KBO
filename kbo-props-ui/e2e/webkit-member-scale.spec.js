import { mkdirSync } from 'node:fs'
import { expect, test, devices, chromium } from '@playwright/test'
import { PHONE_BOARD_QUERY } from '../src/phoneBoardQuery.js'

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

const boards = [
  ['nhl', '/?sport=nhl&previewTier=owner'],
  ['nfl', '/?sport=nfl&previewTier=owner'],
  ['wnba', '/?sport=wnba&previewTier=owner'],
  ['kbo', '/?sport=kbo&previewTier=owner'],
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

function measure(query) {
  const root = document.getElementById('root')
  const card = document.querySelector('[data-testid="prop-line-card"]')
  const heading = document.querySelector('h1')
  const meta = document.querySelector('meta[name="viewport"]')
  const zoom = root ? getComputedStyle(root).zoom : '1'
  return {
    inner: window.innerWidth,
    scroll: document.documentElement.scrollWidth,
    screen: window.screen.width,
    root: root ? root.offsetWidth : 0,
    card: card ? card.offsetWidth : 0,
    font: Number.parseFloat(getComputedStyle(document.body).fontSize),
    heading: heading ? Number.parseFloat(getComputedStyle(heading).fontSize) : 0,
    zoom: zoom === 'normal' ? 1 : Number.parseFloat(zoom) || 1,
    viewport: meta ? meta.getAttribute('content') : '',
    cards: document.querySelectorAll('[data-testid="prop-line-card"]').length,
    tables: document.querySelectorAll('[data-testid="prop-line-table"]').length,
    phone: window.matchMedia(query).matches,
  }
}

test.beforeEach(async ({ page }) => {
  await installFixtures(page)
})

test('desktop-mode 980 viewport renders the four member boards at phone scale', async ({ page, browser }) => {
  const phone = await browser.newContext({
    ...devices['iPhone 15'],
    isMobile: true,
    hasTouch: true,
    baseURL: 'http://127.0.0.1:5173',
  })
  const phonePage = await phone.newPage()
  await installFixtures(phonePage)
  const baseline = {}
  mkdirSync('webkit-screenshots', { recursive: true })
  for (const [name, path] of boards) {
    await phonePage.goto(path)
    await expect(phonePage.getByTestId('prop-line-card').first()).toBeVisible()
    baseline[name] = await phonePage.evaluate(measure, PHONE_BOARD_QUERY)
    if (name === 'nhl') await phonePage.screenshot({ path: 'webkit-screenshots/nhl-member-phone.png' })
  }
  await phone.close()

  for (const [name, path] of boards) {
    await page.goto(path)
    await expect(page.getByTestId('prop-line-card').first()).toBeVisible()
    const box = await page.evaluate(measure, PHONE_BOARD_QUERY)
    const phoneBox = baseline[name]
    const effective = box.inner <= box.screen * 1.25 ? box.inner : box.root
    expect(effective, `${name} effective width`).toBeGreaterThan(phoneBox.screen * 0.9)
    expect(effective, `${name} effective width`).toBeLessThan(phoneBox.screen * 1.1)
    expect(box.scroll, name).toBeLessThanOrEqual(box.inner + 1)
    expect(box.font, `${name} body type`).toBeGreaterThan(phoneBox.font * 0.9)
    expect(box.font, `${name} body type`).toBeLessThan(phoneBox.font * 1.1)
    expect(box.heading, `${name} heading`).toBeGreaterThan(phoneBox.heading * 0.9)
    expect(box.heading, `${name} heading`).toBeLessThan(phoneBox.heading * 1.1)
    expect(box.card, `${name} card`).toBeGreaterThan(phoneBox.card * 0.9)
    expect(box.card, `${name} card`).toBeLessThan(phoneBox.card * 1.1)
    expect(box.tables, name).toBe(0)
    expect(box.phone, name).toBe(true)
    if (name === 'nhl') await page.screenshot({ path: 'webkit-screenshots/nhl-member-980.png' })
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

test('desktop chromium at the proof viewport paints member boards without zoom', async () => {
  const desktop = await chromium.launch({ headless: true })
  const context = await desktop.newContext({
    viewport: { width: 390, height: 844 },
    screen: { width: 390, height: 844 },
    hasTouch: false,
    isMobile: false,
    deviceScaleFactor: 1,
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/156.0.0.0 Safari/537.36',
    baseURL: 'http://127.0.0.1:5173',
  })
  const page = await context.newPage()
  await installFixtures(page)
  for (const path of ['/?sport=nfl&page=projections&previewTier=owner', '/?sport=nhl&page=projections&previewTier=owner']) {
    await page.goto(path)
    await expect(page.locator('.nfl-edge-card').first()).toBeVisible()
    const state = await page.evaluate(() => {
      const root = document.getElementById('root')
      const zoom = root ? getComputedStyle(root).zoom : '1'
      return {
        paywall: Boolean(document.querySelector('.pw-title')),
        meta: document.querySelector('meta[name="viewport"]')?.getAttribute('content') || '',
        zoom: zoom === 'normal' ? 1 : Number.parseFloat(zoom) || 1,
        phoneVar: document.documentElement.style.getPropertyValue('--phone-screen'),
        coarse: window.matchMedia('(hover: none) and (pointer: coarse)').matches,
        touch: navigator.maxTouchPoints,
        screen: [window.screen.width, window.screen.height],
        inner: [window.innerWidth, window.innerHeight],
        h1: document.querySelector('h1')?.textContent || '',
      }
    })
    expect(state.paywall, path).toBe(false)
    expect(state.coarse, path).toBe(false)
    expect(state.touch, path).toBe(0)
    expect(state.meta, path).toBe('width=device-width, initial-scale=1.0')
    expect(state.zoom, path).toBeLessThan(1.05)
    expect(state.phoneVar, path).toBe('')
    expect(state.h1, path).not.toBe('')
  }
  await desktop.close()
})

test('an iPad and a mouse window stay on the desktop layout', async ({ browser }) => {
  const ipad = await browser.newContext({
    viewport: { width: 820, height: 1180 },
    screen: { width: 820, height: 1180 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    baseURL: 'http://127.0.0.1:5173',
  })
  const ipadPage = await ipad.newPage()
  await installFixtures(ipadPage)
  await ipadPage.goto('/?sport=nfl&previewTier=owner')
  await expect(ipadPage.getByTestId('prop-line-table')).toBeVisible()
  const ipadBox = await ipadPage.evaluate(measure, PHONE_BOARD_QUERY)
  expect(ipadBox.inner).toBe(820)
  expect(ipadBox.phone).toBe(false)
  expect(ipadBox.zoom).toBeLessThan(1.05)
  expect(ipadBox.viewport).toBe('width=device-width, initial-scale=1.0')
  expect(ipadBox.tables).toBeGreaterThan(0)
  await ipad.close()

  const mouse = await browser.newContext({
    viewport: { width: 980, height: 800 },
    screen: { width: 1440, height: 900 },
    isMobile: false,
    hasTouch: false,
    baseURL: 'http://127.0.0.1:5173',
  })
  const mousePage = await mouse.newPage()
  await installFixtures(mousePage)
  await mousePage.goto('/?sport=nfl&previewTier=owner')
  await expect(mousePage.getByTestId('prop-line-table')).toBeVisible()
  const mouseBox = await mousePage.evaluate(measure, PHONE_BOARD_QUERY)
  expect(mouseBox.inner).toBe(980)
  expect(mouseBox.phone).toBe(false)
  expect(mouseBox.zoom).toBeLessThan(1.05)
  expect(mouseBox.viewport).toBe('width=device-width, initial-scale=1.0')
  expect(mouseBox.cards).toBe(0)
  await mouse.close()
})
