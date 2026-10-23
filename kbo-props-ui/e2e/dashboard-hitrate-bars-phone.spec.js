import { expect, test } from '@playwright/test'

// 390px Dashboard cards in every sport: the ten mini hit-rate bars carry the
// game date with the opponent's logo underneath (#370 treatment), oldest on
// the left, all ten inside the card with no clipping and no sideways scroll.
// NBA's season pill is this season only, with its own game count.
// Dev server, owner preview, made-up rows only.

const DATES = ['10/12', '10/13', '10/14', '10/15', '10/16', '10/17', '10/18', '10/19', '10/20', '10/21']
const NEWEST_FIRST = [...DATES].reverse()
const OPPS = ['DAL', 'PHI', 'NYG', 'WAS', 'DAL', 'PHI', 'NYG', 'WAS', 'DAL', 'PHI']

function nbaLogs(season) {
  // Newest first, like the roster file.
  return NEWEST_FIRST.map((date, index) => ({
    date: `${date}/2026`, team: 'HOU', matchup: index % 2 ? 'HOU @ SAS' : 'HOU vs. DAL',
    season: season(index), min: 34, pts: 20 + index, reb: 6, ast: 4, stl: 1, blk: index % 3, tov: 2, fg3m: 2,
  }))
}

const nbaRoster = [
  // Two games this season ('2027' = 2026-27), eight from last season.
  { athleteId: '1', name: 'Synth Center', team: 'HOU', position: 'C', gp: 2, gameLogs: nbaLogs((index) => (index < 2 ? '2027' : '2026')) },
  // Ten of ten board logs this season: the true count is unknown, no pill.
  { athleteId: '2', name: 'Synth Wing', team: 'HOU', position: 'SF', gp: 10, gameLogs: nbaLogs(() => '2027') },
]
const nbaBoard = [
  { athleteId: '1', name: 'Synth Center', team: 'HOU', ppAllProps: [{ stat: 'Blocked Shots', line: 0.5, projection: 1.4, opponent: 'SAS' }] },
  { athleteId: '2', name: 'Synth Wing', team: 'HOU', ppAllProps: [{ stat: 'Points', line: 22.5, projection: 21.2, opponent: 'SAS' }] },
]

const twelveDates = ['10/10', '10/11', ...DATES]
const twelveOpps = ['NYG', 'WAS', ...OPPS]

const fixtures = {
  nba_players: nbaRoster,
  nba_projections_standard: nbaBoard,
  nfl_projections: [{
    id: 'nfl-0', player: 'Synth Receiver', team: 'DET', opponent: 'CHI', position: 'WR', prop: 'Receiving Yards',
    line: 64.5, projection: 71.2, score: 70, line_type: 'standard', dvpRank: 4,
    // Oldest → newest, longer than ten like the publisher file.
    recent: [55, 61, 70, 80, 55, 90, 60, 75, 88, 40, 95, 62],
    gameDates: twelveDates.map((date) => `2026-${date.replace('/', '-')}`),
    gameOpponents: twelveOpps,
    gameSeasons: Array(12).fill(2026),
  }],
  nhl_projections: [{
    id: 'nhl-0', player: 'Synth Skater', team: 'EDM', opponent: 'CGY', position: 'C', prop: 'Shots On Goal',
    line: 3.5, projection: 4.2, oddsType: 'standard', dvpRank: 3,
    recent: [4, 5, 3, 2, 6, 4, 1, 5, 3, 4],
    gameDates: DATES,
    chartSeasons: Array(10).fill('2026-27'),
    log: [2, 3, 4, 5, 3, 2, 6, 4, 1, 5, 3, 4],
    logDates: twelveDates,
    logOpponents: ['VAN', 'SEA', 'CGY', 'VAN', 'SEA', 'CGY', 'VAN', 'SEA', 'CGY', 'VAN', 'SEA', 'CGY'],
    hitRateL5: 60, gamesL5: 5, hitRate: 60, gamesL10: 10, seasonHitRate: 60, seasonGames: 10, seasonLabel: '2026-27',
  }],
  prizepicks_props: {
    cards: [{
      name: 'Synth Batter', team: 'Kia', type: 'batter', opponent: 'LG',
      // Newest first, one per value.
      games: NEWEST_FIRST.map((date, index) => ({ date: `2026-${date.replace('/', '-')}`, opp: index % 2 ? 'LG' : 'KT', season: 2026, tb: index % 4 })),
      props: [{ stat: 'Total Bases', line: 1.5, projection: 1.8, hit_rate_l10: 30, hit_rate_all: 30, odds_type: 'standard', recent_values: NEWEST_FIRST.map((_, index) => index % 4) }],
    }],
  },
  wnba_projections_standard: [{
    name: 'Synth Forward', player: 'Synth Forward', team: 'LVA', position: 'Forward', gp: 20,
    recentGames: NEWEST_FIRST.map((date, index) => ({ date: `2026-${date.replace('/', '-')}`, opponent: index % 2 ? 'NYL' : 'SEA', pts: 18 + index, reb: 8, ast: 3 })),
    ppAllProps: [{ stat: 'Points', line: 22.5, projection: 24, opponent: 'NYL' }],
  }],
  wnba_players: [{ name: 'Synth Forward', team: 'LVA', position: 'F' }],
  nfl_sharp_odds: { records: [], status: 'ok' },
  nhl_sharp_odds: { records: [], status: 'ok' },
  nba_sharp_odds: { records: [], status: 'ok' },
}

