import { expect, test } from '@playwright/test'

// 390px Players list on the dev server, owner preview, synthetic rows only.

// thisSeason: how many of the newest games are 2026-27; the rest are 2025-26.
function logs(points, thisSeason = points.length) {
  return points.map((pts, index) => ({
    date: `10/${21 - index}/2026`, team: 'DEN', matchup: 'DEN vs. LAL', season: index < thisSeason ? '2027' : '2026',
    min: 32 - index, usg: 20 + (index % 3), pts, reb: 6, ast: 4, stl: 1, blk: 1, tov: 2, fg3m: 2, fta: 3 + (index % 3),
  }))
}

// Every card's MIN / USG line is fully visible: inside the card, not cut off,
// and not under the prop pill.
async function trendLineProblems(page) {
  return page.evaluate(() => {
    const problems = []
    const inside = (inner, outer) => inner.left >= outer.left - 0.5 && inner.right <= outer.right + 0.5
      && inner.top >= outer.top - 0.5 && inner.bottom <= outer.bottom + 0.5
    const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
    document.querySelectorAll('[data-testid="nba-player-card"]').forEach((card, index) => {
      const line = card.querySelector('[data-testid="nba-card-trends"]')
      if (!line) return
      const cardBox = card.getBoundingClientRect()
      const lineBox = line.getBoundingClientRect()
      if (!inside(lineBox, cardBox)) problems.push(`card ${index}: line outside card`)
      if (line.scrollWidth > line.clientWidth + 1) problems.push(`card ${index}: line overflows`)
      const pill = card.querySelector('.nba-plist-prop')
      line.querySelectorAll('.nba-plist-trend, .nba-plist-trend-base').forEach((item) => {
        const box = item.getBoundingClientRect()
        if (!inside(box, lineBox) || !inside(box, cardBox)) problems.push(`card ${index}: ${item.textContent} clipped`)
        if (pill && overlaps(box, pill.getBoundingClientRect())) problems.push(`card ${index}: ${item.textContent} under the prop`)
      })
    })
    return problems
  })
}

const roster = [
  { athleteId: '1', name: 'Synth Guard', team: 'DEN', teamColor: '#0e2240', position: 'PG', gp: 70, pts: 21.4, reb: 4.1, ast: 7.2, gameLogs: logs([25, 22, 18, 30, 24, 19, 27, 21, 26, 23]) },
  { athleteId: '2', name: 'Synth Center', team: 'LAL', teamColor: '#552583', position: 'C', gp: 64, pts: 12.2, reb: 10.5, ast: 2.1, summaryTeam: 'BOS', gameLogs: logs([10, 14, 9, 12, 8, 11, 13, 7, 12, 10], 2) },
  { athleteId: '3', name: 'Synth Bench', team: 'MIA', teamColor: '#98002e', position: 'SF', gp: 0, gameLogs: [] },
]

const board = [
  { athleteId: '1', name: 'Synth Guard', team: 'DEN', ppAllProps: [{ stat: 'Points', line: 20.5, projection: 25, opponent: 'LAL' }] },
  { athleteId: '2', name: 'Synth Center', team: 'LAL', ppAllProps: [{ stat: 'Free Throws Attempted', line: 3.5, projection: 4, opponent: 'DEN' }] },
]

const scoreboard = {
  events: [{
    date: '2026-10-23T23:30Z',
    status: { type: { state: 'pre' } },
    competitions: [{
      date: '2026-10-23T23:30Z',
      competitors: [
        { homeAway: 'home', team: { abbreviation: 'DEN' } },
        { homeAway: 'away', team: { abbreviation: 'LAL' } },
      ],
    }],
  }],
}

async function installFixtures(page) {
  await page.route('**/api/data**', async (route) => {
    const ds = new URL(route.request().url()).searchParams.get('ds')
    const data = ds === 'nba_players' ? roster : ds === 'nba_projections_standard' ? board : []
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data, updatedAt: '2026-10-23T12:00:00Z', preview: false, lockedCount: 0, tier: 'owner' }),
    })
  })
  await page.route('**/data/nba/*.json', async (route) => {
    const url = route.request().url()
    const data = url.includes('players.json') ? roster : url.includes('projections_standard') ? board : []
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
  })
  await page.route('https://site.api.espn.com/**', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(scoreboard),
  }))
  await page.route('**/api/img**', (route) => route.fulfill({
    status: 200,
    contentType: 'image/webp',
    body: Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AA/vuUAAA=', 'base64'),
  }))
}

