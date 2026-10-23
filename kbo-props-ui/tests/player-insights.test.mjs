// Splits / Advanced preview math. Made-up game logs only.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildSplits, formatMetric, metricWindows, parseGameDay, withRest } from '../src/playerInsights/insightsCore.js'
import { basketballSeasonLabel, kboInsights, nbaInsights, nflInsights, nhlInsights } from '../src/playerInsights/insightsSports.js'
import { readInsightsLayout } from '../src/playerInsights/insightsPreview.js'

function memoryStorage() {
  const data = new Map()
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  }
}

test('preview switch is off by default and sticks per tab', () => {
  const storage = memoryStorage()
  assert.equal(readInsightsLayout('', storage), null)
  assert.equal(readInsightsLayout('?sport=nba', storage), null)
  assert.equal(readInsightsLayout('?insights=B', storage), 'b')
  assert.equal(readInsightsLayout('?sport=nfl', storage), 'b')
  assert.equal(readInsightsLayout('?insights=off', storage), null)
  assert.equal(readInsightsLayout('', storage), null)
  assert.equal(readInsightsLayout('?insights=z', storage), null)
})

test('parses each sport date shape', () => {
  assert.equal(parseGameDay('2026-10-01'), parseGameDay('10/01/2026'))
  assert.equal(parseGameDay('10/1', () => 2026), parseGameDay('2026-10-01'))
  assert.equal(parseGameDay('10/1'), null)
  assert.equal(basketballSeasonLabel('2027'), "'26-27")
})

test('rest days stay inside a season', () => {
  const games = withRest([
    { day: 10, season: 'S2' },
    { day: 9, season: 'S2' },
    { day: 6, season: 'S2' },
    { day: 1, season: 'S1' },
  ])
  assert.deepEqual(games.map((game) => game.rest), [0, 2, null, null])
})

function nbaLog(date, pts, matchup, result, season = '2027') {
  return { date, pts, reb: 5, ast: 3, min: 30, fga: 15, fgm: 7, fg3a: 5, fg3m: 2, fta: 4, ftm: 3, tov: 2, usg: 22, matchup, result, season }
}

test('NBA splits: venue, opponent, result, rest, hit rate vs line, small samples', () => {
  const logs = [
    nbaLog('10/22/2026', 30, 'AAA vs. BBB', 'W'),
    nbaLog('10/21/2026', 10, 'AAA @ CCC', 'L'),
    nbaLog('10/18/2026', 25, 'AAA vs. BBB', 'W'),
    nbaLog('04/10/2026', 20, 'AAA @ BBB', 'L', '2026'),
  ]
  const model = nbaInsights(logs, { valueOf: (game) => game.pts, opponent: 'BBB' })
  assert.equal(model.currentSeason, '2027')
  assert.equal(model.priorSeason, '2026')
  const splits = buildSplits(model.games, { ...model, line: 19.5, today: parseGameDay('10/23/2026') })
  const byId = Object.fromEntries(splits.rows.map((row) => [row.id, row]))
  assert.equal(byId.season.n, 3)
  assert.equal(byId.season.early, true)
  assert.equal(byId.season.rate, 67)
  assert.equal(byId.home.n, 2)
  assert.equal(byId.home.rate, 100)
  assert.equal(byId.away.avg, 15)
  assert.equal(byId.vsopp.n, 3)
  assert.equal(byId.wins.n, 2)
  assert.equal(byId.losses.rate, 50)
  assert.equal(byId.rest0.n, 1)
  assert.equal(byId.rest2.n, 1)
  assert.equal(byId.l30d.n, 3)
  assert.equal(byId.home.small, true)
  assert.deepEqual(splits.skipped, [])
})

test('missing fields are skipped, never shown as zero', () => {
  const model = kboInsights({ type: 'pitcher', games: [{ date: '09/01/2026', so: 6, outs: 18, bb: 2, ha: 5, er: 2, season: 2026, opp: 'X' }] }, { valueOf: (game) => game.so })
  const splits = buildSplits(model.games, { ...model, line: 5.5, today: parseGameDay('2026-09-03') })
  assert.ok(splits.rows.every((row) => row.id !== 'home' && row.id !== 'wins' && row.id !== 'vslhp'))
  assert.ok(splits.skipped.some((item) => item.startsWith('Home/Away')))
  assert.ok(splits.skipped.some((item) => item.startsWith('Wins/Losses')))
})

test('KBO hitters split by starter hand and derive rate stats', () => {
  const player = {
    type: 'batter',
    games: [
      { date: '2026-09-02', h: 2, ab: 4, bb: 1, tb: 5, hr: 1, r: 1, rbi: 2, hrr: 5, season: 2026, opp: 'X', opp_hand: 'L' },
      { date: '2026-09-01', h: 0, ab: 3, bb: 0, tb: 0, hr: 0, r: 0, rbi: 0, hrr: 0, season: 2026, opp: 'Y', opp_hand: 'R' },
    ],
  }
  const model = kboInsights(player, { valueOf: (game) => game.hrr })
  const splits = buildSplits(model.games, { ...model, line: 1.5, today: parseGameDay('2026-09-03') })
  const lhp = splits.rows.find((row) => row.id === 'vslhp')
  assert.equal(lhp.n, 1)
  assert.equal(lhp.rate, 100)
  const avg = model.metrics.find((metric) => metric.id === 'avg')
  const windows = metricWindows(avg, model.games, model)
  assert.equal(formatMetric(windows[0].value, avg.format), '.286')
  assert.equal(windows[0].small, true)
})

test('NFL pairs props by week for rate stats; no rest split', () => {
  const base = { gameDates: ['9/7', '9/14'], gameSeasons: [2026, 2026], gameOpponents: ['AA', 'BB'], recentSnapPercents: [80, 90], recentUsage: [8, 10], usageLabel: 'Targets' }
  const rows = [
    { ...base, prop: 'Receiving Yards', recent: [60, 100] },
    { ...base, prop: 'Receptions', recent: [5, 8] },
  ]
  const model = nflInsights(rows[0], rows, { currentSeason: 2026 })
  assert.equal(model.restApplies, false)
  const ids = model.metrics.map((metric) => metric.id)
  assert.ok(ids.includes('catch') && ids.includes('ypt') && ids.includes('ypc'))
  const ypt = model.metrics.find((metric) => metric.id === 'ypt')
  assert.equal(metricWindows(ypt, model.games, model)[0].value, 160 / 18)
  const splits = buildSplits(model.games, { ...model, line: 70.5, today: parseGameDay('2026-09-20') })
  assert.ok(!splits.rows.some((row) => row.group === 'Rest'))
})

test('NHL splits stay off the non-commercial logs until a source is approved', () => {
  const item = { log: [1, 2], logDates: ['10/10', '10/12'], logSeasons: ['2026-27', '2026-27'], logOpponents: ['A', 'B'], opponent: 'A' }
  const blocked = nhlInsights(item)
  assert.ok(blocked.splitsBlocked)
  assert.equal(blocked.games.length, 0)
  assert.equal(blocked.metrics.length, 0)
  const approved = nhlInsights(item, { sourceApproved: true })
  assert.equal(approved.splitsBlocked, null)
  assert.equal(approved.games[0].opp, 'B')
})
