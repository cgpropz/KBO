import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { breakevenFor } from '../src/prizepicksBreakeven.js'
import { nflCgScore } from '../src/nfl/nflLineFloors.js'
import {
  PAYOUT_ENTRY,
  addLeg,
  boardRows,
  cardAverage,
  compareSlipRows,
  estimateFor,
  headshotFor,
  ladderFor,
  l10Text,
  logoFor,
  naturalSide,
  shownCg,
} from '../src/slipBoardModel.js'
import { legCg, payoutDollars, payoutFor, playersRepeat } from '../src/slipRank.js'

test('payout dollars use a $10 entry and the posted multipliers', () => {
  assert.equal(PAYOUT_ENTRY, 10)
  assert.equal(payoutDollars('6x'), '$60')
  assert.equal(payoutDollars('3x / 1x'), '$30 / $10')
  assert.equal(payoutDollars('2x / 0.5x'), '$20 / $5')
  assert.equal(payoutDollars('37.5x'), '$375')
  assert.equal(payoutDollars('25x / 2x / 0.4x'), '$250 / $20 / $4')
  assert.equal(payoutFor('power', 3).payout, '6x')
  assert.equal(payoutFor('power', 3).breakeven, 55.03)
  assert.equal(payoutFor('flex', 3).breakeven, 57.74)
  assert.equal(payoutFor('flex', 2).payout, '2x / 0.5x')
  assert.equal(estimateFor('power', 3).dollars, '$60')
  assert.equal(estimateFor('flex', 4).dollars, '$60 / $15')
  assert.equal(estimateFor('power', 1).dollars, '—')
  const ladder = ladderFor('power')
  assert.deepEqual(ladder.map((cell) => cell.dollars), ['$30', '$60', '$100', '$200', '$375'])
  assert.deepEqual(ladder.map((cell) => cell.breakeven), [57.74, 55.03, 56.23, 54.93, 54.66])
  assert.equal(breakevenFor('flex', 6).rate, 54.21)
})

test('a demon on the slip marks the payout altered and blocks a second player prop', () => {
  const standard = { name: 'Alex Ovechkin', playerId: '1', prop: 'Points', line: 0.5, projection: 0.8, odds_type: 'standard' }
  const other = { name: 'Alex Ovechkin', playerId: '1', prop: 'Shots On Goal', line: 3.5, projection: 4, odds_type: 'standard' }
  const demon = { name: 'Jared McCann', playerId: '2', prop: 'Points', line: 1.5, projection: 0.9, odds_type: 'demon' }
  let legs = addLeg([], standard, 'MORE')
  legs = addLeg(legs, other, 'MORE')
  assert.equal(legs.length, 1)
  assert.equal(playersRepeat(legs), false)
  legs = addLeg(legs, demon, 'LESS')
  assert.equal(legs.length, 1)
  legs = addLeg(legs, demon, 'MORE')
  assert.equal(legs.length, 2)
  assert.equal(estimateFor('power', legs.length, true).altered, true)
  assert.equal(payoutFor('power', 2, { altered: true }).altered, true)
})

test('NFL slip scores use the board floors so short rush and receiving lines do not lead', () => {
  const mccarthy = { name: 'J.J. McCarthy', prop: 'Rush Yards', line: 2.5, projection: 15.9, odds_type: 'standard', sport: 'nfl' }
  const cousins = { name: 'Kirk Cousins', prop: 'Rush Yards', line: 1.5, projection: 6.2, odds_type: 'standard', sport: 'nfl' }
  const penix = { name: 'Michael Penix Jr.', prop: 'Rush Yards', line: 2.5, projection: 8.6, odds_type: 'standard', sport: 'nfl' }
  const hutchinson = { name: 'Xavier Hutchinson', prop: 'Receiving Yards', line: 14.5, projection: 35.9, odds_type: 'standard', sport: 'nfl' }
  const atFloor = { name: 'Keaton Mitchell', prop: 'Rush Yards', line: 18.5, projection: 30.3, odds_type: 'standard', sport: 'nfl' }
  const missingType = { name: 'No Type', prop: 'Rush Yards', line: 1.5, projection: 40, sport: 'nfl' }
  assert.equal(shownCg(mccarthy), nflCgScore(15.9, 2.5, 'Rush Yards'))
  assert.equal(shownCg(mccarthy), (15.9 / 18.5) * 50)
  assert.equal(shownCg(cousins), (6.2 / 18.5) * 50)
  assert.equal(shownCg(penix), (8.6 / 18.5) * 50)
  assert.equal(shownCg(hutchinson), (35.9 / 15.5) * 50)
  assert.equal(shownCg(atFloor), (30.3 / 18.5) * 50)
  assert.notEqual(shownCg(mccarthy), (15.9 / 2.5) * 50)
  assert.equal(naturalSide(mccarthy), 'MORE')
  const board = boardRows([penix, mccarthy, missingType, cousins, hutchinson, atFloor], { standardOnly: true, sortDesc: true })
  assert.deepEqual(board.map((row) => row.name), [
    'Xavier Hutchinson',
    'Keaton Mitchell',
    'J.J. McCarthy',
    'Michael Penix Jr.',
    'Kirk Cousins',
  ])
})

