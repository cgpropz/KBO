import assert from 'node:assert/strict'
import test from 'node:test'
import { ALL_MATCHUPS, listMatchups, rowMatchesMatchup } from '../src/nfl/matchupFilters.js'

const SLATE = [
  { player: 'Dak Prescott', team: 'DAL', opponent: 'HOU', prop: 'Pass TDs', start_time: '2026-10-04T17:00:00Z' },
  { player: 'C.J. Stroud', team: 'hou', opponent: 'dal', prop: 'Pass Yards', commence_time: '2026-10-04T17:00:00Z' },
  { player: 'Joe Burrow', team: 'CIN', opponent: 'BAL', prop: 'Pass TDs', gameday: '2026-10-05', gametime: '13:00' },
  { player: 'Lamar Jackson', team: 'BAL', opponent: 'CIN', prop: 'Rush Yards', gameday: '2026-10-05', gametime: '13:00' },
  { player: 'Josh Allen', team: 'BUF', opponent: 'NE', prop: 'Pass TDs' },
  { player: 'No Opponent', team: 'KC', opponent: '', prop: 'Pass TDs', start_time: '2026-10-04T17:00:00Z' },
]

test('each game is listed once, no matter which side is the team', () => {
  const games = listMatchups(SLATE)
  assert.deepEqual(games.map((game) => game.label), ['DAL @ HOU', 'BAL @ CIN', 'BUF @ NE'])
  assert.equal(games.filter((game) => game.id === 'DAL@HOU').length, 1)
  assert.equal(games.filter((game) => game.id === 'BAL@CIN').length, 1)
})

test('games with a kickoff sort before games that have no start time', () => {
  const games = listMatchups(SLATE)
  assert.equal(games[0].label, 'DAL @ HOU')
  assert.equal(games[1].label, 'BAL @ CIN')
  assert.equal(games[2].label, 'BUF @ NE')
  assert.equal(games[2].kickoff, null)
})

test('without kickoff times the list is alphabetical', () => {
  const games = listMatchups([
    { team: 'SEA', opponent: 'ARI' },
    { team: 'ARI', opponent: 'SEA' },
    { team: 'GB', opponent: 'MIN' },
  ])
  assert.deepEqual(games.map((game) => game.label), ['ARI @ SEA', 'GB @ MIN'])
})

test('a selected matchup keeps both teams and still combines with prop and search filters', () => {
  const [dalGame] = listMatchups(SLATE)
  const visible = SLATE.filter((item) => {
    if (item.prop !== 'Pass TDs') return false
    if (!String(item.player).toLowerCase().includes('dak')) return false
    return rowMatchesMatchup(item, dalGame.id)
  })
  assert.deepEqual(visible.map((item) => item.player), ['Dak Prescott'])

  const bothSides = SLATE.filter((item) => rowMatchesMatchup(item, dalGame.id))
  assert.deepEqual(bothSides.map((item) => item.player), ['Dak Prescott', 'C.J. Stroud'])

  const everyone = SLATE.filter((item) => rowMatchesMatchup(item, ALL_MATCHUPS))
  assert.equal(everyone.length, SLATE.length)
})

test('labels use the real away team at home, and earlier kickoffs come first', () => {
  const rows = [
    { player: 'Dak Prescott', team: 'DAL', opponent: 'TB', prop: 'Pass TDs', awayTeam: 'TB', homeTeam: 'DAL', start_time: '2026-10-08T20:15:00.000-04:00' },
    { player: 'Baker Mayfield', team: 'TB', opponent: 'DAL', prop: 'Pass Yards', awayTeam: 'TB', homeTeam: 'DAL', start_time: '2026-10-08T20:15:00.000-04:00' },
    { player: 'Bijan Robinson', team: 'ATL', opponent: 'NO', prop: 'Rush Yards', awayTeam: 'ATL', homeTeam: 'NO', start_time: '2026-10-05T20:15:00.000-04:00' },
    { player: 'Trevor Lawrence', team: 'JAC', opponent: 'PHI', prop: 'Pass TDs', awayTeam: 'PHI', homeTeam: 'JAX', start_time: '2026-10-11T13:00:00.000-04:00' },
    { player: 'Jalen Hurts', team: 'PHI', opponent: 'JAX', prop: 'Rush Yards' },
  ]
  const games = listMatchups(rows)
  assert.deepEqual(games.map((game) => game.label), ['ATL @ NO', 'TB @ DAL', 'PHI @ JAX'])
  assert.equal(games.filter((game) => game.id === 'DAL@TB').length, 1)
  assert.equal(games.filter((game) => game.id === 'JAX@PHI').length, 1)
})

test('a game missing from the schedule keeps an alphabetical label and still sorts by kickoff', () => {
  const games = listMatchups([
    { team: 'GB', opponent: 'CHI', start_time: '2026-10-11T16:25:00.000-04:00' },
    { team: 'CHI', opponent: 'GB', gameday: '2026-10-11', gametime: '13:00' },
  ])
  assert.equal(games.length, 1)
  assert.equal(games[0].label, 'CHI @ GB')
  assert.equal(games[0].kickoff, Date.parse('2026-10-11T13:00:00.000-04:00'))
})

test('empty or one-sided rows do not invent a matchup', () => {
  assert.deepEqual(listMatchups(null), [])
  assert.deepEqual(listMatchups([{ team: 'DAL' }, { opponent: 'HOU' }, { team: 'DAL', opponent: 'DAL' }]), [])
  assert.equal(rowMatchesMatchup({ team: 'DAL', opponent: 'HOU' }, ''), true)
})
