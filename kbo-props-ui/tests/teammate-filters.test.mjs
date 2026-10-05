import assert from 'node:assert/strict'
import test from 'node:test'
import { gameMatchesTeammates, hitRateForValues, teammateFilterLabel } from '../src/nfl/teammateFilters.js'

test('no teammate filters keeps every game, including weeks without snap data', () => {
  assert.equal(gameMatchesTeammates(null, {}), true)
  assert.equal(gameMatchesTeammates(['bateman'], {}), true)
  assert.equal(gameMatchesTeammates([], null), true)
})

test('a game must satisfy every on and off constraint', () => {
  const modes = { bateman: 'on', hopkins: 'off' }
  assert.equal(gameMatchesTeammates(['bateman'], modes), true)
  assert.equal(gameMatchesTeammates(['bateman', 'hopkins'], modes), false)
  assert.equal(gameMatchesTeammates(['hopkins'], modes), false)
  assert.equal(gameMatchesTeammates([], modes), false)
})

test('unknown snap weeks fail an active filter, and off means not in the on list', () => {
  assert.equal(gameMatchesTeammates(null, { bateman: 'on' }), false)
  assert.equal(gameMatchesTeammates(null, { bateman: 'off' }), false)
  assert.equal(gameMatchesTeammates([], { bateman: 'off' }), true)
  assert.equal(gameMatchesTeammates(['bateman'], { bateman: 'off' }), false)
})

test('both teammates on requires both ids', () => {
  const modes = { bateman: 'on', hopkins: 'on' }
  assert.equal(gameMatchesTeammates(['bateman', 'hopkins'], modes), true)
  assert.equal(gameMatchesTeammates(['bateman'], modes), false)
})

test('hit rate counts values on or over the line', () => {
  assert.deepEqual(hitRateForValues([80, 40, 10, 70], 50), { hits: 2, games: 4, rate: 50 })
  assert.deepEqual(hitRateForValues([], 50), { hits: 0, games: 0, rate: null })
})

test('filter label uses player names in toggle order', () => {
  const teammates = [
    { id: 'bateman', name: 'Rashod Bateman' },
    { id: 'hopkins', name: 'DeAndre Hopkins' },
  ]
  assert.equal(
    teammateFilterLabel(teammates, { bateman: 'on', hopkins: 'off' }),
    'Rashod Bateman on, DeAndre Hopkins off',
  )
  assert.equal(teammateFilterLabel(teammates, {}), '')
})
