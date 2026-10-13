// Pause-for-a-week: Stripe test mode only, HMAC email links, cancel unchanged.
// No network and no real Stripe keys.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { handleMembershipRequest } from '../api/cancel-subscription.js'
import {
  createPauseLink,
  pauseCollectionParams,
  signPauseLink,
  stripeSecretMode,
  verifyPauseLink,
} from '../api/_pauseSubscription.js'
import { PAUSE_COLLECTION_BEHAVIOR, PAUSE_LINK_TTL_SECONDS, PAUSE_WEEK_SECONDS } from '../src/pauseWindow.js'
import { renderPoliciesPage } from '../scripts/publicPages.mjs'

const NOW = 1_700_000_000_000
const SECRET = 'test-pause-link-secret'
const USER_ID = 'user_member_1'
const EMAIL = 'member@example.com'

function mockRes() {
  return {
    statusCode: 200,
    body: undefined,
    setHeader() {},
    status(code) { this.statusCode = code; return this },
    json(obj) { this.body = obj; return this },
    end(msg) { this.body = msg; return this },
  }
}

function userSupabase(user = { id: USER_ID, email: EMAIL }) {
  return {
    auth: {
      async getUser(token) {
        if (token !== 'session-token') return { data: { user: null }, error: new Error('bad') }
        return { data: { user }, error: null }
      },
    },
  }
}

function stripeWith(subs, { customers = [{ id: 'cus_1', email: EMAIL }] } = {}) {
  const calls = []
  return {
    calls,
    customers: {
      async list() { return { data: customers } },
      async search() { return { data: [] } },
    },
    subscriptions: {
      async list() { return { data: subs } },
      async update(id, params) {
        calls.push({ id, params })
        return {
          id,
          cancel_at_period_end: params.cancel_at_period_end === true,
          current_period_end: 1_800_000_000,
          pause_collection: params.pause_collection || null,
        }
      },
    },
  }
}

function post(body, { authorization = 'Bearer session-token', env, stripe, supabase } = {}) {
  const req = {
    method: 'POST',
    headers: { authorization },
    body,
  }
  const res = mockRes()
  const deps = {
    env: {
      STRIPE_SECRET_KEY: 'sk_test_pause_unit',
      PAUSE_LINK_SECRET: SECRET,
      ...env,
    },
    stripe,
    supabase: supabase || userSupabase(),
    now: () => NOW,
  }
  return handleMembershipRequest(req, res, deps).then(() => ({ res, stripe }))
}

test('stripe secret mode distinguishes test keys from live keys', () => {
  assert.equal(stripeSecretMode('sk_test_abc'), 'test')
  assert.equal(stripeSecretMode('rk_test_abc'), 'test')
  assert.equal(stripeSecretMode('sk_live_abc'), 'live')
  assert.equal(stripeSecretMode('rk_live_abc'), 'live')
  assert.equal(stripeSecretMode(''), 'invalid')
  assert.equal(stripeSecretMode('sk_test_abc\\n'), 'test')
})

test('pause collection voids the skipped week and resumes 7 days later', () => {
  const params = pauseCollectionParams(NOW)
  assert.equal(params.behavior, PAUSE_COLLECTION_BEHAVIOR)
  assert.equal(params.behavior, 'void')
  assert.equal(params.resumes_at, Math.floor(NOW / 1000) + PAUSE_WEEK_SECONDS)
  assert.equal(PAUSE_WEEK_SECONDS, 7 * 24 * 60 * 60)
})

