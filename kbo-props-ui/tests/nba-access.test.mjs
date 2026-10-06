// NBA gate. KBO/WNBA/NFL sportAccess() must stay { kbo, wnba, nfl }.
// Run with the rest of the API tests: npm run test:api
import assert from 'node:assert/strict'
import { test, beforeEach } from 'node:test'
import {
  NBA_OWNER_EMAIL as SERVER_EMAIL,
  nbaAccessDecision,
  nbaAllowed,
  sportAccess as serverAccess,
} from '../api/_dataAccess.js'
import { handleDataRequest, _clearCache, _setTimeouts, timeouts } from '../api/data.js'
import {
  NBA_OWNER_EMAIL as CLIENT_EMAIL,
  canSeeNba,
  landingSportOpens,
  sportAccess as clientAccess,
} from '../src/entitlements.js'
import { handleNbaAccessRequest } from '../api/nba-access.js'

const SPORT_ACCESS = {
  undefined: { kbo: false, wnba: false, nfl: false },
  null: { kbo: false, wnba: false, nfl: false },
  '': { kbo: false, wnba: false, nfl: false },
  free: { kbo: false, wnba: false, nfl: false },
  kbo: { kbo: true, wnba: false, nfl: false },
  wnba: { kbo: false, wnba: true, nfl: false },
  owner: { kbo: true, wnba: true, nfl: true },
  pro: { kbo: true, wnba: true, nfl: true },
  monthly: { kbo: true, wnba: true, nfl: true },
  weekly: { kbo: true, wnba: true, nfl: true },
  season: { kbo: true, wnba: true, nfl: true },
  all: { kbo: true, wnba: true, nfl: true },
  combined: { kbo: true, wnba: true, nfl: true },
  // Lifetime purchases are stored as tier 'combined', not the string 'lifetime'.
  lifetime: { kbo: false, wnba: false, nfl: false },
}

beforeEach(() => _clearCache())

test('KBO, WNBA, and NFL access is unchanged on the client and the server', () => {
  assert.equal(SERVER_EMAIL, 'cgpropz@gmail.com')
  assert.equal(CLIENT_EMAIL, SERVER_EMAIL)
  for (const tier of [undefined, null, '', 'free', 'kbo', 'wnba', 'owner', 'pro', 'monthly', 'weekly', 'season', 'all', 'combined', 'lifetime']) {
    const key = tier === undefined ? 'undefined' : tier === null ? 'null' : tier
    assert.deepEqual(serverAccess(tier), SPORT_ACCESS[key], `server ${key}`)
    assert.deepEqual(clientAccess(tier), SPORT_ACCESS[key], `client ${key}`)
    assert.deepEqual(Object.keys(serverAccess(tier)), ['kbo', 'wnba', 'nfl'])
    assert.deepEqual(Object.keys(clientAccess(tier)), ['kbo', 'wnba', 'nfl'])
  }
})

test('nbaAllowed is the owner email until nba_public, then all-access tiers', () => {
  assert.equal(nbaAllowed('CGPropz@gmail.com', 'free', false), true)
  assert.equal(nbaAllowed('  cgpropz@gmail.com ', 'kbo', false), true)
  for (const tier of ['combined', 'weekly', 'monthly', 'owner', 'pro', 'season', 'all']) {
    assert.equal(nbaAllowed('fan@example.com', tier, false), false, tier)
    assert.equal(nbaAllowed('fan@example.com', tier, true), true, tier)
  }
  for (const tier of ['free', 'kbo', 'wnba', 'lifetime']) {
    assert.equal(nbaAllowed('fan@example.com', tier, true), false, tier)
  }
  assert.equal(nbaAllowed(null, 'combined', true), false)
  assert.equal(nbaAllowed('fan@example.com', 'combined', 'true'), false)
})

test('nbaAccessDecision fails closed on auth, email, flag, and tier lookup errors', () => {
  assert.equal(nbaAccessDecision({
    emailResolved: false, email: 'cgpropz@gmail.com', tierResolved: true, tier: 'owner', flagResolved: true, nbaPublic: true,
  }), 'deny')
  assert.equal(nbaAccessDecision({
    emailResolved: true, email: 'fan@example.com', tierResolved: true, tier: 'combined', flagResolved: false, nbaPublic: true,
  }), 'deny')
  assert.equal(nbaAccessDecision({
    emailResolved: true, email: 'cgpropz@gmail.com', tierResolved: false, tier: 'free', flagResolved: false, nbaPublic: false,
  }), 'full')
  assert.equal(nbaAccessDecision({
    emailResolved: true, email: 'fan@example.com', tierResolved: false, tier: 'combined', flagResolved: true, nbaPublic: true,
  }), 'deny')
  assert.equal(nbaAccessDecision({
    emailResolved: true, email: null, tierResolved: true, tier: 'free', flagResolved: true, nbaPublic: false,
  }), 'deny')
  assert.equal(nbaAccessDecision({
    emailResolved: true, email: null, tierResolved: true, tier: 'free', flagResolved: true, nbaPublic: true,
  }), 'preview')
})

