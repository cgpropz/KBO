import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  homeViewForSport,
  slipTabSearch,
  sportTabSearch,
  viewOnLoad,
} from '../src/memberNav.js'

const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')

test('every sport tab lands on that sport dashboard', () => {
  assert.equal(homeViewForSport('nfl'), 'dashboard')
  assert.equal(homeViewForSport('nhl'), 'dashboard')
  assert.equal(homeViewForSport('wnba'), 'dashboard')
  assert.equal(homeViewForSport('nba'), 'dashboard')
  assert.equal(homeViewForSport('kbo'), 'board')
  for (const sport of ['kbo', 'wnba', 'nfl', 'nhl', 'nba']) {
    assert.equal(viewOnLoad({ sport, entry: { view: 'projections' }, search: '?page=projections', forceHome: true }), homeViewForSport(sport))
  }
})

test('an explicit sub-page still opens, and a stored NBA tab does not', () => {
  assert.equal(viewOnLoad({ sport: 'nfl', entry: null, search: '?page=projections', forceHome: false }), 'projections')
  assert.equal(viewOnLoad({ sport: 'nhl', entry: null, search: '?page=board', forceHome: false }), 'projections')
  assert.equal(viewOnLoad({ sport: 'kbo', entry: null, search: '?page=board', forceHome: false }), 'board')
  assert.equal(viewOnLoad({ sport: 'wnba', entry: null, search: '?page=lineups', forceHome: false }), 'lineups')
  assert.equal(viewOnLoad({ sport: 'wnba', entry: null, search: '?page=nope', forceHome: false }), 'dashboard')
  assert.equal(viewOnLoad({ sport: 'nba', entry: null, search: '?nbaTab=players', forceHome: false }), 'players')
  assert.equal(viewOnLoad({ sport: 'nba', entry: null, search: '', forceHome: false }), 'dashboard')
  assert.equal(viewOnLoad({ sport: 'nba', entry: null, search: '?nbaTab=projections', forceHome: true }), 'dashboard')
  assert.equal(viewOnLoad({ sport: 'nfl', entry: { view: 'slip' }, search: '?page=projections', forceHome: false }), 'slip')
  assert.equal(viewOnLoad({ sport: 'kbo', entry: { view: 'slip' }, search: '', forceHome: false }), 'optimizer')
  assert.equal(viewOnLoad({ sport: 'wnba', entry: { view: 'player', player: 'A' }, search: '', forceHome: false }), 'playerDetail')
  assert.equal(viewOnLoad({ sport: 'nhl', entry: { view: 'player', item: {} }, search: '', forceHome: false }), 'player')
})

test('a sport tab drops the named sub-page and a slip switch keeps the slip link', () => {
  assert.equal(sportTabSearch('?sport=nfl&page=projections&nbaTab=players&s=nhl&d=1&sort=Hit+Rate', 'nhl'), '?sport=nhl&sort=Hit+Rate')
  assert.equal(slipTabSearch('wnba'), '?s=wnba')
  assert.match(app, /forceHome/)
  assert.match(app, /sportTabSearch/)
  assert.match(app, /setForceHome\(true\)/)
  assert.match(app, /chooseSlipSport/)
})
