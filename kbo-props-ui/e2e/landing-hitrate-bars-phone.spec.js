import { expect, test } from '@playwright/test'

// 390px Sports Hub player drilldown: the L10 bars carry the same game date
// and opponent logo as the board charts (#385), oldest on the left.
// Dev server, owner preview, made-up rows only.

const DATES = ['10/12', '10/13', '10/14', '10/15', '10/16', '10/17', '10/18', '10/19', '10/20', '10/22']
const NEWEST = [...DATES].reverse()
const OPPS = ['BOS', 'PHI', 'NYK', 'MIA', 'CHI', 'MIL', 'DEN', 'DAL', 'LAL', 'GSW']
const PTS = [18, 11, 22, 8, 16, 14, 9, 21, 13, 19]

function sarrLogs() {
  return NEWEST.map((date, index) => ({
    date: `${date}/2026`,
    matchup: index % 2 ? `WAS @ ${OPPS[index]}` : `WAS vs. ${OPPS[index]}`,
    min: 28,
    pts: PTS[index],
    reb: 8,
    ast: 3,
    stl: 1,
    blk: 2,
    tov: 2,
    fg3m: 1,
    season: '2027',
  }))
}

const fixtures = {
  nba_players: [{ athleteId: 'sarr', name: 'Alex Sarr', team: 'WAS', position: 'C', gp: 10, gameLogs: sarrLogs() }],
  nba_projections_standard: [{
    athleteId: 'sarr',
    name: 'Alex Sarr',
    team: 'WAS',
    avgMins: 30,
    ppAllProps: [{
      stat: 'Points',
      line: 14.5,
      standardLine: 14.5,
      projection: 17.2,
      rating: 84,
      odds_type: 'standard',
      opponent: 'BOS',
      start_time: '2026-10-24T23:00:00Z',
      l10Values: PTS,
    }],
  }],
  member_recap: { sports: {} },
  player_photos: {},
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/data**', async (route) => {
    const ds = new URL(route.request().url()).searchParams.get('ds')
    const data = Object.prototype.hasOwnProperty.call(fixtures, ds) ? fixtures[ds] : []
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data, updatedAt: '2026-10-24T12:00:00Z', preview: false, lockedCount: 0, tier: 'owner' }),
    })
  })
  await page.route('**/api/nba-access**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ open: true }),
  }))
  const pixel = {
    status: 200,
    contentType: 'image/webp',
    body: Uint8Array.from(atob('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AA/vuUAAA='), (char) => char.charCodeAt(0)),
  }
  await page.route('**/api/img**', (route) => route.fulfill(pixel))
  await page.route('https://a.espncdn.com/**', (route) => route.fulfill(pixel))
})

