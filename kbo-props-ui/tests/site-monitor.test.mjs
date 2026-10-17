import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ISSUE_TITLE,
  formatReport,
  githubIssues,
  memberAccessToken,
  monitorShouldRun,
  probeBoard,
  probeFailure,
  runSiteMonitor,
} from '../scripts/site-monitor.mjs'

const SECRET = 'super-secret-access-token'
const HASH = 'super-secret-token-hash'

test('the monitor sleeps from midnight through 5 AM Eastern, including winter time', () => {
  assert.equal(monitorShouldRun(new Date('2026-10-17T04:00:00Z')), false)
  assert.equal(monitorShouldRun(new Date('2026-10-17T09:30:00Z')), false)
  assert.equal(monitorShouldRun(new Date('2026-01-15T10:30:00Z')), false)
  assert.equal(monitorShouldRun(new Date('2026-10-17T10:05:00Z')), true)
  assert.equal(monitorShouldRun(new Date('2026-01-15T11:05:00Z')), true)
  assert.equal(monitorShouldRun(new Date('2026-10-17T09:30:00Z'), { force: true }), true)
})

test('a free tier, a 503, and a read over 5s fail the probe', () => {
  assert.deepEqual(probeFailure({ status: 200, ms: 400, preview: false, tier: 'combined' }), [])
  assert.deepEqual(probeFailure({ status: 503, ms: 400, preview: null, tier: null }), ['503'])
  assert.deepEqual(probeFailure({ status: 200, ms: 5001, preview: false, tier: 'combined' }), ['read 5001ms'])
  assert.deepEqual(probeFailure({ status: 200, ms: 5000, preview: false, tier: 'combined' }), [])
  assert.deepEqual(probeFailure({ status: 200, ms: 100, preview: true, tier: 'combined' }), ['free tier'])
  assert.deepEqual(probeFailure({ status: 200, ms: 100, preview: false, tier: 'free' }), ['free tier'])
})

test('a probe keeps status and tier and drops the board payload', async () => {
  const seen = []
  const fetchImpl = async (url, options) => {
    seen.push({ url, authorization: options.headers.Authorization })
    return {
      status: 200,
      json: async () => ({ preview: false, tier: 'combined', data: [{ player: 'secret row' }] }),
    }
  }
  const probe = await probeBoard(fetchImpl, { origin: 'https://www.cgpropz.com', token: SECRET, ds: 'nhl_projections' })
  assert.deepEqual(probe, { ds: 'nhl_projections', status: 200, ms: probe.ms, preview: false, tier: 'combined' })
  assert.equal(JSON.stringify(probe).includes('secret row'), false)
  assert.equal(JSON.stringify(probe).includes(SECRET), false)
  assert.equal(seen[0].authorization, `Bearer ${SECRET}`)
})

test('sign-in returns the token and errors never include it', async () => {
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ url, body: options.body })
    if (url.endsWith('/generate_link')) {
      return { ok: true, status: 200, json: async () => ({ properties: { hashed_token: HASH } }) }
    }
    return { ok: true, status: 200, json: async () => ({ access_token: SECRET, user: { id: 'u-1' } }) }
  }
  const token = await memberAccessToken(fetchImpl, {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-key',
    VITE_SUPABASE_ANON_KEY: 'anon-key',
    SITE_MONITOR_EMAIL: 'monitor@example.com',
  })
  assert.equal(token, SECRET)
  assert.equal(calls[0].body.includes('monitor@example.com'), true)

  const refused = async () => ({
    ok: false,
    status: 422,
    json: async () => ({ access_token: SECRET, hashed_token: HASH, msg: 'nope' }),
  })
  await assert.rejects(
    memberAccessToken(refused, {
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-key',
      VITE_SUPABASE_ANON_KEY: 'anon-key',
      SITE_MONITOR_EMAIL: 'monitor@example.com',
    }),
    (err) => err.message === 'magic link failed (422)' && !err.message.includes(SECRET) && !err.message.includes(HASH),
  )
  await assert.rejects(
    memberAccessToken(fetchImpl, {}),
    /site monitor is not configured/,
  )
})

function memoryIssues() {
  const calls = []
  let open = null
  let created = 0
  return {
    calls,
    issues: {
      async findOpen() {
        calls.push('find')
        return open
      },
      async create({ title, body }) {
        created += 1
        calls.push(['create', title, body])
        open = { number: 1 }
        return open
      },
      async comment(number, body) {
        calls.push(['comment', number, body])
      },
      async close(number) {
        calls.push(['close', number])
        open = null
      },
    },
    created: () => created,
  }
}

