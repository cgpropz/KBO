import assert from 'node:assert/strict'
import test from 'node:test'
import { HIT_RATE_NEUTRAL_TEXT, overHitRate } from '../src/hitRateStrip.js'
import {
  buildAltLines,
  inferLineStep,
  lineRange,
  offeredLinesForStat,
  rateTextColor,
  resolveChartLine,
  snapLine,
} from '../src/lineSlider.js'

const GAMES = [5, 1, 3, 3, 0]

test('a push is left out when the line moves onto a logged result', () => {
  assert.deepEqual(overHitRate(GAMES, 2.5), { rate: 60, hits: 3, games: 5, pushes: 0 })
  const onThree = overHitRate(GAMES, 3)
  assert.deepEqual(onThree, { rate: 33, hits: 1, games: 3, pushes: 2 })
  assert.equal(overHitRate([3, 3], 3), null)
})

test('the chart rate follows the dragged line and only the games it is given', () => {
  const posted = resolveChartLine({ postedLine: 2.5, values: GAMES })
  assert.equal(posted.line, 2.5)
  assert.equal(posted.moved, false)
  assert.equal(posted.rate.rate, 60)
  assert.equal(posted.rate.hits, 3)
  assert.equal(posted.rate.games, 5)

  const dragged = resolveChartLine({ postedLine: 2.5, override: 0.5, values: GAMES })
  assert.equal(dragged.line, 0.5)
  assert.equal(dragged.moved, true)
  assert.equal(dragged.rate.rate, 80)
  assert.equal(dragged.rate.hits, 4)
  assert.equal(dragged.rate.games, 5)

  const filtered = resolveChartLine({ postedLine: 2.5, values: [5, 0] })
  assert.equal(filtered.rate.rate, 50)
  assert.equal(filtered.rate.games, 2)
  assert.notEqual(filtered.rate.rate, posted.rate.rate)
})

test('the handle steps by 0.5 and stays inside 0 and the log max', () => {
  assert.equal(inferLineStep(4.5), 0.5)
  assert.equal(inferLineStep(4.25), 0.25)
  assert.equal(snapLine(2.2, 0.5, 0, 10), 2)
  assert.equal(snapLine(2.3, 0.5, 0, 10), 2.5)
  assert.equal(snapLine(-1, 0.5, 0, 10), 0)
  assert.equal(snapLine(99, 0.5, 0, 6.5), 6.5)
  const range = lineRange([5, 1, 3], 0.5, 2.5)
  assert.equal(range.min, 0)
  assert.equal(range.max, 5.5)
  assert.equal(range.step, 0.5)
})

test('alt lines sit two steps around the posted line and keep their own rates', () => {
  const resolved = resolveChartLine({ postedLine: 2.5, values: GAMES })
  assert.deepEqual(resolved.alts.map((alt) => alt.line), [1.5, 2, 2.5, 3, 3.5])
  const atThree = resolved.alts.find((alt) => alt.line === 3)
  assert.equal(atThree.rate, 33)
  assert.equal(atThree.games, 3)
  assert.equal(atThree.hits, 1)
  const low = resolveChartLine({ postedLine: 0.5, values: [1, 0] })
  assert.deepEqual(low.alts.map((alt) => alt.line), [0, 0.5, 1, 1.5])
})

test('real alt lines replace the generated steps', () => {
  const offered = offeredLinesForStat([
    { stat: 'Points', line: 19.5, altLines: [17.5, 19.5, 22.5] },
    { stat: 'Rebounds', line: 6.5 },
  ], 'Points')
  assert.deepEqual(offered, [17.5, 19.5, 22.5])
  const resolved = resolveChartLine({ postedLine: 19.5, values: [20, 18, 24, 15], offeredLines: offered })
  assert.deepEqual(resolved.alts.map((alt) => alt.line), [17.5, 19.5, 22.5])
  assert.equal(resolved.alts.find((alt) => alt.line === 22.5).rate, 25)
  assert.deepEqual(
    buildAltLines({ postedLine: 19.5, step: 0.5, offered: [19.5] }),
    [18.5, 19, 19.5, 20, 20.5],
  )
})

test('fewer than 3 decided games stays the neutral pill color', () => {
  const resolved = resolveChartLine({ postedLine: 1.5, override: 3, values: [5, 3, 0] })
  assert.equal(resolved.rate.games, 2)
  assert.equal(resolved.rate.rate, 50)
  assert.equal(rateTextColor(resolved.rate.rate, resolved.rate.games), HIT_RATE_NEUTRAL_TEXT)
  assert.equal(rateTextColor(80, 5), '#22c55e')
  assert.equal(rateTextColor(20, 6), '#f87171')
})
