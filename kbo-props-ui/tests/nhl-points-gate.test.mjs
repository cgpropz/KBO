import assert from 'node:assert/strict'
import test from 'node:test'
import { shapeForTier } from '../api/_dataAccess.js'
import { nhlHubRows } from '../src/memberHub.js'
import { applyPointsOverGate, pointsOverDisposition, prepareBoardRows } from '../src/nhl/pointsGate.js'

const board = [
  { player: 'Low', prop: 'Points', line: 0.5, projection: 0.68, oddsType: 'standard', rankEligible: true },
  { player: 'Held', prop: 'Points', line: 0.5, projection: 0.74, oddsType: 'standard', rankEligible: true },
  { player: 'Ranked', prop: 'Points', line: 0.5, projection: 0.9, oddsType: 'standard', rankEligible: true },
  { player: 'Under', prop: 'Points', line: 0.5, projection: 0.4, oddsType: 'standard', rankEligible: true },
  { player: 'PPP', prop: 'Power Play Points', line: 0.5, projection: 0.5, oddsType: 'standard', rankEligible: true },
  { player: 'Shots', prop: 'Shots On Goal', line: 2.5, projection: 3.1, oddsType: 'standard', rankEligible: true },
]

test('points overs under 0.69 leave the board and 0.69 to 0.78 stay unranked', () => {
  assert.equal(pointsOverDisposition(board[0]), 'drop')
  assert.equal(pointsOverDisposition(board[1]), 'hold')
  assert.equal(pointsOverDisposition(board[2]), 'rank')
  assert.equal(pointsOverDisposition(board[3]), 'rank')
  assert.equal(pointsOverDisposition(board[4]), 'rank')
  assert.equal(pointsOverDisposition({ ...board[1], projection: 0.77 }), 'hold')
  assert.equal(pointsOverDisposition({ ...board[1], projection: 0.78 }), 'rank')
  assert.equal(pointsOverDisposition({ ...board[1], projection: 0.82 }), 'rank')
  assert.equal(applyPointsOverGate(board[0]), null)
  const rows = prepareBoardRows(board)
  assert.deepEqual(rows.map((row) => row.player), ['Held', 'Ranked', 'Under', 'PPP', 'Shots'])
  assert.equal(rows[0].rankEligible, false)
  assert.equal(rows[1].rankEligible, true)
})

test('a PrizePicks pulled line leaves the NHL board list', () => {
  const rows = prepareBoardRows([
    ...board,
    { player: 'Pulled', prop: 'Shots On Goal', line: 2.5, projection: 4, oddsType: 'standard', removed: true, pp_status: 'removed', rankEligible: true },
  ])
  assert.equal(rows.some((row) => row.player === 'Pulled'), false)
  assert.equal(nhlHubRows([{ player: 'Pulled', prop: 'Points', line: 0.5, projection: 0.9, oddsType: 'standard', pp_status: 'suspended', rankEligible: true }]).length, 0)
})

test('free top lists and hub highlights skip held points overs', () => {
  const free = shapeForTier('nhl_projections', board, 'free')
  assert.equal(free.preview, true)
  assert.equal(free.data.some((row) => row.player === 'Low' || row.player === 'Held'), false)
  assert.deepEqual(free.data.map((row) => row.player), ['Ranked', 'Shots', 'PPP'])
  const paid = shapeForTier('nhl_projections', board, 'combined')
  assert.equal(paid.preview, false)
  assert.equal(paid.data.some((row) => row.player === 'Low'), false)
  assert.equal(paid.data.find((row) => row.player === 'Held').rankEligible, false)
  const hub = nhlHubRows(board)
  assert.deepEqual(hub.map((row) => row.player), ['Ranked', 'Under', 'PPP', 'Shots'])
})
