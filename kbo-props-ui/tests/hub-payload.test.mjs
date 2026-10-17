import assert from 'node:assert/strict'
import test from 'node:test'
import { hubPayload } from '../src/hubPayload.js'
import { countPlayable, hubGamedayFor, scopeToGameday, topHitRateRows, topHubRows } from '../src/memberHub.js'

test('hub rows keep standard lines, drop promo lines and the embedded detail, and cap the chart', () => {
  const recent = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
  const data = [
    {
      player: 'A', prop: 'Receptions', line: 4.5, projection: 6, line_type: 'standard',
      recent, imageUrl: 'https://example.test/a.png', profile: { toi: 1 },
    },
    { player: 'B', prop: 'Receptions', line: 4.5, projection: 6, line_type: 'goblin' },
    { player: 'C', prop: 'Receptions', line: 4.5, projection: 6, oddsType: 'demon' },
  ]
  const out = hubPayload('nfl_projections', data)
  assert.equal(out.hub, true)
  assert.equal(out.rows.length, 1)
  assert.equal(out.rows[0].player, 'A')
  assert.equal(out.rows[0].detail, undefined)
  assert.equal(out.rows[0].profile, undefined)
  assert.equal(out.rows[0].recent.length, 10)
  assert.deepEqual(out.rows[0].recent, recent.slice(-10))
})

test('kbo hub rows are built from the raw card, including games when recent_values is empty', () => {
  const data = {
    cards: [{
      name: 'Kim',
      team: 'LG',
      opponent: 'KT',
      games: [{ date: '2026-09-01', hrr: 2 }, { date: '2026-09-02', hrr: 1 }],
      props: [
        { stat: 'Hits+Runs+RBIs', line: 1.5, projection: 2, cg_projection: 60, recommendation: 'OVER', odds_type: 'standard' },
        { stat: 'Hits+Runs+RBIs', line: 2.5, projection: 2, cg_projection: 40, recommendation: 'OVER', odds_type: 'goblin' },
      ],
    }],
  }
  const out = hubPayload('prizepicks_props', data)
  assert.equal(out.rows.length, 1)
  assert.equal(out.rows[0].player, 'Kim')
  assert.ok(out.rows[0].recent.length >= 1)
  assert.equal(out.rows[0].detail, undefined)
  assert.equal(out.rows[0].games, undefined)
})

test('hub trim keeps rank, line type, and gameday fields the top 3, L10, and counts use', () => {
  const recent = [8, 7, 6, 9, 5, 8, 7, 6, 10, 4, 8, 7]
  const now = new Date('2026-10-17T00:45:00Z')
  const nfl = hubPayload('nfl_projections', [
    {
      player: 'Tonight', prop: 'Receptions', line: 4.5, projection: 6, line_type: 'standard',
      rankEligible: true, start_time: '2026-10-17T01:00:00Z', gameday: '2026-10-16',
      team: 'A', opponent: 'B', awayTeam: 'A', homeTeam: 'B', recent,
    },
    {
      player: 'Saturday', prop: 'Receptions', line: 4.5, projection: 8, line_type: 'standard',
      rankEligible: true, gameday: '2026-10-17', team: 'C', opponent: 'D', recent,
    },
    { player: 'Goblin', prop: 'Receptions', line: 4.5, projection: 9, line_type: 'goblin', recent },
    {
      player: 'Ineligible', prop: 'Receptions', line: 4.5, projection: 9, line_type: 'standard',
      rankEligible: false, start_time: '2026-10-17T01:00:00Z', recent, team: 'A', opponent: 'B',
    },
  ])
  const tonight = nfl.rows.find((row) => row.player === 'Tonight')
  const saturday = nfl.rows.find((row) => row.player === 'Saturday')
  assert.equal(tonight.line_type, 'standard')
  assert.equal(tonight.rankEligible, true)
  assert.equal(tonight.start, '2026-10-17T01:00:00Z')
  assert.equal(tonight.gameday, '2026-10-16')
  assert.equal(tonight.awayTeam, 'A')
  assert.equal(saturday.start, '2026-10-17')
  assert.equal(saturday.gameday, '2026-10-17')
  assert.equal(nfl.rows.some((row) => row.player === 'Goblin'), false)
  const ineligible = nfl.rows.find((row) => row.player === 'Ineligible')
  assert.equal(ineligible.rankEligible, false)
  assert.equal(ineligible.line_type, 'standard')
  for (const row of [tonight, saturday]) {
    for (const key of ['player', 'stat', 'line', 'score', 'side', 'recent', 'hitRate', 'hitHits', 'hitGames', 'start']) {
      assert.notEqual(row[key], undefined, key)
    }
  }
  const day = hubGamedayFor('wnba', nfl.rows, now)
  const scoped = scopeToGameday(nfl.rows, day)
  assert.equal(day, '2026-10-16')
  assert.deepEqual(scoped.map((row) => row.player), ['Tonight', 'Ineligible'])
  assert.deepEqual(topHubRows(scoped, 3).map((row) => row.player).sort(), ['Ineligible', 'Tonight'])
  assert.equal(countPlayable(scoped), 2)
  assert.deepEqual(topHitRateRows(scoped, 10).map((row) => row.player).sort(), ['Ineligible', 'Tonight'])

  const nhl = hubPayload('nhl_projections', [
    {
      player: 'Held', prop: 'Points', line: 0.5, projection: 1.2, oddsType: 'standard',
      rankEligible: false, start_time: '2026-10-17T23:00:00Z', gameday: '2026-10-17',
      team: 'TOR', opponent: 'MTL', awayTeam: 'MTL', homeTeam: 'TOR', recent: Array(12).fill(1),
    },
    {
      player: 'Skater', prop: 'Points', line: 0.5, projection: 1.2, oddsType: 'standard',
      rankEligible: true, start_time: '2026-10-17T23:00:00Z', gameday: '2026-10-17',
      team: 'TOR', opponent: 'MTL', awayTeam: 'MTL', homeTeam: 'TOR', position: 'C',
      recent: Array(12).fill(1),
    },
    {
      player: 'Demon', prop: 'Points', line: 0.5, projection: 1.4, oddsType: 'demon',
      rankEligible: true, start_time: '2026-10-17T23:00:00Z', recent: Array(12).fill(1), team: 'TOR',
    },
  ])
  assert.deepEqual(nhl.rows.map((row) => row.player), ['Skater'])
  assert.equal(nhl.rows[0].rankEligible, true)
  assert.equal(nhl.rows[0].oddsType, 'standard')
  assert.equal(nhl.rows[0].gameday, '2026-10-17')
  assert.equal(nhl.rows[0].start, '2026-10-17T23:00:00Z')
  assert.equal(nhl.rows[0].awayTeam, 'MTL')
  assert.equal(nhl.rows[0].homeTeam, 'TOR')
  assert.equal(nhl.rows[0].position, 'C')
  assert.equal(nhl.rows[0].detail, undefined)
})
