import { expect, test } from '@playwright/test'

const recent = [70, 80, 55, 90, 60, 75, 88, 40, 95, 62, 71, 83]
const seasons = Array(12).fill(2026)
const opponents = ['DAL', 'NYG', 'PHI', 'WAS', 'DAL', 'NYG', 'PHI', 'WAS', 'DAL', 'NYG', 'PHI', 'WAS']
const wnbaGames = Array.from({ length: 12 }, (_, index) => ({
  date: `2026-09-${String(index + 1).padStart(2, '0')}`,
  opponent: 'NYL',
  pts: 20 + index,
  reb: 8,
  ast: 3,
}))
const kboGames = Array.from({ length: 12 }, (_, index) => ({
  date: `2026-09-${String(index + 1).padStart(2, '0')}`,
  opp: 'LG',
  season: '2026',
  tb: 2 + (index % 3),
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
    line_type: 'standard',
  }],
  nhl_projections: [{
    id: 'nhl-0',
    player: 'Darren Raddysh',
    team: 'TB',
    opponent: 'FLA',
    position: 'D',
    prop: 'Shots On Goal',
    line: 1.5,
    projection: 2.1,
    recent: [4, 5, 3, 2, 6, 4, 1, 5, 3, 4, 2, 3],
    hitRateL5: 100,
    gamesL5: 5,
    hitRate: 90,
    gamesL10: 10,
    hitRateL20: 85,
    gamesL20: 20,
    h2hHitRate: 80,
    h2hGames: 5,
    seasonHitRate: 75,
    seasonGames: 40,
    dvpRank: 3,
    oddsType: 'standard',
  }],
  prizepicks_props: {
    cards: [{
      name: 'Kim Do-yeong',
      team: 'Kia',
      type: 'batter',
      opponent: 'LG',
      games: kboGames,
      props: [{ stat: 'Total Bases', line: 1.5, projection: 1.8, hit_rate_l10: 70, hit_rate_all: 60, odds_type: 'standard', recent_values: [2, 1, 0, 1, 2, 1, 3, 0, 1, 2] }],
    }],
  },
  wnba_projections_standard: [{
    name: 'Cecilia Zandalasini',
    player: 'Cecilia Zandalasini',
    team: 'GSV',
    position: 'GUARD',
    projPts: 8,
    gp: 12,
    recentGames: wnbaGames,
    ppAllProps: [{ stat: 'Points', line: 6.5, projection: 8.1, opponent: 'NYL' }],
  }],
  wnba_players: [{ name: 'Cecilia Zandalasini', team: 'GSV', position: 'G' }],
  nba_projections_standard: [],
  nba_players: [],
  nfl_sharp_odds: { records: [], status: 'ok' },
  nhl_sharp_odds: { records: [], status: 'ok' },
  nba_sharp_odds: { records: [], status: 'ok' },
}

const boards = [
  ['wnba', '/?sport=wnba', 'O 6.5 Points'],
  ['nhl', '/?sport=nhl', 'O 1.5 Shots On Goal'],
  ['nfl', '/?sport=nfl', 'O 64.5 Receiving Yards'],
  ['kbo', '/?sport=kbo', 'O 1.5 Total Bases'],
]

function overlaps(a, b) {
  if (!a || !b || a.width < 1 || b.width < 1) return false
  const x = Math.min(a.right, b.right) - Math.max(a.left, b.left)
  const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
  return x > 1 && y > 1
}

async function installFixtures(page, mode) {
  await page.route('**/api/data**', async (route) => {
    const ds = new URL(route.request().url()).searchParams.get('ds')
    const data = Object.prototype.hasOwnProperty.call(fixtures, ds) ? fixtures[ds] : []
    const member = mode === 'member'
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data,
        updatedAt: '2026-10-11T20:00:00Z',
        preview: !member,
        lockedCount: member ? 0 : 4,
        tier: member ? 'combined' : 'free',
      }),
    })
  })
}