test('pause links are HMAC signed, expire, and bind a member id', () => {
  const { url, token, exp } = createPauseLink({
    userId: USER_ID,
    secret: SECRET,
    origin: 'https://www.cgpropz.com/',
    now: NOW,
  })
  assert.equal(exp, Math.floor(NOW / 1000) + PAUSE_LINK_TTL_SECONDS)
  const parsed = new URL(url)
  assert.equal(parsed.origin + parsed.pathname, 'https://www.cgpropz.com/')
  assert.equal(parsed.searchParams.get('pause'), token)
  assert.deepEqual(verifyPauseLink(token, { secret: SECRET, now: NOW + 1000 }), {
    ok: true,
    userId: USER_ID,
    exp,
  })
  assert.equal(verifyPauseLink(token, { secret: SECRET, now: exp * 1000 }).reason, 'expired')
  assert.equal(verifyPauseLink(token, { secret: 'other-secret', now: NOW }).reason, 'bad_signature')
  const [payload, sig] = token.split('.')
  assert.equal(verifyPauseLink(`${payload}.${sig.slice(0, -1)}x`, { secret: SECRET, now: NOW }).reason, 'bad_signature')
  assert.equal(verifyPauseLink('not-a-token', { secret: SECRET, now: NOW }).reason, 'malformed')
  assert.equal(verifyPauseLink(token, { secret: '', now: NOW }).reason, 'missing_secret')
  assert.throws(() => signPauseLink({ userId: '', secret: SECRET }))
})

test('a signed pause link pauses only when the logged-in member matches', async () => {
  const { token } = createPauseLink({ userId: USER_ID, secret: SECRET, now: NOW })
  const stripe = stripeWith([{ id: 'sub_week', status: 'active', pause_collection: null }])
  const { res } = await post({ action: 'pause', token }, { stripe })
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.access, 'kept')
  assert.equal(res.body.paused, true)
  assert.equal(res.body.resumes_at, new Date((Math.floor(NOW / 1000) + PAUSE_WEEK_SECONDS) * 1000).toISOString())
  assert.deepEqual(stripe.calls, [{
    id: 'sub_week',
    params: {
      pause_collection: {
        behavior: 'void',
        resumes_at: Math.floor(NOW / 1000) + PAUSE_WEEK_SECONDS,
      },
    },
  }])
})

test('a pause link for a different member does not call Stripe', async () => {
  const { token } = createPauseLink({ userId: 'someone_else', secret: SECRET, now: NOW })
  const stripe = stripeWith([{ id: 'sub_week', status: 'active' }])
  let constructed = false
  const res = mockRes()
  await handleMembershipRequest({
    method: 'POST',
    headers: { authorization: 'Bearer session-token' },
    body: { action: 'pause', token },
  }, res, {
    env: { STRIPE_SECRET_KEY: 'sk_test_pause_unit', PAUSE_LINK_SECRET: SECRET },
    supabase: userSupabase(),
    getStripe() { constructed = true; return stripe },
    now: () => NOW,
  })
  assert.equal(res.statusCode, 403)
  assert.equal(res.body.error, 'This pause link belongs to a different member.')
  assert.equal(constructed, false)
  assert.equal(stripe.calls.length, 0)
})

test('an in-app pause without a link still requires the session and uses void', async () => {
  const stripe = stripeWith([{ id: 'sub_month', status: 'active', pause_collection: null }])
  const { res } = await post({ action: 'pause' }, { stripe })
  assert.equal(res.statusCode, 200)
  assert.equal(stripe.calls[0].params.pause_collection.behavior, 'void')
  assert.equal(res.body.access, 'kept')
})

test('pause refuses a live key before constructing a Stripe client', async () => {
  let constructed = false
  const res = mockRes()
  await handleMembershipRequest({
    method: 'POST',
    headers: { authorization: 'Bearer session-token' },
    body: { action: 'pause' },
  }, res, {
    env: { STRIPE_SECRET_KEY: 'sk_live_do_not_use', PAUSE_LINK_SECRET: SECRET },
    supabase: userSupabase(),
    getStripe() { constructed = true; throw new Error('live client') },
    now: () => NOW,
  })
  assert.equal(res.statusCode, 403)
  assert.match(res.body.error, /test mode/)
  assert.equal(constructed, false)
})

