import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  adjustedBookLine,
  bookLineFair,
  cgFair,
  computeCgOdds,
  lineAdjustDetail,
  lineAdjustNote,
} from '../src/nfl/cgOdds.js'

// Made-up prices. No board data.
const fanduel = (over, under) => ({ book: 'FanDuel', book_key: 'fanduel', over, under })
const row = (pp, book, prop, quotes) => ({ pp_line: pp, matched_line: book, prop, book_prices: quotes })

test('book line label only on rows whose book line differs', () => {
  assert.equal(adjustedBookLine(row(2, 2.5, 'Shots On Goal', [])), 2.5)
  assert.equal(adjustedBookLine(row(2.5, 2.5, 'Shots On Goal', [])), null)
  assert.equal(adjustedBookLine({ pp_line: 2.5 }), null)
  assert.equal(adjustedBookLine({ pp_line: 2.5, matched_line: '' }), null)
})

test('whole PP line: the note uses the row numbers and the push math adds up', () => {
  const item = row(2, 2.5, 'Shots On Goal', [fanduel(130, -160)])
  const detail = lineAdjustDetail(item)
  assert.equal(detail.kind, 'push')
  assert.equal(detail.bookLine, 2.5)
  assert.equal(detail.ppLine, 2)
  // cgOver is CG's own number, unchanged.
  assert.equal(detail.cgOver, cgFair(item).over)
  // One book: P(X > 2) at PP 2 is the book's over at 2.5, then the push is removed.
  assert.ok(Math.abs(detail.bookOver / (1 - detail.pushPct) - detail.cgOver) < 0.002)
  const note = lineAdjustNote(detail)
  const pct = (p) => `${Math.round(p * 100)}%`
  assert.equal(
    note,
    `Books 2.5: ${pct(detail.bookOver)} Over. At PP 2, exactly 2 is a push (~${pct(detail.pushPct)}) and is removed: ${pct(detail.cgOver)} Over.`,
  )
})

test('half PP line from a whole book line says there is no push at PP', () => {
  const detail = lineAdjustDetail(row(2.5, 2, 'Shots On Goal', [fanduel(-130, 100)]))
  assert.equal(detail.kind, 'count')
  assert.equal(detail.pushPct, null)
  assert.match(lineAdjustNote(detail), /^Books 2: \d+% Over \(an exact 2 is a push for the books\)\. At PP 2\.5 there is no push: \d+% Over\.$/)
})

test('yardage rows use the linear shift wording', () => {
  const detail = lineAdjustDetail(row(64.5, 65, 'Receiving Yards', [fanduel(-110, -110)]))
  assert.equal(detail.kind, 'shift')
  assert.match(lineAdjustNote(detail), /^Books 65: 50% Over\. Moved to PP 64\.5: 51% Over\.$/)
})

test('books % at the book line uses the same books and weights as CG, unshifted', () => {
  const quotes = [fanduel(-120, 100), { book: 'Pinnacle', book_key: 'pinnacle', over: -105, under: -115 }]
  const same = row(2.5, 2.5, 'Shots On Goal', quotes)
  assert.ok(Math.abs(bookLineFair(same).over - cgFair(same).over) < 1e-12)
  assert.equal(lineAdjustDetail(same), null)
  const shifted = row(3, 2.5, 'Shots On Goal', quotes)
  assert.ok(Math.abs(bookLineFair(shifted).over - cgFair(same).over) < 1e-12)
})

test('no explainer when CG has no price, and CG odds are unchanged by the explainer', () => {
  assert.equal(lineAdjustDetail(row(2, 3, 'Shots On Goal', [fanduel(130, -160)])), null)
  const item = row(2, 2.5, 'Shots On Goal', [fanduel(130, -160)])
  const before = computeCgOdds(item, 'over', 0.5426)
  lineAdjustDetail(item)
  assert.deepEqual(computeCgOdds(item, 'over', 0.5426), before)
})

test('NFL, NHL and NBA PP Odds pages all use the line-adjust pieces', () => {
  for (const file of ['src/nfl/NflSharpOdds.jsx', 'src/nhl/NhlSharpOdds.jsx', 'src/nba/NbaSharpOdds.jsx']) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
    assert.match(source, /<BookLineLabel item=\{item\} side="over" \/>/, file)
    assert.match(source, /<BookLineLabel item=\{item\} side="under" \/>/, file)
    assert.match(source, /<BookLinePct detail=\{adjust\} side=\{side\} \/>/, file)
    assert.match(source, /<LineAdjTag item=\{item\} detail=\{adjust\}/, file)
    assert.doesNotMatch(source, /title=\{`Books post /, file)
  }
})