async function cardFit(page) {
  return page.locator('[data-testid="prop-line-card"]:not(.locked)').evaluateAll((cards) => {
    const boxOf = (node) => {
      if (!node) return null
      const box = node.getBoundingClientRect()
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height }
    }
    return cards.map((card) => {
      const name = card.querySelector('.wnba-player-link, .nfl-player-link, .kbo-player-cell strong')
      const tag = card.querySelector('.wnba-lines-tag, .nfl-lines-tag, .kbo-player-cell small')
      const line = card.querySelector('.wnba-lines-line, .nfl-lines-line, .kbo-player-cell b')
      const odds = card.querySelector('button[aria-label^="Show sportsbook odds"], button[aria-label^="Hide sportsbook odds"]')
      const why = card.querySelector('.cg-score-why')
      const strip = card.querySelector('.hit-rate-strip')
      const labels = [...card.querySelectorAll('.hit-rate-pill-k')].map((node) => {
        const box = node.getBoundingClientRect()
        const host = strip ? strip.getBoundingClientRect() : card.getBoundingClientRect()
        return {
          text: (node.textContent || '').trim(),
          visible: box.width > 2 && box.left >= host.left - 1 && box.right <= host.right + 1 && node.scrollWidth <= node.clientWidth + 1,
        }
      })
      const lineStyle = line ? getComputedStyle(line) : null
      const nameStyle = name ? getComputedStyle(name) : null
      return {
        name: (name?.textContent || '').replace(/\s+/g, ' ').trim(),
        line: (line?.textContent || '').replace(/\s+/g, ' ').trim(),
        boxes: {
          name: boxOf(name),
          tag: boxOf(tag),
          line: boxOf(line),
          odds: boxOf(odds),
          why: boxOf(why),
        },
        lineNowrap: lineStyle ? lineStyle.whiteSpace === 'nowrap' : false,
        lineScroll: line ? line.scrollWidth : 0,
        lineClient: line ? line.clientWidth : 0,
        lineFits: line ? line.scrollWidth <= line.clientWidth + 1 : false,
        nameEllipsis: nameStyle ? nameStyle.textOverflow === 'ellipsis' && nameStyle.whiteSpace === 'nowrap' : false,
        stripScroll: strip ? strip.scrollWidth : 0,
        stripClient: strip ? strip.clientWidth : 0,
        labels,
        values: [...card.querySelectorAll('.hit-rate-pill-v')].map((node) => (node.textContent || '').trim()),
      }
    })
  })
}

const slipBoards = [
  ['wnba', '/?s=wnba'],
  ['nhl', '/?s=nhl'],
  ['nfl', '/?s=nfl'],
  ['kbo', '/?s=kbo'],
]

async function installMember(page) {
  const user = { id: 'e2e-slip-member', email: 'member@preview.local', aud: 'authenticated', role: 'authenticated' }
  const session = {
    access_token: 'e2e-slip-token',
    refresh_token: 'e2e-slip-refresh',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user,
  }
  await page.addInitScript((payload) => {
    localStorage.setItem('sb-e2e-slip-auth-token', JSON.stringify(payload))
    sessionStorage.setItem('cg_tier', JSON.stringify({ userId: payload.user.id, tier: 'combined' }))
  }, session)
  await page.route('**/*supabase.co/**', async (route) => {
    const url = route.request().url()
    if (url.includes('/rest/v1/user_profiles')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{ tier: 'combined', discord_only: false }]),
      })
      return
    }
    if (url.includes('/auth/v1/')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(session) })
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })
  await page.route('**/api/sync-subscription**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ tier: 'combined' }),
    })
  })
}

test('slip filter chips wrap without overlapping', async ({ page }) => {
  await installFixtures(page, 'member')
  await installMember(page)
  for (const [sport, path] of slipBoards) {
    await page.goto(path, { waitUntil: 'domcontentloaded' })
    const chips = page.locator('.b2-chip')
    await expect(chips).toHaveCount(4)
    const fit = await page.locator('.b2-chips').evaluate((host) => {
      const boxes = [...host.querySelectorAll('.b2-chip')].map((node) => {
        const box = node.getBoundingClientRect()
        const hostBox = host.getBoundingClientRect()
        return {
          text: (node.textContent || '').replace(/\s+/g, ' ').trim(),
          left: box.left,
          right: box.right,
          top: box.top,
          bottom: box.bottom,
          width: box.width,
          height: box.height,
          fits: node.scrollWidth <= node.clientWidth + 1,
          inside: box.left >= hostBox.left - 1 && box.right <= hostBox.right + 1 && box.top >= hostBox.top - 1,
        }
      })
      return {
        boxes,
        scrolls: host.scrollWidth > host.clientWidth + 1,
      }
    })
    expect(fit.scrolls, `${sport} chip row scrolls`).toBe(false)
    const labels = fit.boxes.map((chip) => chip.text)
    expect(labels.some((text) => text.startsWith('CG: high'))).toBe(true)
    expect(labels).toContain('All props ▾')
    expect(labels).toContain('More only')
    expect(labels).toContain('Standard lines')
    for (const chip of fit.boxes) {
      expect(chip.fits, `${sport} ${chip.text} clips`).toBe(true)
      expect(chip.inside, `${sport} ${chip.text} is outside the chip row`).toBe(true)
    }
    for (let i = 0; i < fit.boxes.length; i += 1) {
      for (let j = i + 1; j < fit.boxes.length; j += 1) {
        expect(
          overlaps(fit.boxes[i], fit.boxes[j]),
          `${sport} ${fit.boxes[i].text} overlaps ${fit.boxes[j].text}`,
        ).toBe(false)
      }
    }
  }
})

