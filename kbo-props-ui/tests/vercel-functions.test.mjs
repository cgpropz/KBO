// Hobby plan: more than 12 Serverless Functions fails the production deploy.
// Public URLs are rewrites onto shared functions and must stay ahead of the
// SPA catch-all. Destinations have no query string, so OAuth code/state and
// checkout session_id are kept.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { handleDiscordCallback } from '../api/_discordSync.js'
import { handleDiscordCheckoutRequest } from '../api/_discordCheckout.js'
import { handleNbaAccessRequest } from '../api/_nbaAccess.js'
import { handleNhlAccessRequest } from '../api/_nhlAccess.js'
import { handleCheckoutSessionRequest } from '../api/_checkoutSession.js'
import { handleWeeklyCheckoutRequest } from '../api/_weeklyCheckout.js'
import discordHandler, { DISCORD_ACTIONS } from '../api/discord/[action].js'
import leagueHandler, { LEAGUE_ACCESS } from '../api/league-access/[league].js'
import checkoutHandler, { CHECKOUT_ACTIONS } from '../api/checkout/[action].js'
import { routeParam } from '../api/_routeKey.js'
import { HOBBY_FUNCTION_LIMIT, serverlessFunctionFiles } from '../scripts/check-function-limit.mjs'

const uiRoot = fileURLToPath(new URL('..', import.meta.url))

const PUBLIC_ROUTES = [
  ['/api/discord-auth', '/api/discord/auth'],
  ['/api/discord-callback', '/api/discord/callback'],
  ['/api/discord-checkout', '/api/discord/checkout'],
  ['/api/discord-disconnect', '/api/discord/disconnect'],
  ['/api/discord-backfill', '/api/discord/backfill'],
  ['/api/nba-access', '/api/league-access/nba'],
  ['/api/nhl-access', '/api/league-access/nhl'],
  ['/api/checkout-session', '/api/checkout/session'],
  ['/api/weekly-checkout', '/api/checkout/weekly'],
]

test('serverless function files stay within the Vercel Hobby limit', () => {
  const files = serverlessFunctionFiles(join(uiRoot, 'api'))
  assert.ok(files.length <= HOBBY_FUNCTION_LIMIT, files.join('\n'))
  assert.equal(files.length, 11)
  assert.equal(files.some((file) => file.endsWith('discord-callback.js')), false)
  assert.equal(files.some((file) => file.endsWith('nba-access.js')), false)
  assert.equal(files.some((file) => file.endsWith('weekly-checkout.js')), false)
})

test('public api urls rewrite before the SPA catch-all and keep their query string', () => {
  const config = JSON.parse(readFileSync(join(uiRoot, 'vercel.json'), 'utf8'))
  const rewrites = config.rewrites
  const generic = rewrites.findIndex((rule) => rule.source === '/api/(.*)')
  const spa = rewrites.findIndex((rule) => rule.destination === '/index.html')
  assert.ok(generic > 0)
  assert.ok(spa > generic)
  assert.match(rewrites[spa].source, /\(\?!api\//)
  for (const [source, destination] of PUBLIC_ROUTES) {
    const index = rewrites.findIndex((rule) => rule.source === source)
    assert.ok(index >= 0, source)
    assert.ok(index < generic, `${source} is swallowed by /api/(.*)`)
    assert.equal(rewrites[index].destination, destination)
    assert.equal(destination.includes('?'), false)
  }
  assert.equal(
    rewrites.find((rule) => rule.source === '/api/discord-callback').destination,
    '/api/discord/callback',
  )
})

function mockRes() {
  return {
    statusCode: 200,
    body: undefined,
    setHeader() {},
    status(code) { this.statusCode = code; return this },
    json(obj) { this.body = obj; return this },
  }
}

test('oauth callback still resolves when the public path is what the function sees', () => {
  assert.equal(routeParam(
    { query: { code: 'abc', state: 'signed' }, url: '/api/discord-callback?code=abc&state=signed' },
    { param: 'action', aliases: { 'discord-callback': 'callback' } },
  ), 'callback')
  assert.equal(routeParam(
    { query: { action: 'callback', code: 'abc', state: 'signed' }, url: '/api/discord/callback?code=abc&state=signed' },
    { param: 'action', aliases: { 'discord-callback': 'callback' } },
  ), 'callback')
  assert.equal(routeParam(
    { query: { session_id: 'cs_live_abcdefghij' }, url: '/api/checkout-session?session_id=cs_live_abcdefghij' },
    { param: 'action', aliases: { 'checkout-session': 'session' } },
  ), 'session')
})

test('dispatchers keep the existing handlers and reject an unknown action', async () => {
  assert.equal(DISCORD_ACTIONS.callback, handleDiscordCallback)
  assert.equal(DISCORD_ACTIONS.checkout, handleDiscordCheckoutRequest)
  assert.equal(LEAGUE_ACCESS.nba, handleNbaAccessRequest)
  assert.equal(LEAGUE_ACCESS.nhl, handleNhlAccessRequest)
  assert.equal(CHECKOUT_ACTIONS.session, handleCheckoutSessionRequest)
  assert.equal(CHECKOUT_ACTIONS.weekly, handleWeeklyCheckoutRequest)

  const missing = mockRes()
  await discordHandler({ query: { action: 'nope' }, method: 'GET' }, missing)
  assert.equal(missing.statusCode, 404)

  const league = mockRes()
  await leagueHandler({ query: {}, method: 'GET' }, league)
  assert.equal(league.statusCode, 404)

  const checkout = mockRes()
  await checkoutHandler({ query: { action: 'lifetime' }, method: 'POST' }, checkout)
  assert.equal(checkout.statusCode, 404)
})
