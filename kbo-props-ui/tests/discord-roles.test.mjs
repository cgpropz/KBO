// Discord role sync, OAuth state, and the admin backfill. No network.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DISCORD_GUILD_ID_DEFAULT,
  DISCORD_ROLE_DISCORD_ONLY_DEFAULT,
  DISCORD_ROLE_SITE_SUBSCRIBER_DEFAULT,
  discordAuthorizeUrl,
  discordConfig,
  entitlementsFor,
  isDiscordAdmin,
  nextMemberRoles,
  oauthStateForUser,
  syncMemberRoles,
  verifyOAuthState,
} from '../api/_discord.js'
import { handleDiscordCallback, handleDiscordDisconnect } from '../api/_discordSync.js'
import { handleDiscordBackfill } from '../api/_discordBackfill.js'
import { discordDisplayPrice, discordPlanCards } from '../src/pricingTiers.js'
import { DISCORD_INVITE_URL, discordInviteFromEnv, discordInviteUrl } from '../src/discordInvite.js'

const HAND = '888888888888888888'
const SITE = '111111111111111111'
const DISCORD = '222222222222222222'
const GUILD = '999999999999999999'
const MEMBER = '424242424242424242'

const CONFIG = {
  clientId: 'cid',
  clientSecret: 'state-secret',
  redirectUri: 'https://www.cgpropz.com/api/discord-callback',
  returnUrl: 'https://www.cgpropz.com/account',
  guildId: GUILD,
  botToken: 'bot-secret',
  siteRoleId: SITE,
  discordRoleId: DISCORD,
  oauthReady: true,
  botReady: true,
}

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    location: '',
    setHeader(k, v) { this.headers[k.toLowerCase()] = v },
    status(code) { this.statusCode = code; return this },
    json(obj) { this.body = obj; return this },
    end() {},
    writeHead(code, headers) {
      this.statusCode = code
      this.location = headers?.Location || ''
    },
  }
}

test('entitlements: site subscribers, discord-only, both, and lifetime', () => {
  assert.deepEqual(entitlementsFor({ tier: 'combined', discordOnly: false }), { siteSubscriber: true, discordOnly: false })
  assert.deepEqual(entitlementsFor({ tier: 'kbo', discordOnly: false }), { siteSubscriber: true, discordOnly: false })
  assert.deepEqual(entitlementsFor({ tier: 'owner', discordOnly: false }), { siteSubscriber: true, discordOnly: false })
  assert.deepEqual(entitlementsFor({ tier: 'discord', discordOnly: true }), { siteSubscriber: false, discordOnly: true })
  assert.deepEqual(entitlementsFor({ tier: 'combined', discordOnly: true }), { siteSubscriber: true, discordOnly: true })
  assert.deepEqual(entitlementsFor({ tier: 'free', discordOnly: false }), { siteSubscriber: false, discordOnly: false })
})

test('role sync keeps hand-assigned roles and only moves the two managed roles', () => {
  const current = [HAND, DISCORD, '333333333333333333']
  const both = nextMemberRoles(current, { siteSubscriber: true, discordOnly: true, siteRoleId: SITE, discordRoleId: DISCORD })
  assert.deepEqual(both, [HAND, '333333333333333333', SITE, DISCORD])

  const siteOnly = nextMemberRoles(current, { siteSubscriber: true, discordOnly: false, siteRoleId: SITE, discordRoleId: DISCORD })
  assert.deepEqual(siteOnly, [HAND, '333333333333333333', SITE])

  const none = nextMemberRoles(current, { siteSubscriber: false, discordOnly: false, siteRoleId: SITE, discordRoleId: DISCORD })
  assert.deepEqual(none, [HAND, '333333333333333333'])
})

test('syncMemberRoles patches only the managed roles', async () => {
  const calls = []
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET', body: options.body, authorization: options.headers?.Authorization })
    if ((options.method || 'GET') === 'GET') {
      return { ok: true, status: 200, async text() { return JSON.stringify({ roles: [HAND, DISCORD] }) } }
    }
    return { ok: true, status: 200, async text() { return '' } }
  }
  const result = await syncMemberRoles({
    discordUserId: MEMBER,
    entitlements: { siteSubscriber: true, discordOnly: false },
    config: CONFIG,
    fetchImpl,
  })
  assert.equal(result.ok, true)
  assert.equal(result.changed, true)
  assert.equal(calls[0].authorization, 'Bot bot-secret')
  const patched = JSON.parse(calls[1].body)
  assert.deepEqual(patched.roles, [HAND, SITE])
  assert.equal(patched.roles.includes(HAND), true)
  assert.equal(JSON.stringify(patched).includes('bot-secret'), false)
})

test('oauth state round-trips, expires, and rejects tampering', () => {
  const state = oauthStateForUser('user_123', 'state-secret', 1_000)
  assert.equal(verifyOAuthState(state, 'state-secret', 1_000).uid, 'user_123')
  assert.equal(verifyOAuthState(state, 'state-secret', 1_000 + 11 * 60 * 1000), null)
  assert.equal(verifyOAuthState(state, 'other-secret', 1_000), null)
  assert.equal(verifyOAuthState(`${state}x`, 'state-secret', 1_000), null)
  const url = new URL(discordAuthorizeUrl(CONFIG, state))
  assert.equal(url.searchParams.get('scope'), 'identify guilds.join')
  assert.equal(url.searchParams.get('redirect_uri'), CONFIG.redirectUri)
  assert.equal(url.searchParams.get('client_id'), 'cid')
})

