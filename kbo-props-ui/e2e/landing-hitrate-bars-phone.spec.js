import { expect, test } from '@playwright/test'

// 390px Sports Hub player drilldown: the L10 bars carry the same game date
// and opponent logo as the board charts (#385), oldest on the left.
// Dev server, owner preview, made-up rows only.

const DATES = ['10/12', '10/13', '10/14', '10/15', '10/16', '10/17', '10/18', '10/19', '10/20', '10/22']
const NEWEST = [...DATES].reverse()
const OPPS = ['BOS', 'PHI', 'NYK', 'MIA', 'CHI', 'MIL', 'DEN', 'DAL', 'LAL', 'GSW']
const PTS = [18, 11, 22, 8, 16, 14, 9, 21, 13, 19]

function sarrLogs() {
  return NEWEST.map((date, index) => ({
    date: `${date}/2026`,
    matchup: index % 2 ? `WAS @ ${OPPS[index]}` : `WAS vs. ${OPPS[index]}`,
    min: 28,
    pts: PTS[index],
    reb: 8,
    ast: 3,
    stl: 1,
    blk: 2,
    tov: 2,
    fg3m: 1,
    season: '2027',
  }))
}

const fixtures = {
  nba_players: [{ athleteId: 'sarr', name: 'Alex Sarr', team: 'WAS', position: 'C', gp: 10, gameLogs: sarrLogs() }],
  nba_projections_standard: [{
    athleteId: 'sarr',
    name: 'Alex Sarr',
    team: 'WAS',
    avgMins: 30,
    ppAllProps: [{
      stat: 'Points',
      line: 14.5,
      standardLine: 14.5,
      projection: 17.2,
      rating: 84,
      odds_type: 'standard',
      opponent: 'BOS',
      start_time: '2026-10-24T23:00:00Z',
      l10Values: PTS,
    }],
  }],
  member_recap: { sports: {} },
  player_photos: {},
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/data**', async (route) => {
    const ds = new URL(route.request().url()).searchParams.get('ds')
    const data = Object.prototype.hasOwnProperty.call(fixtures, ds) ? fixtures[ds] : []
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data, updatedAt: '2026-10-24T12:00:00Z', preview: false, lockedCount: 0, tier: 'owner' }),
    })
  })
  await page.route('**/api/nba-access**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ open: true }),
  }))
  const pixel = {
    status: 200,
    contentType: 'image/webp',
    body: Uint8Array.from(atob('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AA/vuUAAA='), (char) => char.charCodeAt(0)),
  }
  await page.route('**/api/img**', (route) => route.fulfill(pixel))
  await page.route('https://a.espncdn.com/**', (route) => route.fulfill(pixel))
})

test('NBA landing drilldown: ten dated bars with logos fit at 390px', async ({ page }) => {
  expect(page.viewportSize().width).toBe(390)
  await page.goto('/?previewTier=owner', { waitUntil: 'load' })
  await page.getByRole('button', { name: 'NBA', exact: true }).click()
  const drill = page.getByRole('region', { name: 'Player drilldown' })
  await expect(drill.getByText('Alex Sarr').first()).toBeVisible()
  const chart = drill.getByTestId('hub-l10-chart')
  await expect(chart).toBeVisible()
  const labels = chart.getByTestId('hr-game-label')
  await expect(labels).toHaveCount(10)
  await expect(chart.locator('.hr-game-date')).toHaveText(DATES)
  await expect(chart.locator('.hr-game-logo')).toHaveCount(10)

  const geometry = await chart.evaluate((root) => {
    const rect = (el) => el.getBoundingClientRect()
    const card = rect(root.closest('.hub-drill') || root)
    const barEls = [...root.querySelectorAll('.hub-bar')]
    return {
      cardBox: { left: card.left, right: card.right },
      bars: barEls.map((el) => ({ left: rect(el).left, right: rect(el).right })),
      labels: [...root.querySelectorAll('[data-testid="hr-game-label"]')].map((el) => {
        const date = el.querySelector('.hr-game-date')
        const mark = el.querySelector('.hr-game-logo, .hr-game-abbr')
        return {
          left: rect(el).left,
          right: rect(el).right,
          dateLeft: rect(date).left,
          dateRight: rect(date).right,
          dateClipped: date.scrollWidth > date.clientWidth + 0.5,
          markVisible: Boolean(mark) && rect(mark).width > 0 && rect(mark).height > 0,
        }
      }),
    }
  })
  expect(geometry.bars).toHaveLength(10)
  geometry.labels.forEach((item, index) => {
    expect(item.dateClipped, `date ${index} clipped`).toBe(false)
    expect(item.markVisible, `logo ${index}`).toBe(true)
    expect(item.dateLeft).toBeGreaterThanOrEqual(geometry.cardBox.left - 0.5)
    expect(item.dateRight).toBeLessThanOrEqual(geometry.cardBox.right + 0.5)
    expect(item.dateRight).toBeLessThanOrEqual(390)
    if (index > 0) expect(item.dateLeft, `dates ${index - 1}/${index} overlap`).toBeGreaterThanOrEqual(geometry.labels[index - 1].dateRight - 0.5)
    const bar = geometry.bars[index]
    const centre = (item.left + item.right) / 2
    expect(centre, `label ${index} under its bar`).toBeGreaterThanOrEqual(bar.left - 1)
    expect(centre, `label ${index} under its bar`).toBeLessThanOrEqual(bar.right + 1)
  })
  const width = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth))
  expect(width).toBeLessThanOrEqual(390)
})