test('equal CG scores break ties by name, prop, and line', () => {
  const zed = { name: 'Zed', prop: 'Receptions', line: 4.5, projection: 4.5, odds_type: 'standard' }
  const amy = { name: 'Amy', prop: 'Receptions', line: 4.5, projection: 4.5, odds_type: 'standard' }
  const amyRush = { name: 'Amy', prop: 'Rush Attempts', line: 4.5, projection: 4.5, odds_type: 'standard' }
  const amyShort = { name: 'Amy', prop: 'Receptions', line: 3.5, projection: 3.5, odds_type: 'standard' }
  assert.equal(shownCg(zed), shownCg(amy))
  assert.equal(shownCg(amyRush), shownCg(amy))
  const forward = boardRows([zed, amyRush, amy, amyShort], { sortDesc: true })
  const backward = boardRows([amyShort, amy, amyRush, zed], { sortDesc: true })
  const expected = ['Amy', 'Amy', 'Amy', 'Zed']
  assert.deepEqual(forward.map((row) => row.name), expected)
  assert.deepEqual(backward.map((row) => row.name), expected)
  assert.deepEqual(forward.map((row) => `${row.prop}|${row.line}`), [
    'Receptions|3.5',
    'Receptions|4.5',
    'Rush Attempts|4.5',
    'Receptions|4.5',
  ])
  const low = boardRows([zed, amy], { sortDesc: false })
  assert.deepEqual(low.map((row) => row.name), ['Amy', 'Zed'])
  assert.ok(compareSlipRows(zed, amy, true) > 0)
})

test('the board sorts by CG Score and keeps a yardage floor unscored', () => {
  const rows = [
    { name: 'A', prop: 'Receiving Yards', line: 0.5, projection: 20, odds_type: 'standard' },
    { name: 'B', prop: 'Receiving Yards', line: 17.5, projection: 25.9, odds_type: 'standard' },
    { name: 'C', prop: 'Receiving Yards', line: 40, projection: 20, odds_type: 'demon' },
  ]
  assert.equal(legCg(rows[0], 'MORE'), null)
  const board = boardRows(rows, { standardOnly: true, sortDesc: true })
  assert.deepEqual(board.map((row) => row.name), ['B'])
  assert.equal(cardAverage([{ projection: 25.9, line: 17.5, prop: 'Receiving Yards' }, { projection: 4.6, line: 4, prop: 'Rec Targets' }]).toFixed(1), '65.8')
})

test('L10, headshot, and logo fallbacks stay on the row', () => {
  assert.equal(l10Text({ hitRate: 50, gamesL10: 10 }), '5/10')
  assert.equal(l10Text({ recent: [1, 0, 2], line: 0.5 }), '2/3')
  const photo = 'https://static.prizepicks.com/images/players/nhl/Alex.webp'
  assert.equal(headshotFor('nhl', { imageUrl: photo, playerId: '8471214' }), photo)
  assert.match(headshotFor('nhl', { playerId: '8471214' }), /8471214/)
  assert.equal(headshotFor('nfl', { imageUrl: 'https://a.espncdn.com/i/headshots/nfl/players/full/1.png' }), '')
  assert.match(logoFor('nfl', 'DEN'), /nfl\/500\/den/)
  assert.match(logoFor('nhl', 'WSH'), /nhl\/500\/wsh/)
  assert.match(logoFor('kbo', 'LG'), /team-logos\/lg\.webp/)
})

test('the slip screen does not ship sample rows, example payouts, or lock copy', () => {
  const src = readFileSync(new URL('../src/SlipBoard.jsx', import.meta.url), 'utf8')
  const css = readFileSync(new URL('../src/SlipBoard.css', import.meta.url), 'utf8')
  const footer = readFileSync(new URL('../src/SiteFooter.jsx', import.meta.url), 'utf8')
  for (const banned of ['EXAMPLE', 'SAMPLE', 'Troy Franklin', 'x##', '$##', 'locked', 'PrizePicks']) {
    assert.equal(src.includes(banned), false, banned)
    assert.equal(css.includes(banned), false, banned)
  }
  assert.match(src, /min-height: 48px|b2-ml/)
  assert.match(css, /min-height:\s*48px/)
  assert.match(css, /1fr 420px/)
  assert.match(footer, /SiteFooter|STANDARD_LINE|footer/i)
})
