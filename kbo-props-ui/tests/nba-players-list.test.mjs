import test from 'node:test'
import assert from 'node:assert/strict'

import {
  averageMinutes, easternDateKey, filterPlayers, formatTip, gameText, hitTone, isGameDay,
  positionChips, priorTeam, scheduleFromScoreboard, sortPlayers, sparkBars, statShort,
  todayGame, topPropFor, topProps,
} from '../src/nba/nbaPlayersList.js'

// Synthetic players and board. Names and numbers are made up.
function logs(values, extra = {}) {
  return values.map((pts, index) => ({
    date: `10/${20 - index}/2026`, team: 'AAA', matchup: 'AAA vs. ZZZ', season: '2027',
    min: 30 - index, pts, reb: 5, ast: 3, stl: 1, blk: 0, tov: 1, fg3m: 1, ...extra,
  }))
}

const players = [
  { athleteId: '1', name: 'Alpha One', team: 'AAA', position: 'PG', gameLogs: logs([30, 28, 10, 25, 27, 9, 31, 22, 26, 24]) },
  { athleteId: '2', name: 'Bravo Two', team: 'BBB', position: 'C', gameLogs: logs([8, 9, 12, 7, 6, 10, 11, 5, 9, 8]) },
  { athleteId: '3', name: 'Charlie Three', team: 'CCC', position: '', gameLogs: [] },
  { athleteId: '4', name: 'Delta Four', team: 'AAA', position: 'SF', summaryTeam: 'DDD', gameLogs: logs([14, 15], { min: 18 }) },
]

const projections = [
  {
    athleteId: '1', name: 'Alpha One', team: 'AAA', ppAllProps: [
      { stat: 'Points', line: 20.5, projection: 26, opponent: 'BBB' },
      { stat: 'Rebounds', line: 4.5, projection: 4.6, opponent: 'BBB' },
    ],
  },
  {
    athleteId: '2', name: 'Bravo Two', team: 'BBB', ppAllProps: [
      { stat: 'Points', line: 8.5, projection: 12, opponent: 'AAA' },
    ],
  },
]

test('Unset chip only shows when a player has no slot', () => {
  assert.deepEqual(positionChips(players), ['All', 'PG', 'SG', 'SF', 'PF', 'C', 'Unset'])
  assert.deepEqual(positionChips(players.filter((p) => p.position)), ['All', 'PG', 'SG', 'SF', 'PF', 'C'])
})

test('top prop is the first row in the board CG Score order', () => {
  const tops = topProps(projections, players)
  const alpha = topPropFor(tops, players[0])
  const bravo = topPropFor(tops, players[1])
  assert.equal(alpha.stat, 'Points')
  assert.equal(alpha.short, 'PTS')
  assert.equal(alpha.side, 'OVER')
  assert.equal(alpha.hits, 8)
  assert.equal(alpha.games, 10)
  assert.equal(alpha.hitRate, 80)
  assert.deepEqual(alpha.last5, [27, 25, 10, 28, 30])
  assert.equal(bravo.rank, 0, 'higher board score comes first')
  assert.equal(alpha.rank, 1)
  assert.equal(topPropFor(tops, players[2]), null)
})

test('schedule from the scoreboard, with the board opponent as a stand-in', () => {
  const schedule = scheduleFromScoreboard({
    events: [{
      date: '2026-10-23T23:30Z',
      status: { type: { state: 'pre' } },
      competitions: [{
        date: '2026-10-23T23:30Z',
        competitors: [
          { homeAway: 'home', team: { abbreviation: 'AAA' } },
          { homeAway: 'away', team: { abbreviation: 'CCC' } },
        ],
      }],
    }],
  })
  assert.deepEqual(schedule.get('AAA'), { opponent: 'CCC', home: true, tip: '2026-10-23T23:30Z', state: 'pre' })
  assert.equal(gameText(schedule.get('CCC')), '@ AAA · 7:30 PM ET')
  const tops = topProps(projections, players)
  assert.equal(todayGame(players[1], new Map(), topPropFor(tops, players[1])).opponent, 'AAA')
  assert.equal(gameText({ opponent: 'AAA', home: null, tip: null, state: 'pre' }), 'vs AAA')
  assert.equal(gameText({ opponent: 'AAA', home: false, state: 'in' }), '@ AAA · Live')
  assert.equal(todayGame(players[1], schedule, null), null)
  assert.equal(isGameDay(new Map(), new Map()), false)
  assert.equal(isGameDay(schedule, new Map()), true)
})

test('tip time and date are Eastern', () => {
  assert.equal(formatTip('2026-10-24T00:00Z'), '8 PM ET')
  assert.equal(formatTip('2026-10-23T23:30Z'), '7:30 PM ET')
  assert.equal(formatTip('nope'), '')
  assert.equal(easternDateKey(new Date('2026-10-24T02:00Z')), '20261023')
})

test('filters: search, slot, Unset, team, playing today', () => {
  const tops = topProps(projections, players)
  const schedule = new Map([['CCC', { opponent: 'EEE', home: true, tip: null, state: 'pre' }]])
  const names = (list) => list.map((p) => p.name)
  assert.deepEqual(names(filterPlayers(players, { search: 'bra' })), ['Bravo Two'])
  assert.deepEqual(names(filterPlayers(players, { position: 'Unset' })), ['Charlie Three'])
  assert.deepEqual(names(filterPlayers(players, { position: 'SF' })), ['Delta Four'])
  assert.deepEqual(names(filterPlayers(players, { team: 'AAA' })), ['Alpha One', 'Delta Four'])
  assert.deepEqual(
    names(filterPlayers(players, { playingToday: true }, { schedule, tops })),
    ['Alpha One', 'Bravo Two', 'Charlie Three'],
  )
})

test('sorts: CG Score order, L10, minutes, name', () => {
  const tops = topProps(projections, players)
  const names = (list) => list.map((p) => p.name)
  assert.deepEqual(names(sortPlayers(players, 'cg', { tops })), ['Bravo Two', 'Alpha One', 'Charlie Three', 'Delta Four'])
  assert.deepEqual(names(sortPlayers(players, 'l10', { tops })), ['Alpha One', 'Bravo Two', 'Charlie Three', 'Delta Four'])
  assert.deepEqual(names(sortPlayers(players, 'minutes', { tops })), ['Alpha One', 'Bravo Two', 'Delta Four', 'Charlie Three'])
  assert.deepEqual(names(sortPlayers(players, 'name', { tops })), ['Alpha One', 'Bravo Two', 'Charlie Three', 'Delta Four'])
  assert.equal(averageMinutes(players[2]), null)
  assert.equal(averageMinutes(players[3]), 18)
})

test('prior team labels the 2025-26 line after a move', () => {
  assert.equal(priorTeam(players[3]), 'DDD')
  assert.equal(priorTeam(players[0]), '')
  assert.equal(priorTeam({ team: 'AAA', gameLogs: [{ season: '2027', team: 'AAA' }, { season: '2026', team: 'FFF' }] }), 'FFF')
})

test('display helpers', () => {
  assert.equal(statShort('Pts+Rebs+Asts'), 'PRA')
  assert.equal(statShort('Something New'), 'Something New')
  assert.equal(hitTone(70), 'good')
  assert.equal(hitTone(50), 'mid')
  assert.equal(hitTone(10), 'bad')
  assert.equal(hitTone(null), 'none')
  const spark = sparkBars([10, 30], 20, 20)
  assert.deepEqual(spark.bars.map((bar) => bar.hit), [false, true])
  assert.equal(spark.bars[1].height, 20)
  assert.equal(spark.lineY, 7)
})
