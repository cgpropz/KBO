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