// Present in the DOM is not enough: a phone query container can clip the
// row to a zero-height box. Each label's border box has to be tall, and no
// ancestor may clip that box away.
async function assertDateRowPainted(chart, { labels, logos }) {
  const row = chart.locator('.mini-hit-dates')
  await expect(row).toBeVisible()
  await expect(chart.getByTestId('hr-game-label')).toHaveCount(labels)
  await expect(chart.locator('.hr-game-logo, .hr-game-abbr')).toHaveCount(logos)
  const paint = await chart.evaluate((root) => {
    const reasonsFor = (el) => {
      const rect = el.getBoundingClientRect()
      const reasons = []
      if (rect.width < 1 || rect.height < 1) reasons.push('zero-box')
      const style = getComputedStyle(el)
      if (style.display === 'none') reasons.push('display')
      if (style.visibility === 'hidden') reasons.push('visibility')
      if (Number(style.opacity) === 0) reasons.push('opacity')
      if (style.getPropertyValue('-webkit-text-fill-color') === 'transparent') reasons.push('text-fill')
      let node = el.parentElement
      while (node && node !== document.body && node !== document.documentElement) {
        const parent = getComputedStyle(node)
        const box = node.getBoundingClientRect()
        if (parent.overflowY === 'hidden' || parent.overflowY === 'clip') {
          const overlap = Math.min(rect.bottom, box.bottom) - Math.max(rect.top, box.top)
          if (overlap < rect.height - 1.5) reasons.push('clipped-y')
        }
        if (parent.overflowX === 'hidden' || parent.overflowX === 'clip') {
          const overlap = Math.min(rect.right, box.right) - Math.max(rect.left, box.left)
          if (overlap < Math.min(rect.width, 8) - 1) reasons.push('clipped-x')
        }
        node = node.parentElement
      }
      return { height: rect.height, width: rect.width, reasons }
    }
    const rowEl = root.querySelector('.mini-hit-dates')
    const rowStyle = getComputedStyle(rowEl)
    const blockStyle = getComputedStyle(root)
    return {
      rowHeight: rowEl.getBoundingClientRect().height,
      rowDisplay: rowStyle.display,
      rowOverflowY: rowStyle.overflowY,
      containerType: blockStyle.containerType,
      blockOverflowY: blockStyle.overflowY,
      labels: [...root.querySelectorAll('[data-testid="hr-game-label"]')].map((el) => {
        const date = el.querySelector('.hr-game-date')
        const mark = el.querySelector('.hr-game-logo, .hr-game-abbr')
        const painted = reasonsFor(el)
        return {
          text: date ? date.textContent : '',
          ...painted,
          dateHeight: date ? date.getBoundingClientRect().height : 0,
          markHeight: mark ? mark.getBoundingClientRect().height : 0,
          dateClipped: Boolean(date) && date.scrollWidth > date.clientWidth + 0.5,
        }
      }),
      seasons: [...root.querySelectorAll('[data-testid="hr-game-season"]')].map((el) => ({
        text: el.textContent,
        ...reasonsFor(el),
        clipped: el.scrollWidth > el.clientWidth + 0.5,
      })),
    }
  })
  expect(paint.rowHeight).toBeGreaterThan(28)
  expect(paint.rowDisplay).toBe('flex')
  expect(paint.rowOverflowY).toBe('visible')
  expect(paint.blockOverflowY).toBe('visible')
  expect(paint.containerType, 'phone chart must not be a query container').toBe('normal')
  expect(paint.labels).toHaveLength(labels)
  paint.labels.forEach((item, index) => {
    expect(item.reasons, `${item.text || index}: ${item.reasons.join(',')}`).toEqual([])
    expect(item.height, item.text).toBeGreaterThan(20)
    expect(item.dateHeight, item.text).toBeGreaterThan(8)
    expect(item.markHeight, item.text).toBeGreaterThan(8)
    expect(item.dateClipped, item.text).toBe(false)
  })
  paint.seasons.forEach((item) => {
    expect(item.reasons, item.text).toEqual([])
    expect(item.height, item.text).toBeGreaterThan(6)
    expect(item.clipped, item.text).toBe(false)
  })
}

async function saveDrill(page, name) {
  if (!process.env.SAVE_SHOTS) return
  const drill = page.getByRole('region', { name: 'Player drilldown' })
  await drill.scrollIntoViewIfNeeded()
  await drill.screenshot({ path: `${process.env.SAVE_SHOTS}/${name}.png` })
}