test('Copy picks and Open PrizePicks stay apart on the slip sheet', async ({ page }) => {
  await installFixtures(page, 'member')
  await installMember(page)
  for (const [sport] of slipBoards) {
    await page.goto(`/?s=${sport}&d=1`, { waitUntil: 'domcontentloaded' })
    const sheet = page.locator('.b2-sheet-pop')
    await expect(sheet.getByTestId('open-prizepicks')).toBeVisible()
    const fit = await sheet.locator('.b2-cta').evaluate((host) => {
      const boxOf = (node) => {
        const box = node.getBoundingClientRect()
        const hostBox = host.getBoundingClientRect()
        return {
          text: (node.textContent || '').replace(/\s+/g, ' ').trim(),
          left: box.left,
          right: box.right,
          top: box.top,
          bottom: box.bottom,
          width: box.width,
          height: box.height,
          fits: node.scrollWidth <= node.clientWidth + 1,
          inside: box.left >= hostBox.left - 1 && box.right <= hostBox.right + 1,
        }
      }
      return {
        buttons: [...host.querySelectorAll('button')].map(boxOf),
        note: boxOf(host.querySelector('[data-testid="prizepicks-note"]')),
        scrolls: host.scrollWidth > host.clientWidth + 1,
      }
    })
    expect(fit.scrolls, `${sport} slip actions scroll`).toBe(false)
    const labels = fit.buttons.map((button) => button.text)
    expect(labels).toContain('Save slip')
    expect(labels).toContain('Copy picks')
    expect(labels).toContain('Open PrizePicks ↗')
    const pieces = [...fit.buttons, fit.note]
    for (const piece of pieces) {
      expect(piece.fits, `${sport} ${piece.text} clips`).toBe(true)
      expect(piece.inside, `${sport} ${piece.text} is outside the action row`).toBe(true)
    }
    for (let i = 0; i < pieces.length; i += 1) {
      for (let j = i + 1; j < pieces.length; j += 1) {
        expect(
          overlaps(pieces[i], pieces[j]),
          `${sport} ${pieces[i].text} overlaps ${pieces[j].text}`,
        ).toBe(false)
      }
    }
  }
})

const edgeRows = [
  {
    id: 'edge-xavier',
    player: 'Xavier Legette',
    team: 'CAR',
    opponent: 'HOU',
    position: 'WR',
    prop: 'Receiving Yards',
    line: 64.5,
    projection: 78.4,
    seasonAverage: 48.2,
    snapCount: 78,
    dvpRank: 8,
    dvpRatio: 1.1,
    hitRate: 70,
    recent: [80, 70, 90, 40, 75, 88, 30, 95, 20, 72],
    line_type: 'standard',
  },
  {
    id: 'edge-amon',
    player: 'Amon-Ra St. Brown',
    team: 'DET',
    opponent: 'CHI',
    position: 'WR',
    prop: 'Rec Targets',
    line: 7.5,
    projection: 8.6,
    seasonAverage: 7.4,
    snapCount: 91,
    dvpRank: 14,
    dvpRatio: 0.9,
    hitRate: 60,
    recent: [9, 8, 4, 10, 6, 8, 3, 9, 11, 5],
    line_type: 'standard',
  },
  {
    id: 'edge-kimani',
    player: 'Kimani Vidal',
    team: 'LAC',
    opponent: 'DEN',
    position: 'RB',
    prop: 'Rush Yards',
    line: 45.5,
    projection: 58.2,
    seasonAverage: 52.1,
    snapCount: 64,
    dvpRank: 22,
    dvpRatio: 1.2,
    hitRate: 70,
    recent: [60, 50, 20, 70, 48, 10, 55, 80, 30, 62],
    line_type: 'standard',
  },
  {
    id: 'edge-hopkins',
    player: 'DeAndre Hopkins',
    team: 'TEN',
    opponent: 'IND',
    position: 'WR',
    prop: 'Receptions',
    line: 4.5,
    projection: 5.4,
    seasonAverage: 4.8,
    snapCount: 55,
    dvpRank: 3,
    dvpRatio: 0.7,
    hitRate: 80,
    recent: [6, 5, 3, 7, 8, 6, 6, 5, 2, 7],
    line_type: 'standard',
  },
]

