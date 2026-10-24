import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import {
  correlationSectionOpen,
  correlationSuggestions,
  formatAgreement,
  isSmallSample,
  presentCorrelationDoc,
} from '../src/slipCorrelations.js'

const board = [
  { idx: 0, name: 'A', prop: 'Points', propShort: 'PTS', team: 'NY' },
  { idx: 1, name: 'B', prop: 'Rebounds', propShort: 'REB', team: 'NY' },
  { idx: 2, name: 'C', prop: 'Assists', propShort: 'AST', team: 'BOS' },
  { idx: 3, name: 'D', prop: 'Points', propShort: 'PTS', team: 'NY' },
]

const doc = {
  minShared: 15,
  pairs: [
    { player: 'A', stat: 'Points', partner: 'B', partnerStat: 'Rebounds', agreement: 0.72, n: 16 },
    { player: 'A', stat: 'Points', partner: 'C', partnerStat: 'Assists', agreement: 0.31, n: 22 },
    { player: 'A', stat: 'Points', partner: 'D', partnerStat: 'Points', agreement: 0.6, n: 30 },
    { player: 'A', stat: 'Points', partner: 'E', partnerStat: 'Points', agreement: 0.9, n: 40 },
    { player: 'B', stat: 'Rebounds', partner: 'C', partnerStat: 'Assists', agreement: 0.39, n: 18 },
  ],
}

test('suggestions split hit-together and works-against and skip the board gaps', () => {
  const result = correlationSuggestions([board[0]], board, doc)
  assert.deepEqual(result.pairsWell.map((row) => row.name), ['B'])
  assert.equal(result.pairsWell[0].agreement, 0.72)
  assert.equal(result.pairsWell[0].n, 16)
  assert.equal(result.pairsWell[0].smallSample, true)
  assert.equal(result.pairsWell[0].idx, 1)
  assert.deepEqual(result.worksAgainst.map((row) => row.name), ['C'])
  assert.equal(result.worksAgainst[0].smallSample, false)
  assert.equal(formatAgreement(0.72), '72%')
})

test('exactly 60 percent and 40 percent stay off both lists', () => {
  const result = correlationSuggestions([board[0]], board, {
    minShared: 8,
    pairs: [
      { player: 'A', stat: 'Points', partner: 'B', partnerStat: 'Rebounds', agreement: 0.6, n: 10 },
      { player: 'A', stat: 'Points', partner: 'C', partnerStat: 'Assists', agreement: 0.4, n: 10 },
    ],
  })
  assert.deepEqual(result.pairsWell, [])
  assert.deepEqual(result.worksAgainst, [])
  assert.equal(isSmallSample(10, 8), true)
  assert.equal(isSmallSample(12, 8), false)
})

test('a partner already on the slip is not suggested again', () => {
  const result = correlationSuggestions([board[0], board[1]], board, doc)
  assert.equal(result.pairsWell.some((row) => row.name === 'B'), false)
  assert.equal(result.worksAgainst.some((row) => row.name === 'C'), true)
})

test('a failed or unpublished correlation file stays hidden and a real empty file does not', () => {
  const hidden = presentCorrelationDoc(null, 8)
  assert.equal(hidden.unavailable, true)
  assert.deepEqual(hidden.pairs, [])
  assert.equal(correlationSectionOpen(hidden), false)
  assert.equal(correlationSectionOpen(presentCorrelationDoc({ pairs: [], unavailable: true }, 8)), false)
  assert.equal(correlationSectionOpen(presentCorrelationDoc({ sport: 'nfl' }, 8)), false)
  const empty = presentCorrelationDoc({ pairs: [], minShared: 8 }, 8)
  assert.equal(empty.unavailable, undefined)
  assert.equal(correlationSectionOpen(empty), true)
  assert.equal(correlationSectionOpen(presentCorrelationDoc({ pairs: [{ n: 1 }] }, 8)), true)
  const source = readFileSync(new URL('../src/SlipOptimizer.jsx', import.meta.url), 'utf8')
  assert.match(source, /correlationSectionOpen\(correlations\) \? <div className="so-corr" data-testid="slip-correlations">/)
})
