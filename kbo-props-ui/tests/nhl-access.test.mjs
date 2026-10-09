// NHL follows the NBA gate. sportAccess stays { kbo, wnba, nfl }.
import assert from 'node:assert/strict'
import { test, beforeEach } from 'node:test'
import {
  nhlAccessDecision,
  shapeForTier,
  sportAccess as serverAccess,
} from '../api/_dataAccess.js'
import { handleDataRequest, _clearCache } from '../api/data.js'
import { handleNhlAccessRequest } from '../api/nhl-access.js'
import { landingSportOpens, nhlDevBypass, sportAccess as clientAccess } from '../src/entitlements.js'

beforeEach(() => _clearCache())

test('NHL does not change KBO, WNBA, or NFL access keys', () => {
  assert.deepEqual(Object.keys(serverAccess('owner')), ['kbo', 'wnba', 'nfl'])
  assert.deepEqual(Object.keys(clientAccess('free')), ['kbo', 'wnba', 'nfl'])
  assert.equal(landingSportOpens('kbo', false), true)
  assert.equal(landingSportOpens('nhl', true), false)
  assert.equal(landingSportOpens('nhl', true, true), true)
  assert.equal(landingSportOpens('nba', true, false), true)
})

test('the dev screenshot query cannot open a production build', () => {
  assert.equal(nhlDevBypass(false, '?nhl=1'), false)
  assert.equal(nhlDevBypass(true, '?nhl=1'), true)
  assert.equal(nhlDevBypass(true, ''), false)
})

test('nhl access fails closed the same way NBA does', () => {
  assert.equal(nhlAccessDecision({
    emailResolved: true, email: 'cgpropz@gmail.com', tierResolved: false, tier: 'free', flagResolved: false, nhlPublic: false,
  }), 'full')
  assert.equal(nhlAccessDecision({
    emailResolved: true, email: 'fan@example.com', tierResolved: true, tier: 'combined', flagResolved: true, nhlPublic: false,
  }), 'deny')
  assert.equal(nhlAccessDecision({
    emailResolved: true, email: 'fan@example.com', tierResolved: true, tier: 'combined', flagResolved: true, nhlPublic: true,
  }), 'full')
  assert.equal(nhlAccessDecision({
    emailResolved: true, email: null, tierResolved: true, tier: 'free', flagResolved: true, nhlPublic: true,
  }), 'preview')
})

test('an unconfirmed goalie is not one of the free top rows', () => {
  const payload = [
    { player: 'Probable Goalie', projection: 30, line: 20, rankEligible: false },
    { player: 'Skater A', projection: 4, line: 2.5, rankEligible: true },
    { player: 'Skater B', projection: 3, line: 2.5, rankEligible: true },
    { player: 'Skater C', projection: 2, line: 2.5, rankEligible: true },
    { player: 'Skater D', projection: 1, line: 2.5, rankEligible: true },
  ]
  const shaped = shapeForTier('nhl_projections', payload, 'free')
  assert.equal(shaped.preview, true)
  assert.deepEqual(shaped.data.map((row) => row.player), ['Skater A', 'Skater B', 'Skater C'])
  assert.equal(shaped.lockedCount, 2)
})

function mockRes() {
  return {
    statusCode: 200, headers: {}, body: undefined,
    setHeader() {},
    status(code) { this.statusCode = code; return this },
    json(obj) { this.body = obj; return this },
  }
}

function mockClient({ flag = false } = {}) {
  const users = {
    'tok-owner': { id: 'u-owner', email: 'cgpropz@gmail.com' },
    'tok-fan': { id: 'u-fan', email: 'fan@example.com' },
  }
  const profiles = { 'u-owner': 'free', 'u-fan': 'combined' }
  return {
    auth: {
      getUser(token) {
        const user = users[token]
        if (!user) return Promise.resolve({ data: { user: null }, error: { message: 'invalid' } })
        return Promise.resolve({ data: { user }, error: null })
      },
    },
    from(table) {
      const filters = {}
      const chain = {
        select() { return chain },
        eq(col, val) { filters[col] = val; return chain },
        abortSignal() { return chain },
        maybeSingle() {
          if (table === 'user_profiles') {
            return Promise.resolve({ data: profiles[filters.id] ? { tier: profiles[filters.id] } : null, error: null })
          }
          if (table === 'app_flags') {
            return Promise.resolve({ data: { value: flag === true }, error: null })
          }
          if (table === 'nhl_projections') {
            return Promise.resolve({
              data: { data: [{ player: 'Mikko Rantanen', projection: 3.2, line: 2.5, rankEligible: true }], updated_at: '2026-10-09T00:00:00Z' },
              error: null,
            })
          }
          return Promise.resolve({ data: null, error: null })
        },
      }
      return chain
    },
  }
}

test('the owner can read NHL while the public flag is off', async () => {
  const res = mockRes()
  await handleDataRequest(
    { method: 'GET', query: { ds: 'nhl_projections' }, headers: { authorization: 'Bearer tok-owner' } },
    res,
    mockClient({ flag: false }),
  )
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.preview, false)
  assert.equal(res.body.data[0].player, 'Mikko Rantanen')

  const fan = mockRes()
  await handleDataRequest(
    { method: 'GET', query: { ds: 'nhl_projections' }, headers: { authorization: 'Bearer tok-fan' } },
    fan,
    mockClient({ flag: false }),
  )
  assert.equal(fan.statusCode, 403)

  const open = mockRes()
  await handleNhlAccessRequest({ method: 'GET', headers: {} }, open, mockClient({ flag: true }))
  assert.deepEqual(open.body, { open: false })
})