const edgeLabels = ['LINE', 'MODEL', 'SCORE', 'DVP RANK', 'SEASON AVG', 'HIT RATE', 'GAMES']

async function installEdgeRows(page) {
  await installFixtures(page, 'member')
  await page.route('**/api/data**', async (route) => {
    const ds = new URL(route.request().url()).searchParams.get('ds')
    const data = ds === 'nfl_projections'
      ? edgeRows
      : (Object.prototype.hasOwnProperty.call(fixtures, ds) ? fixtures[ds] : [])
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data,
        updatedAt: '2026-10-17T20:00:00Z',
        preview: false,
        lockedCount: 0,
        tier: 'combined',
      }),
    })
  })
  await installMember(page)
}

const nhlEdgeLabels = ['LINE', 'MODEL', 'SCORE', 'DVP', '2026-27', '2025-26', 'L10', 'H2H']

// Reads the edge grid and every card's name, prop, and stat labels.
async function edgeFit(page, labels) {
  return page.locator('.nfl-edge-grid').evaluate((grid, expected) => {
    const tracks = getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean)
    const cardNodes = [...grid.querySelectorAll('.nfl-edge-card')]
    const boxOf = (node) => {
      const box = node.getBoundingClientRect()
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height }
    }
    const clipped = (node) => {
      if (!node) return true
      const style = getComputedStyle(node)
      const ellipsis = style.textOverflow === 'ellipsis' && (style.whiteSpace === 'nowrap' || style.whiteSpace === 'pre')
      return ellipsis || node.scrollWidth > node.clientWidth + 1
    }
    const rootBox = (document.getElementById('root') || document.body).getBoundingClientRect()
    return {
      tracks,
      innerWidth: Math.max(window.innerWidth, rootBox.right),
      scrollWidth: Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0),
      cards: cardNodes.map((card) => {
        const cardBox = boxOf(card)
        const name = card.querySelector('.nfl-card-player h2')
        const meta = card.querySelector('.nfl-card-player p')
        const prop = card.querySelector('.nfl-card-prop')
        const labelNodes = [...card.querySelectorAll('.nfl-card-metrics small, .nfl-card-meta small')]
        const pieces = [name, meta, prop, ...labelNodes].filter(Boolean).map((node) => {
          const box = boxOf(node)
          return {
            text: (node.textContent || '').replace(/\s+/g, ' ').trim(),
            clipped: clipped(node),
            sticksOut: box.right > cardBox.right + 1 || box.left < cardBox.left - 1,
          }
        })
        const dvp = [...card.querySelectorAll('.nfl-card-metrics > div')]
          .find((node) => /^DVP/.test((node.querySelector('small')?.textContent || '').trim()))
          ?.querySelector('strong')
        const dvpRects = dvp ? [...dvp.getClientRects()].map((r) => Math.round(r.top)) : []
        return {
          name: (name?.textContent || '').replace(/\s+/g, ' ').trim(),
          box: cardBox,
          pieces,
          labels: labelNodes.map((node) => (node.textContent || '').replace(/\s+/g, ' ').trim()),
          dvpText: (dvp?.textContent || '').replace(/\s+/g, ' ').trim(),
          dvpOneLine: dvp ? getComputedStyle(dvp).whiteSpace === 'nowrap' && new Set(dvpRects).size <= 1 : false,
          hitRate: [...card.querySelectorAll('.nfl-card-meta div')].find((node) => (node.querySelector('small')?.textContent || '').trim() === 'HIT RATE')?.querySelector('strong')?.textContent?.trim() || '',
        }
      }),
      expectedLabels: expected,
    }
  }, labels)
}

function expectTwoUp(fit, players, labels, where) {
  expect(fit.tracks, `${where} columns ${fit.tracks.join(' | ')}`).toHaveLength(2)
  expect(fit.scrollWidth, `${where} edge board scrollWidth`).toBeLessThanOrEqual(fit.innerWidth + 1)
  const boxes = fit.cards.map((card) => card.box)
  expect(boxes[0].top, `${where} first row`).toBeLessThanOrEqual(boxes[1].top + 1)
  expect(boxes[1].top, `${where} first row`).toBeLessThanOrEqual(boxes[0].top + 1)
  expect(boxes[0].right, `${where} two cards share the row`).toBeLessThanOrEqual(boxes[1].left + 1)
  if (boxes[2]) expect(boxes[2].top, `${where} third card wraps`).toBeGreaterThan(boxes[0].bottom - 1)
  const names = fit.cards.map((card) => card.name)
  expect(names).toEqual(expect.arrayContaining(players))
  for (const card of fit.cards) {
    expect(card.labels, `${where} ${card.name}`).toEqual(labels)
    for (const piece of card.pieces) {
      expect(piece.clipped, `${where} ${card.name} clips ${piece.text}`).toBe(false)
      expect(piece.sticksOut, `${where} ${card.name} ${piece.text} leaves the card`).toBe(false)
    }
    expect(card.dvpText, `${where} ${card.name} DvP`).toMatch(/^\d+ \/32$/)
    expect(card.dvpOneLine, `${where} ${card.name} DvP rank wraps`).toBe(true)
  }
}

