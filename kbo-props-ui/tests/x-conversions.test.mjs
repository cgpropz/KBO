// Unit tests for the optional server-side X Conversions API reporter
// (api/_xConversions.js). fetch is mocked; no network, no credentials.
// Run: npm run test:api
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  xConversionsConfig, hashEmail, oauth1Header, buildPurchaseConversion, reportPurchaseToX, X_ADS_API_BASE,
} from '../api/_xConversions.js'

const OAUTH_ENV = {
  X_PIXEL_ID: 'pixel1',
  X_PURCHASE_EVENT_ID: 'tw-pixel1-evt1',
  X_ADS_CONSUMER_KEY: 'ck',
  X_ADS_CONSUMER_SECRET: 'cs',
  X_ADS_ACCESS_TOKEN: 'at',
  X_ADS_ACCESS_TOKEN_SECRET: 'ats',
}

function paidSession(overrides = {}) {
  return {
    id: 'cs_live_abc1234567890',
    payment_status: 'paid',
    status: 'complete',
    amount_total: 2999,
    currency: 'usd',
    customer_details: { email: '  Buyer@Example.COM ' },
    ...overrides,
  }
}

function mockFetch(status = 200, body = '{"data":{"conversions_processed":1}}') {
  const calls = []
  const fn = async (url, init) => {
    calls.push({ url, init })
    return { ok: status >= 200 && status < 300, status, text: async () => body }
  }
  fn.calls = calls
  return fn
}

test('hashEmail matches X\'s documented example and normalizes case/whitespace', () => {
  // X's docs show this digest for their sample address; it is the unsalted
  // SHA-256 of 'test@twitter.com' (the page text was later renamed to x.com).
  const expected = 'd360d510a224510f373931ce2d6215a799f5a9c1cef221b0149b6b6b50cced62'
  assert.equal(hashEmail('test@twitter.com'), expected)
  assert.equal(hashEmail('  TEST@Twitter.com '), expected)
  assert.equal(hashEmail(''), null)
  assert.equal(hashEmail(null), null)
})

test('OAuth 1.0a signature matches X\'s published signing example', () => {
  // Public sample values from X's OAuth 1.0a docs (not real credentials):
  // https://docs.x.com/resources/fundamentals/authentication/oauth-1-0a/creating-a-signature
  const header = oauth1Header({
    method: 'POST',
    url: 'https://api.twitter.com/1.1/statuses/update.json',
    consumerKey: 'xvz1evFS4wEEPTGEFPHBog',
    consumerSecret: 'kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw',
    token: '370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb',
    tokenSecret: 'LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE',
    params: { include_entities: 'true', status: 'Hello Ladies + Gentlemen, a signed OAuth request!' },
    nonce: 'kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg',
    timestamp: 1318622958,
  })
  assert.match(header, /^OAuth /)
  assert.ok(header.includes(`oauth_signature="${encodeURIComponent('hCtSmYh+iHYCEqBWrE7C7hYmtUk=')}"`), header)
})

test('config is null (no-op) unless pixel, event and credentials are all set', () => {
  assert.equal(xConversionsConfig({}), null)
  assert.equal(xConversionsConfig({ X_PIXEL_ID: 'p', X_PURCHASE_EVENT_ID: 'e' }), null)
  assert.equal(xConversionsConfig({ ...OAUTH_ENV, X_ADS_ACCESS_TOKEN_SECRET: '' }), null)
  assert.equal(xConversionsConfig({ ...OAUTH_ENV, X_PIXEL_ID: '' }), null)
  assert.equal(xConversionsConfig(OAUTH_ENV).auth, 'oauth1')
  assert.equal(xConversionsConfig({ X_PIXEL_ID: 'p', X_PURCHASE_EVENT_ID: 'e', X_CAPI_PIXEL_TOKEN: 't' }).auth, 'pixel_token')
  assert.equal(xConversionsConfig({ ...OAUTH_ENV, X_CAPI_PIXEL_TOKEN: 't' }).auth, 'oauth1')
})

