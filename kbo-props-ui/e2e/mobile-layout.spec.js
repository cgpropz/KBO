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
    line_type: 'standard',
  }, {
    id: 'nfl-goblin',
    player: 'Goblin Only',
    team: 'DET',
    opponent: 'CHI',
    position: 'WR',
    prop: 'Receiving Yards',
    line: 4.5,
    projection: 20,
    recent,
    line_type: 'goblin',
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
    oddsType: 'standard',
  }, {
    id: 'nhl-goblin',
    player: 'Goblin Skater',
    team: 'EDM',
    opponent: 'CGY',
    position: 'C',
    prop: 'Points',
    line: 0.5,
    projection: 1.2,
    oddsType: 'goblin',
    rankEligible: true,
  }],
  prizepicks_props: {
    cards: [{
      name: 'Kim Do-yeong',
      team: 'KIA',
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
    avgMins: 32,
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
  test(`${sport} dashboard uses phone cards and 12px type`, async ({ page }) => {
    await page.goto(path)
    const cards = page.getByTestId('prop-line-card')
    await expect(cards.first()).toBeVisible()
    await expect(page.getByTestId('prop-line-table')).toHaveCount(0)
    await expect(page.locator('table.hit-rate-board')).toHaveCount(0)
    const box = await page.getByTestId('prop-line-cards').evaluate((el) => ({
      width: el.getBoundingClientRect().width,
      scrollWidth: el.scrollWidth,
    }))
    const viewport = page.viewportSize().width
    expect(box.width, `${sport} cards are wider than the viewport`).toBeLessThanOrEqual(viewport + 1)
    expect(box.scrollWidth, `${sport} card content is wider than the viewport`).toBeLessThanOrEqual(viewport + 1)
    const pills = page.locator('.hit-rate-strip').first()
    if (await pills.count()) {
      const wrap = await pills.evaluate((el) => getComputedStyle(el).flexWrap)
      expect(wrap, `${sport} hit-rate pills wrap`).toBe('nowrap')
    }
    expect(await tinyText(page), `${sport} has text under 12px`).toEqual([])
  })
}

test('empty kbo board shows the next game in Eastern Time', async ({ page }) => {
  await page.route('**/api/data**', async (route) => {
    const ds = new URL(route.request().url()).searchParams.get('ds')
    const data = ds === 'prizepicks_props'
      ? {
        cards: [],
        total_props: 0,
        board_note: 'no_upcoming_games',
        next_game: {
          away: 'LG',
          home: 'Kia',
          start_time_utc: '2026-10-17T05:00:00+00:00',
          label_et: 'Sat, Oct 17, 1:00 AM ET',
        },
      }
      : (Object.prototype.hasOwnProperty.call(fixtures, ds) ? fixtures[ds] : [])
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data, updatedAt: '2026-10-14T13:38:52-04:00', preview: false, lockedCount: 0, tier: 'owner' }),
    })
  })
  await page.goto('/?sport=kbo&previewTier=owner')
  const empty = page.getByTestId('kbo-board-empty')
  await expect(empty).toBeVisible()
  await expect(empty).toContainText('No upcoming props')
  await expect(empty).toContainText('LG @ Kia')
  await expect(empty).toContainText('Sat, Oct 17, 1:00 AM ET')
  await expect(page.locator('.kbo-player-cell')).toHaveCount(0)
  expect(await tinyText(page), 'empty kbo board has text under 12px').toEqual([])
})

test('desktop NFL and NHL dashboards stay wide tables', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  for (const sport of ['nfl', 'nhl']) {
    await page.goto(`/?sport=${sport}&previewTier=owner`)
    const table = page.getByTestId('prop-line-table')
    await expect(table).toBeVisible()
    await expect(page.getByTestId('prop-line-card')).toHaveCount(0)
    const display = await table.evaluate((el) => getComputedStyle(el).display)
    const menu = await page.locator('.cg-menu-btn').evaluate((el) => getComputedStyle(el).display)
    expect(display).toBe('table')
    expect(menu).toBe('none')
  }
})