test('NBA landing drilldown: ten dated bars with logos fit at 390px', async ({ page }) => {
  expect(page.viewportSize().width).toBe(390)
  await page.goto('/?previewTier=owner', { waitUntil: 'load' })
  await page.getByRole('button', { name: 'NBA', exact: true }).click()
  const drill = page.getByRole('region', { name: 'Player drilldown' })
  await expect(drill.getByText('Alex Sarr').first()).toBeVisible()
  const chart = drill.getByTestId('hub-l10-chart')
  await expect(chart).toBeVisible()
  const labels = chart.getByTestId('hr-game-label')
  await expect(labels).toHaveCount(10)
  await expect(chart.locator('.hr-game-date')).toHaveText(DATES)
  await expect(chart.locator('.hr-game-logo')).toHaveCount(10)
  await expect(chart.getByTestId('hub-l10-scope')).toContainText("'26-27")
  await expect(chart.getByTestId('hr-game-season')).toHaveCount(0)
  await assertDateRowPainted(chart, { labels: 10, logos: 10 })

  const geometry = await chart.evaluate((root) => {
    const rect = (el) => el.getBoundingClientRect()
    const card = rect(root.closest('.hub-drill') || root)
    const barEls = [...root.querySelectorAll('.hub-bar')]
    return {
      cardBox: { left: card.left, right: card.right },
      bars: barEls.map((el) => ({ left: rect(el).left, right: rect(el).right })),
      labels: [...root.querySelectorAll('[data-testid="hr-game-label"]')].map((el) => {
        const date = el.querySelector('.hr-game-date')
        const mark = el.querySelector('.hr-game-logo, .hr-game-abbr')
        return {
          left: rect(el).left,
          right: rect(el).right,
          dateLeft: rect(date).left,
          dateRight: rect(date).right,
          dateClipped: date.scrollWidth > date.clientWidth + 0.5,
          markVisible: Boolean(mark) && rect(mark).width > 0 && rect(mark).height > 0,
        }
      }),
    }
  })
  expect(geometry.bars).toHaveLength(10)
  geometry.labels.forEach((item, index) => {
    expect(item.dateClipped, `date ${index} clipped`).toBe(false)
    expect(item.markVisible, `logo ${index}`).toBe(true)
    expect(item.dateLeft).toBeGreaterThanOrEqual(geometry.cardBox.left - 0.5)
    expect(item.dateRight).toBeLessThanOrEqual(geometry.cardBox.right + 0.5)
    expect(item.dateRight).toBeLessThanOrEqual(390)
    if (index > 0) expect(item.dateLeft, `dates ${index - 1}/${index} overlap`).toBeGreaterThanOrEqual(geometry.labels[index - 1].dateRight - 0.5)
    const bar = geometry.bars[index]
    const centre = (item.left + item.right) / 2
    expect(centre, `label ${index} under its bar`).toBeGreaterThanOrEqual(bar.left - 1)
    expect(centre, `label ${index} under its bar`).toBeLessThanOrEqual(bar.right + 1)
  })
  const width = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth))
  expect(width).toBeLessThanOrEqual(390)
  await saveDrill(page, 'sarr-390-this-season')
})

test('NBA landing drilldown: a mixed-season L10 names last season at 390px', async ({ page }) => {
  const last = [
    ['04/12/2026', 'MIA', 22],
    ['04/09/2026', 'NYK', 8],
    ['03/28/2026', 'CHI', 16],
    ['03/15/2026', 'MIL', 14],
    ['03/02/2026', 'DEN', 9],
    ['02/20/2026', 'DAL', 21],
    ['02/14/2026', 'LAL', 13],
  ]
  const current = [
    ['10/23/2026', 'BOS', 18],
    ['10/22/2026', 'PHI', 11],
    ['10/21/2026', 'GSW', 19],
  ]
  const games = [...current, ...last]
  await page.route('**/api/data**', async (route) => {
    const ds = new URL(route.request().url()).searchParams.get('ds')
    const data = ds === 'nba_players'
      ? [{
        athleteId: 'sarr', name: 'Alex Sarr', team: 'WAS', position: 'C', gp: 10,
        gameLogs: games.map(([date, opp, pts], index) => ({
          date, matchup: index % 2 ? `WAS @ ${opp}` : `WAS vs. ${opp}`, min: 28, pts,
          reb: 8, ast: 3, stl: 1, blk: 2, tov: 2, fg3m: 1,
          season: date.startsWith('10/') ? '2027' : '2026',
        })),
      }]
      : ds === 'nba_projections_standard'
        ? [{
          athleteId: 'sarr', name: 'Alex Sarr', team: 'WAS', avgMins: 30,
          ppAllProps: [{
            stat: 'Points', line: 14.5, standardLine: 14.5, projection: 17.2, rating: 84,
            odds_type: 'standard', opponent: 'BOS', start_time: '2026-10-24T23:00:00Z',
            l10Values: games.map((game) => game[2]),
          }],
        }]
        : (Object.prototype.hasOwnProperty.call(fixtures, ds) ? fixtures[ds] : [])
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data, updatedAt: '2026-10-24T12:00:00Z', preview: false, lockedCount: 0, tier: 'owner' }),
    })
  })
  expect(page.viewportSize().width).toBe(390)
  await page.goto('/?previewTier=owner', { waitUntil: 'load' })
  await page.getByRole('button', { name: 'NBA', exact: true }).click()
  const chart = page.getByRole('region', { name: 'Player drilldown' }).getByTestId('hub-l10-chart')
  await expect(chart.locator('.hr-game-date')).toHaveText(['2/14', '2/20', '3/02', '3/15', '3/28', '4/09', '4/12', '10/21', '10/22', '10/23'])
  await expect(chart.getByTestId('hub-l10-scope')).toHaveText("Both seasons · '25-26 · '26-27")
  await expect(chart.getByTestId('hr-game-season')).toHaveText(["'26", "'26", "'26", "'26", "'26", "'26", "'26", "'27", "'27", "'27"])
  await assertDateRowPainted(chart, { labels: 10, logos: 10 })
  const width = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth))
  expect(width).toBeLessThanOrEqual(390)
  const clipped = await chart.locator('.hr-game-date, .hr-game-season').evaluateAll((nodes) => (
    nodes.some((node) => node.scrollWidth > node.clientWidth + 0.5)
  ))
  expect(clipped).toBe(false)
  await saveDrill(page, 'sarr-390-both-seasons')
})

