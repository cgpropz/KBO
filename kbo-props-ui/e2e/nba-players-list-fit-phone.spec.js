import { expect, test } from '@playwright/test'

// 390px Players list row fit: full names and season lines, no Unset chip,
// and a moved player's season line names the old team. Synthetic rows only.

function logs(points) {
  return points.map((pts, index) => ({
    date: `10/${21 - index}/2026`, team: 'DEN', matchup: 'DEN vs. LAL', season: '2027',
    min: 32 - index, pts, reb: 6, ast: 4, stl: 1, blk: 1, tov: 2, fg3m: 2,
  }))
}

const roster = [
  { athleteId: '1', name: 'Synth Guard', team: 'DEN', teamColor: '#0e2240', position: 'PG', gp: 70, pts: 21.4, reb: 4.1, ast: 7.2, gameLogs: logs([25, 22, 18, 30, 24, 19, 27, 21, 26, 23]) },
  { athleteId: '2', name: 'Synth Center', team: 'LAL', teamColor: '#552583', position: 'C', gp: 64, pts: 12.2, reb: 10.5, ast: 2.1, summaryTeam: 'BOS', gameLogs: logs([10, 14, 9, 12, 8, 11, 13, 7, 12, 10]) },
  { athleteId: '3', name: 'Synth Bench', team: 'MIA', teamColor: '#98002e', position: 'SF', gp: 0, gameLogs: [] },
  // Long name, no slot, moved teams, long prop stat name.
  { athleteId: '4', name: 'Giannis Synthokounmpo-Longname Jr.', team: 'DEN', teamColor: '#00471b', position: '', gp: 66, pts: 30.4, reb: 11.9, ast: 6.5, summaryTeam: 'MIL', gameLogs: logs([31, 28, 35, 30, 27, 33, 29, 32, 26, 34]) },
]

const board = [
  { athleteId: '1', name: 'Synth Guard', team: 'DEN', ppAllProps: [{ stat: 'Points', line: 20.5, projection: 25, opponent: 'LAL' }] },
  { athleteId: '2', name: 'Synth Center', team: 'LAL', ppAllProps: [{ stat: 'Rebounds', line: 9.5, projection: 11, opponent: 'DEN' }] },
  { athleteId: '4', name: 'Giannis Synthokounmpo-Longname Jr.', team: 'DEN', ppAllProps: [{ stat: 'Free Throws Attempted', line: 7.5, projection: 9, opponent: 'LAL' }] },
]

const scoreboard = {
  events: [{
    date: '2026-10-23T23:30Z',
    status: { type: { state: 'pre' } },
    competitions: [{
      date: '2026-10-23T23:30Z',
      competitors: [
        { homeAway: 'home', team: { abbreviation: 'DEN' } },
        { homeAway: 'away', team: { abbreviation: 'LAL' } },
      ],
    }],
  }],
}

async function installFixtures(page) {
  await page.route('**/api/data**', async (route) => {
    const ds = new URL(route.request().url()).searchParams.get('ds')
    const data = ds === 'nba_players' ? roster : ds === 'nba_projections_standard' ? board : []
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data, updatedAt: '2026-10-23T12:00:00Z', preview: false, lockedCount: 0, tier: 'owner' }),
    })
  })
  await page.route('**/data/nba/*.json', async (route) => {
    const url = route.request().url()
    const data = url.includes('players.json') ? roster : url.includes('projections_standard') ? board : []
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
  })
  await page.route('https://site.api.espn.com/**', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(scoreboard),
  }))
  await page.route('**/api/img**', (route) => route.fulfill({
    status: 200,
    contentType: 'image/webp',
    body: Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AA/vuUAAA=', 'base64'),
  }))
}

// Nothing in a row is clipped, ellipsized, or past the card edge.
function clippedInRows(page) {
  return page.evaluate(() => {
    const out = []
    for (const card of document.querySelectorAll('[data-testid="nba-player-card"]')) {
      const box = card.getBoundingClientRect()
      for (const el of card.querySelectorAll('.nba-plist-name, .nba-plist-season, .nba-plist-season > *, .nba-plist-prop, .nba-plist-prop-line')) {
        const r = el.getBoundingClientRect()
        if (el.scrollWidth > el.clientWidth + 1 || r.right > box.right + 0.5 || r.left < box.left - 0.5
          || getComputedStyle(el).textOverflow === 'ellipsis') out.push(`${el.className}: ${el.textContent}`)
      }
    }
    return out
  })
}

// CI's Chromium falls back to a wider sans than a Mac does; check both.
for (const font of ['default', 'DejaVu Sans']) {
  test(`NBA Players rows show full names and season lines at 390px (${font} font)`, async ({ page }) => {
    expect(page.viewportSize().width).toBe(390)
    await installFixtures(page)
    if (font !== 'default') {
      await page.addInitScript((family) => {
        document.addEventListener('DOMContentLoaded', () => {
          const style = document.createElement('style')
          style.textContent = `* { font-family: "${family}" !important; }`
          document.head.appendChild(style)
        })
      }, font)
    }
    await page.goto('/?sport=nba&nbaTab=players&previewTier=owner', { waitUntil: 'load' })
    const cards = page.getByTestId('nba-player-card')
    await expect(cards).toHaveCount(3)

    // No Unset chip, even with a player who has no slot; his card shows no position.
    await expect(page.locator('.nba-plist-chip', { hasText: 'Unset' })).toHaveCount(0)
    const longRow = cards.filter({ hasText: 'Giannis Synthokounmpo-Longname Jr.' })
    await expect(longRow.locator('.nba-plist-pos')).toHaveCount(0)

    // Moved players: the 2025-26 line names the old team.
    await expect(longRow).toContainText("'25-26 w/ MIL")
    await expect(cards.filter({ hasText: 'Synth Center' })).toContainText("'25-26 w/ BOS")
    await expect(cards.filter({ hasText: 'Synth Guard' })).not.toContainText('w/')

    expect(await clippedInRows(page)).toEqual([])
    await page.getByRole('switch', { name: 'Playing today' }).click()
    await expect(cards).toHaveCount(4)
    expect(await clippedInRows(page)).toEqual([])
    const width = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth))
    expect(width).toBeLessThanOrEqual(390)
  })
}