test('NFL edge board uses two cards per row without clipping names or labels', async ({ page }) => {
  for (const row of edgeRows) {
    expect(row.hitRate, `${row.player} hit rate scale`).toBeGreaterThan(1)
    expect(row.hitRate, `${row.player} hit rate scale`).toBeLessThanOrEqual(100)
  }
  await installEdgeRows(page)
  await page.goto('/?sport=nfl&page=projections', { waitUntil: 'domcontentloaded' })
  const cards = page.locator('.nfl-edge-card')
  await expect(cards).toHaveCount(edgeRows.length)
  await expect(page.locator('.nfl-board-meta')).toContainText('LIVE MODEL / DVP ADJUSTED')
  const fit = await edgeFit(page, edgeLabels)
  expectTwoUp(fit, edgeRows.map((row) => row.player), edgeLabels, 'nfl')
  for (const card of fit.cards) {
    expect(card.hitRate, `${card.name} hit rate`).toMatch(/^(60|70|80)%$/)
  }
})

test('NHL edge board shares the two-card phone grid', async ({ page }) => {
  await installEdgeRows(page)
  await page.goto('/?sport=nhl&page=projections', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('.nfl-edge-card')).toHaveCount(fixtures.nhl_projections.length)
  const fit = await edgeFit(page, nhlEdgeLabels)
  expect(fit.tracks, `nhl columns ${fit.tracks.join(' | ')}`).toHaveLength(2)
  for (const card of fit.cards) {
    for (const piece of card.pieces) {
      expect(piece.clipped, `nhl ${card.name} clips ${piece.text}`).toBe(false)
    }
    expect(card.dvpOneLine, `nhl ${card.name} DvP rank wraps`).toBe(true)
  }
})

// Safari "Request Desktop Website" (and a zoomed iPhone) keeps a 980px layout
// viewport, and the boot script zooms #root back to the phone width. Width
// queries then see 980px, so the cards used to fall to the 3-column tablet
// grid with clipped names. The phone-board query must still give two per row.
test('edge boards stay two per row when a phone requests the desktop site', async ({ browser }, testInfo) => {
  const { use } = testInfo.project
  const context = await browser.newContext({
    userAgent: use.userAgent,
    viewport: { width: 980, height: 1800 },
    screen: { width: use.viewport.width, height: use.screen.height },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  })
  const page = await context.newPage()
  try {
    await installEdgeRows(page)
    await page.goto('/?sport=nfl&page=projections', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('.nfl-edge-card')).toHaveCount(edgeRows.length)
    expectTwoUp(await edgeFit(page, edgeLabels), edgeRows.map((row) => row.player), edgeLabels, 'nfl desktop-site')
    await page.goto('/?sport=nhl&page=projections', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('.nfl-edge-card')).toHaveCount(fixtures.nhl_projections.length)
    const nhl = await edgeFit(page, nhlEdgeLabels)
    expect(nhl.tracks, `nhl desktop-site columns ${nhl.tracks.join(' | ')}`).toHaveLength(2)
  } finally {
    await context.close()
  }
})