test('the hub treats only the owner email as able to see NBA', () => {
  assert.equal(canSeeNba({ email: 'CGPropz@Gmail.com' }), true)
  assert.equal(canSeeNba({ email: ' fan@example.com ' }), false)
  assert.equal(canSeeNba(null), false)
  assert.equal(canSeeNba({}), false)
})

test('a locked NBA landing card does not open and the other sports still do', () => {
  assert.equal(landingSportOpens('nba', false), false)
  assert.equal(landingSportOpens('nba', undefined), false)
  assert.equal(landingSportOpens('nba', true), true)
  assert.equal(landingSportOpens('kbo', false), true)
  assert.equal(landingSportOpens('wnba', false), true)
  assert.equal(landingSportOpens('nfl', false), true)
  assert.equal(landingSportOpens('mlb', true), false)
})

async function callAccess(token, options) {
  _clearCache()
  const res = mockRes()
  const client = mockClient(options)
  const req = { method: 'GET', query: {}, headers: token ? { authorization: `Bearer ${token}` } : {} }
  await handleNbaAccessRequest(req, res, client)
  return { res, client }
}

test('nba-access returns only an open bit and stays closed without full access', async () => {
  const anon = await callAccess(undefined, { flag: true })
  assert.equal(anon.res.statusCode, 200)
  assert.deepEqual(anon.res.body, { open: false })

  const fan = await callAccess('tok-fan', { flag: false })
  assert.deepEqual(fan.res.body, { open: false })

  const legacy = await callAccess('tok-fan', { flag: true, profileErrorFor: 'u-fan' })
  assert.deepEqual(legacy.res.body, { open: false })

  const forged = await callAccess('forged-token', { flag: true })
  assert.deepEqual(forged.res.body, { open: false })
  assert.equal(forged.client.calls.some((c) => c.table === 'app_flags'), false)
  assert.equal(forged.res.body.data, undefined)
  assert.equal(forged.res.body.email, undefined)
  assert.equal(forged.res.body.tier, undefined)
})

test('nba-access opens for the owner and for all-access only when the flag is on', async () => {
  for (const flag of [false, 'missing', 'error']) {
    const owner = await callAccess('tok-owner', { flag })
    assert.deepEqual(owner.res.body, { open: true }, String(flag))
  }
  const combinedOff = await callAccess('tok-fan', { flag: false })
  assert.deepEqual(combinedOff.res.body, { open: false })
  const combinedOn = await callAccess('tok-fan', { flag: true })
  assert.deepEqual(combinedOn.res.body, { open: true })
  const weeklyOn = await callAccess('tok-weekly', { flag: true })
  assert.deepEqual(weeklyOn.res.body, { open: true })
  const singleSport = await callAccess('tok-kbo', { flag: true })
  assert.deepEqual(singleSport.res.body, { open: false })
})

test('nba-access fails closed when the flag hangs, and still opens for the owner', async () => {
  const prev = { ...timeouts }
  _setTimeouts({ snapshotReadMs: 40, tierLookupMs: 40 })
  try {
    const fan = await callAccess('tok-fan', { flag: 'hang' })
    assert.deepEqual(fan.res.body, { open: false })
    const owner = await callAccess('tok-owner', { flag: 'hang' })
    assert.deepEqual(owner.res.body, { open: true })
  } finally {
    _setTimeouts(prev)
  }
})

test('nba-access rejects non-GET without an open bit', async () => {
  const res = mockRes()
  await handleNbaAccessRequest({ method: 'POST', headers: {} }, res, mockClient())
  assert.equal(res.statusCode, 405)
  assert.equal(res.body.open, undefined)
})

function mockRes() {
  return {
    statusCode: 200, headers: {}, body: undefined,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v },
    status(code) { this.statusCode = code; return this },
    json(obj) { this.body = obj; return this },
  }
}

