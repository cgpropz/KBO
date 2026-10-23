// Made-up players and numbers for the player-page Insights preview specs.
import { Buffer } from 'node:buffer'

const nflBase = {
  team: 'AAA',
  opponent: 'BBB',
  position: 'WR',
  gameDates: ['9/7', '9/14', '9/21', '9/28', '10/5', '10/12'],
  gameSeasons: [2026, 2026, 2026, 2026, 2026, 2026],
  gameOpponents: ['BBB', 'CCC', 'DDD', 'BBB', 'CCC', 'DDD'],
  recentSnapPercents: [81, 77, 90, 84, 88, 79],
  recentUsage: [7, 9, 11, 6, 10, 8],
  usageLabel: 'Targets',
  dvpRank: 9,
  line_type: 'standard',
}

const kboGames = Array.from({ length: 12 }, (_, index) => ({
  date: `2026-10-${String(20 - index).padStart(2, '0')}`,
  season: 2026,
  opp: index % 2 ? 'Synth B' : 'Synth C',
  opp_hand: index % 3 ? 'R' : 'L',
  h: index % 3, r: index % 2, rbi: (index + 1) % 3, ab: 4, bb: index % 2, tb: (index % 3) + (index % 4 === 0 ? 2 : 0),
  hr: index % 4 === 0 ? 1 : 0, fs: 6 + index, hrr: (index % 3) + (index % 2) + ((index + 1) % 3),
}))

const wnbaGames = Array.from({ length: 10 }, (_, index) => ({
  date: `09/${String(20 - index).padStart(2, '0')}/2026`,
  matchup: index % 2 ? 'SYA @ SYB' : 'SYA vs. SYC',
  opponent: index % 2 ? 'SYB' : 'SYC',
  min: 30 + (index % 4), pts: 15 + index, reb: 7, ast: 3, stl: 1, blk: 1, tov: 2,
  fga: 14, fgm: 6, fg3a: 4, fg3m: 1, fta: 4, ftm: 3, oreb: 2, dreb: 5, usagePct: 24,
}))


function nbaLog(index, pts) {
  const day = 22 - index
  const month = day > 0 ? 10 : 4
  const date = day > 0 ? `10/${String(day).padStart(2, '0')}/2026` : `04/${String(14 + day).padStart(2, '0')}/2026`
  return {
    date, season: day > 0 ? '2027' : '2026', team: 'SYA', matchup: index % 2 ? 'SYA @ SYB' : 'SYA vs. SYC', result: index % 3 ? 'W' : 'L',
    min: 30 + (index % 5), pts, reb: 6 + (index % 3), ast: 4, stl: 1, blk: 1, tov: 2, fga: 16, fgm: 7, fg3a: 6, fg3m: 2, fta: 5, ftm: 4,
    oreb: 2, dreb: 4, usg: 24, position: 'G', month,
  }
}

const nbaRoster = [{
  athleteId: '901', name: 'Synth Guard', team: 'SYA', teamColor: '#123456', position: 'PG', gp: 12, pts: 21, reb: 6, ast: 4,
  gameLogs: [24, 18, 30, 22, 15, 27, 19, 25, 21, 28, 17, 23].map((pts, index) => nbaLog(index, pts)),
}]

const nbaBoard = [{
  athleteId: '901', name: 'Synth Guard', team: 'SYA', ppAllProps: [
    { stat: 'Points', line: 21.5, projection: 23, opponent: 'SYB' },
    { stat: 'Rebounds', line: 6.5, projection: 6.1, opponent: 'SYB' },
  ],
}]

export const fixtures = {
  nfl_projections: [
    { ...nflBase, id: 'nfl-1', player: 'Synth Receiver', prop: 'Receiving Yards', line: 61.5, projection: 64, recent: [55, 72, 90, 41, 77, 66] },
    { ...nflBase, id: 'nfl-2', player: 'Synth Receiver', prop: 'Receptions', line: 4.5, projection: 5, recent: [4, 6, 8, 3, 7, 5] },
  ],
  nhl_projections: [{
    id: 'nhl-1', player: 'Synth Center', team: 'AAA', opponent: 'BBB', position: 'C', prop: 'Shots On Goal', line: 2.5, projection: 3,
    recent: [3, 2, 4, 1, 3], log: [3, 2, 4, 1, 3], logDates: ['10/10', '10/12', '10/14', '10/16', '10/18'],
    logSeasons: ['2026-27', '2026-27', '2026-27', '2026-27', '2026-27'], logOpponents: ['BBB', 'CCC', 'DDD', 'BBB', 'CCC'],
    oddsType: 'standard',
  }],
  prizepicks_props: {
    cards: [{
      name: 'Synth Hitter', team: 'Synth A', type: 'batter', opponent: 'Synth B', games: kboGames,
      props: [{ stat: 'Hits+Runs+RBIs', line: 1.5, projection: 1.8, odds_type: 'standard', recent_values: [2, 1, 0, 1, 2, 1, 3, 0, 1, 2] }],
    }],
  },
  wnba_projections_standard: [{
    name: 'Synth Forward', player: 'Synth Forward', team: 'SYA', position: 'Forward', projPts: 20, gp: 10, recentGames: wnbaGames,
    ppAllProps: [{ stat: 'Points', line: 18.5, projection: 20, opponent: 'SYB' }],
  }],
  wnba_players: [{ name: 'Synth Forward', team: 'SYA', position: 'F' }],
  nfl_sharp_odds: { records: [], status: 'ok' },
  nhl_sharp_odds: { records: [], status: 'ok' },
  wnba_sharp_odds: { records: [], status: 'ok' },
  nba_players: nbaRoster,
  nba_projections_standard: nbaBoard,
  nba_sharp_odds: { records: [], status: 'ok' },
}


