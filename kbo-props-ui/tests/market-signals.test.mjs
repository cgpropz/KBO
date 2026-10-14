import assert from 'node:assert/strict'
import test from 'node:test'
import { handleDataRequest } from '../api/data.js'
import {
  exampleSignals,
  formatSignalTime,
  presentSignal,
  signalChipText,
  signalsForSport,
  signalsForViewer,
} from '../src/marketSignals.js'

const FUTURE = '2026-12-01T23:00:00Z'
const PAST = '2020-01-01T00:00:00Z'

function row(overrides) {
  return {
    signal_key: 'k',
    sport: 'nfl',
    kind: 'line_pulled',
    player: 'Alex Example',
    team: 'CIN',
    game_start: FUTURE,
    signaled_at: '2026-12-01T18:00:00Z',
    projection: 99,
    cg_score: 88,
    ...overrides,
  }
}

test('chip text names the feed and the ET time', () => {
  assert.equal(formatSignalTime('2026-10-18T22:42:00Z'), '6:42 PM ET')
  assert.equal(
    signalChipText({ source: 'prizepicks', kind: 'line_pulled', signaled_at: '2026-10-18T22:42:00Z' }),
    'PrizePicks line pulled 6:42 PM ET',
  )
  assert.equal(
    signalChipText({ source: 'prizepicks', kind: 'line_back', signaled_at: '2026-10-18T22:40:00Z' }),
    'PrizePicks line back 6:40 PM ET',
  )
  assert.equal(
    signalChipText({ source: 'unabated', kind: 'line_pulled', signaled_at: '2026-10-18T22:50:00Z' }),
    'Unabated market off 6:50 PM ET',
  )
  assert.equal(
    signalChipText({ source: 'nfl_odds', kind: 'big_move', signaled_at: '2026-10-18T22:40:00Z' }),
    'Odds big move 6:40 PM ET',
  )
})

test('viewer filter keeps the selected sport and drops scores', () => {
  const rows = [
    row({ signal_key: 'nfl', sport: 'nfl' }),
    row({ signal_key: 'kbo', sport: 'kbo', team: 'LG', player: 'Kim Example' }),
    row({ signal_key: 'old', game_start: PAST }),
    row({ signal_key: 'nba', sport: 'nba', team: 'LAL', player: 'Sam Example' }),
  ]
  const kbo = signalsForViewer(rows, 'kbo')
  assert.deepEqual(kbo.map((item) => item.sport), ['kbo'])
  assert.equal('projection' in kbo[0], false)
  assert.equal('cg_score' in kbo[0], false)
  const all = signalsForViewer(rows, 'pro')
  assert.deepEqual(all.map((item) => item.sport).sort(), ['kbo', 'nba', 'nfl'])
  assert.deepEqual(signalsForViewer(rows, 'free'), [])
  const shown = presentSignal(row({}))
  assert.equal(shown.projection, undefined)
  assert.deepEqual(signalsForSport(all, 'nfl').map((item) => item.player), ['Alex Example'])
  const dupes = signalsForSport([
    row({ signal_key: 'a', source: 'prizepicks', signaled_at: '2026-12-01T18:00:00Z' }),
    row({ signal_key: 'b', source: 'prizepicks', signaled_at: '2026-12-01T19:00:00Z', player: 'Alex Example' }),
    row({ signal_key: 'u', source: 'unabated', kind: 'line_pulled', signaled_at: '2026-12-01T19:30:00Z' }),
    row({ signal_key: 'c', source: 'nfl_odds', kind: 'big_move', signaled_at: '2026-12-01T17:00:00Z' }),
  ], 'nfl')
  assert.deepEqual(dupes.map((item) => [item.source, item.signal_key]), [
    ['unabated', 'u'],
    ['prizepicks', 'b'],
    ['nfl_odds', 'c'],
  ])
})

test('example rows are labeled and carry no model numbers', () => {
  const examples = exampleSignals(new Date('2026-10-18T18:00:00Z'))
  assert.equal(examples.length, 4)
  assert.ok(examples.every((item) => item.player.includes('Example')))
  assert.deepEqual(examples.map((item) => item.source), ['prizepicks', 'prizepicks', 'unabated', 'nfl_odds'])
  for (const item of examples) {
    assert.equal('projection' in item, false)
    assert.equal('cg_score' in item, false)
    assert.equal('cg_projection' in item, false)
  }
})

function signalClient(rows, tier, { missing = false } = {}) {
  return {
    auth: {
      async getUser(token) {
        if (token !== 'tok') return { data: { user: null }, error: { message: 'nope' } }
        return { data: { user: { id: 'u1' } }, error: null }
      },
    },
    from(table) {
      const chain = {
        select() { return chain },
        eq() { return chain },
        gt() { return chain },
        order() { return chain },
        limit() { return chain },
        maybeSingle() {
          if (table === 'user_profiles') return Promise.resolve({ data: tier ? { tier } : null, error: null })
          return Promise.resolve({ data: null, error: null })
        },
        then(resolve, reject) {
          if (missing) {
            return Promise.resolve({ data: null, error: { message: 'Could not find the table public.market_signals' } }).then(resolve, reject)
          }
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject)
        },
      }
      return chain
    },
  }
}

async function call(client, token) {
  const res = {
    statusCode: 200, headers: {}, body: undefined,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v },
    status(code) { this.statusCode = code; return this },
    json(obj) { this.body = obj; return this },
  }
  await handleDataRequest(
    { method: 'GET', query: { ds: 'market_signals' }, headers: token ? { authorization: `Bearer ${token}` } : {} },
    res,
    client,
  )
  return res
}

test('the data route returns signals for the paid sport and hides model fields', async () => {
  const rows = [row({ sport: 'nfl' }), row({ signal_key: 'kbo', sport: 'kbo', team: 'LG' })]
  const paid = await call(signalClient(rows, 'pro'), 'tok')
  assert.equal(paid.statusCode, 200)
  assert.equal(paid.body.data.length, 2)
  assert.equal('projection' in paid.body.data[0], false)
  assert.equal('cg_score' in paid.body.data[0], false)
  const kbo = await call(signalClient(rows, 'kbo'), 'tok')
  assert.deepEqual(kbo.body.data.map((item) => item.sport), ['kbo'])
  const missing = await call(signalClient([], 'pro', { missing: true }), 'tok')
  assert.equal(missing.statusCode, 200)
  assert.deepEqual(missing.body.data, [])
})
