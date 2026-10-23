import { expect, test } from '@playwright/test'
import { expectNoInsights, installFixtures } from './playerInsightsFixtures.js'
import { installNflParityRows, nflFreePreviewRows, nflParityRows } from './nflParityFixtures.js'
import { nflCgScore } from '../src/nfl/nflLineFloors.js'
import { nflInsights } from '../src/playerInsights/insightsSports.js'
import { metricWindows } from '../src/playerInsights/insightsCore.js'

// Logged out at phone width, the NFL player page shows none of the member
// sections (no Snaps & Usage trends, no Splits, no Advanced stats) and no
// member-only number appears anywhere in the page: not the projection or CG
// Score of a prop outside the free preview, and not a splits / advanced value.
// Production build, made-up data only.

const PLAYER = 'Synth Back'

function memberOnlyNumbers() {
  const free = new Set(nflFreePreviewRows().map((row) => row.id))
  const playerRows = nflParityRows.filter((row) => row.player === PLAYER)
  const paidRows = playerRows.filter((row) => !free.has(row.id))
  const numbers = new Set()
  paidRows.forEach((row) => {
    numbers.add(Number(row.projection).toFixed(1))
    const cg = nflCgScore(row.projection, row.line, row.prop)
    if (cg != null) numbers.add(cg.toFixed(1))
  })
  playerRows.forEach((row) => {
    const model = nflInsights(row, playerRows, { currentSeason: 2026 })
    model.metrics.forEach((metric) => {
      metricWindows(metric, model.games, model).forEach((window) => {
        const value = Number(window.value)
        if (!Number.isFinite(value) || Number.isInteger(value)) return
        numbers.add(metric.format === 'pct' ? `${(value * 100).toFixed(1)}%` : value.toFixed(2))
        if (metric.format !== 'pct') numbers.add(value.toFixed(1))
      })
    })
  })
  // A number the free preview row itself shows is not member-only.
  nflFreePreviewRows().filter((row) => row.player === PLAYER).forEach((row) => {
    ;[row.line, row.projection, nflCgScore(row.projection, row.line, row.prop), ...(row.recent || [])]
      .filter((value) => value != null)
      .forEach((value) => { numbers.delete(Number(value).toFixed(1)); numbers.delete(Number(value).toFixed(2)) })
  })
  return [...numbers]
}

test('nfl logged out player page has no trends, splits, advanced stats or member numbers', async ({ page }) => {
  await installFixtures(page)
  await installNflParityRows(page)
  await page.goto('/?sport=nfl', { waitUntil: 'load' })
  const link = page.locator('.nfl-player-link').filter({ hasText: PLAYER }).first()
  await expect(link).toBeVisible()
  await link.click()
  await expectNoInsights(page, expect)
  await expect(page.getByTestId('nfl-snaps-usage')).toHaveCount(0)
  await expect(page.locator('.nfl-su-metric')).toHaveCount(0)
  const paid = memberOnlyNumbers()
  expect(paid.length).toBeGreaterThan(10)
  const html = await page.content()
  const text = await page.locator('body').innerText()
  const leaked = paid.filter((number) => {
    const pattern = new RegExp(`(^|[^0-9.])${number.replace(/[.%]/g, (c) => `\\${c}`)}($|[^0-9])`)
    return pattern.test(text) || pattern.test(html)
  })
  expect(leaked, `member-only numbers in the DOM: ${leaked.join(', ')}`).toEqual([])
})