test('NBA Players list fits 390px, filters, sorts, and opens a profile', async ({ page }) => {
  expect(page.viewportSize().width).toBe(390)
  await installFixtures(page)
  await page.goto('/?sport=nba&nbaTab=players&previewTier=owner', { waitUntil: 'load' })

  const cards = page.getByTestId('nba-player-card')
  // Game day: Playing today starts on, so the player with no game is hidden.
  await expect(cards).toHaveCount(2)
  await expect(page.getByRole('switch', { name: 'Playing today' })).toHaveAttribute('aria-checked', 'true')
  await expect(cards.first()).toContainText('Synth Guard')
  await expect(cards.first()).toContainText('vs LAL')
  await expect(cards.first()).toContainText('L10')
  await expect(cards.nth(1)).toContainText('@ DEN')
  // L5 minutes (32..28 = 30.0) run above the season (27.5): MIN ↑. Usage is flat.
  const trends = cards.first().getByTestId('nba-card-trends')
  await expect(trends).toContainText('MIN↑30.0')
  await expect(trends).toContainText('USG→21%')
  await expect(cards.nth(1)).toContainText('BOS')
  // 2 games this season: L5 averages, but no arrow and no last-season label.
  const early = cards.nth(1).getByTestId('nba-card-trends')
  await expect(early).toContainText('MIN30.0')
  await expect(early).toContainText('USG21%')
  await expect(early.locator('b')).toHaveCount(0)
  await expect(early).not.toContainText('vs')
  await expect(early).not.toContainText("'25-26")
  await expect(trends).not.toContainText('vs')
  // The long prop name does not clip the line on any card.
  await expect(cards.nth(1)).toContainText('Free Throws Attempted')
  expect(await trendLineProblems(page)).toEqual([])

  // No player without a slot, so there is no Unset chip.
  await expect(page.locator('.nba-plist-chip', { hasText: 'Unset' })).toHaveCount(0)

  await page.getByRole('switch', { name: 'Playing today' }).click()
  await expect(cards).toHaveCount(3)
  expect(await trendLineProblems(page)).toEqual([])

  await page.getByLabel('Sort by').selectOption('name')
  await expect(cards.first()).toContainText('Synth Bench')

  await page.locator('.nba-plist-chip', { hasText: 'C' }).first().click()
  await expect(cards).toHaveCount(1)
  await expect(cards.first()).toContainText('Synth Center')

  const fit = await page.evaluate(() => {
    const card = document.querySelector('[data-testid="nba-player-card"]').getBoundingClientRect()
    return {
      scrollWidth: Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0),
      innerWidth: window.innerWidth,
      cardRight: card.right,
      cardHeight: card.height,
    }
  })
  expect(fit.scrollWidth).toBeLessThanOrEqual(fit.innerWidth)
  expect(fit.cardRight).toBeLessThanOrEqual(fit.innerWidth)
  // Name, meta and season line beside the prop, then the MIN / USG row.
  // Since #381 the long "Free Throws Attempted" pill label wraps rather than
  // clipping the name: this card measures ~117px (default and DejaVu Sans).
  expect(fit.cardHeight).toBeLessThan(125)
  expect(await trendLineProblems(page)).toEqual([])

  await cards.first().click()
  await expect(page.getByRole('heading', { name: 'Synth Center' })).toBeVisible()
  await expect(page.getByRole('button', { name: '← Players' })).toBeVisible()

  // Minutes & Usage under the hit-rate chart: two charts, same L10 window.
  const section = page.getByTestId('nba-minutes-usage')
  await expect(section).toBeVisible()
  await expect(section.getByTestId('nba-mu-min').locator('.nba-mu-col')).toHaveCount(10)
  await expect(section.getByTestId('nba-mu-usg').locator('.nba-mu-col')).toHaveCount(10)
  await expect(section.getByTestId('nba-mu-min')).toContainText('L5')
  // 2 games this season: no arrow and no early-season label on the profile.
  await expect(section.locator('.nba-mu-trend')).toHaveCount(0)
  await expect(section).not.toContainText("'25-26")
  // Header text (label, arrow, L5 / L10 / Season) stays inside each chart.
  const headClipped = await page.evaluate(() => [...document.querySelectorAll('.nba-mu-metric')].flatMap((metric) => {
    const box = metric.getBoundingClientRect()
    return [...metric.querySelectorAll('.nba-mu-head > *, .nba-mu-avgs > span')]
      .filter((el) => { const r = el.getBoundingClientRect(); return r.left < box.left - 0.5 || r.right > box.right + 0.5 })
      .map((el) => el.textContent)
  }))
  expect(headClipped).toEqual([])
  // The tallest bar's value sits below the header row.
  const labelGap = await page.evaluate(() => {
    const metric = document.querySelector('[data-testid="nba-mu-min"]')
    const head = metric.querySelector('.nba-mu-head').getBoundingClientRect()
    const top = Math.min(...[...metric.querySelectorAll('.nba-mu-bar i')].map((el) => el.getBoundingClientRect().top))
    return top - head.bottom
  })
  expect(labelGap).toBeGreaterThanOrEqual(4)
  const profileFit = await page.evaluate(() => {
    const box = document.querySelector('[data-testid="nba-minutes-usage"]').getBoundingClientRect()
    return {
      scrollWidth: Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0),
      innerWidth: window.innerWidth,
      right: box.right,
    }
  })
  expect(profileFit.scrollWidth).toBeLessThanOrEqual(profileFit.innerWidth)
  expect(profileFit.right).toBeLessThanOrEqual(profileFit.innerWidth)
})
