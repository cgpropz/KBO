import assert from 'node:assert/strict'
import test from 'node:test'
import { formatRecord, kboHubRows, nbaHubRows, nhlHubRows, nflHubRows, playableRows, recapLabel, topHubRows, unavailableFromLineups } from '../src/memberHub.js'
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
