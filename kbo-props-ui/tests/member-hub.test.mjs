import assert from 'node:assert/strict'
import test from 'node:test'
import { cgScore } from '../src/cgScore.js'
import { formatRecord, hubGames, kboHubRows, nbaHubRows, nhlHubRows, nflHubRows, playableRows, recapLabel, sameMatchup, statusChips, topHubRows, unavailableFromLineups, wnbaHubRows } from '../src/memberHub.js'
import { standardRecord } from '../scripts/write-member-recap.mjs'

test('hub rows keep standard lines only', () => {
  const kbo = kboHubRows({ cards: [{ name: 'A', props: [
    { stat: 'Hits', line: 0.5, odds_type: 'goblin', cg_projection: 90 },
    { stat: 'Hits', line: 1.5, odds_type: 'standard', cg_projection: 70, projection: 1.8, recommendation: 'OVER' },
  ] }] })
  assert.equal(kbo.length, 1)
  assert.equal(kbo[0].score, 70)
  const nhl = nhlHubRows([{ player: 'B', prop: 'Points', line: 0.5, projection: 1, oddsType: 'demon' }, { player: 'C', prop: 'Points', line: 0.5, projection: 1, oddsType: 'standard' }])
  assert.deepEqual(nhl.map((r) => r.player), ['C'])
  const nfl = nflHubRows([{ player: 'D', prop: 'Receptions', line: 4.5, projection: 6, line_type: 'goblin' }])
  assert.equal(nfl.length, 0)
  const nba = nbaHubRows([{ name: 'E', ppAllProps: [{ stat: 'Points', line: 9.5, standardLine: 9.5, rating: 60, projection: 11 }, { stat: 'Points', line: 7.5, standardLine: 9.5, rating: 80 }] }])
  assert.deepEqual(nba.map((r) => r.score), [60])
})

test('top rows are one per player, best score first', () => {
  const rows = [
    { player: 'A', stat: 's', line: 1, score: 60 },
    { player: 'A', stat: 't', line: 1, score: 90 },
    { player: 'B', stat: 's', line: 1, score: 70 },
    { player: 'C', stat: 's', line: 1, score: NaN },
  ]
  assert.deepEqual(topHubRows(rows).map((r) => [r.player, r.score]), [['A', 90], ['B', 70]])
})

test('held and OUT players stay off the hub, including a Gauthier-style row', () => {
  const rows = [
    { player: 'Cutter Gauthier', stat: 'Points', line: 0.5, score: 88, injury: 'OUT' },
    { player: 'Held Skater', stat: 'Shots On Goal', line: 2.5, score: 91, status: 'held' },
    { player: 'Questionable', stat: 'Points', line: 0.5, score: 60, status: 'GTD' },
    { player: 'Healthy', stat: 'Points', line: 0.5, score: 70 },
  ]
  assert.deepEqual(topHubRows(rows).map((r) => r.player), ['Healthy', 'Questionable'])
  const names = unavailableFromLineups('nhl', [{
    injuries: { ANA: [{ name: 'Cutter Gauthier', status: 'out' }, { name: 'Alex Tuch', status: 'GTD' }] },
    lineups: { ANA: [{ name: 'Cutter Gauthier', status: 'out' }] },
  }])
  const slate = [
    { player: 'Cutter Gauthier', stat: 'Points', line: 0.5, score: 80 },
    { player: 'Alex Tuch', stat: 'Points', line: 0.5, score: 55 },
  ]
  assert.deepEqual(playableRows(slate, names).map((r) => r.player), ['Alex Tuch'])
  const nfl = unavailableFromLineups('nfl', [{
    injuries: { DET: [{ name: 'Amon-Ra St. Brown', status: 'OUT' }, { name: 'Sam LaPorta', status: 'GTD' }] },
  }])
  assert.equal(nfl.has('amon ra st brown'), true)
  assert.equal(nfl.has('sam laporta'), false)
  const wnba = unavailableFromLineups('wnba', [{
    visitor: { players: [{ name: 'Angel Reese', status: 'out' }, { name: 'Allisha Gray', status: 'questionable' }], inactive: [{ name: 'Rhyne Howard' }] },
  }])
  assert.equal(wnba.has('angel reese'), true)
  assert.equal(wnba.has('rhyne howard'), true)
  assert.equal(wnba.has('allisha gray'), false)
})

