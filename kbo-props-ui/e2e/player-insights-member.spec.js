import { expect, test } from '@playwright/test'
import { checkInsights, installFixtures } from './playerInsightsFixtures.js'

// Signed-in player pages (NBA, NFL, NHL) with the Splits / Advanced preview
// at phone width. Runs on the card-fit build, which has the fake Supabase URL
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
  ['nba', '/?sport=nba&nbaTab=players', '[data-testid="nba-player-card"]', 'Synth Guard', false],
  ['nfl', '/?sport=nfl', '.nfl-player-link', 'Synth Receiver', false],
  ['nhl', '/?sport=nhl', '.nfl-player-link', 'Synth Center', true],
]

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(!['chromium-320', 'chromium-390', 'webkit-390'].includes(testInfo.project.name), '320 and 390 only')
  await installFixtures(page, { member: true })
  await installMember(page)
})

for (const [sport, path, selector, name, blocked] of pages) {
  for (const layout of ['a', 'b', 'c']) {
    test(`${sport} member layout ${layout.toUpperCase()} fits with Splits and the Advanced picker`, async ({ page }) => {
      await page.goto(`${path}&insights=${layout}`, { waitUntil: 'load' })
      const link = page.locator(selector).filter({ hasText: name }).first()
      await expect(link).toBeVisible()
      await link.click()
      await checkInsights(page, { expect, layout, label: `${sport} ${layout}`, blocked })
    })
  }

  test(`${sport} member page has no preview UI without the switch`, async ({ page }) => {
    await page.goto(`${path}&insights=off`, { waitUntil: 'load' })
    const link = page.locator(selector).filter({ hasText: name }).first()
    await expect(link).toBeVisible()
    await link.click()
    await page.waitForTimeout(800)
    await expect(page.locator('[data-testid^="pi-"]')).toHaveCount(0)
  })
}
