// Opponent-adjusted NFL matchup context (nflverse). Mapping, lookup, tooltip
// credit, free dataset registration, and no hook into CG Score / projections.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { canonicalTeam, matchupEntries, matchupTooltip, splitsForProp } from '../src/nfl/matchupDefenseModel.js'
import { DATASETS, datasetIsFullyPublic, shapeForTier } from '../api/_dataAccess.js'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/nfl-matchup-prop-map.json', import.meta.url), 'utf8'))

function team(rank, extra = {}) {
  const row = (r) => ({ rank: r, grade: null, epa: 0.12, success: 0.48, plays: 90, smallSample: false, ...extra })
  return { pass: row(rank), run: row(33 - rank), WR: row(rank), TE: row(rank), RB: row(rank) }
}

const payload = { throughWeek: 6, credit: 'Data: nflverse', teams: { JAX: team(29), LA: team(3, { smallSample: true, plays: 17 }), WAS: team(16) } }

test('prop mapping matches the shared fixture (same cases as the Python builder)', () => {
  for (const c of fixture.cases) assert.deepEqual(splitsForProp(c.prop, c.position), c.splits, JSON.stringify(c))
})

test('team aliases match nflverse codes', () => {
  assert.equal(canonicalTeam('JAC'), 'JAX')
  assert.equal(canonicalTeam('LAR'), 'LA')
  assert.equal(canonicalTeam('WSH'), 'WAS')
  assert.equal(canonicalTeam('@jax'), 'JAX')
})

test('entries carry rank and the matchupGrade.js grade', () => {
  const [wr] = matchupEntries(payload, { prop: 'Receiving Yards', position: 'WR', opponent: 'JAC' })
  assert.equal(wr.split, 'WR')
  assert.equal(wr.rank, 29)
  assert.equal(wr.grade, 'A+')
  const both = matchupEntries(payload, { prop: 'Rush+Rec Yds', position: 'RB', opponent: 'JAX' })
  assert.deepEqual(both.map((e) => e.split), ['run', 'RB'])
  assert.deepEqual(matchupEntries(payload, { prop: 'Fantasy Score', position: 'WR', opponent: 'JAX' }), [])
  assert.deepEqual(matchupEntries(null, { prop: 'Rush Yards', position: 'RB', opponent: 'JAX' }), [])
  assert.deepEqual(matchupEntries(payload, { prop: 'Rush Yards', position: 'RB', opponent: 'XXX' }), [])
})

test('tooltip credits nflverse, flags small samples and says it is not in CG Score', () => {
  const [entry] = matchupEntries(payload, { prop: 'Receptions', position: 'TE', opponent: 'LAR' })
  const text = matchupTooltip(entry, payload)
  assert.match(text, /Data: nflverse/)
  assert.match(text, /Small sample/)
  assert.match(text, /not part of CG Score/)
  assert.match(text, /Through Week 6/)
})

test('nfl_matchup_defense is a registered, fully free NFL dataset', () => {
  assert.equal(DATASETS.nfl_matchup_defense.table, 'nfl_matchup_defense')
  assert.equal(DATASETS.nfl_matchup_defense.sport, 'nfl')
  assert.equal(datasetIsFullyPublic('nfl_matchup_defense'), true)
  const shaped = shapeForTier('nfl_matchup_defense', payload, 'free')
  assert.equal(shaped.preview, false)
  assert.deepEqual(shaped.data, payload)
  const anon = shapeForTier('nfl_matchup_defense', payload, null)
  assert.equal(anon.preview, false)
})

test('CG Score, projections and the totals ranking do not read the matchup data', () => {
  for (const file of ['../src/nfl/nflLineFloors.js', '../src/nfl/cgOdds.js', '../src/nfl/gameCardModel.js', '../api/_dataAccess.js']) {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8')
    const uses = src.split('\n').filter((line) => /matchupDefense|matchup_defense/.test(line) && !/nfl_matchup_defense: \{/.test(line) && !/^\s*\/\//.test(line))
    assert.deepEqual(uses, [], `${file} must not use matchup defense`)
  }
})
