import { expect, test } from '@playwright/test'
import { checkInsights, expectFits, installFixtures } from './playerInsightsFixtures.js'
import { installNflParityRows } from './nflParityFixtures.js'

// Signed-in NFL player page at phone width: header with headshot and team
// logos, projection / CG Score beside the line (Pending when blank), the
// Snap % / usage / targets / touches / def-rank sliders, Snaps & Usage trends
// (no arrow before 5 games this season), and NFL Splits + Advanced stats.
// Card-fit build (fake Supabase URL, mocked member session). Made-up data.

async function installMember(page) {
  const user = { id: 'e2e-nfl-parity-member', email: 'member@preview.local', aud: 'authenticated', role: 'authenticated' }
  const session = {
    access_token: 'e2e-nfl-parity-token',
    refresh_token: 'e2e-nfl-parity-refresh',
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

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(!['chromium-320', 'chromium-390', 'webkit-390'].includes(testInfo.project.name), '320 and 390 only')
  await installFixtures(page, { member: true })
  await installNflParityRows(page, { member: true })
  await installMember(page)
})

async function openPlayer(page, name) {
  await page.goto('/?sport=nfl', { waitUntil: 'load' })
  const link = page.locator('.nfl-player-link').filter({ hasText: name }).first()
  await expect(link).toBeVisible()
  await link.click()
  await expect(page.getByTestId('nfl-player-pick')).toBeVisible()
}

test('nfl header shows headshot, matchup logos and projection / CG beside the line', async ({ page }) => {
  await openPlayer(page, 'Synth Back')
  await expect(page.getByTestId('nfl-player-headshot')).toBeVisible()
  await expect(page.getByTestId('nfl-player-matchup')).toContainText('AAA')
  await expect(page.getByTestId('nfl-player-matchup')).toContainText('BBB')
  await page.locator('.nfl-player-tabs button', { hasText: 'Rush Yards' }).click()
  await expect(page.getByTestId('nfl-player-line')).toHaveText('70.5')
  await expect(page.getByTestId('nfl-player-projection')).toHaveText('75.0')
  const cg = page.getByTestId('nfl-player-cg')
  await expect(cg).toContainText('OVER')
  await expect(cg).not.toContainText(/Pending|NaN|undefined/)
  await expectFits(page, 'nfl header', expect)
})

test('nfl sliders use snaps, rush att, targets, touches and def rank', async ({ page }) => {
  await openPlayer(page, 'Synth Back')
  const panel = page.getByTestId('nfl-game-filters')
  await expect(panel).toBeVisible()
  for (const id of ['snap', 'usage', 'targets', 'touches', 'dvp']) {
    await expect(page.getByTestId(`nfl-filter-${id}`)).toBeVisible()
  }
  await expect(page.getByTestId('nfl-filter-usage')).toContainText('Rush Att')
  await expect(panel).toContainText('all 10 games')
  await expect(page.getByTestId('nfl-filter-hidden-snap')).toHaveCount(0)
  const low = page.getByTestId('nfl-filter-snap').locator('[data-handle="low"]')
  await low.focus()
  for (let step = 0; step < 15; step += 1) await page.keyboard.press('ArrowRight')
  await expect(panel).toContainText(/filtered: \d+ of 10 games/)
  await expect(page.locator('.nfl-su-col.is-dimmed').first()).toBeVisible()
  // The one game with no snap data was in until the snap slider moved.
  await expect(page.getByTestId('nfl-filter-hidden-snap')).toHaveText('1 game without snap data hidden')
  await expect(page.getByTestId('nfl-filter-dvp')).toContainText('Def rank (2026)')
  await expect(page.getByTestId('nfl-filter-hidden-dvp')).toHaveCount(0)
  await expectFits(page, 'nfl sliders', expect)
})

test('nfl snaps & usage trends show snap %, touches and targets with an arrow after 5 games', async ({ page }) => {
  await openPlayer(page, 'Synth Back')
  const trends = page.getByTestId('nfl-snaps-usage')
  await expect(trends).toBeVisible()
  for (const id of ['snap', 'touches', 'targets']) await expect(page.getByTestId(`nfl-su-${id}`)).toBeVisible()
  await expect(page.getByTestId('nfl-su-touches').getByTestId('nfl-su-trend')).toHaveAttribute('aria-label', /trending up/)
  await expect(trends).not.toContainText(/NaN|undefined/)
  await expectFits(page, 'nfl trends', expect)
})

test('nfl splits and advanced stats use NFL stats and fit', async ({ page }) => {
  await openPlayer(page, 'Synth Back')
  const splitsCard = page.getByTestId('pi-splits-card')
  await expect(splitsCard).toContainText('vs 2026 D rank 1–10')
  await expect(splitsCard).not.toContainText(/top-10 D|bottom-10 D/)
  await expect(page.getByTestId('pi-splits-card')).toContainText('Snap % 70+')
  // Defense and Snaps rows use the shared strength scale like every other row.
  for (const label of ['vs 2026 D rank 1–10', 'Snap % 70+']) {
    const tone = await splitsCard.getByTestId('pi-split-row').filter({ hasText: label }).first().getAttribute('data-tone')
    expect(['strong', 'good', 'neutral', 'soft', 'weak', 'muted']).toContain(tone)
  }
  await page.getByTestId('pi-adv-toggle').click()
  const options = page.getByTestId('pi-adv-option')
  for (const label of ['Touches per game', 'Targets per game', 'Catch rate', 'Yards per carry', 'Yards per touch']) {
    await expect(options.filter({ hasText: label })).toHaveCount(1)
  }
  await page.getByTestId('pi-adv-toggle').click()
  await checkInsights(page, { expect, label: 'nfl parity' })
})

test('nfl blank projection shows Pending and no trend arrow under 5 games', async ({ page }) => {
  await openPlayer(page, 'Synth Rookie')
  await expect(page.getByTestId('nfl-player-projection')).toHaveText('Pending')
  await expect(page.getByTestId('nfl-player-cg')).toHaveText('Pending')
  await expect(page.locator('.nfl-player-summary')).toContainText('Pending')
  await expect(page.locator('.nfl-player-page')).not.toContainText(/CG Score 0\.0|NaN|undefined/)
  await expect(page.getByTestId('nfl-snaps-usage')).toBeVisible()
  await expect(page.getByTestId('nfl-su-trend')).toHaveCount(0)
  await expect(page.getByTestId('nfl-snaps-usage')).toContainText('after 5 games')
  await expectFits(page, 'nfl pending', expect)
})

test('nfl board shows Pending, not 0, for a blank projection', async ({ page }) => {
  await page.goto('/?sport=nfl', { waitUntil: 'load' })
  const row = page.locator('.nfl-lines-row, .nfl-edge-card').filter({ hasText: 'Synth Rookie' }).first()
  await expect(row).toBeVisible()
  await expect(row).toContainText('Pending')
  await expect(row).not.toContainText(/(^|[^0-9.])0\.0([^0-9]|$)|NaN|undefined/)
})