test('hub rows carry the board hit rate and log without changing the score', () => {
  const kbo = kboHubRows({ cards: [{ name: 'A', team: 'LG', opponent: 'KT', games: [
    { tb: 2, date: '2026-10-12' },
    { tb: 0, date: '2026-10-11' },
  ], props: [{ stat: 'Total Bases', line: 1.5, odds_type: 'standard', cg_projection: 70, projection: 1.8, hit_rate_l10: 60, recent_values: [3, 0, 2] }] }] })
  assert.equal(kbo[0].score, 70)
  assert.equal(kbo[0].hitRate, 60)
  assert.deepEqual(kbo[0].recent, [2, 0, 3])
  const nhl = nhlHubRows([{
    player: 'Alex Ovechkin', prop: 'Points', line: 0.5, projection: 0.68, oddsType: 'standard',
    hitRate: 70, gamesL10: 10, recent: [0, 1, 2], dvpRank: 28, score: 999,
  }])
  assert.equal(nhl[0].score, cgScore(0.68, 0.5, 'Points'))
  assert.equal(nhl[0].hitRate, 70)
  assert.deepEqual(nhl[0].recent, [0, 1, 2])
  assert.equal(nhl[0].oppRank, 28)
  const wnba = wnbaHubRows([{
    name: 'Allisha Gray', team: 'ATL', recentGames: [
      { ftm: 4, date: '10/09/2026' },
      { ftm: 1, date: '10/07/2026' },
    ],
    ppAllProps: [{ stat: 'Free Throws Made', line: 2.5, standardLine: 2.5, projection: 3.2, effectiveDvpFactor: 6 }],
  }])
  assert.equal(wnba[0].oppRank, 6)
  assert.deepEqual(wnba[0].recent, [1, 4])
  assert.equal(wnba[0].hitRate, null)
})

test('status chips and matchups come from the lineup snapshot', () => {
  const chips = statusChips({
    sport: 'nhl',
    rows: [],
    lineups: [{
      awayTeam: 'MTL', homeTeam: 'WSH', start_time: '2026-10-14T23:30:00Z',
      goalies: { MTL: { status: 'confirmed', confirmed: true }, WSH: { status: 'probable' } },
      lineLabels: { MTL: 'PROJECTED', WSH: 'PROJECTED' },
    }],
    recap: { slate_date_iso: '2026-10-12', hits: 2, misses: 1, pushes: 1 },
    now: new Date('2026-10-14T03:30:00Z'),
  })
  assert.deepEqual(chips.map((chip) => chip.text), ['Goalie confirmed', 'Lines projected', 'Yesterday 2-1-1 → Results'])
  const games = hubGames('nhl', [{ team: 'DAL', opponent: 'COL' }], [{ awayTeam: 'MTL', homeTeam: 'WSH' }])
  assert.deepEqual(games.map((game) => game.team), ['MTL', 'DAL'])
  assert.equal(sameMatchup({ team: 'WSH', opponent: 'MTL' }, games[0]), true)
  assert.equal(sameMatchup({ team: 'DAL', opponent: 'COL' }, games[0]), false)
  const pending = statusChips({ sport: 'nfl', rows: [], lineups: [], recap: null, ready: true })
  assert.equal(pending[0].text, 'Lines pending')
})

test('record counts standard graded lines and labels the slate', () => {
  const r = standardRecord({ props: [
    { odds_type: 'standard', model_result: 'HIT' },
    { odds_type: 'standard', model_result: 'MISS' },
    { odds_type: 'standard', model_result: 'PUSH' },
    { odds_type: 'demon', model_result: 'HIT' },
    { odds_type: 'standard', model_result: 'HIT', rank_eligible: false },
    { odds_type: 'standard', model_result: 'N/A' },
  ] })
  assert.deepEqual(r, { hits: 1, misses: 1, pushes: 1 })
  assert.equal(formatRecord(r), '1-1-1')
  const now = new Date('2026-10-14T03:30:00Z')
  assert.equal(recapLabel('2026-10-12', now), 'Yesterday')
  assert.equal(recapLabel('2026-09-27', now), 'Last graded Sep 27')
})
