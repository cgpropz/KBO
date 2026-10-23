import test from 'node:test'
import assert from 'node:assert/strict'
import {
  PENDING, gamePassesRanges, nflGameFilters, nflGameLog, nflTodayPick, nflTrendMetrics, nflTrendSummary, pickText, rangesActive, resolveFilterRanges,
} from '../src/nfl/nflPlayerGames.js'
import { nflCgScore } from '../src/nfl/nflLineFloors.js'
import { nflInsights } from '../src/playerInsights/insightsSports.js'
import { buildSplits, metricWindows, parseGameDay } from '../src/playerInsights/insightsCore.js'

// Made-up NFL rows only.
const base = {
  position: 'RB',
  usageLabel: 'Rush Att',
  gameDates: ['12/21', '12/28', '9/6', '9/13', '9/20', '9/27', '10/4'],
  gameSeasons: [2025, 2025, 2026, 2026, 2026, 2026, 2026],
  gameOpponents: ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
  recentSnapPercents: [60, 62, 70, 72, 75, 80, 82],
  recentUsage: [10, 12, 15, 16, 18, 20, 22],
  recentDvpRanks: [5, 25, 3, 12, 28, 9, 30],
  priorSeasonLabel: 2025,
}
const rows = [
  { ...base, prop: 'Rush Yards', line: 70.5, projection: 75, recent: [40, 55, 62, 70, 81, 90, 99] },
  { ...base, prop: 'Receptions', line: 3.5, projection: 3.8, recent: [1, 2, 2, 3, 3, 4, 5] },
  { ...base, prop: 'Rec Targets', line: 4.5, projection: 4.2, recent: [2, 3, 3, 4, 4, 5, 6] },
]

test('today pick reuses the board CG Score and is Pending when blank', () => {
  const pick = nflTodayPick(rows[0])
  assert.equal(pick.projection, 75)
  assert.equal(pick.cg, nflCgScore(75, 70.5, 'Rush Yards'))
  assert.equal(pick.side, 'OVER')
  for (const projection of [null, '', 0, -1, 'x']) {
    const blank = nflTodayPick({ ...rows[0], projection })
    assert.deepEqual(blank, { projection: null, cg: null, side: null })
    assert.equal(pickText(blank.cg), null)
  }
  assert.equal(nflTodayPick({ ...rows[0], line: null }).cg, null)
  assert.equal(nflTodayPick({ ...rows[0], line: 0.5 }).cg, null)
  assert.equal(PENDING, 'Pending')
})

test('game log pairs props by week; touches only when both parts are known', () => {
  const log = nflGameLog(rows[0], rows)
  assert.equal(log.length, 7)
  assert.equal(log[6].carries, 22)
  assert.equal(log[6].receptions, 5)
  assert.equal(log[6].targets, 6)
  assert.equal(log[6].touches, 27)
  assert.equal(log[6].rushYds, 99)
  assert.equal(log[6].season, '2026')
  const alone = nflGameLog(rows[0], [rows[0]])
  assert.equal(alone[6].receptions, null)
  assert.equal(alone[6].touches, null)
  assert.equal(alone[6].targets, null)
})

test('filters: one per stat with values, def rank on a 1-32 scale', () => {
  const log = nflGameLog(rows[0], rows)
  const filters = nflGameFilters(rows[0], log)
  assert.deepEqual(filters.map((filter) => filter.id), ['snap', 'usage', 'targets', 'touches', 'dvp'])
  assert.equal(filters.find((filter) => filter.id === 'usage').label, 'Rush Att')
  assert.deepEqual([filters[4].bounds.min, filters[4].bounds.max], [1, 32])
  const open = resolveFilterRanges(filters, {})
  assert.equal(rangesActive(open), false)
  assert.ok(log.every((game) => gamePassesRanges(game, filters, open)))
  const narrowed = resolveFilterRanges(filters, { snap: { low: 75, high: 100 } })
  assert.equal(rangesActive(narrowed), true)
  assert.equal(log.filter((game) => gamePassesRanges(game, filters, narrowed)).length, 3)
  const wr = { ...base, position: 'WR', usageLabel: 'Targets' }
  assert.ok(!nflGameFilters(wr, nflGameLog(wr, [])).some((filter) => filter.id === 'targets'))
})

test('trends: no arrow under 5 games this season, then L5 vs this season', () => {
  const log = nflGameLog(rows[0], rows)
  const metrics = nflTrendMetrics(rows[0], log)
  assert.deepEqual(metrics.map((metric) => metric.id), ['snap', 'touches', 'targets'])
  const touches = metrics.find((metric) => metric.id === 'touches')
  const newest = [...log].reverse()
  const summary = nflTrendSummary(newest, touches, 2026)
  assert.equal(summary.seasonGames, 5)
  assert.equal(summary.season, (17 + 19 + 21 + 24 + 27) / 5)
  assert.equal(summary.trend, 'flat')
  const early = nflTrendSummary(newest.slice(0, 4), touches, 2026)
  assert.equal(early.trend, null)
  assert.equal(nflTrendSummary(newest, touches, 2027).trend, null)
})

test('NFL insights: volume and efficiency metrics, defense and snap splits', () => {
  const model = nflInsights(rows[0], rows, { currentSeason: 2026 })
  const ids = model.metrics.map((metric) => metric.id)
  for (const id of ['snap', 'touches', 'targets', 'carries', 'catch', 'ypcarry']) assert.ok(ids.includes(id), id)
  assert.ok(!ids.includes('yptouch'), 'no receiving yards logged, so no yards per touch')
  const ypc = model.metrics.find((metric) => metric.id === 'ypcarry')
  assert.equal(metricWindows(ypc, model.games, model)[0].value, (62 + 70 + 81 + 90 + 99) / (15 + 16 + 18 + 20 + 22))
  const splits = buildSplits(model.games, { ...model, line: 70.5, today: parseGameDay('2026-10-10') })
  const tough = splits.rows.find((row) => row.id === 'dvptough')
  assert.equal(tough.n, 3)
  assert.ok(splits.rows.some((row) => row.id === 'snaphigh'))
  assert.ok(!splits.rows.some((row) => row.group === 'Rest'))
  assert.ok(model.unavailable.some((item) => /Target share/.test(item)))
})
