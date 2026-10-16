import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  addLeg,
  cardAverage,
  estimateFor,
  ladderFor,
  payoutDollars,
  rankedRows,
  sideCounts,
} from '../src/slipRailModel.js'

const yard = (name, projection, line, odds = 'standard') => ({
  name,
  team: 'DEN',
  prop: 'Receiving Yards',
  line,
  projection,
  odds_type: odds,
})

test('Power and Flex cells are dollarized from the published table', () => {
  assert.equal(payoutDollars('3x'), '$30')
  assert.equal(payoutDollars('6x'), '$60')
  assert.equal(payoutDollars('10x'), '$100')
  assert.equal(payoutDollars('20x'), '$200')
  assert.equal(payoutDollars('37.5x'), '$375')
  assert.equal(payoutDollars('2x / 0.5x'), '$20 / $5')
  assert.equal(payoutDollars('3x / 1x'), '$30 / $10')
  assert.equal(payoutDollars('6x / 1.5x'), '$60 / $15')
  assert.equal(payoutDollars('10x / 2x / 0.4x'), '$100 / $20 / $4')
  assert.equal(payoutDollars('25x / 2x / 0.4x'), '$250 / $20 / $4')
  assert.deepEqual(ladderFor('power').map((cell) => cell.dollars), ['$30', '$60', '$100', '$200', '$375'])
  assert.equal(estimateFor('power', 3).dollars, '$60')
  assert.equal(estimateFor('power', 3).breakeven, 55.03)
  assert.equal(estimateFor('flex', 3).dollars, '$30 / $10')
  assert.equal(estimateFor('power', 1).dollars, '—')
})

test('the rail ranks standard lines by the CG Score printed on the card', () => {
  const rows = rankedRows([
    yard('Low', 20, 20),
    { name: 'Goblin', prop: 'Receiving Yards', line: 40, projection: 20, odds_type: 'goblin' },
    yard('Floor', 80, 0.5),
    yard('High', 35, 10),
    { name: 'Demon', prop: 'Receptions', line: 1.5, projection: 4, oddsType: 'demon' },
  ])
  assert.deepEqual(rows.map((row) => row.name), ['High', 'Low'])
})

test('the card average matches the printed CG numbers', () => {
  const legs = [
    { projection: 74, line: 50, prop: 'Points', side: 'MORE' },
    { projection: 71.9, line: 50, prop: 'Points', side: 'MORE' },
    { projection: 65, line: 50, prop: 'Points', side: 'MORE' },
    { projection: 57.5, line: 50, prop: 'Points', side: 'LESS' },
  ]
  assert.equal(Math.round(cardAverage(legs) * 10) / 10, 67.1)
  assert.deepEqual(sideCounts(legs), { more: 3, less: 1 })
})

test('one prop per player, More only on a promo, and six picks max', () => {
  const a = yard('Troy Franklin', 30, 17.5)
  const b = { ...a, prop: 'Receptions', line: 4.5, projection: 5 }
  const goblin = { name: 'Sam', prop: 'Shots', line: 1.5, projection: 1, odds_type: 'goblin' }
  let legs = addLeg([], a, 'MORE')
  legs = addLeg(legs, a, 'MORE')
  assert.equal(legs.length, 0)
  legs = addLeg([a], b, 'LESS')
  assert.equal(legs.length, 1)
  assert.equal(addLeg([], goblin, 'LESS').length, 0)
  assert.equal(addLeg([], goblin, 'MORE')[0].side, 'MORE')
  const six = ['A', 'B', 'C', 'D', 'E', 'F'].map((name) => ({ name, prop: 'Points', line: 1.5, projection: 2, odds_type: 'standard', key: name }))
  const seventh = { name: 'G', prop: 'Points', line: 1.5, projection: 2, odds_type: 'standard' }
  assert.equal(addLeg(six.map((row) => ({ ...row, side: 'MORE', key: `${row.name}|DEN|Points|1.5|standard` })), seventh, 'MORE').length, 6)
})

test('the rail copy has real payouts and no sample or example tag', () => {
  const jsx = readFileSync(new URL('../src/SlipRail.jsx', import.meta.url), 'utf8')
  const css = readFileSync(new URL('../src/SlipRail.css', import.meta.url), 'utf8')
  const model = readFileSync(new URL('../src/slipRailModel.js', import.meta.url), 'utf8')
  const source = `${jsx}\n${css}\n${model}`
  assert.equal(/EXAMPLE|SAMPLE|x##|\$##/.test(source), false)
  assert.equal(/\blocked\b/.test(source), false)
  assert.equal(/PrizePicks/.test(source), false)
  assert.match(css, /180px minmax\(0, 1fr\) 320px/)
  assert.match(jsx, /Payout preview/)
  assert.match(jsx, /STANDARD_LINE/)
})
