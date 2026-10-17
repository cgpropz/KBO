import assert from 'node:assert/strict'
import test from 'node:test'
import { wnbaLineupColumns } from '../src/wnba/lineupColumns.js'

test('an expected starter listed again as inactive stays out of the out column', () => {
  const { expected, out } = wnbaLineupColumns({
    abbr: 'ATL',
    players: [
      { name: 'Allisha Gray', pos: 'G', status: 'gtd' },
      { name: 'Rhyne Howard', pos: 'G', status: 'expected' },
    ],
    inactive: [
      { name: 'Allisha Gray', pos: 'G', status: 'gtd' },
      { name: 'Tina Charles', pos: 'F', status: 'out' },
    ],
  })
  assert.deepEqual(expected.map((player) => [player.name, player.status]), [
    ['Allisha Gray', 'gtd'],
    ['Rhyne Howard', 'expected'],
  ])
  assert.deepEqual(out.map((player) => player.name), ['Tina Charles'])
})

test('a starter name does not hide that player OUT row', () => {
  const { expected, out } = wnbaLineupColumns({
    players: [{ name: 'Naz Hillmon', pos: 'F', status: 'expected' }],
    inactive: [{ name: 'Naz Hillmon', pos: 'F', status: 'out' }],
  })
  assert.deepEqual(expected.map((player) => player.name), ['Naz Hillmon'])
  assert.deepEqual(out.map((player) => [player.name, player.status]), [['Naz Hillmon', 'out']])
})

test('a bench GTD stays visible with the badge', () => {
  const { expected, out } = wnbaLineupColumns({
    players: [{ name: 'Rhyne Howard', pos: 'G', status: 'expected' }],
    inactive: [{ name: 'Maya Caldwell', pos: 'G', status: 'gtd' }],
  })
  assert.deepEqual(expected.map((player) => player.name), ['Rhyne Howard'])
  assert.deepEqual(out.map((player) => [player.name, player.status]), [['Maya Caldwell', 'gtd']])
})
