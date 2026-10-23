import { expect, test } from '@playwright/test'
import { expectNoInsights, installFixtures } from './playerInsightsFixtures.js'
import { installNflParityRows } from './nflParityFixtures.js'

// Logged out at phone width, the NFL player page shows none of the member
// sections: no Snaps & Usage trends, no Splits, no Advanced stats. Production
// build, made-up data only.

test('nfl logged out player page has no trends, splits or advanced stats', async ({ page }) => {
  await installFixtures(page)
  await installNflParityRows(page)
  await page.goto('/?sport=nfl', { waitUntil: 'load' })
  const link = page.locator('.nfl-player-link').filter({ hasText: 'Synth Back' }).first()
  await expect(link).toBeVisible()
  await link.click()
  await expectNoInsights(page, expect)
  await expect(page.getByTestId('nfl-snaps-usage')).toHaveCount(0)
  await expect(page.locator('.nfl-su-metric')).toHaveCount(0)
})
