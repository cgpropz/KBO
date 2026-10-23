import test from 'node:test'
import assert from 'node:assert/strict'
import {
  PENDING, gamePassesRanges, hiddenForMissing, nflGameFilters, nflGameLog, nflTodayPick, nflTrendMetrics, nflTrendSummary, pickText, rangesActive, resolveFilterRanges,
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
  // Defense splits use this season's games only: 2025's rank-5 game is out.
  const tough = splits.rows.find((row) => row.id === 'dvptough')
  assert.equal(tough.n, 2)
  assert.equal(tough.label, 'vs 2026 D rank 1–10')
  assert.equal(splits.rows.find((row) => row.id === 'dvpsoft').n, 2)
  assert.ok(splits.rows.some((row) => row.id === 'snaphigh'))
  assert.ok(!splits.rows.some((row) => row.group === 'Rest'))
  assert.ok(model.unavailable.some((item) => /Target share/.test(item)))
})

test('def rank: this season only, unknown opponents are null, label says the season', () => {
  const row = { ...rows[0], recentDvpRanks: [5, 25, 3, null, 28, 9, 30] }
  const log = nflGameLog(row, rows, { currentSeason: 2026 })
  assert.deepEqual(log.map((game) => game.dvp), [null, null, 3, null, 28, 9, 30])
  const filters = nflGameFilters(row, log, { currentSeason: 2026 })
  const dvp = filters.find((filter) => filter.id === 'dvp')
  assert.equal(dvp.label, 'Def rank (2026)')
  const model = nflInsights(row, rows, { currentSeason: 2026 })
  const splits = buildSplits(model.games, { ...model, line: 70.5, today: parseGameDay('2026-10-10') })
  const defense = splits.rows.filter((item) => item.group === 'Defense')
  assert.equal(defense.reduce((sum, item) => sum + item.n, 0), 4)
  assert.ok(defense.every((item) => item.label.startsWith('vs 2026 D rank')))
})

test('a game missing a stat stays in until that slider is narrowed, then is counted', () => {
  const row = { ...rows[0], recentSnapPercents: [60, null, 70, null, 75, 80, 82] }
  const log = nflGameLog(row, rows, { currentSeason: 2026 })
  const filters = nflGameFilters(row, log, { currentSeason: 2026 })
  const open = resolveFilterRanges(filters, {})
  assert.ok(log.every((game) => gamePassesRanges(game, filters, open)))
  assert.deepEqual(hiddenForMissing(log, filters, open), [])
  const usageOnly = resolveFilterRanges(filters, { usage: { low: 10, high: 22 } })
  assert.equal(log.filter((game) => gamePassesRanges(game, filters, usageOnly)).length, 7)
  const snapNarrow = resolveFilterRanges(filters, { snap: { low: 61, high: 82 } })
  assert.equal(log.filter((game) => gamePassesRanges(game, filters, snapNarrow)).length, 4)
  assert.deepEqual(hiddenForMissing(log, filters, snapNarrow).map((item) => item.text), ['2 games without snap data hidden'])
  const dvpNarrow = resolveFilterRanges(filters, { dvp: { low: 1, high: 10 } })
  assert.deepEqual(hiddenForMissing(log, filters, dvpNarrow).map((item) => item.text), ['2 games without a 2026 D rank hidden'])
})

test('trend arrow count uses only games with a value this season', () => {
  const row = { ...rows[0], recentSnapPercents: [60, 62, 70, null, null, 80, 82] }
  const log = nflGameLog(row, rows, { currentSeason: 2026 })
  const snap = nflTrendMetrics(row, log).find((metric) => metric.id === 'snap')
  const summary = nflTrendSummary([...log].reverse(), snap, 2026)
  assert.equal(summary.seasonGames, 3)
  assert.equal(summary.trend, null)
})

test('board CG is Pending for a blank projection, never 0', () => {
  for (const projection of [null, undefined, '', 0]) {
    assert.equal(nflTodayPick({ prop: 'Rush Yards', line: 70.5, projection }).cg, null)
  }
  // The old board fallback turned a null projection into 0.
  assert.equal(nflCgScore(null, 70.5, 'Rush Yards'), 0)
})

test('nfl advanced directions: turnovers and def rank are lower-is-better, yards are not', async () => {
  await import('../src/playerInsights/insightsSports.js')
  const { isLowerBetter, strengthTone } = await import('../src/playerInsights/strengthScale.js')
  for (const stat of ['Pass INTs', 'INT', 'Interceptions', 'Sacks Taken', 'Fumbles Lost', 'Def rank', 'dvp']) {
    assert.equal(isLowerBetter('nfl', stat), true, stat)
  }
  for (const stat of ['Rush Yards', 'Receptions', 'Pass Yards', 'Rec Targets', 'snap', 'ypcarry', 'Pass TDs']) {
    assert.equal(isLowerBetter('nfl', stat), false, stat)
  }
  // Every NFL Advanced metric is registered higher-is-better and none is neutral.
  const { isNeutralStat } = await import('../src/playerInsights/strengthScale.js')
  for (const id of ['snap', 'touches', 'targets', 'carries', 'passatt', 'catch', 'ypt', 'ypc', 'ypcarry', 'yptouch', 'ypa', 'comp', 'tdr']) {
    assert.equal(isLowerBetter('nfl', id, { id, label: id }), false, id)
    assert.equal(isNeutralStat('nfl', id, { id, label: id }), false, id)
  }
  assert.equal(strengthTone(0.5, 1, { n: 6, lowerIsBetter: isLowerBetter('nfl', 'Pass INTs') }).tone, 'strong')
  assert.equal(strengthTone(90, 60, { n: 2 }).tone, 'muted')
})

test('nfl defense and snap split rows color by over rate vs the overall rate', async () => {
  const { buildSplits } = await import('../src/playerInsights/insightsCore.js')
  const mk = (i, value, snap, dvp) => ({ gameday: `2026-10-${String(1 + i).padStart(2, '0')}`, value, opponent: 'DAL', season: '2026', raw: { snap }, dvp })
  const games = [mk(0, 40, 80, 3), mk(1, 45, 82, 5), mk(2, 50, 85, 7), mk(3, 100, 60, 28), mk(4, 110, 55, 30), mk(5, 105, 50, 25)]
  const model = { sport: 'nfl', games, currentSeason: '2026' }
  const extra = [
    { group: 'Defense', id: 'dvptough', ownScope: true, label: 'vs 2026 D rank 1–10', test: (g) => g.dvp <= 10 },
    { group: 'Defense', id: 'dvpsoft', ownScope: true, label: 'vs 2026 D rank 23–32', test: (g) => g.dvp > 22 },
    { group: 'Snaps', id: 'snaphigh', label: 'Snap % 70+', test: (g) => g.raw.snap >= 70 },
  ]
  const { rows } = buildSplits(games, { ...model, extraSplits: extra, line: null })
  const by = Object.fromEntries(rows.map((r) => [r.id, r.strength?.tone]))
  assert.ok(['weak', 'soft'].includes(by.dvptough), JSON.stringify(by))
  assert.ok(['strong', 'good'].includes(by.dvpsoft), JSON.stringify(by))
  assert.ok(['weak', 'soft'].includes(by.snaphigh), JSON.stringify(by))
})
