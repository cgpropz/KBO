import { expect, test } from '@playwright/test'
import { checkInsights, expectNoInsights, installFixtures } from './playerInsightsFixtures.js'

// Signed-in player pages at phone width: stacked Splits + Advanced stats on
// NBA, NFL, KBO and WNBA; nothing on NHL (game feed not approved yet). Runs on the card-fit build, which has the fake Supabase URL
// so a mocked member session can finish the plan check. Made-up data only.

async function installMember(page) {
  const user = { id: 'e2e-insights-member', email: 'member@preview.local', aud: 'authenticated', role: 'authenticated' }
  const session = {
    access_token: 'e2e-insights-token',
    refresh_token: 'e2e-insights-refresh',
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
  await page.route('**/api/nba-access**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ open: true }) }))
}

const pages = [
  ['nba', '/?sport=nba&nbaTab=players', '[data-testid="nba-player-card"]', 'Synth Guard'],
  ['nfl', '/?sport=nfl', '.nfl-player-link', 'Synth Receiver'],
  ['kbo', '/?sport=kbo', '.kbo-player-cell', 'Synth Hitter'],
  ['wnba', '/?sport=wnba', '.wnba-player-link', 'Synth Forward'],
]

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(!['chromium-320', 'chromium-390', 'webkit-390'].includes(testInfo.project.name), '320 and 390 only')
  await installFixtures(page, { member: true })
  await installMember(page)
})

async function openPlayer(page, path, selector, name) {
  await page.goto(path, { waitUntil: 'load' })
  const link = page.locator(selector).filter({ hasText: name }).first()
  await expect(link).toBeVisible()
  await link.click()
}

for (const [sport, path, selector, name] of pages) {
  test(`${sport} member page stacks Splits and Advanced stats and fits`, async ({ page }) => {
    await openPlayer(page, path, selector, name)
    await checkInsights(page, { expect, label: sport })
  })
}

test('nhl member page has no splits or advanced stats', async ({ page }) => {
  await openPlayer(page, '/?sport=nhl', '.nfl-player-link', 'Synth Center')
  await expectNoInsights(page, expect)
})