test('member cards show the player logo and hide model weights', async ({ page }) => {
  const shots = process.env.SAVE_BOARD_SHOTS
  const pages = [
    ['nfl-dashboard', '/?sport=nfl&previewTier=owner', 'DET', 'vs CHI'],
    ['nfl-board', '/?sport=nfl&page=projections&previewTier=owner', 'DET', 'vs CHI'],
    ['nhl-dashboard', '/?sport=nhl&previewTier=owner', 'EDM', 'vs CGY'],
    ['nhl-board', '/?sport=nhl&page=projections&previewTier=owner', 'EDM', 'vs CGY'],
    ['wnba-dashboard', '/?sport=wnba&previewTier=owner', 'LVA', 'vs NYL'],
    ['wnba-board', '/?sport=wnba&page=projections&previewTier=owner', 'LVA', 'vs NYL'],
    ['nba-dashboard', '/?sport=nba&previewTier=owner', 'DEN', 'vs LAL'],
    ['kbo-board', '/?sport=kbo&previewTier=owner', 'KIA', 'vs LG'],
  ]
  for (const [name, path, team, versus] of pages) {
    await page.goto(path)
    const logo = page.getByTestId('player-team-logo').first()
    await expect(logo).toBeVisible()
    await expect(logo).toHaveAttribute('data-team', team)
    if (name.startsWith('wnba')) {
      await expect(logo).toHaveAttribute('src', /teamlogos%2Fwnba%2F500%2Flv\.png/)
      await expect(logo).not.toHaveAttribute('src', /\/logos\//)
    }
    await expect(page.locator('body')).toContainText(versus)
    await expect(page.locator('body')).not.toContainText('L3 50%')
    await expect(page.locator('body')).not.toContainText('SCORE SCALE')
    await expect(page.locator('body')).not.toContainText('0.5/0.3/0.2')
    if (shots) await page.screenshot({ path: `${shots}/${name}.png` })
  }
  await page.goto('/?sport=nfl&page=projections&previewTier=owner')
  await expect(page.locator('.nfl-board-meta')).toContainText('LIVE MODEL / DVP ADJUSTED')
  await expect(page.locator('.nfl-board-meta')).not.toContainText('Projection =')
})

test('phone NHL dashboard hides goblin lines and opens on CG Score', async ({ page }) => {
  await page.goto('/?sport=nhl&previewTier=owner')
  await expect(page.getByTestId('prop-line-card').first()).toBeVisible()
  await expect(page.getByText('Goblin Skater')).toHaveCount(0)
  await expect(page.getByText(/GOBLIN/)).toHaveCount(0)
  await expect(page.getByLabel('Sort')).toHaveValue('CG Score')
})

test('a deep link opens the NFL and NHL boards as phone cards', async ({ page }) => {
  await page.goto('/?sport=nfl&page=projections&previewTier=owner')
  await expect(page.getByRole('heading', { name: 'Edge Board' })).toBeVisible()
  await expect(page.locator('.nfl-edge-card').first()).toBeVisible()
  await expect(page.getByText('Goblin Only')).toHaveCount(0)
  await page.goto('/?sport=nhl&page=projections&previewTier=owner')
  await expect(page.getByRole('heading', { name: 'Board' })).toBeVisible()
  await expect(page.locator('.nfl-edge-card').first()).toBeVisible()
  await expect(page.getByText('Goblin Skater')).toHaveCount(0)
})

test('a sport tab opens that sport dashboard', async ({ page }) => {
  await page.goto('/?sport=nfl&page=projections&previewTier=owner')
  await page.getByRole('tab', { name: 'NHL' }).click()
  await expect(page.getByRole('heading', { name: 'Prop Lines' })).toBeVisible()
  await expect(page.getByText('NHL / PRIZEPICKS')).toBeVisible()
  await expect(page.getByTestId('prop-line-card').first()).toBeVisible()
})

test('phone layout is unlayered and sport min-width stays in a layer', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/?sport=nfl&previewTier=owner')
  await expect(page.getByTestId('prop-line-table')).toBeVisible()
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
