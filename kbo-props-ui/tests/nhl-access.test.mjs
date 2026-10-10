// NHL is the admin email only. sportAccess stays { kbo, wnba, nfl }.
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

test('only the admin email can see NHL, paid members included', () => {
  assert.equal(nhlAccessDecision({
    emailResolved: true, email: 'cgpropz@gmail.com',
  }), 'full')
  assert.equal(nhlAccessDecision({
    emailResolved: true, email: '  CGPropz@gmail.com ',
  }), 'full')
  for (const tier of ['free', 'kbo', 'wnba', 'combined', 'owner', 'pro', 'monthly', 'weekly', 'season', 'all']) {
    assert.equal(nhlAccessDecision({
      emailResolved: true, email: 'fan@example.com', tierResolved: true, tier, flagResolved: true, nhlPublic: true,
    }), 'deny', tier)
  }
  assert.equal(nhlAccessDecision({
    emailResolved: false, email: 'cgpropz@gmail.com', tierResolved: true, tier: 'owner', flagResolved: true, nhlPublic: true,
  }), 'deny')
  assert.equal(nhlAccessDecision({
    emailResolved: true, email: null, tierResolved: true, tier: 'owner', flagResolved: true, nhlPublic: true,
  }), 'deny')
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
    'tok-owner': { id: 'u-owner', email: 'CGPropz@gmail.com' },
    'tok-fan': { id: 'u-fan', email: 'fan@example.com' },
    'tok-member': { id: 'u-member', email: 'member@example.com' },
  }
  const profiles = { 'u-owner': 'free', 'u-fan': 'combined', 'u-member': 'owner' }
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

test('the admin can read NHL data and a paid member cannot, even if the flag is on', async () => {
  const client = mockClient({ flag: true })
  const res = mockRes()
  await handleDataRequest(
    { method: 'GET', query: { ds: 'nhl_projections' }, headers: { authorization: 'Bearer tok-owner' } },
    res,
    client,
  )
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.preview, false)
  assert.equal(res.body.data[0].player, 'Mikko Rantanen')

  for (const token of ['tok-fan', 'tok-member', 'tok-nope']) {
    const denied = mockRes()
    await handleDataRequest(
      { method: 'GET', query: { ds: 'nhl_projections' }, headers: { authorization: `Bearer ${token}` } },
      denied,
      client,
    )
    assert.equal(denied.statusCode, 403, token)
    assert.equal(denied.body.data, undefined)
  }

  const anon = mockRes()
  await handleDataRequest(
    { method: 'GET', query: { ds: 'nhl_lineups' }, headers: {} },
    anon,
    client,
  )
  assert.equal(anon.statusCode, 403)

  const adminOpen = mockRes()
  await handleNhlAccessRequest(
    { method: 'GET', headers: { authorization: 'Bearer tok-owner' } },
    adminOpen,
    client,
  )
  assert.deepEqual(adminOpen.body, { open: true })

  const memberOpen = mockRes()
  await handleNhlAccessRequest(
    { method: 'GET', headers: { authorization: 'Bearer tok-member' } },
    memberOpen,
    client,
  )
  assert.deepEqual(memberOpen.body, { open: false })

  const loggedOut = mockRes()
  await handleNhlAccessRequest({ method: 'GET', headers: {} }, loggedOut, client)
  assert.deepEqual(loggedOut.body, { open: false })
})
