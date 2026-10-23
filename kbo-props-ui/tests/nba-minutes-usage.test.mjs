import test from 'node:test'
import assert from 'node:assert/strict'
import {
  EARLY_SEASON_GAMES, TREND_THRESHOLD, TREND_METRICS, averageMetric, cardTrend, formatTrendValue, metricSummary, metricValue,
  seasonLabel, trendBars, trendBaseline, trendDirection,
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
  assert.equal(minutes.baselineLabel, null)
  assert.equal(minutes.trend, 'up')

  const usage = metricSummary(LOGS, 'usg')
  close(usage.l5, (28 + 27 + 26.5) / 3)
  close(usage.season, (28 + 27 + 26.5 + 18) / 4)
  // Only 4 usage games this season: the arrow is against last season (21.5).
  close(usage.baseline, 21.5)
  assert.equal(usage.baselineLabel, "'25-26")
  assert.equal(usage.trend, 'up')

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
  assert.deepEqual([usg.short, usg.arrow, usg.text], ['USG', '↑', '27%'])
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

test('early season: under 5 games this season the arrow uses last season, labeled', () => {
  assert.equal(EARLY_SEASON_GAMES, 5)
  assert.equal(seasonLabel('2026'), "'25-26")
  assert.equal(seasonLabel('2027'), "'26-27")
  assert.equal(seasonLabel(null), null)

  const season = (year, minutes) => minutes.map((min) => ({ season: year, min }))
  // 1 game this season (18 min) after 5 at 30 last season: L5 = (18+30*4)/5 = 27.6,
  // 2.4 under last season's 30 -> down vs '25-26 (not up vs this season's 18).
  const oneGame = [...season('2027', [18]), ...season('2026', [30, 30, 30, 30, 30])]
  assert.deepEqual(trendBaseline(oneGame, 'min'), { value: 30, season: '2026', label: "'25-26" })
  const early = metricSummary(oneGame, 'min')
  close(early.season, 18)
  assert.equal(early.trend, 'down')
  assert.equal(early.baselineLabel, "'25-26")

  // 4 games this season still uses last season; the 5th switches to this season.
  const four = [...season('2027', [36, 36, 36, 36]), ...season('2026', [30, 30, 30, 30, 30, 30])]
  assert.equal(metricSummary(four, 'min').baselineLabel, "'25-26")
  const five = [...season('2027', [36, 36, 36, 36, 36]), ...season('2026', [30, 30, 30, 30, 30])]
  const atFive = metricSummary(five, 'min')
  assert.equal(atFive.baselineLabel, null)
  close(atFive.baseline, 36)
  assert.equal(atFive.trend, 'flat')

  // A 0-minute game does not count toward the 5.
  const withDnp = [...season('2027', [36, 0, 36, 36, 36]), ...season('2026', [30, 30, 30, 30, 30])]
  assert.equal(metricSummary(withDnp, 'min').baselineLabel, "'25-26")

  // Neither season has 5 games: no arrow.
  const thin = [...season('2027', [20, 22]), ...season('2026', [30, 30, 30, 30])]
  assert.equal(trendBaseline(thin, 'min'), null)
  assert.equal(metricSummary(thin, 'min').trend, null)
  const thinCard = cardTrend({ gameLogs: thin }, TREND_METRICS[0])
  assert.deepEqual([thinCard.arrow, thinCard.trend, thinCard.baselineLabel, thinCard.text], ['', null, null, '26.4'])

  // Only two seasons back counts as last season when it is the season before.
  const gap = [...season('2027', [20]), ...season('2025', [30, 30, 30, 30, 30])]
  assert.equal(trendBaseline(gap, 'min'), null)

  // The card uses the same rule and carries the label.
  const card = cardTrend({ gameLogs: oneGame }, TREND_METRICS[0])
  assert.deepEqual([card.arrow, card.text, card.baselineLabel, card.color], ['↓', '27.6', "'25-26", '#ef4444'])
  const cardFive = cardTrend({ gameLogs: five }, TREND_METRICS[0])
  assert.deepEqual([cardFive.arrow, cardFive.baselineLabel], ['→', null])
})
