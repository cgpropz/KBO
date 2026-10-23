import assert from 'node:assert/strict'
import test from 'node:test'
import {
  deriveHeadLabels,
  deriveTailLabels,
  gameChartBars,
  headChartBars,
  tailChartBars,
} from '../src/chartLabels.js'
import { buildPropRows, nbaHitPills } from '../src/nba/nbaPropLines.js'
import { KBO_VALUE } from '../src/hitRateStrip.js'
import { stripBoardHistory } from '../api/_boardPayload.js'

// Made-up rows only.
const series = (n, start = 0) => Array.from({ length: n }, (_, i) => start + i)

test('NFL tail labels line up with the last ten values, oldest first', () => {
  const row = {
    recent: series(12, 50),
    gameDates: series(12).map((n) => `2026-10-${String(n + 1).padStart(2, '0')}`),
    gameOpponents: series(12).map((n) => `T${n}`),
  }
  const bars = tailChartBars(row)
  assert.equal(bars.length, 10)
  assert.deepEqual(bars.map((bar) => bar.value), series(10, 52))
  assert.equal(bars[0].date, '2026-10-03')
  assert.equal(bars[0].team, 'T2')
  assert.equal(bars[9].date, '2026-10-12')
  assert.equal(bars[9].team, 'T11')
})

test('NHL takes opponents from the log tail only when its dates match', () => {
  const recent = series(10)
  const gameDates = series(10).map((n) => `10/${n + 10}`)
  const log = { recent, gameDates, logDates: ['10/08', '10/09', ...gameDates], logOpponents: ['A', 'B', ...series(10).map((n) => `O${n}`)] }
  assert.deepEqual(deriveTailLabels(log).l10Opps, series(10).map((n) => `O${n}`))
  const shifted = { ...log, logDates: [...log.logDates.slice(1), '10/30'] }
  assert.deepEqual(deriveTailLabels(shifted).l10Opps, Array(10).fill(''))
  assert.deepEqual(deriveTailLabels(shifted).l10Dates, gameDates)
  // Dates that do not run parallel to the values give no labels at all.
  assert.equal(deriveTailLabels({ recent, gameDates: gameDates.slice(1) }), null)
  assert.ok(tailChartBars({ recent, gameDates: gameDates.slice(1) }).every((bar) => bar.date === ''))
})

test('KBO labels need the games to give exactly the shown values', () => {
  const games = series(12).map((n) => ({ date: `2026-09-${n + 1}`, opp: n % 2 ? 'LG' : 'KT', tb: n % 4 }))
  const prop = { stat: 'Total Bases', recent_values: games.slice(0, 10).map((g) => g.tb) }
  const bars = headChartBars(prop, games, KBO_VALUE['Total Bases'])
  assert.equal(bars.length, 10)
  // recent_values are newest first; bars run oldest on the left.
  assert.equal(bars[9].date, '2026-09-1')
  assert.equal(bars[9].team, 'KT')
  assert.equal(bars[0].date, '2026-09-10')
  const mismatched = { ...prop, recent_values: [9, ...prop.recent_values.slice(1)] }
  assert.equal(deriveHeadLabels(games, mismatched.recent_values, KBO_VALUE['Total Bases']), null)
  assert.ok(headChartBars(mismatched, games, KBO_VALUE['Total Bases']).every((bar) => bar.date === ''))
})

test('NBA / WNBA bars skip games without the stat and keep each game its own label', () => {
  const games = [
    { date: '10/21/2026', matchup: 'HOU vs. DAL', blk: 1 },
    { date: '04/10/2026', matchup: 'HOU @ SAS', blk: null },
    { date: '04/09/2026', matchup: 'HOU @ MIN', blk: 0 },
  ]
  const bars = gameChartBars(games, (g) => g.blk, (g) => g.matchup.split(/vs\.|@/).pop().trim())
  assert.deepEqual(bars, [
    { value: 0, date: '04/09/2026', team: 'MIN' },
    { value: 1, date: '10/21/2026', team: 'DAL' },
  ])
})

function nbaLog(index, season, blk = index % 2) {
  return { date: `10/${21 - index}/2026`, matchup: 'HOU vs. DAL', season, min: 30, pts: 20, reb: 6, ast: 4, stl: 1, blk, tov: 1, fg3m: 2 }
}