test('builds a purchase with plan value, session id as conversion_id and hashed email only', () => {
  const c = buildPurchaseConversion(paidSession(), { eventId: 'tw-pixel1-evt1', conversionTime: Date.UTC(2026, 8, 28, 12) })
  assert.equal(c.event_id, 'tw-pixel1-evt1')
  assert.equal(c.conversion_id, 'cs_live_abc1234567890')
  assert.equal(c.value, '29.99')
  assert.equal(c.price_currency, 'USD')
  assert.equal(c.conversion_time, '2026-09-28T12:00:00.000Z')
  assert.deepEqual(c.identifiers, [{ hashed_email: hashEmail('buyer@example.com') }])
  assert.equal(c.contents[0].content_id, 'monthly')
  assert.ok(!JSON.stringify(c).toLowerCase().includes('buyer@example.com'))

  assert.equal(buildPurchaseConversion(paidSession({ amount_total: 999 }), { eventId: 'e' }).value, '9.99')
  assert.equal(buildPurchaseConversion(paidSession({ amount_total: 999 }), { eventId: 'e' }).contents[0].content_id, 'weekly')
  assert.equal(buildPurchaseConversion(paidSession({ amount_total: 9999 }), { eventId: 'e' }).value, '99.99')
  assert.equal(buildPurchaseConversion(paidSession({ amount_total: 499 }), { eventId: 'e' }).value, '4.99')
  assert.equal(buildPurchaseConversion(paidSession({ amount_total: 499 }), { eventId: 'e' }).contents[0].content_id, 'weekly')
  assert.equal(
    buildPurchaseConversion(paidSession({ amount_total: 539, metadata: { cg_plan: 'weekly' } }), { eventId: 'e' }).contents[0].content_id,
    'weekly',
  )
})

test('unpaid, $0 or email-less sessions are not reported', () => {
  assert.equal(buildPurchaseConversion(paidSession({ payment_status: 'unpaid' }), { eventId: 'e' }), null)
  assert.equal(buildPurchaseConversion(paidSession({ amount_total: 0 }), { eventId: 'e' }), null)
  assert.equal(buildPurchaseConversion(paidSession({ customer_details: {} }), { eventId: 'e' }), null)
})

test('no-op without env vars: fetch is never called', async () => {
  const fetchImpl = mockFetch()
  const r = await reportPurchaseToX(paidSession(), { env: {}, fetchImpl })
  assert.deepEqual(r, { sent: false, reason: 'not_configured' })
  assert.equal(fetchImpl.calls.length, 0)
})

test('posts to the pixel conversions endpoint with OAuth 1.0a', async () => {
  const fetchImpl = mockFetch()
  const r = await reportPurchaseToX(paidSession(), { env: OAUTH_ENV, fetchImpl })
  assert.equal(r.sent, true)
  assert.equal(fetchImpl.calls.length, 1)
  const { url, init } = fetchImpl.calls[0]
  assert.equal(url, `${X_ADS_API_BASE}/measurement/conversions/pixel1`)
  assert.equal(url, 'https://ads-api.x.com/12/measurement/conversions/pixel1')
  assert.equal(init.method, 'POST')
  assert.match(init.headers.Authorization, /^OAuth .*oauth_consumer_key="ck".*oauth_signature="[^"]+".*oauth_token="at"/)
  const body = JSON.parse(init.body)
  assert.equal(body.conversions.length, 1)
  assert.equal(body.conversions[0].conversion_id, 'cs_live_abc1234567890')
  assert.equal(body.conversions[0].event_id, 'tw-pixel1-evt1')
})

test('uses X-Pixel-Token header when only the Events Manager token is set', async () => {
  const fetchImpl = mockFetch()
  await reportPurchaseToX(paidSession(), { env: { X_PIXEL_ID: 'p', X_PURCHASE_EVENT_ID: 'e', X_CAPI_PIXEL_TOKEN: 'tok' }, fetchImpl })
  assert.equal(fetchImpl.calls[0].init.headers['X-Pixel-Token'], 'tok')
  assert.equal(fetchImpl.calls[0].init.headers.Authorization, undefined)
})

test('never throws when X errors or the network fails', async () => {
  const original = console.error
  console.error = () => {}
  try {
    const bad = await reportPurchaseToX(paidSession(), { env: OAUTH_ENV, fetchImpl: mockFetch(401, '{"errors":[{"code":"UNAUTHORIZED_ACCESS"}]}') })
    assert.deepEqual(bad, { sent: false, reason: 'http_error', status: 401 })
    const thrown = await reportPurchaseToX(paidSession(), { env: OAUTH_ENV, fetchImpl: async () => { throw new Error('ECONNRESET') } })
    assert.deepEqual(thrown, { sent: false, reason: 'exception' })
  } finally {
    console.error = original
  }
})