const day = new Date('2026-10-17T14:00:00Z')

test('a quiet hour does not open an issue', async () => {
  const store = memoryIssues()
  const outcome = await runSiteMonitor({
    now: new Date('2026-10-17T09:30:00Z'),
    probes: async () => { throw new Error('should not run') },
    issues: store.issues,
  })
  assert.deepEqual(outcome, { skipped: true, failed: false })
  assert.deepEqual(store.calls, [])
})

test('a free board opens one issue, a second failure updates it, and recovery closes it', async () => {
  const store = memoryIssues()
  const free = [{ ds: 'nhl_projections', status: 200, ms: 800, preview: true, tier: 'free' }]
  const first = await runSiteMonitor({ now: day, origin: 'https://www.cgpropz.com', probes: async () => free, issues: store.issues })
  assert.equal(first.failed, true)
  assert.equal(store.created(), 1)
  assert.equal(store.calls[1][1], ISSUE_TITLE)
  assert.equal(store.calls[1][2].includes('free tier'), true)
  assert.equal(store.calls[1][2].includes(SECRET), false)

  const again = await runSiteMonitor({ now: day, probes: async () => free, issues: store.issues })
  assert.equal(again.failed, true)
  assert.equal(store.created(), 1)
  assert.equal(store.calls.at(-1)[0], 'comment')

  const paid = [{ ds: 'nhl_projections', status: 200, ms: 800, preview: false, tier: 'combined' }]
  const recovered = await runSiteMonitor({ now: day, probes: async () => paid, issues: store.issues })
  assert.equal(recovered.failed, false)
  assert.equal(store.calls.at(-1)[0], 'close')
})

test('a 503 and a slow read are both in the one issue', async () => {
  const store = memoryIssues()
  const logs = []
  await runSiteMonitor({
    now: day,
    issues: store.issues,
    log: (line) => logs.push(line),
    probes: async () => ([
      { ds: 'strikeout_projections', status: 503, ms: 1200, preview: null, tier: null },
      { ds: 'nfl_sharp_odds', status: 200, ms: 6400, preview: false, tier: 'combined' },
    ]),
  })
  const body = store.calls[1][2]
  assert.equal(body.includes('503'), true)
  assert.equal(body.includes('read 6400ms'), true)
  assert.equal(logs.join('\n').includes('secret'), false)
})

test('a rejected sign-in opens one issue without the token', async () => {
  const store = memoryIssues()
  const logs = []
  const outcome = await runSiteMonitor({
    now: day,
    issues: store.issues,
    log: (line) => logs.push(line),
    probes: async () => { throw new Error(`verify failed (500) ${SECRET} ${HASH}`) },
  })
  assert.equal(outcome.failed, true)
  const body = store.calls[1][2]
  assert.equal(body.includes('sign-in failed'), true)
  assert.equal(body.includes(SECRET), false)
  assert.equal(body.includes(HASH), false)
  assert.equal(logs.join('\n').includes(SECRET), false)
})

test('the report lists status and timing only', () => {
  const report = formatReport({
    checkedAt: '2026-10-17T14:00:00.000Z',
    origin: 'https://www.cgpropz.com',
    results: [{ ds: 'prizepicks_props', status: 200, ms: 90, preview: false, tier: 'combined' }],
  })
  assert.equal(report.includes('prizepicks_props'), true)
  assert.equal(report.includes('within 5s'), true)
})

test('issue create falls back when the site-monitor label is missing', async () => {
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ url, body: options.body ? JSON.parse(options.body) : null })
    if (options.method === 'POST' && calls.length === 1) {
      return { ok: false, status: 422, json: async () => ({ message: 'Label not found' }) }
    }
    return { ok: true, status: 201, json: async () => ({ number: 9 }) }
  }
  const created = await githubIssues({ fetchImpl, token: 'gh', repo: 'cgpropz/KBO' }).create({
    title: ISSUE_TITLE,
    body: 'status only',
  })
  assert.equal(created.number, 9)
  assert.deepEqual(calls[0].body.labels, ['site-monitor'])
  assert.equal(calls[1].body.labels, undefined)
  assert.equal(calls[1].body.body, 'status only')
})