export async function installFixtures(page, { member = false } = {}) {
  await page.route('**/api/data**', async (route) => {
    const ds = new URL(route.request().url()).searchParams.get('ds')
    const data = Object.prototype.hasOwnProperty.call(fixtures, ds) ? fixtures[ds] : []
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data, updatedAt: '2026-10-11T20:00:00Z', preview: !member, lockedCount: member ? 0 : 4, tier: member ? 'combined' : 'free' }),
    })
  })
  await page.route('**/api/img**', (route) => route.fulfill({
    status: 200, contentType: 'image/webp', body: Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AA/vuUAAA=', 'base64'),
  }))
  await page.route('https://site.api.espn.com/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"events":[]}' }))
}

export async function expectFits(page, label, expect) {
  const box = await page.evaluate(() => ({
    scrollWidth: Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0),
    innerWidth: window.innerWidth,
  }))
  expect(box.scrollWidth, `${label} scrollWidth`).toBeLessThanOrEqual(box.innerWidth)
}

// Checks the stacked Splits and Advanced stats cards, opens the Advanced
// picker and switches metric, staying inside the viewport at every step.
export async function checkInsights(page, { expect, label }) {
  const splits = page.getByTestId('pi-splits-card')
  await expect(splits).toBeVisible()
  await expect(page.getByTestId('pi-split-row').first()).toBeVisible()
  // Strength scale: every row carries a tone, the baseline is explained, and
  // a colored row also has a text cue in its accessible name.
  await expect(page.getByTestId('pi-scale-note')).toBeVisible()
  const tones = await page.getByTestId('pi-split-row').evaluateAll((rows) => rows.map((row) => [row.dataset.tone, row.getAttribute('aria-label') || '']))
  expect(tones.length, `${label}: split rows`).toBeGreaterThan(0)
  for (const [tone, name] of tones) {
    expect(['strong', 'good', 'neutral', 'soft', 'weak', 'muted', 'unrated'], `${label}: tone`).toContain(tone)
    expect(name, `${label}: aria-label names the tone`).toMatch(/overs than usual|about usual|above usual|below usual|too few games|not rated/)
  }
  await expect(splits).not.toContainText(/NaN|undefined/)
  await expectFits(page, `${label} splits`, expect)

  const advanced = page.getByTestId('pi-advanced-card')
  await expect(advanced).toBeVisible()
  await page.getByTestId('pi-adv-toggle').click()
  const options = page.getByTestId('pi-adv-option')
  expect(await options.count()).toBeGreaterThan(1)
  await expectFits(page, `${label} advanced open`, expect)
  const second = (await options.nth(1).innerText()).trim()
  await options.nth(1).click()
  await expect(page.getByTestId('pi-adv-toggle')).toContainText(second)
  await expect(advanced).not.toContainText(/NaN|undefined/)
  await expectFits(page, `${label} advanced`, expect)
  await expect(page.getByTestId('pi-adv-baseline')).toBeVisible()
  await expectSeriesLabelsApart(page, label, expect)
}

// Bar-chart value and date labels never run into the next bar's label.
async function expectSeriesLabelsApart(page, label, expect) {
  const touching = await page.evaluate(() => {
    const out = []
    for (const selector of ['.pi-series-col b', '.pi-series-col small']) {
      const boxes = [...document.querySelectorAll(selector)].map((node) => {
        const range = document.createRange()
        range.selectNodeContents(node)
        return range.getBoundingClientRect()
      }).filter((box) => box.width > 0)
      for (let i = 1; i < boxes.length; i += 1) {
        if (boxes[i].left < boxes[i - 1].right + 1) out.push(`${selector} #${i}`)
      }
    }
    return out
  })
  expect(touching, `${label} bar labels overlap`).toEqual([])
}

// No Splits / Advanced markup at all (logged out, or NHL).
export async function expectNoInsights(page, expect) {
  await page.waitForTimeout(800)
  await expect(page.locator('[data-testid^="pi-"]')).toHaveCount(0)
  await expect(page.locator('.pi-card')).toHaveCount(0)
}
