import assert from 'node:assert/strict'
import test from 'node:test'
import { countedLines, lineClause, lineWord } from '../src/lineCount.js'

test('a count of one uses the singular line', () => {
  assert.equal(lineWord(1), 'line')
  assert.equal(lineWord(0), 'lines')
  assert.equal(lineWord(2), 'lines')
  assert.equal(lineClause(1), 'line is')
  assert.equal(lineClause(4), 'lines are')
  assert.equal(countedLines(1), '1 line')
  assert.equal(countedLines(12), '12 lines')
  assert.equal(countedLines(1, { locked: 4 }), '1 + 4 locked lines')
})