for (const mode of ['free', 'member']) {
  test(`${mode} cards keep the name, tag, line, and odds button apart`, async ({ page }) => {
    await installFixtures(page, mode)
    for (const [sport, path, lineText] of boards) {
      await page.goto(path, { waitUntil: 'domcontentloaded' })
      await expect(page.locator('[data-testid="prop-line-card"]:not(.locked)').first()).toBeVisible()
      const cards = await cardFit(page)
      expect(cards.length, `${sport} ${mode} cards`).toBeGreaterThan(0)
      for (const card of cards) {
        const { boxes } = card
        const parts = ['name', 'tag', 'line', 'odds', 'why']
        for (let i = 0; i < parts.length; i += 1) {
          for (let j = i + 1; j < parts.length; j += 1) {
            expect(
              overlaps(boxes[parts[i]], boxes[parts[j]]),
              `${sport} ${mode} ${card.name} ${parts[i]} overlaps ${parts[j]}`,
            ).toBe(false)
          }
        }
        expect(card.lineNowrap, `${sport} ${mode} line wraps`).toBe(true)
        expect(card.nameEllipsis, `${sport} ${mode} name`).toBe(true)
        if (card.labels.length) {
          expect(card.stripScroll, `${sport} ${mode} hit-rate scroll`).toBeLessThanOrEqual(card.stripClient + 1)
          for (const label of card.labels) {
            expect(label.visible, `${sport} ${mode} label ${label.text}`).toBe(true)
          }
          expect(card.labels.some((label) => label.text === 'Season'), `${sport} ${mode} Season`).toBe(true)
          if (sport === 'nhl') {
            expect(card.values, `${sport} ${mode} hit rates`).toEqual(['100%', '90%', '85%', '80%', '75%'])
          }
        }
      }
      const shown = cards.find((card) => card.line.replace(/\s+/g, ' ').includes(lineText.replace(/\s+/g, ' ')) || card.line.replace(/\s+/g, '') === lineText.replace(/\s+/g, ''))
      expect(shown, `${sport} ${mode} line ${lineText}`).toBeTruthy()
      expect(shown.lineFits, `${sport} ${mode} ${lineText} scroll ${shown.lineScroll} client ${shown.lineClient} line "${shown.line}"`).toBe(true)
      if (mode === 'member') {
        const count = page.locator('.nfl-lines-header-actions span, .wnba-lines-header-actions span, .kbo-header-actions span').first()
        await expect(count).toHaveText(/^1 line\b/)
      }
    }
  })
}

// KBO Batter Props and Pitcher Props tables. On a phone every row is a card,
// two per row, and each value carries its column name. iPad keeps the table.
const kboLog = (values) => values.map((value, i) => ({ hit: value > 1, date: `10/${String(12 - i).padStart(2, '0')}/2026`, value, opponent: 'LG' }))
const kboBatter = (row) => ({
  ba: 0.293, ops: 0.811, slg: 0.45, edge: 0.4, line: 1.5, prop: 'Total Bases', team: 'Kia', opponent: 'LG', home_team: 'LG',
  rating: 63.3, avg_per_g: 1.7, odds_type: 'standard', vs_lhp_avg: 0.283, vs_rhp_avg: 0.306, batter_hand: 'L',
  hit_rate_l5: 60, hit_rate_l10: 60, hit_rate_full: 54.7, opp_pitcher: 'Carlos Carrasco', opp_pitcher_hand: 'R', opp_pitcher_whip: 1.31,
  projection: 1.9, cg_projection: 64, recommendation: 'OVER', recent_game_log: kboLog([2, 1, 3, 0, 2, 1, 2, 0, 3, 1]), ...row,
})
const kboPitcher = (row) => ({
  team: 'LG', opponent: 'Kia', prop: 'Strikeouts', opp_ba: 0.271, opp_k_pct: 20.1, line: 4.5, projection: 4.7, hit_rate_l5: 40,
  hit_rate_full: 47, rating: 52, cg_projection: 56, edge: 0.2, recommendation: 'OVER', odds_type: 'standard',
  recent_values: [5, 4, 6, 3, 5, 4, 7, 2, 5, 4], ...row,
})
const kboTableData = {
  batter_projections: {
    generated_at: '2026-10-20T05:00:00Z',
    projections: [
      kboBatter({ name: 'Park Jae-hyun' }),
      kboBatter({ name: 'Park Hae-min', team: 'LG', opponent: 'Kia', opp_pitcher: 'James Naile', line: 0.5 }),
      kboBatter({ name: 'Kim Do-yeong', line: 2.5 }),
    ],
    team_batting: {},
  },
  strikeout_projections: {
    projections: [
      kboPitcher({ name: 'Carlos Carrasco' }),
      kboPitcher({ name: 'James Naile', team: 'Kia', opponent: 'LG', line: 5.5, projection: 5.9 }),
      kboPitcher({ name: 'Son Ju-young', line: 3.5, projection: 4.1 }),
    ],
    team_so_per_g: {},
  },
  prizepicks_props: {
    cards: [
      ['Park Jae-hyun', 'Kia', 'LG', 'batter', 'Total Bases', 1.5],
      ['Park Hae-min', 'LG', 'Kia', 'batter', 'Total Bases', 0.5],
      ['Kim Do-yeong', 'Kia', 'LG', 'batter', 'Total Bases', 2.5],
      ['Carlos Carrasco', 'LG', 'Kia', 'pitcher', 'Pitcher Strikeouts', 4.5],
      ['James Naile', 'Kia', 'LG', 'pitcher', 'Pitcher Strikeouts', 5.5],
      ['Son Ju-young', 'LG', 'Kia', 'pitcher', 'Pitcher Strikeouts', 3.5],
    ].map(([name, team, opponent, type, stat, line]) => ({ name, team, opponent, type, games: [], props: [{ stat, line, odds_type: 'standard' }] })),
  },
}

