import test from 'node:test'
import assert from 'node:assert/strict'
import {
  filterGames, formatMetric, gameMetric, isFiltered, metricBounds, newestSeasonLogs, resolveRange,
} from '../src/nba/nbaGameFilters.js'
import { overHitRate } from '../src/hitRateStrip.js'

// Synthetic game log, newest first.
const LOGS = [
  { date: '10/22/2026', season: '2027', min: 31, usg: 24.5, pts: 18 },
  { date: '04/12/2026', season: '2026', min: 12, usg: 15.0, pts: 4 },
  { date: '04/10/2026', season: '2026', min: 28, usg: 21.0, pts: 14 },
  { date: '04/08/2026', season: '2026', min: 22, usg: null, pts: 9 },
  { date: '04/06/2026', season: '2026', min: '35', usg: 29.4, pts: 22 },
]

test('bounds cover every logged value and skip blanks', () => {
  assert.deepEqual(metricBounds(LOGS, 'min', 1), { min: 12, max: 35, count: 5 })
  assert.deepEqual(metricBounds(LOGS, 'usg', 0.5), { min: 15, max: 29.5, count: 4 })
  assert.equal(metricBounds([{ min: null }], 'usg', 1), null)
  assert.equal(gameMetric({ min: 'DNP' }, 'min'), null)
})

test('a full range keeps every game; the default is the full range', () => {
  const bounds = metricBounds(LOGS, 'min', 1)
  const range = resolveRange(bounds, null, 1)
  assert.equal(range.full, true)
  assert.equal(isFiltered({ min: range }), false)
  assert.equal(filterGames(LOGS, { min: range }).length, LOGS.length)
})

test('minutes range drops games outside it and keeps newest-first order', () => {
  const range = resolveRange(metricBounds(LOGS, 'min', 1), { low: 20, high: 32 }, 1)
  const kept = filterGames(LOGS, { min: range })
  assert.deepEqual(kept.map((game) => game.date), ['10/22/2026', '04/10/2026', '04/08/2026'])
  assert.equal(isFiltered({ min: range }), true)
})

test('a narrowed usage range drops games without usage; both filters must pass', () => {
  const usg = resolveRange(metricBounds(LOGS, 'usg', 0.5), { low: 20, high: 30 }, 0.5)
  const min = resolveRange(metricBounds(LOGS, 'min', 1), { low: 25, high: 35 }, 1)
  assert.deepEqual(filterGames(LOGS, { usg }).map((game) => game.date), ['10/22/2026', '04/10/2026', '04/06/2026'])
  assert.deepEqual(filterGames(LOGS, { usg, min }).map((game) => game.date), ['10/22/2026', '04/10/2026', '04/06/2026'])
})

test('handles snap to the step, clamp to the bounds, and swap when crossed', () => {
  const bounds = { min: 10, max: 40 }
  assert.deepEqual(resolveRange(bounds, { low: 33.4, high: 5 }, 1), { low: 10, high: 33, full: false })
  assert.deepEqual(resolveRange(bounds, { low: 10, high: 40 }, 1), { low: 10, high: 40, full: true })
})

test('the hit rate is the unchanged math on the filtered games', () => {
  const range = resolveRange(metricBounds(LOGS, 'min', 1), { low: 25, high: 35 }, 1)
  const values = filterGames(LOGS, { min: range }).map((game) => game.pts)
  assert.deepEqual(overHitRate(values, 15.5), overHitRate([18, 14, 22], 15.5))
})

test('the Season window is the newest season in the log', () => {
  assert.deepEqual(newestSeasonLogs(LOGS, '2027').map((game) => game.date), ['10/22/2026'])
  assert.equal(newestSeasonLogs(LOGS, undefined).length, LOGS.length)
  assert.equal(newestSeasonLogs([{ date: 'x' }], '2026').length, 1)
})

test('labels format whole minutes and tenths of usage', () => {
  assert.equal(formatMetric(24, 1), '24')
  assert.equal(formatMetric(21.5, 0.5), '21.5')
  assert.equal(formatMetric(null, 1), '—')
})
