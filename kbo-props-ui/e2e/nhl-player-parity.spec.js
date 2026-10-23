import { expect, test } from '@playwright/test'
import { expectFits, installFixtures } from './playerInsightsFixtures.js'

// NHL player page parity at phone width. Made-up players and numbers only.
// Production bundle (4176): today's line / projection / CG Score card and the
// stat chips; no NHL API sections. Dev server with ?nhlApiPreview=1 (4175):
// TOI / PP TOI sliders, ice time trends, Splits and Advanced stats.

const PROD = 'http://127.0.0.1:4176'
const DEV = 'http://127.0.0.1:4175'
const COLS = ['d', 's', 'opp', 'h', 'res', 'g', 'a', 'pts', 'sog', 'ppg', 'ppp', 'toi', 'ev', 'pp', 'sh', 'shf', 'hit', 'blk', 'fow', 'fot']

function games() {
  const out = []
  for (let index = 0; index < 8; index += 1) {
    const day = 22 - index * 2
    const sog = [4, 2, 5, 3, 1, 4, 3, 2][index]
    const toi = 1020 + index * 45
    const pp = [240, 0, 180, 120, 60, 200, 0, 150][index]
    out.push([`2026-10-${String(day).padStart(2, '0')}`, '2026-27', index % 2 ? 'CCC' : 'BBB', index % 2, index % 3 ? 'W' : 'OTL',
      index % 3 ? 0 : 1, 1, (index % 3 ? 0 : 1) + 1, sog, 0, index % 2, toi, toi - pp - 40, pp, 40, 21, 2, 1, 5, 11])
  }
  for (let index = 0; index < 10; index += 1) {
    out.push([`2026-04-${String(14 - index).padStart(2, '0')}`, '2025-26', index % 2 ? 'DDD' : 'BBB', index % 2, index % 2 ? 'L' : 'W',
      0, 1, 1, 2 + (index % 3), 0, 0, 1000, 820, 120, 60, 20, 1, 1, 4, 10])
  }
  // Dressed but no ice time: counts nowhere (played = TOI > 0).
  out.push(['2026-10-07', '2026-27', 'BBB', 1, 'W', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
  return out
}

const BASE = { team: 'AAA', opponent: 'BBB', position: 'C', oddsType: 'standard', recent: [3, 2, 4, 1, 3], log: [3, 2, 4, 1, 3],
  logDates: ['10/10', '10/12', '10/14', '10/16', '10/18'], logSeasons: Array(5).fill('2026-27'), logOpponents: ['BBB', 'CCC', 'DDD', 'BBB', 'CCC'] }

const ROWS = [
  { ...BASE, id: 'nhl-1', player: 'Synth Center', prop: 'Shots On Goal', line: 2.5, projection: 3,
    nhlApiLog: { v: 1, source: 'api.nhle.com/stats/rest', kind: 'skater', fetchedAt: '2026-10-23T12:00:00+00:00', cols: COLS, games: games() } },
  { ...BASE, id: 'nhl-2', player: 'Synth Center', prop: 'Points', line: 0.5, projection: 0.54 },
  // Demon-only prop: never a chip.
  { ...BASE, id: 'nhl-4', player: 'Synth Center', prop: 'Power Play Points', line: 0.5, projection: 0.9, oddsType: 'demon' },
  { ...BASE, id: 'nhl-5', player: 'Synth Center', prop: 'Points', line: 1.5, projection: 0.54, oddsType: 'goblin' },
  { ...BASE, id: 'nhl-3', player: 'Synth Winger', position: 'L', prop: 'Points', line: 0.5, projection: null },
]

async function installMember(page) {
  const user = { id: 'e2e-nhl-member', email: 'member@preview.local', aud: 'authenticated', role: 'authenticated' }
  const session = {
    access_token: 'e2e-nhl-token', refresh_token: 'e2e-nhl-refresh', token_type: 'bearer', expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600, user,
  }
  await page.addInitScript((payload) => {
    localStorage.setItem('sb-e2e-slip-auth-token', JSON.stringify(payload))
    sessionStorage.setItem('cg_tier', JSON.stringify({ userId: payload.user.id, tier: 'combined' }))
  }, session)
  await page.route('**/*supabase.co/**', async (route) => {
    const url = route.request().url()
    if (url.includes('/rest/v1/user_profiles')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ tier: 'combined', discord_only: false }]) })
      return
    }
    if (url.includes('/auth/v1/')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(session) })
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })
  await page.route('**/api/sync-subscription**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tier: 'combined' }) }))
}

test.beforeEach(async ({ page }) => {
  // Season labels come from the date; pin it to the fixture's season.
  await page.clock.setFixedTime(new Date('2026-10-23T16:00:00Z'))
  await installFixtures(page, { member: true })
  await page.route('**/api/data**', async (route) => {
    const url = new URL(route.request().url())
    if (url.searchParams.get('ds') !== 'nhl_projections') return route.fallback()
    // The board drops nhlApiLog (HISTORY_KEYS); only the player request has it.
    const player = url.searchParams.get('player')
    const data = player ? ROWS.filter((row) => row.player === player) : ROWS.map((row) => { const copy = { ...row }; delete copy.nhlApiLog; return copy })
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data, updatedAt: '2026-10-23T16:00:00Z', preview: false, lockedCount: 0, tier: 'combined' }),
    })
  })
  await installMember(page)
})

async function openPlayer(page, base, name, query = '') {
  await page.goto(`${base}/?sport=nhl${query}`, { waitUntil: 'load' })
  const link = page.locator('.nfl-player-link').filter({ hasText: name }).first()
  await expect(link).toBeVisible()
  await link.click()
  await expect(page.locator('.nhl-player-sheet')).toBeVisible()
}