test("NBA season pill is this season only, labelled '26-27, with its true count", () => {
  const logs = series(10).map((i) => nbaLog(i, i < 2 ? '2027' : '2026', i === 0 ? 1 : 0))
  const pills = nbaHitPills(logs, 'Blocked Shots', 0.5, 'SAS')
  const season = pills.find((pill) => pill.id === 'season')
  assert.equal(season.label, "'26-27")
  assert.equal(season.games, 2)
  assert.equal(season.rate, 50)
  assert.equal(pills.find((pill) => pill.id === 'l10').games, 10)
})

test('NBA season pill keeps the Season fallback when logs carry no season', () => {
  const logs = series(10).map((i) => nbaLog(i, undefined))
  const season = nbaHitPills(logs, 'Blocked Shots', 0.5, 'SAS').find((pill) => pill.id === 'season')
  assert.equal(season.label, 'Season')
  assert.equal(season.games, 10)
})

test('NBA season pill is left out when all ten board logs are this season', () => {
  const logs = series(10).map((i) => nbaLog(i, '2027'))
  const pills = nbaHitPills(logs, 'Blocked Shots', 0.5, 'SAS')
  assert.equal(pills.find((pill) => pill.id === 'season'), undefined)
  // Fewer than ten, all this season: the count is known.
  const short = nbaHitPills(logs.slice(0, 4), 'Blocked Shots', 0.5, 'SAS').find((pill) => pill.id === 'season')
  assert.equal(short.label, "'26-27")
  assert.equal(short.games, 4)
})

test('NBA board rows carry dated bars in the same order as the values', () => {
  const logs = series(10).map((i) => nbaLog(i, i < 2 ? '2027' : '2026', i % 3))
  const rows = buildPropRows(
    [{ athleteId: '1', name: 'Synth Center', team: 'HOU', ppAllProps: [{ stat: 'Blocked Shots', line: 0.5, projection: 1.4, opponent: 'SAS' }] }],
    [{ athleteId: '1', name: 'Synth Center', team: 'HOU', gameLogs: logs }],
  )
  assert.equal(rows.length, 1)
  const [row] = rows
  assert.deepEqual(row.recentBars.map((bar) => bar.value), row.recent)
  assert.equal(row.recentBars[0].date, '10/12/2026')
  assert.equal(row.recentBars[9].date, '10/21/2026')
  assert.equal(row.recentBars[9].team, 'DAL')
  // Sorting still reads the old season number: no ranking change.
  assert.equal(row.seasonHitRate, Math.round((logs.filter((g) => g.blk > 0.5).length / 10) * 100))
})

test('board payload keeps ten date/opponent labels lined up with the trimmed values', () => {
  const [nfl, nhl, kbo] = stripBoardHistory([
    { player: 'NFL', prop: 'Receiving Yards', recent: series(30), gameDates: series(30).map((n) => `d${n}`), gameOpponents: series(30).map((n) => `o${n}`) },
    { player: 'NHL', prop: 'Shots On Goal', recent: series(10), gameDates: series(10).map((n) => `10/${n + 10}`), log: series(40), logDates: [...series(30).map((n) => `x${n}`), ...series(10).map((n) => `10/${n + 10}`)], logOpponents: series(40).map((n) => `T${n}`) },
    { name: 'KBO', type: 'batter', games: series(30).map((n) => ({ date: `2026-09-${n + 1}`, opp: 'LG', tb: n % 3 })), props: [
      { stat: 'Total Bases', line: 1.5, recent_values: series(10).map((n) => n % 3) },
      { stat: 'Total Bases', line: 1.5, recent_values: [7, 7, 7] },
    ] },
  ])
  assert.deepEqual(nfl.recent, series(10, 20))
  assert.deepEqual(nfl.l10Dates, series(10, 20).map((n) => `d${n}`))
  assert.deepEqual(nfl.l10Opps, series(10, 20).map((n) => `o${n}`))
  assert.equal(nfl.gameDates, undefined)
  assert.deepEqual(nhl.l10Opps, series(10, 30).map((n) => `T${n}`))
  assert.equal(nhl.logOpponents, undefined)
  assert.equal(kbo.games, undefined)
  assert.deepEqual(kbo.props[0].l10Dates, series(10).map((n) => `2026-09-${n + 1}`))
  assert.equal(kbo.props[1].l10Dates, undefined)
  // The client reads the trimmed labels without the full arrays.
  assert.equal(tailChartBars(nfl)[9].date, 'd29')
  assert.equal(headChartBars(kbo.props[0], undefined, KBO_VALUE['Total Bases'])[9].date, '2026-09-1')
})