test('NBA landing drilldown: misaligned blocks and one missing date still paint at 390px', async ({ page }) => {
  // The phone report: ten colored bars, line 1.5, L10 60% 6/10, proj 3.4, and
  // no date row. The stored series is not the roster log, and one log has no
  // date. The other nine dates and logos still have to paint.
  const values = [4, 1, 0, 3, 2, 5, 1, 2, 0, 6]
  const games = sarrLogs().map((game, index) => (index === 4 ? { ...game, date: '' } : game))
  await page.route('**/api/data**', async (route) => {
    const ds = new URL(route.request().url()).searchParams.get('ds')
    const data = ds === 'nba_players'
      ? [{ athleteId: 'sarr', name: 'Alex Sarr', team: 'WSH', position: 'C', gp: 10, gameLogs: games }]
      : ds === 'nba_projections_standard'
        ? [{
          athleteId: 'sarr', name: 'Alex Sarr', team: 'WSH', avgMins: 30,
          ppAllProps: [{
            stat: 'Blocks', line: 1.5, standardLine: 1.5, projection: 3.4, rating: 84,
            odds_type: 'standard', opponent: 'CHI', start_time: '2026-10-24T23:00:00Z',
            l10Values: values,
          }],
        }]
        : (Object.prototype.hasOwnProperty.call(fixtures, ds) ? fixtures[ds] : [])
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data, updatedAt: '2026-10-24T12:00:00Z', preview: false, lockedCount: 0, tier: 'owner' }),
    })
  })
  expect(page.viewportSize().width).toBe(390)
  await page.goto('/?previewTier=owner', { waitUntil: 'load' })
  await page.getByRole('button', { name: 'NBA', exact: true }).click()
  const drill = page.getByRole('region', { name: 'Player drilldown' })
  await expect(drill.getByText('Alex Sarr').first()).toBeVisible()
  await expect(drill.getByText('60%')).toBeVisible()
  await expect(drill.getByText('6/10')).toBeVisible()
  await expect(drill.getByText('3.4')).toBeVisible()
  const chart = drill.getByTestId('hub-l10-chart')
  await expect(chart.locator('.hub-bar')).toHaveCount(10)
  await expect(chart.locator('.hub-line-label')).toHaveText('O 1.5')
  await expect(chart.locator('.hr-game-blank')).toHaveCount(1)
  await expect(chart.locator('.hr-game-date')).toHaveText(DATES.filter((date) => date !== '10/17'))
  await expect(chart.getByTestId('hub-l10-scope')).toContainText('This season')
  await assertDateRowPainted(chart, { labels: 9, logos: 9 })
  const width = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth))
  expect(width).toBeLessThanOrEqual(390)
  await saveDrill(page, 'sarr-390-misaligned')
})