test('pause refuses an expired link and a missing session', async () => {
  const { token } = createPauseLink({ userId: USER_ID, secret: SECRET, now: NOW - (PAUSE_LINK_TTL_SECONDS + 5) * 1000 })
  const stripe = stripeWith([{ id: 'sub_week', status: 'active' }])
  const expired = await post({ action: 'pause', token }, { stripe })
  assert.equal(expired.res.statusCode, 400)
  assert.match(expired.res.body.error, /expired/)
  assert.equal(stripe.calls.length, 0)

  const missing = await post({ action: 'pause' }, { stripe, authorization: '' })
  assert.equal(missing.res.statusCode, 401)
})

test('an already paused subscription keeps its resume time', async () => {
  const existing = Math.floor(NOW / 1000) + 2 * 24 * 60 * 60
  const stripe = stripeWith([{
    id: 'sub_week',
    status: 'active',
    pause_collection: { behavior: 'void', resumes_at: existing },
  }])
  const { res } = await post({ action: 'pause' }, { stripe })
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.resumes_at, new Date(existing * 1000).toISOString())
  assert.equal(stripe.calls.length, 0)
})

test('status reports a future pause and ignores one that already resumed', async () => {
  const future = Math.floor(NOW / 1000) + 3600
  const paused = stripeWith([{
    id: 'sub_week',
    status: 'active',
    pause_collection: { behavior: 'void', resumes_at: future },
  }])
  const open = await post({ action: 'status' }, { stripe: paused })
  assert.equal(open.res.statusCode, 200)
  assert.equal(open.res.body.paused, true)
  assert.equal(open.res.body.access, 'kept')
  assert.equal(open.res.body.resumes_at, new Date(future * 1000).toISOString())

  const past = stripeWith([{
    id: 'sub_week',
    status: 'active',
    pause_collection: { behavior: 'void', resumes_at: Math.floor(NOW / 1000) - 10 },
  }])
  const resumed = await post({ action: 'status' }, { stripe: past })
  assert.equal(resumed.res.body.paused, false)
  assert.equal(resumed.res.body.resumes_at, null)
})

test('cancel anytime still sets cancel_at_period_end and does not pause collection', async () => {
  const stripe = stripeWith([{ id: 'sub_week', status: 'active', pause_collection: null }])
  const { res } = await post(undefined, {
    stripe,
    env: { STRIPE_SECRET_KEY: 'sk_live_cancel_still_works' },
  })
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.message, 'Subscription will cancel at end of billing period')
  assert.equal(res.body.access_until, new Date(1_800_000_000 * 1000).toISOString())
  assert.deepEqual(stripe.calls, [{
    id: 'sub_week',
    params: { cancel_at_period_end: true },
  }])
})

test('cancel with an empty body stays the cancel path even in test mode', async () => {
  const stripe = stripeWith([{ id: 'sub_week', status: 'active' }])
  const { res } = await post({}, { stripe })
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.success, true)
  assert.equal(stripe.calls[0].params.cancel_at_period_end, true)
  assert.equal(stripe.calls[0].params.pause_collection, undefined)
})

test('policies keep the cancel anytime wording and state that pause keeps access', () => {
  const html = renderPoliciesPage().html
  assert.match(html, /All plans: cancel anytime\./)
  assert.match(html, /A renewing plan shows Cancel Subscription\. Choose it, then confirm Yes, Cancel\./)
  assert.match(html, /CGPropz tells Stripe to end that subscription when the current billing period ends\./)
  assert.match(html, /The page then says the subscription has been cancelled and shows the date full access lasts through\./)
  assert.match(html, /Paused members keep access/)
  assert.match(html, /void any invoice created during that week/)
  assert.match(html, /Billing resumes automatically 7 days later/)
  assert.match(html, /expires after 48 hours/)
  assert.match(html, /signed-in member is the member the link was created for/)

  const page = readFileSync(join(fileURLToPath(new URL('..', import.meta.url)), 'src/SubscriptionPage.jsx'), 'utf8')
  assert.match(page, /Are you sure\? You'll keep access until the end of your current billing period\./)
  assert.match(page, /Your subscription has been cancelled\. You'll keep full access until/)
  assert.match(page, /Pause 1 week/)
  assert.match(page, /Yes, Cancel/)
})
