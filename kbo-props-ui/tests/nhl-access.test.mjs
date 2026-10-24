// NHL follows the same All-Access entitlement as KBO, WNBA, and NFL.
import assert from 'node:assert/strict'
import { test, beforeEach } from 'node:test'
import {
  nhlAccessDecision,
  shapeForTier,
  sportAccess as serverAccess,
} from '../api/_dataAccess.js'
import { handleDataRequest, _clearCache } from '../api/data.js'
import { handleNhlAccessRequest } from '../api/_nhlAccess.js'
import {
  DISCORD_MONTHLY_PRICE_ID,
  DISCORD_WEEKLY_PRICE_ID,
  TIER_BY_PRICE,
  tierForPrice,
} from '../api/_stripeTier.js'
import { devTierOverride, landingSportOpens, nhlDevBypass, sportAccess as clientAccess } from '../src/entitlements.js'
import { bearerFor, installJwtSecret } from './access-token.mjs'

installJwtSecret()

const ALL_ACCESS_PRICE_IDS = {
  'price_1TtFErPwL0k9PEMvIrEJajK1': 'weekly',
  'price_1TtFFePwL0k9PEMvPJUUwuTr': 'monthly',
  'price_1THZjaPwL0k9PEMvARtuGG1F': 'lifetime',
}

beforeEach(() => _clearCache())

test('NHL is live for every visitor, and All-Access includes it beside NFL', () => {
  assert.deepEqual(Object.keys(serverAccess('owner')), ['kbo', 'wnba', 'nfl', 'nhl'])
  assert.deepEqual(Object.keys(clientAccess('free')), ['kbo', 'wnba', 'nfl', 'nhl'])
  assert.equal(serverAccess('combined').nhl, clientAccess('combined').nhl)
  assert.equal(landingSportOpens('kbo', false), true)
  assert.equal(landingSportOpens('nhl', false, false), true)
  assert.equal(landingSportOpens('nba', false, true), false)
  assert.equal(landingSportOpens('nba', true, false), true)
})

test('the dev screenshot query cannot open a production build', () => {
  assert.equal(nhlDevBypass(false, '?nhl=1'), false)
  assert.equal(nhlDevBypass(true, '?nhl=1'), true)
  assert.equal(nhlDevBypass(true, ''), false)
  assert.equal(devTierOverride(false, '?previewTier=combined'), null)
  assert.equal(devTierOverride(true, '?previewTier=combined'), 'combined')
  assert.equal(devTierOverride(true, '?previewTier=discord'), 'discord')
  assert.equal(devTierOverride(true, '?previewTier=nope'), null)
})

test('All-Access tiers and the admin email get full NHL; Discord and free get a preview', () => {
  assert.equal(nhlAccessDecision({
    emailResolved: true, email: 'cgpropz@gmail.com', tierResolved: true, tier: 'free',
  }), 'full')
  assert.equal(nhlAccessDecision({
    emailResolved: true, email: '  CGPropz@gmail.com ', tierResolved: false, tier: 'free',
  }), 'full')
  for (const tier of ['combined', 'owner', 'pro', 'monthly', 'weekly', 'season', 'all']) {
    assert.equal(nhlAccessDecision({
      emailResolved: true, email: 'fan@example.com', tierResolved: true, tier,
    }), 'full', tier)
    assert.equal(serverAccess(tier).nhl, true, tier)
    assert.equal(clientAccess(tier).nhl, true, tier)
  }
  for (const tier of ['free', 'discord', 'kbo', 'wnba', 'lifetime']) {
    assert.equal(nhlAccessDecision({
      emailResolved: true, email: 'fan@example.com', tierResolved: true, tier,
    }), 'preview', tier)
    assert.equal(serverAccess(tier).nhl, false, tier)
  }
  assert.equal(nhlAccessDecision({
    emailResolved: false, email: 'cgpropz@gmail.com', tierResolved: true, tier: 'owner',
  }), 'preview')
  assert.equal(nhlAccessDecision({
    emailResolved: true, email: 'fan@example.com', tierResolved: false, tier: 'combined',
  }), 'preview')
  assert.equal(nhlAccessDecision({
    emailResolved: true, email: null, tierResolved: true, tier: 'free',
  }), 'preview')
})

