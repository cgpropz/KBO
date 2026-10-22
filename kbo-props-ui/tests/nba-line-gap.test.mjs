import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { cgFair, computeCgOdds, lineAdjustDetail, MAX_LINE_GAP, NBA_MAX_LINE_GAP } from '../src/nfl/cgOdds.js'

// Made-up prices. No board data.
const fanduel = (over, under) => ({ book: 'FanDuel', book_key: 'fanduel', over, under })
const row = (pp, book, prop, quotes) => ({ pp_line: pp, matched_line: book, prop, book_prices: quotes })
const nba = { maxLineGap: NBA_MAX_LINE_GAP }

test('NBA gap is one point; the default stays half a point', () => {
  assert.equal(MAX_LINE_GAP, 0.5)
  assert.equal(NBA_MAX_LINE_GAP, 1)
})

test('a book line one point off gets a CG price only with the NBA gap', () => {
  const item = row(20.5, 21.5, 'Points', [fanduel(-120, -105)])
  assert.equal(cgFair(item), null)
  assert.equal(computeCgOdds(item, 'over', 0.5), null)
  const fair = cgFair(item, nba)
  assert.ok(fair && fair.over > 0 && fair.over < 1)
  assert.equal(fair.lineAdjusted, true)
  const cg = computeCgOdds(item, 'under', 0.5, nba)
  assert.ok(cg && Number.isFinite(cg.american))
  assert.ok(lineAdjustDetail(item, nba))
  // Book line above the PP line: the over at PP is at least the book over.
  const lower = row(21.5, 20.5, 'Points', [fanduel(-120, -105)])
  assert.ok(cgFair(lower, nba).over <= fair.over)
})

test('the NBA gap does not open lines more than one point away', () => {
  assert.equal(cgFair(row(20.5, 22, 'Points', [fanduel(-120, -105)]), nba), null)
  assert.equal(cgFair(row(20.5, 22.5, 'Points', [fanduel(-120, -105)]), nba), null)
})

test('half-point rows are unchanged by the NBA gap', () => {
  const item = row(20.5, 21, 'Points', [fanduel(-120, -105)])
  assert.deepEqual(cgFair(item, nba), cgFair(item))
  const same = row(20.5, 20.5, 'Points', [fanduel(-120, -105)])
  assert.deepEqual(cgFair(same, nba), cgFair(same))
})

test('only the NBA page passes the wider gap', () => {
  const nbaSrc = readFileSync(new URL('../src/nba/NbaSharpOdds.jsx', import.meta.url), 'utf8')
  assert.match(nbaSrc, /maxLineGap: NBA_MAX_LINE_GAP/)
  assert.match(nbaSrc, /\.breakeven, CG_OPTIONS\)/)
  assert.match(nbaSrc, /lineAdjustDetail\(item, CG_OPTIONS\)/)
  for (const page of ['../src/nhl/NhlSharpOdds.jsx', '../src/nfl/NflSharpOdds.jsx']) {
    const src = readFileSync(new URL(page, import.meta.url), 'utf8')
    assert.doesNotMatch(src, /maxLineGap|NBA_MAX_LINE_GAP/)
  }
})