const kboTables = [
  {
    view: 'batters',
    table: '.bp-table',
    players: ['Park Jae-hyun', 'Park Hae-min', 'Kim Do-yeong'],
    labels: ['Team', 'Bat', 'Matchup', 'Opp Pitcher', 'Opp Hand', 'Wind', '2026', 'vs RHP', 'vs LHP', 'WHIP', 'OPS', 'Prop', 'PP Line', 'Projection', 'Avg/G', 'L5', 'L10', 'FULL', 'Rating', 'CG Projection', 'Variance', 'VALUE'],
  },
  {
    view: 'projections',
    table: '.so-table',
    players: ['Carlos Carrasco', 'James Naile', 'Son Ju-young'],
    labels: ['Team', 'Matchup', 'Opp BA', 'Opp K%', 'Prop', 'PP Line', 'Projection', 'L5 Hit%', 'Full Hit%', 'Rating', 'CG Projection', 'Variance', 'VALUE'],
  },
]

async function installKboTables(page) {
  await installFixtures(page, 'member')
  await installMember(page)
  await page.route('**/api/data**', async (route) => {
    const ds = new URL(route.request().url()).searchParams.get('ds')
    if (!Object.prototype.hasOwnProperty.call(kboTableData, ds)) return route.fallback()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: kboTableData[ds], updatedAt: '2026-10-20T05:00:00Z', preview: false, lockedCount: 0, tier: 'combined' }),
    })
  })
}

async function tableCards(page, selector) {
  return page.locator(selector).evaluate((table) => {
    const body = table.tBodies[0]
    const rows = [...body.rows].filter((row) => row.dataset.cardRow === 'card')
    const rootBox = (document.getElementById('root') || document.body).getBoundingClientRect()
    return {
      cardTable: table.dataset.cardTable || '',
      theadShown: getComputedStyle(table.tHead).display !== 'none',
      tracks: getComputedStyle(body).gridTemplateColumns.split(' ').filter(Boolean),
      innerWidth: Math.max(window.innerWidth, rootBox.right),
      scrollWidth: Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0),
      cards: rows.map((row) => {
        const box = row.getBoundingClientRect()
        const cells = [...row.cells]
        return {
          box: { top: box.top, left: box.left, right: box.right, bottom: box.bottom },
          name: (row.querySelector('.bp-player-identity > span, .so-player-identity > span')?.textContent || '').trim(),
          labels: cells.filter((cell) => cell.hasAttribute('data-label')).map((cell) => cell.dataset.label),
          shown: cells.filter((cell) => cell.hasAttribute('data-label')).map((cell) => getComputedStyle(cell, '::before').content.replace(/^"|"$/g, '')),
          unlabeled: cells.filter((cell) => !cell.hasAttribute('data-label') && !cell.hasAttribute('data-card-head') && cell.textContent.trim()).map((cell) => cell.textContent.trim()),
          sticksOut: cells.filter((cell) => {
            const r = cell.getBoundingClientRect()
            return r.width > 0 && (r.right > box.right + 1 || r.left < box.left - 1)
          }).map((cell) => cell.dataset.label || cell.textContent.trim()),
        }
      }),
    }
  })
}