function mockClient({ flag = false, profileErrorFor = null, hangAuth = false } = {}) {
  const calls = []
  const users = {
    'tok-owner': { id: 'u-owner', email: 'CGPropz@gmail.com' },
    'tok-fan': { id: 'u-fan', email: 'fan@example.com' },
    'tok-weekly': { id: 'u-weekly', email: 'weekly@example.com' },
    'tok-kbo': { id: 'u-kbo', email: 'kbo@example.com' },
    'tok-noemail': { id: 'u-noemail' },
  }
  const profiles = {
    'u-owner': 'free',
    'u-fan': 'combined',
    'u-weekly': 'weekly',
    'u-kbo': 'kbo',
  }
  return {
    calls,
    auth: {
      getUser(token) {
        if (hangAuth) return new Promise(() => {})
        const user = users[token]
        if (!user) return Promise.resolve({ data: { user: null }, error: { message: 'invalid JWT' } })
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
          calls.push({ table, key: filters.key, id: filters.id })
          if (table === 'user_profiles') {
            if (profileErrorFor && profileErrorFor === filters.id) {
              return Promise.resolve({ data: null, error: { message: 'profile down' } })
            }
            const tier = profiles[filters.id]
            return Promise.resolve({ data: tier ? { tier } : null, error: null })
          }
          if (table === 'app_flags') {
            if (flag === 'error') return Promise.resolve({ data: null, error: { message: 'flag down' } })
            if (flag === 'hang') return new Promise(() => {})
            if (flag === 'missing') return Promise.resolve({ data: null, error: null })
            return Promise.resolve({ data: { value: flag === true }, error: null })
          }
          if (table === 'nba_players' || table === 'nba_teams' || String(table).startsWith('nba_dvp_')) {
            const data = String(table).startsWith('nba_dvp_')
              ? { position: 'PG', leagueAvgOppPts: 26.21, teams: [{ team: 'WSH', oppPts: 29.1, dvpFactor: 30 }, { team: 'OKC', oppPts: 22.2, dvpFactor: 1 }] }
              : [{ name: 'Jaren Jackson Jr.', team: 'MEM', athleteId: '4277961' }]
            return Promise.resolve({
              data: { data, updated_at: '2026-04-12T00:00:00Z' },
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

async function call(ds, token, options) {
  const res = mockRes()
  const client = mockClient(options)
  const req = { method: 'GET', query: { ds }, headers: token ? { authorization: `Bearer ${token}` } : {} }
  await handleDataRequest(req, res, client)
  return { res, client }
}

test('anonymous, forged, and combined callers get 403 with no NBA payload', async () => {
  for (const token of [undefined, 'forged-token', 'tok-fan', 'tok-noemail']) {
    const { res, client } = await call('nba_players', token)
    assert.equal(res.statusCode, 403, String(token))
    assert.equal(res.body.error, 'Forbidden')
    assert.equal(res.body.data, undefined)
    assert.equal(Object.hasOwn(res.body, 'preview'), false)
  }
  const forged = await call('nba_players', 'forged-token')
  assert.equal(forged.client.calls.some((c) => c.table === 'app_flags'), false)
})

test('combined is denied while the flag is false or the flag lookup fails', async () => {
  for (const flag of [false, 'missing', 'error']) {
    const { res } = await call('nba_players', 'tok-fan', { flag })
    assert.equal(res.statusCode, 403, String(flag))
    assert.equal(res.body.data, undefined)
  }
})

test('the owner is allowed when the flag is missing or the flag lookup fails', async () => {
  for (const flag of [false, 'missing', 'error']) {
    const { res } = await call('nba_projections_standard', 'tok-owner', { flag })
    assert.equal(res.statusCode, 400, String(flag))
    assert.equal(res.body.error, 'Unknown dataset')
    assert.equal(res.body.data, undefined)
  }
})

test('a public flag lets all-access through the gate and still denies a failed tier lookup', async () => {
  const combined = await call('nba_players', 'tok-fan', { flag: true })
  assert.equal(combined.res.statusCode, 200)
  assert.equal(combined.res.body.data[0].name, 'Jaren Jackson Jr.')
  const weekly = await call('nba_teams', 'tok-weekly', { flag: true })
  assert.equal(weekly.res.statusCode, 200)
  assert.equal(weekly.res.body.data[0].team, 'MEM')
  const profileDown = await call('nba_players', 'tok-fan', { flag: true, profileErrorFor: 'u-fan' })
  assert.equal(profileDown.res.statusCode, 403)
  assert.equal(profileDown.res.body.data, undefined)
})

test('the owner receives nba player and team snapshots while a combined tier is still 403', async () => {
  const owner = await call('nba_players', 'tok-owner', { flag: false })
  assert.equal(owner.res.statusCode, 200)
  assert.equal(owner.res.body.preview, false)
  assert.equal(owner.res.body.data[0].athleteId, '4277961')
  const teams = await call('nba_teams', 'tok-owner', { flag: 'missing' })
  assert.equal(teams.res.statusCode, 200)
  assert.equal(teams.res.body.data[0].name, 'Jaren Jackson Jr.')
  const combined = await call('nba_players', 'tok-fan', { flag: false })
  assert.equal(combined.res.statusCode, 403)
  assert.equal(combined.res.body.data, undefined)
  assert.equal(combined.client.calls.some((entry) => entry.table === 'nba_players'), false)
  const forged = await call('nba_teams', 'forged-token')
  assert.equal(forged.res.statusCode, 403)
  assert.equal(forged.res.body.data, undefined)
})

test('the owner receives NBA DVP while a combined tier and a forged token stay 403', async () => {
  const owner = await call('nba_dvp_pg', 'tok-owner', { flag: false })
  assert.equal(owner.res.statusCode, 200)
  assert.equal(owner.res.body.preview, false)
  assert.equal(owner.res.body.data.teams[0].team, 'WSH')
  const missingFlag = await call('nba_dvp_c', 'tok-owner', { flag: 'missing' })
  assert.equal(missingFlag.res.statusCode, 200)
  assert.equal(missingFlag.res.body.data.position, 'PG')
  const combined = await call('nba_dvp_sg', 'tok-fan', { flag: false })
  assert.equal(combined.res.statusCode, 403)
  assert.equal(combined.res.body.data, undefined)
  assert.equal(combined.client.calls.some((entry) => entry.table === 'nba_dvp_sg'), false)
  const forged = await call('nba_dvp_pf', 'forged-token')
  assert.equal(forged.res.statusCode, 403)
  assert.equal(forged.res.body.data, undefined)
  const flagError = await call('nba_dvp_sf', 'tok-fan', { flag: 'error' })
  assert.equal(flagError.res.statusCode, 403)
})

test('an auth timeout denies NBA instead of falling open to a preview', async () => {
  const prev = { ...timeouts }
  _setTimeouts({ snapshotReadMs: 40, tierLookupMs: 40 })
  try {
    const { res } = await call('nba_players', 'tok-owner', { hangAuth: true })
    assert.equal(res.statusCode, 403)
    assert.equal(res.body.data, undefined)
  } finally {
    _setTimeouts(prev)
  }
})

test('a flag timeout denies a paying subscriber and still allows the owner', async () => {
  const prev = { ...timeouts }
  _setTimeouts({ snapshotReadMs: 40, tierLookupMs: 40 })
  try {
    const fan = await call('nba_players', 'tok-fan', { flag: 'hang' })
    assert.equal(fan.res.statusCode, 403)
    const owner = await call('nba_players', 'tok-owner', { flag: 'hang' })
    assert.equal(owner.res.statusCode, 200)
    assert.equal(owner.res.body.data[0].name, 'Jaren Jackson Jr.')
  } finally {
    _setTimeouts(prev)
  }
})

test('non-NBA datasets still preview when the token is invalid', async () => {
  const res = mockRes()
  const client = {
    auth: {
      async getUser() {
        return { data: { user: null }, error: { message: 'invalid JWT' } }
      },
    },
    from(table) {
      const chain = {
        select() { return chain },
        eq() { return chain },
        async maybeSingle() {
          if (table === 'prizepicks_props') {
            return {
              data: {
                data: { cards: [{ props: [{ cg_projection: 1 }, { cg_projection: 2 }, { cg_projection: 3 }, { cg_projection: 4 }] }] },
                updated_at: '2026-10-06T00:00:00Z',
              },
              error: null,
            }
          }
          return { data: null, error: null }
        },
      }
      return chain
    },
  }
  await handleDataRequest(
    { method: 'GET', query: { ds: 'prizepicks_props' }, headers: { authorization: 'Bearer forged' } },
    res,
    client,
  )
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.preview, true)
  assert.deepEqual(Object.keys(res.body.access), ['kbo', 'wnba', 'nfl'])
  assert.deepEqual(res.body.access, { kbo: false, wnba: false, nfl: false })
})
