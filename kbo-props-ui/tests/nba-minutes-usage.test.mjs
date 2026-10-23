import test from 'node:test'
import assert from 'node:assert/strict'
import {
  EARLY_SEASON_GAMES, TREND_THRESHOLD, TREND_METRICS, averageMetric, cardTrend, formatTrendValue, metricSummary, metricValue,
  trendBars, trendBaseline, trendDirection,
} from '../src/nba/nbaMinutesUsage.js'
import { filterGames, resolveRange, metricBounds } from '../src/nba/nbaGameFilters.js'

// Synthetic game log, newest first: 6 games this season, 6 last season.
const LOGS = [
  { date: '11/04/2026', season: '2027', min: 36, usg: 28.0 },
  { date: '11/02/2026', season: '2027', min: 34, usg: 27.0 },
  { date: '10/31/2026', season: '2027', min: '32', usg: '26.5' },
  { date: '10/29/2026', season: '2027', min: 30, usg: null },
  { date: '10/27/2026', season: '2027', min: 0, usg: null },
  { date: '10/24/2026', season: '2027', min: 20, usg: 18.0 },
  { date: '04/12/2026', season: '2026', min: 22, usg: 19.0 },
  { date: '04/10/2026', season: '2026', min: 24, usg: 20.0 },
  { date: '04/08/2026', season: '2026', min: 26, usg: 21.0 },
  { date: '04/06/2026', season: '2026', min: 28, usg: 22.0 },
  { date: '04/04/2026', season: '2026', min: 30, usg: 23.0 },
  { date: '04/02/2026', season: '2026', min: 32, usg: 24.0 },
]

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`)

test('metric values skip blanks, non-numbers and a 0-minute game', () => {
  assert.equal(metricValue({ min: 0 }, 'min'), null)
  assert.equal(metricValue({ min: '31.5' }, 'min'), 31.5)
  assert.equal(metricValue({ usg: '' }, 'usg'), null)
  assert.equal(metricValue({ usg: 'n/a' }, 'usg'), null)
  assert.equal(metricValue({ usg: 0 }, 'usg'), 0)
  assert.equal(averageMetric([], 'min'), null)
  assert.equal(averageMetric([{ usg: null }], 'usg'), null)
})

test('L5 / L10 / Season averages', () => {
  const minutes = metricSummary(LOGS, 'min')
  // L5: 36, 34, 32, 30 (the 0-minute game is left out).
  close(minutes.l5, 33)
  // L10: 36 34 32 30 20 22 24 26 28 (9 values).
  close(minutes.l10, (36 + 34 + 32 + 30 + 20 + 22 + 24 + 26 + 28) / 9)
  // Season = newest season only: 36 34 32 30 20.
  close(minutes.season, 30.4)
  // 5 minutes games this season: the arrow is against this season.
  close(minutes.baseline, 30.4)
  assert.equal(minutes.trend, 'up')

  const usage = metricSummary(LOGS, 'usg')
  close(usage.l5, (28 + 27 + 26.5) / 3)
  close(usage.season, (28 + 27 + 26.5 + 18) / 4)
  // Only 4 usage games this season: no arrow, and last season is not used.
  assert.equal(usage.baseline, null)
  assert.equal(usage.trend, null)
  assert.equal('baselineLabel' in usage, false)

  const empty = metricSummary([], 'usg')
  assert.deepEqual([empty.l5, empty.l10, empty.season, empty.trend], [null, null, null, null])
})

test('trend arrow: more than 1.5 up or down, otherwise flat', () => {
  assert.equal(TREND_THRESHOLD, 1.5)
  assert.equal(trendDirection(31.6, 30), 'up')
  assert.equal(trendDirection(31.5, 30), 'flat')
  assert.equal(trendDirection(28.5, 30), 'flat')
  assert.equal(trendDirection(28.4, 30), 'down')
  assert.equal(trendDirection(30, 30), 'flat')
  // Float noise at the edge stays flat: 0.1 + 0.2 + 1.2 = 1.5000000000000002.
  assert.equal(trendDirection(0.1 + 0.2 + 1.2, 0), 'flat')
  assert.equal(trendDirection(null, 30), null)
  assert.equal(trendDirection(30, null), null)
})

test('bars run oldest to newest and dim the games the sliders filtered out', () => {
  const window = LOGS.slice(0, 5)
  const open = trendBars(window, null, 'min')
  assert.deepEqual(open.map((bar) => bar.game.date), ['10/27/2026', '10/29/2026', '10/31/2026', '11/02/2026', '11/04/2026'])
  assert.ok(open.every((bar) => bar.dimmed === false))
  assert.deepEqual(open.map((bar) => bar.value), [null, 30, 32, 34, 36])

  // Minutes slider narrowed to 31-40: the 30 and the 0 drop out of the hit
  // rate, and are dimmed here.
  const bounds = metricBounds(LOGS, 'min', 1)
  const ranges = { min: resolveRange(bounds, { low: 31, high: 40 }, 1) }
  const kept = new Set(filterGames(LOGS, ranges))
  const narrowed = trendBars(window, kept, 'usg')
  assert.deepEqual(narrowed.map((bar) => bar.dimmed), [true, true, false, false, false])
  assert.deepEqual(narrowed.map((bar) => bar.value), [null, null, 26.5, 27, 28])
})

test('list card line: L5 average and arrow', () => {
  const [minMetric, usgMetric] = TREND_METRICS
  const min = cardTrend({ gameLogs: LOGS }, minMetric)
  assert.deepEqual([min.short, min.arrow, min.text, min.trend], ['MIN', '↑', '33.0', 'up'])
  const usg = cardTrend({ gameLogs: LOGS }, usgMetric)
  assert.deepEqual([usg.short, usg.arrow, usg.text, usg.trend], ['USG', '', '27%', null])
  const down = cardTrend({ gameLogs: [
    { season: '2027', usg: 18 }, { season: '2027', usg: 19 }, { season: '2027', usg: 20 },
    { season: '2027', usg: 30 }, { season: '2027', usg: 30 }, { season: '2027', usg: 30 }, { season: '2027', usg: 30 },
  ] }, usgMetric)
  assert.equal(down.arrow, '↓')
  assert.equal(down.color, '#ef4444')
  assert.equal(cardTrend({ gameLogs: [{ min: 30 }] }, usgMetric), null)
  assert.equal(cardTrend({}, minMetric), null)
  assert.equal(formatTrendValue(22.4, '%'), '22%')
  assert.equal(formatTrendValue(null, 'min'), '—')
})

test('early season: no arrow and no label under 5 games this season', () => {
  assert.equal(EARLY_SEASON_GAMES, 5)
  const season = (year, minutes) => minutes.map((min) => ({ season: year, min }))

  // 1 game this season after a full last season: no arrow, last season unused.
  const oneGame = [...season('2027', [18]), ...season('2026', [30, 30, 30, 30, 30])]
  assert.equal(trendBaseline(oneGame, 'min'), null)
  const early = metricSummary(oneGame, 'min')
  close(early.season, 18)
  assert.equal(early.trend, null)
  assert.equal(early.baseline, null)
  const card = cardTrend({ gameLogs: oneGame }, TREND_METRICS[0])
  assert.deepEqual([card.arrow, card.trend, card.text, card.color], ['', null, '27.6', '#9ca3af'])
  assert.equal('baselineLabel' in card, false)

  // 4 games this season: still no arrow. The 5th turns on L5 vs this season.
  const four = [...season('2027', [40, 40, 40, 40]), ...season('2026', [30, 30, 30, 30, 30, 30])]
  assert.equal(metricSummary(four, 'min').trend, null)
  const five = [...season('2027', [36, 36, 36, 36, 36]), ...season('2026', [30, 30, 30, 30, 30])]
  const atFive = metricSummary(five, 'min')
  assert.deepEqual(trendBaseline(five, 'min'), { value: 36, season: '2027' })
  close(atFive.baseline, 36)
  assert.equal(atFive.trend, 'flat')
  const rising = [...season('2027', [36, 36, 36, 36, 36, 20, 20, 20]), ...season('2026', [30])]
  assert.equal(metricSummary(rising, 'min').trend, 'up')
  assert.deepEqual(cardTrend({ gameLogs: rising }, TREND_METRICS[0]).arrow, '↑')

  // A 0-minute game does not count toward the 5.
  const withDnp = [...season('2027', [36, 0, 36, 36, 36]), ...season('2026', [30, 30, 30, 30, 30])]
  assert.equal(metricSummary(withDnp, 'min').trend, null)
})
