import { expect, test } from '@playwright/test'

const SPORTS = ['nfl', 'nba', 'nhl', 'wnba', 'kbo']

async function openCheatsheets(page) {
  await page.goto('/?cheatsheets=1&previewTier=owner', { waitUntil: 'load' })
  await expect(page.getByTestId('cheatsheets-page')).toBeVisible()
}

async function exerciseTabs(page) {
  for (const id of SPORTS) {
    const tab = page.getByTestId(`cheatsheets-sport-${id}`)
    await tab.click()
    await expect(page.getByTestId('cheatsheets-page')).toHaveAttribute('data-sport', id)
    await expect(tab).toHaveAttribute('aria-selected', 'true')
  }

  await page.getByTestId('cheatsheets-sport-nba').click()
  await expect(page.getByTestId('game-proj-match')).toHaveText(/DEN\s*@\s*LAL/)
  const edge = page.getByTestId('cheatsheet-game-nba-bos-nyk').locator('td').last()
  await edge.click()
  await expect(page.getByTestId('game-proj-match')).toHaveText(/BOS\s*@\s*NYK/)
  await expect(page.getByTestId('cheatsheet-game-nba-bos-nyk')).toHaveClass(/on/)

  await page.getByTestId('game-proj-toggle-pro').click()
  await expect(page.getByTestId('game-proj-pro')).toBeVisible()
  await page.getByTestId('game-proj-panel-pace').click()
  await expect(page.getByTestId('game-proj-pro')).toHaveAttribute('data-panel', 'pace')
  await page.getByTestId('cheatsheet-game-nba-mil-chi').locator('td.gp-hi').click()
  await expect(page.getByTestId('cheatsheet-game-nba-mil-chi')).toHaveClass(/on/)
  await expect(page.locator('.gp-pro-head')).toContainText('Milwaukee')
  await expect(page.locator('.gp-pro-head')).toContainText('Chicago')
}

test('admin cheatsheet sport tabs and game rows switch on a phone', async ({ page }) => {
  expect(page.viewportSize().width).toBe(390)
  await openCheatsheets(page)
  await exerciseTabs(page)
})

test.describe('desktop', () => {
  test.use({
    viewport: { width: 1440, height: 900 },
    isMobile: false,
    hasTouch: false,
    deviceScaleFactor: 1,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  })

  test('admin cheatsheet sport tabs and game rows switch on a desktop', async ({ page }) => {
    expect(page.viewportSize().width).toBe(1440)
    await openCheatsheets(page)
    await exerciseTabs(page)
  })
})