test('production bundle: line, projection and CG Score; NHL API sections stay off', async ({ page }) => {
  await openPlayer(page, PROD, 'Synth Center', '&nhlApiPreview=1')
  const pick = page.getByTestId('nhl-pick')
  await expect(pick).toBeVisible()
  await expect(page.getByTestId('nhl-pick-line')).toHaveText('2.5 Shots On Goal')
  await expect(page.getByTestId('nhl-pick-projection')).toHaveText('3')
  await expect(page.getByTestId('nhl-pick-cg')).toHaveText('60.0')
  await expect(page.getByTestId('nhl-pick-cg')).toHaveClass(/is-over/)
  await expect(page.getByTestId('nhl-pick-side')).toHaveText('OVER')
  const chips = page.getByTestId('nhl-prop-chips')
  await expect(chips).toBeVisible()
  await expect(chips.getByRole('tab')).toHaveCount(2)
  await expect(chips.getByRole('tab', { name: 'Power Play Points' })).toHaveCount(0)
  await page.waitForTimeout(600)
  await expect(page.getByTestId('nhl-filters')).toHaveCount(0)
  await expect(page.getByTestId('nhl-usage-trends')).toHaveCount(0)
  await expect(page.locator('.pi-card')).toHaveCount(0)
  await expectFits(page, 'nhl prod', expect)

  await page.getByTestId('nhl-prop-chips').getByRole('tab', { name: 'Points' }).click()
  await expect(page.getByTestId('nhl-pick-line')).toHaveText('0.5 Points')
  await expect(page.getByTestId('nhl-pick-projection')).toHaveText('0.5')
  await expect(page.locator('.nhl-player-sheet')).toContainText('2026-27 is this season only. 2025-26 is last season')
})

test('blank projection shows Pending, never 0', async ({ page }) => {
  await openPlayer(page, PROD, 'Synth Winger')
  await expect(page.getByTestId('nhl-pick-projection')).toHaveText('Pending')
  await expect(page.getByTestId('nhl-pick-cg')).toHaveText('Pending')
  await expect(page.getByTestId('nhl-pick')).not.toContainText(/\b0\.0\b|NaN/)
  await expectFits(page, 'nhl pending', expect)
})

test('preview: sliders, trends, splits and advanced fit the phone', async ({ page }) => {
  await openPlayer(page, DEV, 'Synth Center', '&nhlApiPreview=1')
  const filters = page.getByTestId('nhl-filters')
  await expect(filters).toBeVisible()
  await expect(page.getByTestId('nhl-filter-toi')).toBeVisible()
  await expect(page.getByTestId('nhl-filter-pp')).toBeVisible()
  await expect(page.getByTestId('nhl-filters-count')).toHaveText('All 18 games')
  await expectFits(page, 'nhl filters', expect)

  const trends = page.getByTestId('nhl-usage-trends')
  await expect(trends).toBeVisible()
  for (const id of ['toi', 'sog', 'pp']) await expect(page.getByTestId(`nhl-trend-${id}`)).toBeVisible()
  await expect(trends.getByTestId('nhl-trend-arrow')).toHaveCount(3) // 8 games this season
  await expect(trends).not.toContainText(/NaN|undefined/)

  // Narrow PP TOI from the top: games with no PP time drop out.
  const low = page.getByRole('slider', { name: 'Lowest PP TOI' })
  await low.focus()
  await low.press('ArrowRight')
  await expect(page.getByTestId('nhl-filters-count')).toContainText('of 18 games')
  await expect(filters).toHaveClass(/is-narrowed/)
  await expect(trends.locator('[data-dimmed="true"]').first()).toBeVisible()
  await expectFits(page, 'nhl narrowed', expect)

  const splits = page.getByTestId('pi-splits-card')
  await expect(splits).toBeVisible()
  await expect(splits).toContainText('Home')
  await expect(splits).toContainText('Team wins')
  await expect(splits).toContainText('vs BBB')
  await expect(splits).not.toContainText(/NaN|undefined/)

  await page.getByTestId('pi-adv-toggle').click()
  const options = page.getByTestId('pi-adv-option')
  await expect(options.filter({ hasText: 'Shooting %' })).toHaveCount(1)
  await expect(options.filter({ hasText: 'Faceoff %' })).toHaveCount(1)
  await expect(options.filter({ hasText: 'SOG / 60' })).toHaveCount(1)
  await expectFits(page, 'nhl advanced open', expect)
  await options.filter({ hasText: 'Faceoff %' }).click()
  await expect(page.getByTestId('pi-adv-toggle')).toContainText('Faceoff %')
  await expect(page.getByTestId('pi-advanced-card')).toContainText('45.5%')
  await expect(page.getByTestId('pi-advanced-card')).toContainText('MoneyPuck only')
  await expectFits(page, 'nhl advanced', expect)

  // Neutral stat: values shown, no color, no arrows.
  await page.getByTestId('pi-adv-toggle').click()
  await options.filter({ hasText: 'Shifts / game' }).click()
  await expect(page.getByTestId('pi-adv-baseline')).toContainText('Not colored')
  await expect(page.getByTestId('pi-advanced-card')).not.toContainText(/[▲▼]/)
})

test('dev server without the preview param keeps the sections off', async ({ page }) => {
  await openPlayer(page, DEV, 'Synth Center')
  await expect(page.getByTestId('nhl-pick')).toBeVisible()
  await page.waitForTimeout(600)
  await expect(page.getByTestId('nhl-filters')).toHaveCount(0)
  await expect(page.locator('.pi-card')).toHaveCount(0)
})
