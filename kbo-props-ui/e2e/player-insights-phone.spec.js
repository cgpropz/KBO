import { expect, test } from '@playwright/test'
import { expectNoInsights, installFixtures } from './playerInsightsFixtures.js'

// Player-page Splits / Advanced stats are for members only. Logged out at
// phone width, none of their markup renders on any sport, including the KBO
// and WNBA pages that show a free preview. Production build, made-up players
// and numbers only. The signed-in pages run in player-insights-member.spec.js.

test.beforeEach(async ({ page }) => {
  await installFixtures(page)
})

const pages = [
  ['kbo', '/?sport=kbo', '.kbo-player-cell', 'Synth Hitter'],
  ['wnba', '/?sport=wnba', '.wnba-player-link', 'Synth Forward'],
  ['nfl', '/?sport=nfl', '.nfl-player-link', 'Synth Receiver'],
  ['nhl', '/?sport=nhl', '.nfl-player-link', 'Synth Center'],
]

for (const [sport, path, selector, name] of pages) {
  test(`${sport} logged out player page has no splits or advanced stats`, async ({ page }) => {
    await page.goto(path, { waitUntil: 'load' })
    const link = page.locator(selector).filter({ hasText: name }).first()
    await expect(link).toBeVisible()
    await link.click()
    await expectNoInsights(page, expect)
  })
}
