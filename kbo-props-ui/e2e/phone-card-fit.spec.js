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

test('NFL edge board uses two cards per row without clipping names or labels', async ({ page }) => {
  for (const row of edgeRows) {
    expect(row.hitRate, `${row.player} hit rate scale`).toBeGreaterThan(1)
    expect(row.hitRate, `${row.player} hit rate scale`).toBeLessThanOrEqual(100)
  }
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
  await page.goto('/?sport=nfl&page=projections', { waitUntil: 'domcontentloaded' })
  const cards = page.locator('.nfl-edge-card')
  await expect(cards).toHaveCount(edgeRows.length)
  await expect(page.locator('.nfl-board-meta')).toContainText('LIVE MODEL / DVP ADJUSTED')
  const fit = await page.locator('.nfl-edge-grid').evaluate((grid, labels) => {
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
    return {
      tracks,
      innerWidth: window.innerWidth,
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
        return {
          name: (name?.textContent || '').replace(/\s+/g, ' ').trim(),
          box: cardBox,
          pieces,
          labels: labelNodes.map((node) => (node.textContent || '').replace(/\s+/g, ' ').trim()),
          hitRate: [...card.querySelectorAll('.nfl-card-meta div')].find((node) => (node.querySelector('small')?.textContent || '').trim() === 'HIT RATE')?.querySelector('strong')?.textContent?.trim() || '',
        }
      }),
      expectedLabels: labels,
    }
  }, edgeLabels)
  expect(fit.tracks, `columns ${fit.tracks.join(' | ')}`).toHaveLength(2)
  expect(fit.scrollWidth, 'edge board scrollWidth').toBeLessThanOrEqual(fit.innerWidth + 1)
  const boxes = fit.cards.map((card) => card.box)
  expect(boxes[0].top, 'first row').toBeLessThanOrEqual(boxes[1].top + 1)
  expect(boxes[1].top, 'first row').toBeLessThanOrEqual(boxes[0].top + 1)
  expect(boxes[0].right, 'two cards share the row').toBeLessThanOrEqual(boxes[1].left + 1)
  expect(boxes[2].top, 'third card wraps').toBeGreaterThan(boxes[0].bottom - 1)
  expect(boxes[1].right, 'row stays in the viewport').toBeLessThanOrEqual(fit.innerWidth + 1)
  const names = fit.cards.map((card) => card.name)
  expect(names).toEqual(expect.arrayContaining(edgeRows.map((row) => row.player)))
  for (const card of fit.cards) {
    expect(card.labels, card.name).toEqual(edgeLabels)
    for (const piece of card.pieces) {
      expect(piece.clipped, `${card.name} clips ${piece.text}`).toBe(false)
      expect(piece.sticksOut, `${card.name} ${piece.text} leaves the card`).toBe(false)
    }
    expect(card.hitRate, `${card.name} hit rate`).toMatch(/^(60|70|80)%$/)
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

// Code Green's phone: on the spread/total game cards the CG NUMBER label,
// the projected score and the away/home tags sat on top of HOU JAX. The
// header now stacks (logo HOU @ JAX logo, label, each score under its team)
// whenever the page itself is phone-narrow. That includes Safari "Request
// Desktop Website": a 980px viewport with #root zoomed to the phone width,
// where viewport media queries still see a desktop.
const gameMarkets = {
  generated_at: '2026-10-18T09:00:00Z',
  status: 'ok',
  week: 7,
  model: { label: 'Test model' },
  games: [
    { id: 'hou-jax', awayTeam: 'HOU', homeTeam: 'JAX', awayScore: 21, homeScore: 24, gameday: '2026-10-25', gametime: '09:30', spread: { line: -2.5, projection: -3, edge: -0.5 }, total: { line: 42, projection: 45, edge: 3 } },
    { id: 'car-phi', awayTeam: 'CAR', homeTeam: 'PHI', awayScore: 22, homeScore: 22, gameday: '2026-10-25', gametime: '13:00', spread: { line: -3, projection: 0, edge: 3 }, total: { line: 39, projection: 44, edge: 5 } },
  ],
}

async function openGameMarkets(page) {
  await page.route('**/api/data**', async (route) => {
    const ds = new URL(route.request().url()).searchParams.get('ds')
    const data = ds === 'nfl_game_markets' ? gameMarkets : (Object.prototype.hasOwnProperty.call(fixtures, ds) ? fixtures[ds] : [])
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data, updatedAt: '2026-10-18T09:00:00Z', preview: false, lockedCount: 0, tier: 'combined' }),
    })
  })
  await installMember(page)
  await page.goto('/?sport=nfl', { waitUntil: 'domcontentloaded' })
  const menu = page.locator('.cg-menu-btn')
  if (await menu.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false)) await menu.click()
  await page.getByRole('button', { name: 'Game Markets' }).click()
  await expect(page.locator('.nfl-market-card')).toHaveCount(gameMarkets.games.length)
  await page.waitForTimeout(300)
}