test('callback with a bad state redirects to an error and does not call Discord', async () => {
  let called = false
  const res = mockRes()
  await handleDiscordCallback(
    { method: 'GET', query: { code: 'abc', state: 'not-signed' } },
    res,
    { config: CONFIG, fetchImpl: () => { called = true } },
  )
  assert.equal(called, false)
  assert.equal(res.statusCode, 302)
  assert.match(res.location, /discord=error/)
  assert.equal(res.location.includes('bot-secret'), false)
})

test('callback stores the discord id, joins the guild, and keeps hand-assigned roles', async () => {
  const updates = []
  const limits = [
    { data: [{ discord_user_id: null }], error: null },
    { data: [{ id: 'user_123' }], error: null },
    { data: [{ tier: 'combined', discord_only: true, discord_user_id: MEMBER }], error: null },
  ]
  const supabase = {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                neq: async () => ({ data: [], error: null }),
                limit: async () => limits.shift(),
              }
            },
          }
        },
        update(patch) {
          updates.push(patch)
          return { eq: async () => ({ error: null }) }
        },
      }
    },
  }
  const calls = []
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET', body: options.body })
    if (url.endsWith('/oauth2/token')) {
      return { ok: true, status: 200, async json() { return { access_token: 'user-access-token' } } }
    }
    if (url.endsWith('/users/@me')) {
      return { ok: true, status: 200, async text() { return JSON.stringify({ id: MEMBER, username: 'fan', global_name: 'Fan' }) } }
    }
    if ((options.method || 'GET') === 'PUT') return { ok: true, status: 201, async text() { return '{}' } }
    if ((options.method || 'GET') === 'GET') {
      return { ok: true, status: 200, async text() { return JSON.stringify({ roles: [HAND] }) } }
    }
    return { ok: true, status: 200, async text() { return '' } }
  }
  const res = mockRes()
  const state = oauthStateForUser('user_123', CONFIG.clientSecret)
  await handleDiscordCallback(
    { method: 'GET', query: { code: 'auth-code', state } },
    res,
    { config: CONFIG, supabase, fetchImpl },
  )
  assert.equal(res.statusCode, 302)
  assert.match(res.location, /discord=connected/)
  assert.equal(res.location.includes('user-access-token'), false)
  assert.deepEqual(updates[0], { discord_user_id: MEMBER, discord_username: 'Fan' })
  const put = calls.find((call) => call.method === 'PUT')
  assert.deepEqual(JSON.parse(put.body), { access_token: 'user-access-token' })
  const patch = calls.find((call) => call.method === 'PATCH')
  const roles = JSON.parse(patch.body).roles
  assert.equal(roles.includes(HAND), true)
  assert.equal(roles.includes(SITE), true)
  assert.equal(roles.includes(DISCORD), true)
})

test('disconnect removes managed roles, keeps hand-assigned roles, and unlinks', async () => {
  const updates = []
  const supabase = {
    from() {
      return {
        select() {
          return { eq() { return { limit: async () => ({ data: [{ discord_user_id: MEMBER }], error: null }) } } }
        },
        update(patch) {
          updates.push(patch)
          return { eq: async () => ({ error: null }) }
        },
      }
    },
  }
  const calls = []
  const fetchImpl = async (url, options = {}) => {
    calls.push({ method: options.method || 'GET', body: options.body })
    if ((options.method || 'GET') === 'GET') {
      return { ok: true, status: 200, async text() { return JSON.stringify({ roles: [HAND, SITE, DISCORD] }) } }
    }
    return { ok: true, status: 200, async text() { return '' } }
  }
  const res = mockRes()
  await handleDiscordDisconnect(
    { method: 'POST', headers: {} },
    res,
    { config: CONFIG, supabase, user: { id: 'user_123' }, fetchImpl },
  )
  assert.equal(res.statusCode, 200)
  assert.deepEqual(JSON.parse(calls.find((call) => call.method === 'PATCH').body).roles, [HAND])
  assert.deepEqual(updates[0], { discord_user_id: null, discord_username: null })
})

test('disconnect keeps the link when Discord refuses the role update', async () => {
  const updates = []
  const supabase = {
    from() {
      return {
        select() {
          return { eq() { return { limit: async () => ({ data: [{ discord_user_id: MEMBER }], error: null }) } } }
        },
        update(patch) {
          updates.push(patch)
          return { eq: async () => ({ error: null }) }
        },
      }
    },
  }
  const fetchImpl = async (url, options = {}) => {
    if ((options.method || 'GET') === 'GET') {
      return { ok: true, status: 200, async text() { return JSON.stringify({ roles: [SITE] }) } }
    }
    return { ok: false, status: 403, async text() { return JSON.stringify({ message: 'Missing Permissions' }) } }
  }
  const res = mockRes()
  await handleDiscordDisconnect(
    { method: 'POST', headers: {} },
    res,
    { config: CONFIG, supabase, user: { id: 'user_123' }, fetchImpl },
  )
  assert.equal(res.statusCode, 502)
  assert.equal(updates.length, 0)
})

