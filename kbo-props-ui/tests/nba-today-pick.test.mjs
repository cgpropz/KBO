import test from 'node:test'
import assert from 'node:assert/strict'
import { PENDING, pickText, seasonShortLabel, todayPick } from '../src/nba/nbaTodayPick.js'
import { boundCg, cgScore } from '../src/cgScore.js'
import { topProps } from '../src/nba/nbaPlayersList.js'

// Synthetic rows only.

test('todayPick reads the board projection and the board CG Score for that stat', () => {
  const pick = todayPick({ stat: 'Points', projection: 24 }, 20.5, 'Points')
  assert.equal(pick.projection, 24)
  assert.equal(pick.cg, boundCg(cgScore(24, 20.5, 'Points')))
  assert.equal(pick.side, 'OVER')
  assert.equal(todayPick({ projection: '8' }, 9.5, 'Rebounds').side, 'UNDER')
})

test('blank projection or no line is pending, never 0 or NaN', () => {
  for (const projection of [null, undefined, '', 'abc', NaN, 0, -1]) {
    assert.deepEqual(todayPick({ projection }, 20.5, 'Points'), { projection: null, cg: null, side: null })
  }
  for (const line of [null, undefined, '', 0, 'x']) {
    assert.deepEqual(todayPick({ projection: 24 }, line, 'Points'), { projection: null, cg: null, side: null })
  }
  assert.deepEqual(todayPick(null, null, undefined), { projection: null, cg: null, side: null })
  assert.equal(pickText(null), null)
  assert.equal(pickText(NaN), null)
  assert.equal(pickText(''), null)
  assert.equal(pickText(24), '24.0')
  assert.equal(PENDING, 'Pending')
})

test('season pill label names the season instead of Season', () => {
  assert.equal(seasonShortLabel('2027'), "'26-27")
  assert.equal(seasonShortLabel(2027), "'26-27")
  assert.equal(seasonShortLabel('2026-27'), "'26-27")
  assert.equal(seasonShortLabel('2026-2027'), "'26-27")
  assert.equal(seasonShortLabel(null), 'Season')
  assert.equal(seasonShortLabel('', 'Season'), 'Season')
  assert.equal(seasonShortLabel('soon'), 'Season')
})

test('top prop carries the board row projection and CG Score unchanged', () => {
  const board = [{ athleteId: '1', name: 'Synth Guard', team: 'DEN', ppAllProps: [{ stat: 'Points', line: 20.5, projection: 25, opponent: 'LAL' }] }]
  const top = topProps(board, []).get('id:1')
  assert.equal(top.projection, 25)
  assert.equal(top.score, boundCg(cgScore(25, 20.5, 'Points')))
})
