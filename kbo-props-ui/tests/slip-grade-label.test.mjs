import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  BASKET_PROPS,
  FANTASY_PROPS,
  KBO_PROPS,
  KBO_TEAMS,
  NFL_PROPS,
  NHL_PROPS,
} from '../src/slipSportCatalog.js'
import { inferLegSport, inferSlipSport, slipGradeLabel } from '../src/slipSportInfer.js'
import { buildSavedSlipRow, savedLegFromProp, sportColumnMissing } from '../src/savedSlipPayload.js'

const known = new Set(
  [...KBO_PROPS, ...FANTASY_PROPS, ...BASKET_PROPS, ...NFL_PROPS, ...NHL_PROPS].map((name) => name.toLowerCase()),
)

function quoted(source, marker) {
  const start = source.indexOf(marker)
  const end = source.indexOf('}', start)
  const body = source.slice(start, end)
  return [...body.matchAll(/(?:'([^']+)'|"([^"]+)"|([A-Za-z][A-Za-z0-9+.-]*))\s*:/g)]
    .map((match) => match[1] || match[2] || match[3])
}

test('catalog covers every prop name the slip builder lists', () => {
  const source = readFileSync(new URL('../src/slipSports.js', import.meta.url), 'utf8')
  const names = [
    ...quoted(source, 'const BASKET_SHORT'),
    ...quoted(source, 'const NFL_SHORT'),
    ...quoted(source, 'const NHL_SHORT'),
    ...[...source.matchAll(/prop === '([^']+)'/g)].map((match) => match[1]),
  ]
  const missing = names.filter((name) => name && !known.has(name.toLowerCase()))
  assert.deepEqual(missing, [])
  const teams = quoted(source, 'const KBO_TEAMS')
  for (const team of teams) assert.ok(KBO_TEAMS.includes(team), team)
})

test('old rows are classified by prop name, then team code', () => {
  assert.equal(inferSlipSport({ legs: [{ prop: 'Strikeouts', team: 'Doosan' }] }), 'kbo')
  assert.equal(inferSlipSport({ legs: [{ prop: 'Pass Yards', team: 'KC' }] }), 'nfl')
  assert.equal(inferSlipSport({ legs: [{ prop: 'Shots On Goal', team: 'EDM' }] }), 'nhl')
  assert.equal(inferSlipSport({ legs: [{ prop: 'Fantasy Score', team: 'Hanwha' }] }), 'kbo')
  assert.equal(inferSlipSport({ legs: [{ prop: 'Fantasy Score', team: 'LVA' }] }), 'wnba')
  assert.equal(inferSlipSport({ legs: [{ prop: 'Points', team: 'NYR' }] }), 'nhl')
  assert.equal(inferSlipSport({ legs: [{ prop: 'Points', team: 'LAL' }] }), 'nba')
  assert.equal(inferSlipSport({ legs: [{ prop: 'Rebounds', team: 'NYL' }] }), 'wnba')
  assert.equal(inferLegSport({ prop: 'Pitcher Strikeouts', team: 'LG' }), 'kbo')
  assert.equal(inferSlipSport({ legs: [{ prop: 'Points', team: 'BOS' }] }), '')
  assert.equal(inferSlipSport({ sport: 'nfl', legs: [{ prop: 'Strikeouts', team: 'Doosan' }] }), 'nfl')
})

test('grading coming soon is only for sports and slips that cannot be graded', () => {
  assert.equal(slipGradeLabel({ sport: 'nba', graded: false, result: 'pending', legs: [{ prop: 'Points', team: 'LAL', result: 'pending' }] }), 'Grading coming soon')
  assert.equal(slipGradeLabel({ graded: false, result: 'pending', legs: [{ prop: 'Mystery', team: 'ZZZ', result: 'pending' }] }), 'Grading coming soon')
  assert.equal(slipGradeLabel({
    sport: 'kbo',
    graded: false,
    result: 'pending',
    legs: [{ prop: 'Strikeouts', team: 'Doosan', result: 'pending' }],
  }), null)
  assert.equal(slipGradeLabel({
    sport: 'nfl',
    graded: false,
    result: 'pending',
    legs: [{ prop: 'Pass Yards', result: 'pending', ungradeable: true }],
  }), 'Grading coming soon')
  assert.equal(slipGradeLabel({
    sport: 'wnba',
    graded: false,
    result: 'pending',
    legs: [
      { prop: 'Points', result: 'pending' },
      { prop: 'Points', result: 'pending', ungradeable: true },
    ],
  }), null)
  assert.equal(slipGradeLabel({ sport: 'nhl', graded: true, result: 'hit', legs: [] }), null)
  assert.equal(slipGradeLabel({ sport: 'kbo', graded: true, result: 'push', legs: [] }), null)
})

test('the save payload keeps sport, odds type, and projection id', () => {
  const row = buildSavedSlipRow({
    game_date: '2026-10-17',
    sport: 'nfl',
    confidence: 70,
    legs: [{
      name: 'Patrick Mahomes',
      team: 'KC',
      prop: 'Pass Yards',
      propShort: 'PY',
      line: 275.5,
      projection: 290,
      edge: 14.5,
      side: 'LESS',
      odds_type: 'standard',
      projection_id: '15700846',
      playerId: '123',
      id: '15700846',
    }],
  })
  assert.equal(row.sport, 'nfl')
  assert.equal(row.legs[0].side, 'UNDER')
  assert.equal(row.legs[0].sport, 'nfl')
  assert.equal(row.legs[0].odds_type, 'standard')
  assert.equal(row.legs[0].projection_id, '15700846')
  assert.equal(row.legs[0].player_id, '123')
  const fromProp = savedLegFromProp({ name: 'A', prop: 'Points', team: 'LVA', oddsType: 'standard', id: '44' }, 'MORE', 'wnba')
  assert.equal(fromProp.sport, 'wnba')
  assert.equal(fromProp.side, 'OVER')
  assert.equal(fromProp.projection_id, '44')
  assert.equal(sportColumnMissing({ code: 'PGRST204', message: "Could not find the 'sport' column of 'saved_slips' in the schema cache" }), true)
  assert.equal(sportColumnMissing({ code: '42703', message: 'column "sport" of relation "saved_slips" does not exist' }), true)
  assert.equal(sportColumnMissing({ code: '23505', message: 'duplicate key' }), false)
})
