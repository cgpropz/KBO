import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  initialBoardSort,
  rememberBoardSort,
  resolveBoardSort,
  withDefaultSort,
} from '../src/boardSort.js'

function memory(seed = {}) {
  const data = { ...seed }
  return {
    getItem: (key) => (Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null),
    setItem: (key, value) => { data[key] = String(value) },
    dump: () => data,
  }
}

const nfl = ['Hit Rate', 'CG Score', 'H2H Hit Rate']

test('CG Score is the default, highest first, unless a saved or explicit sort is valid', () => {
  assert.equal(resolveBoardSort(nfl, {}), 'CG Score')
  assert.equal(resolveBoardSort(nfl, { saved: 'Hit Rate' }), 'Hit Rate')
  assert.equal(resolveBoardSort(nfl, { saved: 'Hit Rate', explicit: 'H2H Hit Rate' }), 'H2H Hit Rate')
  assert.equal(resolveBoardSort(nfl, { saved: 'Hit Rate', explicit: 'Not a sort' }), 'Hit Rate')
  assert.equal(resolveBoardSort(nfl, { saved: 'Nope' }), 'CG Score')
  assert.equal(resolveBoardSort(['L10 Hit Rate'], {}), 'L10 Hit Rate')
})

test('the saved sort is per sport and the initial filters use it', () => {
  const storage = memory()
  rememberBoardSort('nfl', 'Hit Rate', storage)
  rememberBoardSort('nhl', 'DVP', storage)
  assert.equal(initialBoardSort('nfl', nfl, { search: '', storage }), 'Hit Rate')
  assert.equal(initialBoardSort('nhl', ['CG Score', 'DVP'], { search: '', storage }), 'DVP')
  assert.equal(initialBoardSort('wnba', nfl, { search: '?sort=H2H+Hit+Rate', storage }), 'H2H Hit Rate')
  assert.deepEqual(withDefaultSort({ sortBy: 'Hit Rate', side: 'All' }, 'nba', nfl, { search: '', storage }), {
    sortBy: 'CG Score',
    side: 'All',
  })
})

test('every member dashboard reads the shared sort', () => {
  const files = [
    '../src/nfl/NflPropLines.jsx',
    '../src/nhl/NhlPropLines.jsx',
    '../src/wnba/Dashboard.jsx',
    '../src/nba/NbaDashboard.jsx',
    '../src/KboPropBoard.jsx',
  ]
  for (const file of files) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8')
    assert.match(source, /initialBoardSort|withDefaultSort/, file)
    assert.match(source, /rememberBoardSort/, file)
    assert.match(source, /usePhoneBoard/, file)
    assert.match(source, /prop-line-table|BoardSurface/, file)
  }
})
