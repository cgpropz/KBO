import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { cgScore } from '../src/cgScore.js'
import { isPromoLine, isStandardLine, matchImportedPick, oddsTypeOf, standardSlipRows } from '../src/slipLines.js'

// slipSports.js is a Vite module (extensionless imports). Load the pure
// basketball builder from source so this test still runs under node --test.
function loadBasketRows() {
  const source = readFileSync(new URL('../src/slipSports.js', import.meta.url), 'utf8')
  const start = source.indexOf('function lineTypePresent')
  const end = source.indexOf('async function loadBasketProps')
  const helpers = source.slice(source.indexOf('function byCg'), source.indexOf('async function loadKboProps'))
  const num = (value) => {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return new Function('isStandardLine', 'oddsTypeOf', 'num', 'cgScore', 'keepSlipRow', 'BASKET_SHORT', `${helpers}\n${source.slice(start, end)}\nreturn basketRows`)(
    isStandardLine,
    oddsTypeOf,
    num,
    cgScore,
    () => true,
    { Points: 'PTS', Rebounds: 'REB', Assists: 'AST', '3-PT Made': '3PM', Steals: 'STL', Blocks: 'BLK', Turnovers: 'TOV', 'Fantasy Score': 'FANT' },
  )
}

test('each sport field keeps standard and drops demon, goblin, blank, and unknown', () => {
  const kept = standardSlipRows([
    { name: 'KBO', prop: 'Strikeouts', odds_type: 'standard' },
    { name: 'KBO demon', prop: 'Strikeouts', odds_type: 'demon' },
    { name: 'WNBA', prop: 'Points', odds_type: 'Standard' },
    { name: 'WNBA goblin', prop: 'Points', odds_type: 'goblin' },
    { name: 'NBA', prop: 'Rebounds', odds_type: 'standard' },
    { name: 'NBA blank', prop: 'Rebounds' },
    { player: 'NHL', prop: 'Shots On Goal', oddsType: 'standard' },
    { player: 'NHL demon', prop: 'Shots On Goal', oddsType: 'demon' },
    { player: 'NFL', prop: 'Receiving Yards', line_type: 'standard' },
    { player: 'NFL goblin', prop: 'Receiving Yards', line_type: 'goblin' },
    { player: 'NFL unknown', prop: 'Rush Yards', line_type: 'boost' },
    { player: 'NFL blank type', prop: 'Receptions', line_type: '  ' },
  ])
  assert.deepEqual(kept.map((row) => row.name || row.player), ['KBO', 'WNBA', 'NBA', 'NHL', 'NFL'])
  assert.equal(oddsTypeOf({ odds_type: 'demon' }), 'demon')
  assert.equal(oddsTypeOf({ oddsType: 'Demon' }), 'demon')
  assert.equal(oddsTypeOf({ line_type: 'goblin' }), 'goblin')
  assert.equal(oddsTypeOf({ lineType: 'GOBLIN' }), 'goblin')
  assert.equal(oddsTypeOf({}), '')
  assert.equal(oddsTypeOf({ odds_type: 'discount' }), '')
  assert.equal(isStandardLine({ odds_type: 'standard' }), true)
  assert.equal(isStandardLine({ oddsType: 'standard' }), true)
  assert.equal(isStandardLine({ line_type: 'standard' }), true)
  assert.equal(isStandardLine({ lineType: 'standard' }), true)
  assert.equal(isStandardLine({}), false)
  assert.equal(isStandardLine({ oddsType: 'goblin' }), false)
  assert.equal(isStandardLine({ line_type: 'demon' }), false)
  assert.equal(isPromoLine({ oddsType: 'demon' }), true)
  assert.equal(isPromoLine({ line_type: 'standard' }), false)
  assert.equal(isPromoLine({}), false)
})

test('import matches a standard line and skips demon and goblin rows', () => {
  const props = [
    { name: 'Nazem Kadri', prop: 'Shots On Goal', team: 'CGY', opponent: 'EDM', line: 6.5, oddsType: 'demon' },
    { name: 'Nazem Kadri', prop: 'Shots On Goal', team: 'CGY', opponent: 'EDM', line: 2.5, oddsType: 'standard' },
    { name: 'Troy Franklin', prop: 'Receiving Yards', team: 'DEN', opponent: 'SEA', line: 40.5, line_type: 'goblin' },
    { name: 'Troy Franklin', prop: 'Receiving Yards', team: 'DEN', opponent: 'SEA', line: 17.5, line_type: 'standard' },
  ]
  assert.equal(matchImportedPick(props, {
    name: 'Nazem Kadri', prop: 'Shots On Goal', team: 'CGY', opponent: 'EDM',
  }), 1)
  assert.equal(matchImportedPick(props, {
    name: 'Nazem Kadri', prop: 'Shots On Goal', team: 'CGY', opponent: 'EDM', line: 6.5, oddsType: 'demon',
  }), -1)
  assert.equal(matchImportedPick(props, {
    name: 'Nazem Kadri', prop: 'Shots On Goal', team: 'CGY', opponent: 'EDM', line: 2.5,
  }), 1)
  assert.equal(matchImportedPick(props, {
    name: 'Troy Franklin', prop: 'Receiving Yards', team: 'DEN', opponent: 'SEA', line: 17.5, line_type: 'standard',
  }), 3)
})

test('flat rows and the WNBA loader stay on the standard table', () => {
  const source = readFileSync(new URL('../src/slipSports.js', import.meta.url), 'utf8')
  const flatStart = source.indexOf('function flatRows')
  const flatEnd = source.indexOf('const chip', flatStart)
  const flat = source.slice(flatStart, flatEnd)
  assert.match(flat, /standardSlipRows\(rows\)/)
  assert.match(flat, /isStandardLine\(row\)/)
  assert.equal(source.includes('projections_demon.json'), false)
  assert.equal(source.includes('projections_goblin.json'), false)
  assert.match(source, /projections_standard\.json/)
  const wnba = source.slice(source.indexOf("id: 'wnba'"), source.indexOf("id: 'nba'"))
  assert.match(wnba, /loadBasketProps/)
  const nba = source.slice(source.indexOf("id: 'nba'"), source.indexOf("id: 'nfl'"))
  assert.match(nba, /loadBasketProps/)
  const basket = source.slice(source.indexOf('function basketLine'), source.indexOf('function flatRows'))
  assert.match(basket, /source === 'projections_standard\.json'/)
  assert.match(basket, /if \(!fillMissingStandard \|\| lineTypePresent\(merged\)\) return merged/)
  assert.match(basket, /odds_type: 'standard'/)
  assert.doesNotMatch(flat, /odds_type: 'standard'/)
})

test('a missing line type on the standard basketball board is standard', () => {
  const basketRows = loadBasketRows()
  const players = [
    {
      name: 'Allisha Gray',
      team: 'ATL',
      dvpOpponent: 'GSV',
      ppAllProps: [
        { stat: 'Points', line: 16.5, projection: 18.2, opponent: 'GSV' },
        { stat: 'Rebounds', line: 4.5, projection: 5.1, odds_type: 'demon', opponent: 'GSV' },
        { stat: 'Assists', line: 3.5, projection: 4, oddsType: 'goblin', opponent: 'GSV' },
        { stat: 'Steals', line: 1.5, projection: 1.2, line_type: 'goblin', opponent: 'GSV' },
        { stat: 'Blocks', line: 0.5, projection: 0.4, lineType: 'demon', opponent: 'GSV' },
        { stat: 'Turnovers', line: 2.5, projection: 2.1, odds_type: 'boost', opponent: 'GSV' },
        { stat: '3-PT Made', line: 2.5, projection: 2.8, odds_type: 'standard', opponent: 'GSV' },
        { stat: 'Fantasy Score', line: 30.5, projection: 32, odds_type: '  ', opponent: 'GSV' },
      ],
    },
  ]
  const rows = basketRows(players, { source: 'projections_standard.json' })
  assert.deepEqual(rows.map((row) => [row.name, row.team, row.opponent, row.prop, row.odds_type]).sort((a, b) => a[3].localeCompare(b[3])), [
    ['Allisha Gray', 'ATL', 'GSV', '3-PT Made', 'standard'],
    ['Allisha Gray', 'ATL', 'GSV', 'Fantasy Score', 'standard'],
    ['Allisha Gray', 'ATL', 'GSV', 'Points', 'standard'],
  ])
  assert.equal(isStandardLine({ odds_type: 'standard', stat: 'Points', line: 16.5 }), true)
})

test('demon and goblin boards drop rows that have no line type', () => {
  const basketRows = loadBasketRows()
  const players = [{
    name: 'Allisha Gray',
    team: 'ATL',
    dvpOpponent: 'GSV',
    ppAllProps: [
      { stat: 'Points', line: 18.5, projection: 17.1, opponent: 'GSV' },
      { stat: 'Rebounds', line: 4.5, projection: 5, opponent: 'GSV' },
    ],
  }]
  assert.deepEqual(basketRows(players, { source: 'projections_demon.json' }), [])
  assert.deepEqual(basketRows(players, { source: 'projections_goblin.json' }), [])
  assert.deepEqual(basketRows(players), [])
  const kept = basketRows(players, { source: 'projections_standard.json' })
  assert.deepEqual(kept.map((row) => [row.prop, row.odds_type]).sort((a, b) => a[0].localeCompare(b[0])), [
    ['Points', 'standard'],
    ['Rebounds', 'standard'],
  ])
})