for (const spec of kboTables) {
  test(`KBO ${spec.view} table shows two labeled cards per row on a phone`, async ({ page }) => {
    await installKboTables(page)
    await page.goto(`/?sport=kbo&page=${spec.view}`, { waitUntil: 'domcontentloaded' })
    await expect(page.locator(`${spec.table} tbody tr[data-card-row="card"]`)).toHaveCount(spec.players.length)
    const fit = await tableCards(page, spec.table)
    expect(fit.cardTable).toBe('on')
    expect(fit.theadShown, 'header row is hidden on the phone').toBe(false)
    expect(fit.tracks, `${spec.view} columns ${fit.tracks.join(' | ')}`).toHaveLength(2)
    expect(fit.scrollWidth, `${spec.view} scrollWidth`).toBeLessThanOrEqual(fit.innerWidth + 1)
    const [a, b, c] = fit.cards.map((card) => card.box)
    expect(Math.abs(a.top - b.top), `${spec.view} first two cards share a row`).toBeLessThanOrEqual(1)
    expect(a.right, `${spec.view} cards side by side`).toBeLessThanOrEqual(b.left + 1)
    expect(c.top, `${spec.view} third card wraps`).toBeGreaterThan(Math.min(a.bottom, b.bottom) - 1)
    expect(b.right, `${spec.view} row stays on screen`).toBeLessThanOrEqual(fit.innerWidth + 1)
    expect(fit.cards.map((card) => card.name).sort()).toEqual([...spec.players].sort())
    for (const card of fit.cards) {
      expect(card.labels, `${spec.view} ${card.name} labels in column order`).toEqual(spec.labels)
      expect(card.shown, `${spec.view} ${card.name} printed labels`).toEqual(spec.labels)
      expect(card.unlabeled, `${spec.view} ${card.name} unlabeled values`).toEqual([])
      expect(card.sticksOut, `${spec.view} ${card.name} cells leave the card`).toEqual([])
    }
    if (spec.view === 'projections') await expect(page.locator('.so-scroll-hint')).toBeHidden()
  })
}

test('KBO batter and pitcher tables stay tables on an iPad', async ({ browser }) => {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    viewport: { width: 820, height: 1180 },
    screen: { width: 820, height: 1180 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  })
  const page = await context.newPage()
  try {
    await installKboTables(page)
    for (const spec of kboTables) {
      await page.goto(`/?sport=kbo&page=${spec.view}`, { waitUntil: 'domcontentloaded' })
      await expect(page.locator(`${spec.table} tbody tr`).first()).toBeVisible()
      const fit = await tableCards(page, spec.table)
      expect(fit.cardTable, `${spec.view} iPad is not carded`).toBe('')
      expect(fit.theadShown, `${spec.view} iPad header row`).toBe(true)
      expect(await page.locator(spec.table).evaluate((table) => getComputedStyle(table).display)).toBe('table')
    }
  } finally {
    await context.close()
  }
})

// Matchups last 5 starts: dates and the longest KBO team names stay whole on
// the narrowest phone (nowrap cells clip, so the text must fit its cell).
const mddStart = (date, opp) => ({ date, opp, ip: '6.0', er: 3, so: 3, ha: 5, bb: 3, era: 4.5 })
const mddPitcher = (name, team) => ({
  name,
  line: 4.5,
  k_projection: 4.8,
  profile: {
    name, team, era: 4.24, whip: 1.45, k_per_9: 7.66, ip_per_g: 5.7, starts: 23,
    recent: [mddStart('09/19/2026', 'Samsung'), mddStart('09/13/2026', 'KT'), mddStart('09/05/2026', 'Hanwha'), mddStart('08/20/2026', 'Kiwoom'), mddStart('07/30/2026', 'Doosan')],
  },
})
const mddData = {
  generated_at: '2026-10-20T05:00:00Z',
  matchups: [{ away: 'Lotte', home: 'Doosan', stadium: 'Seoul-Jamsil', weather: null, market: null, away_pitcher: mddPitcher('Na Gyun-an', 'Lotte'), home_pitcher: mddPitcher('Choi Seung-yong', 'Doosan') }],
}

test('Matchups last-5 dates and team names are not clipped on a phone', async ({ page }) => {
  await installFixtures(page, 'member')
  await installMember(page)
  await page.route('**/api/data**', async (route) => {
    const ds = new URL(route.request().url()).searchParams.get('ds')
    if (ds !== 'matchup_data') return route.fallback()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: mddData, updatedAt: '2026-10-20T05:00:00Z', preview: false, lockedCount: 0, tier: 'combined' }),
    })
  })
  await page.goto('/?sport=kbo&page=matchups', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('table.mdd-recent-table[data-card-table] tbody tr').first()).toBeVisible()
  const cells = await page.locator('table.mdd-recent-table tbody td').evaluateAll((nodes) => nodes
    .filter((node) => node.dataset.label === 'Date' || node.dataset.label === 'Opp')
    .map((node) => ({ label: node.dataset.label, text: node.textContent.trim(), scroll: node.scrollWidth, client: node.clientWidth })))
  expect(cells.some((cell) => cell.text === 'Samsung'), 'fixture has a Samsung row').toBe(true)
  expect(cells.length).toBeGreaterThanOrEqual(10)
  for (const cell of cells) {
    expect(cell.scroll, `${cell.label} "${cell.text}" clipped (${cell.scroll} > ${cell.client})`).toBeLessThanOrEqual(cell.client)
  }
})
