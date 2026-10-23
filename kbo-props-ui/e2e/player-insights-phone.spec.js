import { expect, test } from '@playwright/test'
import { checkInsights, installFixtures } from './playerInsightsFixtures.js'

// Player-page Splits / Advanced preview (?insights=a|b|c) at phone width,
// logged out. Production build, made-up players and numbers only. The
// signed-in NBA / NFL / NHL pages run in player-insights-member.spec.js.

async function openPlayer(page, path, selector, name, layout) {
  await page.goto(layout ? `${path}&insights=${layout}` : path, { waitUntil: 'load' })
  const link = page.locator(selector).filter({ hasText: name }).first()
  await expect(link).toBeVisible()
  await link.click()
}

test.beforeEach(async ({ page }) => {
  await installFixtures(page)
})

const open = [
  ['kbo', '/?sport=kbo', '.kbo-player-cell', 'Synth Hitter'],
  ['wnba', '/?sport=wnba', '.wnba-player-link', 'Synth Forward'],
]

for (const [sport, path, selector, name] of open) {
  test(`${sport} player page has no preview UI by default`, async ({ page }) => {
    await openPlayer(page, path, selector, name, null)
    await expect(page.getByTestId('pi-split-row')).toHaveCount(0)
    await page.waitForTimeout(500)
    await expect(page.locator('[data-testid^="pi-"]')).toHaveCount(0)
  })

  for (const layout of ['a', 'b', 'c']) {
    test(`${sport} layout ${layout.toUpperCase()} shows Splits and the Advanced picker inside the viewport`, async ({ page }) => {
      await openPlayer(page, path, selector, name, layout)
      await checkInsights(page, { expect, layout, label: `${sport} ${layout}` })
    })
  }
}

// Paid player pages stay locked when logged out, preview switch or not.
for (const [sport, path, name] of [['nfl', '/?sport=nfl', 'Synth Receiver'], ['nhl', '/?sport=nhl', 'Synth Center']]) {
  test(`${sport} logged out player page shows no splits even with the preview switch on`, async ({ page }) => {
    await openPlayer(page, path, '.nfl-player-link', name, 'b')
    await page.waitForTimeout(800)
    await expect(page.locator('[data-testid^="pi-"]')).toHaveCount(0)
  })
}
