import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { shapeForTier } from '../api/_dataAccess.js'
import { KBO_HOLD_TEXT, freeTopEmptyText, kboHoldMessage } from '../src/freeTopEmpty.js'
import { kboHubRows } from '../src/memberHub.js'
import { publicFreeTopRows } from '../src/publicBoard.js'

const LATER = '2099-10-20T09:30:00Z'

function card(name, projection) {
  return { name, team: 'LG', opponent: 'Kia', games: [], start_time: LATER, props: [{ stat: 'Hits', line: 0.5, projection, odds_type: 'standard' }] }
}

test('at the 100 cap the server free pick breaks ties on raw score, like the landing', () => {
  // Every card is at the capped score; board order is the reverse of raw order.
  const payload = { cards: [card('A', 1.0), card('B', 1.1), card('C', 1.2), card('D', 1.4), card('E', 1.6)] }
  const landing = publicFreeTopRows(kboHubRows(payload)).map((row) => row.player)
  assert.deepEqual(landing, ['E', 'D', 'C'])
  const shaped = shapeForTier('prizepicks_props', payload, 'free')
  const server = shaped.data.cards.map((c) => c.name).sort()
  assert.deepEqual(server, [...landing].sort())
  // Below the cap the order is still score first.
  const mixed = { cards: [card('Low', 0.6), card('Cap1', 1.0), card('Cap2', 1.05), card('Mid', 0.8)] }
  const picked = shapeForTier('prizepicks_props', mixed, 'free').data.cards.map((c) => c.name).sort()
  assert.deepEqual(picked, ['Cap1', 'Cap2', 'Mid'])
})

test('under the KBO hold the landing empty state says the lines are not posted yet', () => {
  assert.equal(kboHoldMessage('kbo', { cards: [], kbo_hold: { active: true, message: 'Lines not posted yet' } }), 'Lines not posted yet')
  assert.equal(kboHoldMessage('kbo', { cards: [], kbo_hold: { active: true } }), KBO_HOLD_TEXT)
  assert.equal(kboHoldMessage('kbo', { cards: [], kbo_hold: { active: false } }), null)
  assert.equal(kboHoldMessage('kbo', { cards: [] }), null)
  assert.equal(kboHoldMessage('nfl', { kbo_hold: { active: true } }), null)
  const held = freeTopEmptyText({ sportName: 'KBO', settled: false, hold: 'Lines not posted yet' })
  assert.match(held, /^Lines not posted yet\./)
  assert.equal(freeTopEmptyText({ sportName: 'KBO', settled: true, hold: null }), 'No scored standard lines in the KBO free top 3 right now.')
  assert.equal(freeTopEmptyText({ sportName: 'NHL', settled: false, hold: null }), 'Loading the board…')
  const landing = readFileSync(new URL('../src/PublicLanding.jsx', import.meta.url), 'utf8')
  assert.match(landing, /hold: kboHoldMessage\(sport\.id, snap\.data\)/)
  assert.match(landing, /freeTopEmptyText\(\{ sportName: hitSport\.name/)
})
