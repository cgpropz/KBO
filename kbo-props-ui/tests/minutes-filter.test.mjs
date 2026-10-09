import assert from 'node:assert/strict'
import test from 'node:test'
import {
  formatMinutes,
  hitRateForGames,
  minutesBounds,
  minutesInRange,
  passesChartFilters,
  recordedMinutes,
  resolveMinutesRange,
} from '../src/wnba/chartFilters.js'

const blksStls = game => (game.blk ?? 0) + (game.stl ?? 0)

test('minutes come from the log and missing values stay missing', () => {
  assert.equal(recordedMinutes({ min: 32.5 }), 32.5)
  assert.equal(recordedMinutes({ min: 0 }), 0)
  assert.equal(recordedMinutes({ min: '28' }), 28)
  assert.equal(recordedMinutes({ min: null }), null)
  assert.equal(recordedMinutes({ min: undefined }), null)
  assert.equal(recordedMinutes({}), null)
  assert.equal(recordedMinutes({ min: '' }), null)
  assert.equal(recordedMinutes({ min: '32:15' }), null)
  assert.equal(recordedMinutes({ min: Number.NaN }), null)
})

test('bounds use the real low and high minutes, snapped to the slider step', () => {
  const bounds = minutesBounds([
    { min: 18.2 },
    { min: 36.2 },
    { min: null },
    { min: 'nope' },
  ])
  assert.deepEqual(bounds, { min: 18, max: 36.5 })
  assert.equal(minutesBounds([{ min: null }, {}]), null)
  assert.deepEqual(minutesBounds([{ min: 28 }]), { min: 28, max: 28 })
})

test('a fresh slider is the full range, and a saved range is clamped', () => {
  const bounds = { min: 12, max: 36 }
  assert.deepEqual(resolveMinutesRange(bounds, null), { low: 12, high: 36, full: true })
  assert.deepEqual(resolveMinutesRange(bounds, { low: 20, high: 30 }), { low: 20, high: 30, full: false })
  assert.deepEqual(resolveMinutesRange(bounds, { low: 5, high: 99 }), { low: 12, high: 36, full: true })
  assert.deepEqual(resolveMinutesRange(bounds, { low: 30, high: 20 }), { low: 20, high: 30, full: false })
  assert.equal(resolveMinutesRange(null, { low: 10, high: 20 }), null)
})

test('games outside the minutes range, and games with no minutes, drop out', () => {
  const games = [
    { min: 34, defRank: 4, usagePct: 22 },
    { min: 12, defRank: 8, usagePct: 18 },
    { min: null, defRank: 1, usagePct: 30 },
    { min: 0, defRank: 6, usagePct: 10 },
  ]
  const kept = games.filter(game => passesChartFilters(game, {
    filterMinutes: true,
    minutesLow: 0,
    minutesHigh: 36,
  }))
  assert.deepEqual(kept.map(game => game.min), [34, 12, 0])
  const narrowed = games.filter(game => passesChartFilters(game, {
    filterMinutes: true,
    minutesLow: 28,
    minutesHigh: 36,
  }))
  assert.deepEqual(narrowed.map(game => game.min), [34])
  assert.equal(minutesInRange(null, 0, 40), false)
  assert.equal(minutesInRange(0, 0, 40), true)
})

test('minutes, defense rank, and usage have to agree', () => {
  const game = { min: 30, defRank: 10, usagePct: 15 }
  assert.equal(passesChartFilters(game, {
    filterMinutes: true,
    minutesLow: 20,
    minutesHigh: 40,
    dvpThreshold: 8,
    usageThreshold: 10,
  }), false)
  assert.equal(passesChartFilters(game, {
    filterMinutes: true,
    minutesLow: 20,
    minutesHigh: 40,
    dvpThreshold: 12,
    usageThreshold: 20,
  }), false)
  assert.equal(passesChartFilters(game, {
    filterMinutes: true,
    minutesLow: 20,
    minutesHigh: 40,
    dvpThreshold: 12,
    usageThreshold: 10,
  }), true)
})

test('when the log has no minutes, the other filters still work and games stay', () => {
  const game = { min: null, defRank: 3, usagePct: 19 }
  assert.equal(passesChartFilters(game, { filterMinutes: false, dvpThreshold: null, usageThreshold: null }), true)
  assert.equal(passesChartFilters(game, { filterMinutes: false, dvpThreshold: 2 }), false)
})

test('hit rate recounts only the games still in the minutes range', () => {
  const games = [
    { min: 34, blk: 2, stl: 1 },
    { min: 31, blk: 1, stl: 1 },
    { min: 18, blk: 0, stl: 0 },
    { min: 29, blk: 1, stl: 0 },
    { min: null, blk: 4, stl: 4 },
  ]
  const line = 1.5
  const allWithMinutes = games.filter(game => passesChartFilters(game, {
    filterMinutes: true,
    minutesLow: 18,
    minutesHigh: 34,
  }))
  assert.deepEqual(hitRateForGames(allWithMinutes, blksStls, line), { pct: 50, hits: 2, games: 4 })
  const starters = games.filter(game => passesChartFilters(game, {
    filterMinutes: true,
    minutesLow: 28,
    minutesHigh: 34,
  }))
  assert.deepEqual(hitRateForGames(starters, blksStls, line), { pct: 67, hits: 2, games: 3 })
  assert.deepEqual(hitRateForGames([], blksStls, line), { pct: null, hits: 0, games: 0 })
})

test('minutes labels stay on one decimal and do not invent a number', () => {
  assert.equal(formatMinutes(32), '32')
  assert.equal(formatMinutes(18.5), '18.5')
  assert.equal(formatMinutes(null), '—')
})