async function installFixtures(page) {
  await page.route('**/api/data**', async (route) => {
    const ds = new URL(route.request().url()).searchParams.get('ds')
    const data = Object.prototype.hasOwnProperty.call(fixtures, ds) ? fixtures[ds] : []
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data, updatedAt: '2026-10-23T12:00:00Z', preview: false, lockedCount: 0, tier: 'owner' }),
    })
  })
  await page.route('**/data/**/*.json', async (route) => {
    const url = route.request().url()
    const data = url.includes('nba/players') ? nbaRoster : url.includes('nba/projections_standard') ? nbaBoard : []
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
  })
  await page.route('https://site.api.espn.com/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"events":[]}' }))
  // Every logo and headshot is a 1px image, so nothing reaches a real host.
  const pixel = { status: 200, contentType: 'image/webp', body: Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AA/vuUAAA=', 'base64') }
  await page.route('**/api/img**', (route) => route.fulfill(pixel))
  await page.route('https://a.espncdn.com/**', (route) => route.fulfill(pixel))
  await page.route('https://assets.nhle.com/**', (route) => route.fulfill(pixel))
}

async function expectTenFittedBars(page, card, expectedDates, label) {
  const bars = card.getByTestId('mini-hit-bars')
  await expect(bars, `${label} chart`).toBeVisible()
  const labels = bars.getByTestId('hr-game-label')
  await expect(labels, `${label} labels`).toHaveCount(10)
  // Oldest on the left, newest on the right.
  await expect(bars.locator('.hr-game-date')).toHaveText(expectedDates)
  const geometry = await bars.evaluate((root) => {
    const rect = (el) => el.getBoundingClientRect()
    const cardBox = rect(root.closest('[data-testid="prop-line-card"]') || root)
    const barEls = [...root.firstElementChild.children]
    return {
      cardBox: { left: cardBox.left, right: cardBox.right },
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
  expect(geometry.bars, `${label} bar count`).toHaveLength(10)
  geometry.labels.forEach((item, index) => {
    expect(item.dateClipped, `${label} date ${index} clipped`).toBe(false)
    expect(item.markVisible, `${label} logo ${index}`).toBe(true)
    expect(item.dateLeft, `${label} date ${index} left`).toBeGreaterThanOrEqual(geometry.cardBox.left)
    expect(item.dateRight, `${label} date ${index} right`).toBeLessThanOrEqual(geometry.cardBox.right)
    expect(item.dateRight, `${label} date ${index} in viewport`).toBeLessThanOrEqual(390)
    if (index > 0) expect(item.dateLeft, `${label} dates ${index - 1}/${index} overlap`).toBeGreaterThanOrEqual(geometry.labels[index - 1].dateRight - 0.5)
    // Each label sits under its own bar.
    const bar = geometry.bars[index]
    const centre = (item.left + item.right) / 2
    expect(centre, `${label} label ${index} under its bar`).toBeGreaterThanOrEqual(bar.left - 1)
    expect(centre, `${label} label ${index} under its bar`).toBeLessThanOrEqual(bar.right + 1)
  })
}

async function noSidewaysScroll(page, label) {
  const width = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth))
  expect(width, `${label} scrollWidth`).toBeLessThanOrEqual(390)
}

test.beforeEach(async ({ page }) => {
  await installFixtures(page)
})

test('NBA dashboard card: dated bars with logos, season pill for this season only', async ({ page }) => {
  expect(page.viewportSize().width).toBe(390)
  await page.goto('/?sport=nba&previewTier=owner', { waitUntil: 'load' })
  const center = page.getByTestId('prop-line-card').filter({ hasText: 'Synth Center' })
  await expect(center).toBeVisible()
  await expectTenFittedBars(page, center, DATES, 'nba')
  const strip = center.locator('.hit-rate-strip')
  await expect(strip).toContainText("'26-27")
  await expect(strip).not.toContainText('Season')
  // Two games this season, not the ten the L10 pill counts.
  const seasonPill = strip.locator('.hit-rate-pill').filter({ has: page.locator('.hit-rate-pill-k', { hasText: "'26-27" }) })
  await expect(seasonPill.locator('.hit-rate-pill-n')).toHaveText('2 gm')

  const wing = page.getByTestId('prop-line-card').filter({ hasText: 'Synth Wing' })
  await expect(wing).toBeVisible()
  await expect(wing).toContainText('L10')
  await expect(wing).not.toContainText("'26-27")
  await expect(wing).not.toContainText('Season')
  await noSidewaysScroll(page, 'nba')
})

const others = [
  ['wnba', '/?sport=wnba&previewTier=owner', 'Synth Forward'],
  ['nfl', '/?sport=nfl&previewTier=owner', 'Synth Receiver'],
  ['nhl', '/?sport=nhl&previewTier=owner', 'Synth Skater'],
  ['kbo', '/?sport=kbo&previewTier=owner', 'Synth Batter'],
]

for (const [sport, path, name] of others) {
  test(`${sport} dashboard card: ten dated bars fit at 390px`, async ({ page }) => {
    await page.goto(path, { waitUntil: 'load' })
    const card = page.getByTestId('prop-line-card').filter({ hasText: name }).first()
    await expect(card).toBeVisible()
    await expectTenFittedBars(page, card, DATES, sport)
    await noSidewaysScroll(page, sport)
  })
}