async function gameHeaderLayout(page) {
  return page.locator('.nfl-game-board').evaluate((board) => {
    const boxOf = (node) => {
      if (!node) return null
      const box = node.getBoundingClientRect()
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height }
    }
    const zoom = Number(getComputedStyle(document.getElementById('root')).zoom) || 1
    const cards = [...board.querySelectorAll('.nfl-market-card')].map((card) => {
      const head = card.querySelector('.nfl-market-matchup')
      const part = (selector) => boxOf(head.querySelector(selector))
      const tiles = [...card.querySelectorAll('.nfl-market-tile')].map((tile) => {
        const value = tile.querySelector('strong, em')
        return { inside: boxOf(value).right <= boxOf(tile).right - 4, clipped: value.scrollWidth > value.clientWidth + 1 }
      })
      return {
        parts: {
          awayLogo: part('.is-away img, .is-away .nfl-market-fallback'),
          away: part('.is-away b'),
          at: part('.nfl-market-at'),
          home: part('.is-home b'),
          homeLogo: part('.is-home img, .is-home .nfl-market-fallback'),
          label: part('.nfl-market-cg-label'),
          awayScore: part('.nfl-market-score.is-away'),
          sep: part('.nfl-market-score-sep'),
          homeScore: part('.nfl-market-score.is-home'),
          awayTag: part('.is-away small'),
          homeTag: part('.is-home small'),
        },
        tiles,
        gridColumns: getComputedStyle(card.querySelector('.nfl-market-grid')).gridTemplateColumns.split(' ').filter(Boolean).length,
        share: boxOf(card.querySelector('.nfl-market-share')),
      }
    })
    return {
      zoom,
      boardColumns: getComputedStyle(board).gridTemplateColumns.split(' ').filter(Boolean).length,
      scrolls: document.documentElement.scrollWidth > window.innerWidth + 1,
      cards,
    }
  })
}

function expectStackedHeader(layout, label) {
  expect(layout.scrolls, `${label} scrolls sideways`).toBe(false)
  expect(layout.boardColumns, `${label} board columns`).toBe(1)
  for (const [index, card] of layout.cards.entries()) {
    const name = `${label} card ${index + 1}`
    const { parts } = card
    expect(parts.at, `${name} shows HOU @ JAX`).not.toBeNull()
    expect(parts.at.width, `${name} shows HOU @ JAX`).toBeGreaterThan(0)
    expect(parts.awayTag?.width || 0, `${name} hides the away tag`).toBe(0)
    expect(parts.homeTag?.width || 0, `${name} hides the home tag`).toBe(0)
    const shown = Object.entries(parts).filter(([, box]) => box && box.width > 0)
    for (let i = 0; i < shown.length; i += 1) {
      for (let j = i + 1; j < shown.length; j += 1) {
        expect(overlaps(shown[i][1], shown[j][1]), `${name} ${shown[i][0]} overlaps ${shown[j][0]}`).toBe(false)
      }
    }
    expect(parts.label.top, `${name} label sits under the teams`).toBeGreaterThanOrEqual(parts.away.bottom - 1)
    expect(parts.awayScore.top, `${name} scores sit under the label`).toBeGreaterThanOrEqual(parts.label.bottom - 1)
    expect(Math.abs(parts.awayScore.right - parts.away.right), `${name} away score under away team`).toBeLessThanOrEqual(2)
    expect(Math.abs(parts.homeScore.left - parts.home.left), `${name} home score under home team`).toBeLessThanOrEqual(2)
    expect(card.gridColumns, `${name} stat tiles in one column`).toBe(1)
    for (const tile of card.tiles) {
      expect(tile.inside, `${name} tile value touches its edge`).toBe(true)
      expect(tile.clipped, `${name} tile value clips`).toBe(false)
    }
    // 44px tap target in CSS px, before the #root zoom is applied.
    expect(card.share.height / layout.zoom, `${name} share height`).toBeGreaterThanOrEqual(43.5)
    expect(card.share.width / layout.zoom, `${name} share width`).toBeGreaterThanOrEqual(43.5)
  }
}

test('NFL game card header stacks without overlap on a phone', async ({ page }, testInfo) => {
  await openGameMarkets(page)
  expectStackedHeader(await gameHeaderLayout(page), testInfo.project.name)
})

test('NFL game card header stacks in Safari desktop-site mode', async ({ browser, browserName }, testInfo) => {
  test.skip(!testInfo.project.name.endsWith('-390'), 'one desktop-site pass per engine')
  const context = await browser.newContext({
    baseURL: 'http://127.0.0.1:4173',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
    viewport: { width: 980, height: 844 },
    screen: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  })
  const page = await context.newPage()
  await openGameMarkets(page)
  const layout = await gameHeaderLayout(page)
  expect(layout.zoom, `${browserName} desktop-site zooms #root to the phone`).toBeGreaterThan(1.5)
  expectStackedHeader(layout, `${browserName} desktop-site`)
  await context.close()
})

test('NFL game card header keeps the wide layout on a desktop window', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-390', 'one desktop pass')
  // Spell out every phone option: contexts made here inherit the project's.
  const context = await browser.newContext({
    baseURL: 'http://127.0.0.1:4173',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 },
    screen: { width: 1280, height: 900 },
    isMobile: false,
    hasTouch: false,
    deviceScaleFactor: 1,
  })
  const page = await context.newPage()
  await openGameMarkets(page)
  const layout = await gameHeaderLayout(page)
  expect(layout.zoom).toBe(1)
  expect(layout.boardColumns).toBeGreaterThan(1)
  for (const card of layout.cards) {
    expect(card.parts.at.width, 'no @ row on desktop').toBe(0)
    expect(card.parts.awayTag.width, 'away tag on desktop').toBeGreaterThan(0)
    expect(card.gridColumns, 'two stat columns on desktop').toBe(2)
    // Clubs left and right, CG number between them.
    expect(card.parts.away.right).toBeLessThan(card.parts.label.left)
    expect(card.parts.home.left).toBeGreaterThan(card.parts.label.right)
    expect(Math.abs(card.parts.awayScore.top - card.parts.homeScore.top)).toBeLessThanOrEqual(1)
  }
  await context.close()
})
