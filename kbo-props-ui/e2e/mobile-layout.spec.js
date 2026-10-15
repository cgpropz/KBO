import { expect, test } from '@playwright/test'

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
    imageUrl: '',
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
  }],
  prizepicks_props: {
    cards: [{
      name: 'Kim Do-yeong',
      team: 'KIA',
      type: 'batter',
      opponent: 'LG',
      games: [],
      props: [{ stat: 'Hits', line: 1.5, projection: 1.8, hit_rate_l10: 70, hit_rate_all: 60, recent_values: [2, 1, 0, 1, 2, 1, 3, 0, 1, 2] }],
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

const boards = [
  ['nfl', '/?sport=nfl&previewTier=owner'],
  ['nhl', '/?sport=nhl&previewTier=owner'],
  ['kbo', '/?sport=kbo&previewTier=owner'],
  ['wnba', '/?sport=wnba&previewTier=owner'],
  ['nba', '/?sport=nba&previewTier=owner'],
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
  // Logos go through /api/img. Leaving that to the Vite dev server serves
  // api/img.js (sharp), which prebundles and reloads the page. The board
  // check is the table, not the picture.
  await page.route('**/api/img**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'image/webp',
      body: Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AA/vuUAAA=', 'base64'),
    })
  })
}

async function tinyText(page) {
  return page.evaluate(() => {
    const bad = []
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode()
    while (node) {
      const text = node.textContent.replace(/\s+/g, ' ').trim()
      const el = node.parentElement
      if (text && el) {
        let shown = true
        for (let current = el; current && current !== document.documentElement; current = current.parentElement) {
          const style = getComputedStyle(current)
          if (style.display === 'none' || style.visibility === 'hidden') {
            shown = false
            break
          }
        }
        if (shown) {
          const size = Number.parseFloat(getComputedStyle(el).fontSize)
          if (Number.isFinite(size) && size < 12) {
            bad.push(`${size}px ${el.tagName}.${String(el.className).slice(0, 40)} "${text.slice(0, 40)}"`)
          }
        }
      }
      if (bad.length >= 8) break
      node = walker.nextNode()
    }
    return bad
  })
}

test.beforeEach(async ({ page }) => {
  await installFixtures(page)
})

for (const [sport, path] of boards) {
  test(`${sport} board stays inside the phone and uses 12px type`, async ({ page }) => {
    await page.goto(path)
    const table = page.locator('table.hit-rate-board')
    await expect(table).toBeVisible()
    const box = await table.evaluate((el) => ({
      width: el.getBoundingClientRect().width,
      scrollWidth: el.scrollWidth,
      display: getComputedStyle(el).display,
    }))
    const viewport = page.viewportSize().width
    expect(box.display, `${sport} board is still a desktop table`).not.toBe('table')
    expect(box.width, `${sport} board is wider than the viewport`).toBeLessThanOrEqual(viewport + 1)
    expect(box.scrollWidth, `${sport} board content is wider than the viewport`).toBeLessThanOrEqual(viewport + 1)
    const pills = page.locator('.hit-rate-strip').first()
    if (await pills.count()) {
      const wrap = await pills.evaluate((el) => getComputedStyle(el).flexWrap)
      expect(wrap, `${sport} hit-rate pills wrap`).toBe('nowrap')
    }
    expect(await tinyText(page), `${sport} has text under 12px`).toEqual([])
  })
}

test('desktop NFL board stays a wide table', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/?sport=nfl&previewTier=owner')
  const table = page.locator('table.hit-rate-board')
  await expect(table).toBeVisible()
  const display = await table.evaluate((el) => getComputedStyle(el).display)
  const menu = await page.locator('.cg-menu-btn').evaluate((el) => getComputedStyle(el).display)
  expect(display).toBe('table')
  expect(menu).toBe('none')
})

test('phone layout is unlayered and sport min-width stays in a layer', async ({ page }) => {
  await page.goto('/?sport=nfl&previewTier=owner')
  await expect(page.locator('table.hit-rate-board')).toBeVisible()
  const cascade = await page.evaluate(() => {
    let menuUnlayered = false
    let tableLayered = false
    const walk = (rules, layered) => {
      for (const rule of rules) {
        if (rule instanceof CSSLayerBlockRule) walk(rule.cssRules, true)
        else if (rule instanceof CSSMediaRule || rule instanceof CSSGroupingRule) walk(rule.cssRules, layered)
        else if (rule.selectorText?.includes('.cg-menu-btn') && !layered) menuUnlayered = true
        else if (rule.selectorText?.includes('.nfl-lines-table') && rule.style?.minWidth === '900px' && layered) tableLayered = true
      }
    }
    for (const sheet of document.styleSheets) {
      try { walk(sheet.cssRules, false) } catch { /* cross-origin sheet */ }
    }
    return { menuUnlayered, tableLayered }
  })
  expect(cascade.menuUnlayered).toBe(true)
  expect(cascade.tableLayered).toBe(true)
})