test('backfill requires the admin secret and preserves hand-assigned roles', async () => {
  const open = await handleDiscordBackfill({ method: 'POST', headers: {} }, mockRes(), { env: {} })
  assert.equal(open.statusCode, 401)

  const wrong = mockRes()
  await handleDiscordBackfill(
    { method: 'POST', headers: { authorization: 'Bearer nope' } },
    wrong,
    { env: { DISCORD_ADMIN_SECRET: 'admin-secret' } },
  )
  assert.equal(wrong.statusCode, 401)
  assert.equal(isDiscordAdmin({ headers: { authorization: 'Bearer admin-secret' } }, { DISCORD_ADMIN_SECRET: 'admin-secret' }), true)

  const rows = [{ id: 'user_1', tier: 'combined', discord_only: false, discord_user_id: MEMBER }]
  const supabase = {
    from() {
      const api = {
        select() { return api },
        not() { return api },
        range: async () => ({ data: rows, error: null }),
      }
      return api
    },
  }
  const calls = []
  const fetchImpl = async (url, options = {}) => {
    calls.push({ method: options.method || 'GET', body: options.body })
    if ((options.method || 'GET') === 'GET') {
      return { ok: true, status: 200, async text() { return JSON.stringify({ roles: [HAND, DISCORD] }) } }
    }
    return { ok: true, status: 200, async text() { return '' } }
  }
  const res = mockRes()
  await handleDiscordBackfill(
    { method: 'POST', headers: { authorization: 'Bearer admin-secret' } },
    res,
    { env: { DISCORD_ADMIN_SECRET: 'admin-secret' }, supabase, config: CONFIG, fetchImpl },
  )
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.connected, 1)
  assert.equal(res.body.synced, 1)
  const roles = JSON.parse(calls.find((call) => call.method === 'PATCH').body).roles
  assert.deepEqual(roles, [HAND, SITE])
})

test('invite and discord server ids default to the live server, and prices default to the live amounts', () => {
  assert.equal(discordInviteUrl(''), '')
  assert.equal(discordInviteUrl('javascript:alert(1)'), '')
  assert.equal(discordInviteUrl('https://example.com/discord'), '')
  assert.equal(discordInviteUrl('https://discord.gg/greenland'), 'https://discord.gg/greenland')
  assert.equal(discordInviteFromEnv({}), DISCORD_INVITE_URL)
  assert.equal(discordInviteFromEnv({ VITE_DISCORD_INVITE_URL: 'https://discord.gg/override' }), 'https://discord.gg/override')
  assert.equal(discordInviteFromEnv({ VITE_DISCORD_INVITE_URL: 'javascript:alert(1)' }), DISCORD_INVITE_URL)
  assert.equal(DISCORD_INVITE_URL, 'https://discord.gg/w3wgbCcxDZ')

  const defaults = discordConfig({})
  assert.equal(defaults.guildId, '1175980588579164230')
  assert.equal(defaults.siteRoleId, '1558580149715337216')
  assert.equal(defaults.discordRoleId, '1558580317932224603')
  assert.equal(defaults.guildId, DISCORD_GUILD_ID_DEFAULT)
  assert.equal(defaults.siteRoleId, DISCORD_ROLE_SITE_SUBSCRIBER_DEFAULT)
  assert.equal(defaults.discordRoleId, DISCORD_ROLE_DISCORD_ONLY_DEFAULT)
  assert.equal(defaults.botToken, '')
  assert.equal(defaults.botReady, false)
  assert.equal(defaults.oauthReady, false)
  const override = discordConfig({
    DISCORD_GUILD_ID: '333333333333333333',
    DISCORD_ROLE_SITE_SUBSCRIBER: 'not-a-snowflake',
    DISCORD_ROLE_DISCORD_ONLY: '444444444444444444',
  })
  assert.equal(override.guildId, '333333333333333333')
  assert.equal(override.siteRoleId, DISCORD_ROLE_SITE_SUBSCRIBER_DEFAULT)
  assert.equal(override.discordRoleId, '444444444444444444')
  assert.equal(discordDisplayPrice(''), '')
  assert.equal(discordDisplayPrice('not a price'), '')
  assert.equal(discordDisplayPrice('4.99'), '$4.99')
  assert.equal(discordDisplayPrice('$12.00'), '$12.00')
  const cards = discordPlanCards({})
  assert.equal(cards[0].price, '$5.99')
  assert.equal(cards[0].period, '/ week')
  assert.equal(cards[1].price, '$19.99')
  assert.equal(cards[1].period, '/ month')
  const priceOverride = discordPlanCards({ VITE_DISCORD_WEEKLY_PRICE: '$4.00', VITE_DISCORD_MONTHLY_PRICE: 'nope' })
  assert.equal(priceOverride[0].price, '$4.00')
  assert.equal(priceOverride[1].price, '$19.99')
})