test('live All-Access price ids include NHL and Discord Only prices do not', () => {
  for (const [priceId, label] of Object.entries(ALL_ACCESS_PRICE_IDS)) {
    assert.equal(TIER_BY_PRICE[priceId], 'combined', label)
    assert.equal(serverAccess(tierForPrice(priceId)).nhl, true, label)
  }
  assert.equal(tierForPrice(DISCORD_WEEKLY_PRICE_ID), 'discord')
  assert.equal(tierForPrice(DISCORD_MONTHLY_PRICE_ID), 'discord')
  assert.equal(serverAccess(tierForPrice(DISCORD_WEEKLY_PRICE_ID)).nhl, false)
  assert.equal(serverAccess(tierForPrice(DISCORD_MONTHLY_PRICE_ID)).nhl, false)
  assert.equal(serverAccess(tierForPrice('price_1THCokPwL0k9PEMvcWwT7F2c')).nhl, false)
  assert.equal(serverAccess(tierForPrice('price_1TtFEPPwL0k9PEMvc8kcK6Ut')).nhl, false)
})

test('an unconfirmed goalie is not one of the free top rows', () => {
  const payload = [
    { player: 'Probable Goalie', projection: 30, line: 20, rankEligible: false, oddsType: 'standard' },
    { player: 'Skater A', projection: 4, line: 2.5, rankEligible: true, oddsType: 'standard' },
    { player: 'Skater B', projection: 3, line: 2.5, rankEligible: true, oddsType: 'standard' },
    { player: 'Skater C', projection: 2, line: 2.5, rankEligible: true, oddsType: 'standard' },
    { player: 'Skater D', projection: 1, line: 2.5, rankEligible: true, oddsType: 'standard' },
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

const PROJECTION_ROWS = [
  { player: 'Mikko Rantanen', projection: 3.2, line: 2.5, rankEligible: true, oddsType: 'standard' },
  { player: 'Skater B', projection: 3, line: 2.5, rankEligible: true, oddsType: 'standard' },
  { player: 'Skater C', projection: 2, line: 2.5, rankEligible: true, oddsType: 'standard' },
  { player: 'Skater D', projection: 1, line: 2.5, rankEligible: true, oddsType: 'standard' },
  { player: 'Goblin Skater', projection: 9, line: 0.5, rankEligible: true, oddsType: 'goblin' },
  { player: 'Demon Skater', projection: 8, line: 0.5, rankEligible: true, oddsType: 'demon' },
]

function mockClient({ flag = false } = {}) {
  const users = {
    'tok-owner': { id: 'u-owner', email: 'CGPropz@gmail.com' },
    'tok-fan': { id: 'u-fan', email: 'fan@example.com' },
    'tok-member': { id: 'u-member', email: 'member@example.com' },
    'tok-weekly': { id: 'u-weekly', email: 'weekly@example.com' },
    'tok-monthly': { id: 'u-monthly', email: 'monthly@example.com' },
    'tok-discord': { id: 'u-discord', email: 'discord@example.com' },
    'tok-kbo': { id: 'u-kbo', email: 'kbo@example.com' },
  }
  const profiles = {
    'u-owner': 'free',
    'u-fan': 'combined',
    'u-member': 'owner',
    'u-weekly': 'weekly',
    'u-monthly': 'monthly',
    'u-discord': 'discord',
    'u-kbo': 'kbo',
  }
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
          if (table === 'nhl_projections' || table === 'nhl_lineups') {
            return Promise.resolve({
              data: { data: PROJECTION_ROWS, updated_at: '2026-10-09T00:00:00Z' },
              error: null,
            })
          }
          if (table === 'nhl_dvp_f') {
            return Promise.resolve({
              data: {
                data: { position: 'F', windows: { blend: { stats: { sog: { teams: [{ team: 'TOR', rank: 32 }] } } } } },
                updated_at: '2026-10-10T00:00:00Z',
              },
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

test('All-Access and the admin read full NHL data; Discord, legacy, and logged-out get the preview', async () => {
  const client = mockClient({ flag: true })
  for (const token of ['tok-owner', 'tok-fan', 'tok-member', 'tok-weekly', 'tok-monthly']) {
    const res = mockRes()
    await handleDataRequest(
      { method: 'GET', query: { ds: 'nhl_projections' }, headers: { authorization: `Bearer ${bearerFor(token)}` } },
      res,
      client,
    )
    assert.equal(res.statusCode, 200, token)
    assert.equal(res.body.preview, false, token)
    assert.equal(res.body.lockedCount, 0, token)
    assert.equal(res.body.data.length, 6, token)
    assert.equal(res.body.data.some((row) => row.player === 'Goblin Skater'), true, token)
    assert.equal(res.body.data.some((row) => row.player === 'Demon Skater'), true, token)
    assert.equal(res.body.access.nhl, token === 'tok-owner' ? false : true, token)
  }

  for (const token of ['tok-discord', 'tok-kbo', 'tok-nope']) {
    const preview = mockRes()
    await handleDataRequest(
      { method: 'GET', query: { ds: 'nhl_projections' }, headers: { authorization: `Bearer ${bearerFor(token)}` } },
      preview,
      client,
    )
    assert.equal(preview.statusCode, 200, token)
    assert.equal(preview.body.preview, true, token)
    assert.equal(preview.body.data.length, 3, token)
    assert.equal(preview.body.lockedCount, 3, token)
    assert.deepEqual(preview.body.data.map((row) => row.player), ['Goblin Skater', 'Demon Skater', 'Mikko Rantanen'], token)
    assert.equal(preview.body.access.nhl, false, token)
  }

  const anon = mockRes()
  await handleDataRequest(
    { method: 'GET', query: { ds: 'nhl_lineups' }, headers: {} },
    anon,
    client,
  )
  assert.equal(anon.statusCode, 200)
  assert.equal(anon.body.preview, true)
  assert.equal(anon.body.data.length, 3)

  for (const token of ['tok-owner', 'tok-fan', 'tok-weekly', 'tok-monthly']) {
    const open = mockRes()
    await handleNhlAccessRequest(
      { method: 'GET', headers: { authorization: `Bearer ${bearerFor(token)}` } },
      open,
      client,
    )
    assert.deepEqual(open.body, { open: true }, token)
  }

  for (const token of ['tok-discord', 'tok-kbo']) {
    const closed = mockRes()
    await handleNhlAccessRequest(
      { method: 'GET', headers: { authorization: `Bearer ${bearerFor(token)}` } },
      closed,
      client,
    )
    assert.deepEqual(closed.body, { open: false }, token)
  }

  const loggedOut = mockRes()
  await handleNhlAccessRequest({ method: 'GET', headers: {} }, loggedOut, client)
  assert.deepEqual(loggedOut.body, { open: false })
})

test('NHL defense vs position follows the same All-Access gate', async () => {
  const client = mockClient()
  const res = mockRes()
  await handleDataRequest(
    { method: 'GET', query: { ds: 'nhl_dvp_f' }, headers: { authorization: `Bearer ${bearerFor('tok-fan')}` } },
    res,
    client,
  )
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.preview, false)
  assert.equal(res.body.data.windows.blend.stats.sog.teams[0].team, 'TOR')
  assert.equal(res.body.data.windows.blend.stats.sog.teams[0].rank, 32)

  const discord = mockRes()
  await handleDataRequest(
    { method: 'GET', query: { ds: 'nhl_dvp_f' }, headers: { authorization: `Bearer ${bearerFor('tok-discord')}` } },
    discord,
    client,
  )
  assert.equal(discord.statusCode, 200)
  assert.equal(discord.body.preview, true)
  assert.equal(discord.body.data.windows.blend.stats.sog.teams[0].team, 'TOR')

  const anon = mockRes()
  await handleDataRequest(
    { method: 'GET', query: { ds: 'nhl_dvp_d' }, headers: {} },
    anon,
    client,
  )
  assert.equal(anon.statusCode, 404)

  const missing = mockRes()
  await handleDataRequest(
    { method: 'GET', query: { ds: 'nhl_dvp_g' }, headers: { authorization: `Bearer ${bearerFor('tok-owner')}` } },
    missing,
    client,
  )
  assert.equal(missing.statusCode, 404)
})
