// Unit tests for the server-gated data endpoint (api/data.js) using a mocked
// Supabase client. No network, no credentials.
// Run: npm run test:api
import assert from 'node:assert/strict'
import { test, beforeEach } from 'node:test'
import { handleDataRequest, _clearCache } from '../api/data.js'
import { DATASETS, FREE_ROW_LIMIT } from '../api/_dataAccess.js'

const NOW = '2026-09-25T12:00:00Z'

function kboBoard(nCards = 6, propsPerCard = 3) {
  return {
    generated_at: NOW,
    total_props: nCards * propsPerCard,
    cards: Array.from({ length: nCards }, (_, c) => ({
      name: `Player ${c}`, team: 'LG', opponent: 'KT', type: c % 2 ? 'batter' : 'pitcher',
      props: Array.from({ length: propsPerCard }, (_, p) => ({
        stat: `S${p}`, line: 1.5, cg_projection: c * 10 + p, hit_rate_l10: 50, recommendation: 'OVER',
      })),
    })),
  }
}

const TABLES = {
  prizepicks_props: kboBoard(),
  strikeout_projections: { generated_at: NOW, projections: Array.from({ length: 10 }, (_, i) => ({ name: `P${i}`, rating: i, line: 4.5 })), team_so_per_g: { LG: 7 } },
  batter_projections: { generated_at: NOW, projections: Array.from({ length: 8 }, (_, i) => ({ name: `B${i}`, cg_projection: i })) },
  matchup_data: { generated_at: NOW, matchups: [{ away: 'LG', home: 'KT', props: [{ name: 'x', line: 3.5 }, { name: 'y', line: 1.5 }], market: { total: 8.5 }, away_pitcher: { name: 'A', line: 17.5, k_projection: 19.9, profile: { era: 3.1 } }, home_pitcher: { name: 'H', profile: { era: 4 } } }] },
  pitcher_rankings: Array.from({ length: 12 }, (_, i) => ({ name: `R${i}`, rk: i + 1 })),
  graded_props_history: { generated_at: NOW, summary: { hit: 10 }, graded: Array.from({ length: 20 }, (_, i) => ({ id: i })), pending: Array.from({ length: 9 }, (_, i) => ({ id: i })) },
  wnba_projections_standard: Array.from({ length: 5 }, (_, i) => ({
    name: `W${i}`, propProjectionByStat: { Points: 10 + i },
    ppAllProps: [{ stat: 'Points', line: 10, projection: 10 + i * 2 }, { stat: 'Rebounds', line: 5, projection: 4 }],
  })),
  wnba_players: Array.from({ length: 30 }, (_, i) => ({ name: `W${i}` })),
  wnba_lineups: Array.from({ length: 6 }, (_, i) => ({ game: i })),
  nfl_projections: Array.from({ length: 15 }, (_, i) => ({ player: `N${i}`, line: 50, projection: 40 + i })),
  nfl_lineups: Array.from({ length: 4 }, (_, i) => ({ game: i })),
}

const USERS = { 'tok-free': 'u-free', 'tok-kbo': 'u-kbo', 'tok-owner': 'u-owner', 'tok-combined': 'u-comb', 'tok-noprofile': 'u-none' }
const PROFILES = { 'u-free': 'free', 'u-kbo': 'kbo', 'u-owner': 'owner', 'u-comb': 'combined' }

function mockClient() {
  const calls = { tables: [] }
  return {
    calls,
    auth: {
      async getUser(token) {
        const id = USERS[token]
        return id ? { data: { user: { id } }, error: null } : { data: { user: null }, error: { message: 'invalid JWT' } }
      },
    },
    from(table) {
      const q = { table, filters: {} }
      const chain = {
        select() { return chain },
        eq(col, val) { q.filters[col] = val; return chain },
        async maybeSingle() {
          if (table === 'user_profiles') {
            const tier = PROFILES[q.filters.id]
            return { data: tier ? { tier } : null, error: null }
          }
          calls.tables.push(table)
          if (!(table in TABLES)) return { data: null, error: null }
          return { data: { data: structuredClone(TABLES[table]), updated_at: NOW }, error: null }
        },
      }
      return chain
    },
  }
}

function mockRes() {
  return {
    statusCode: 200, headers: {}, body: undefined,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v },
    status(code) { this.statusCode = code; return this },
    json(obj) { this.body = obj; return this },
  }
}

async function call(ds, token, method = 'GET') {
  const res = mockRes()
  const req = { method, query: { ds }, headers: token ? { authorization: `Bearer ${token}` } : {} }
  await handleDataRequest(req, res, mockClient())
  return res
}

const countProps = (board) => board.cards.reduce((n, c) => n + c.props.length, 0)

beforeEach(() => _clearCache())

test('anonymous caller gets only the top 3 KBO board lines + locked count', async () => {
  const res = await call('prizepicks_props')
  assert.equal(res.statusCode, 200)
  assert.equal(res.headers['cache-control'], 'private, no-store, max-age=0')
  assert.equal(res.body.preview, true)
  assert.equal(res.body.tier, 'free')
  assert.equal(countProps(res.body.data), FREE_ROW_LIMIT)
  assert.equal(res.body.lockedCount, 18 - FREE_ROW_LIMIT)
  // best scores are kept (Player 5: cg 50,51,52)
  const kept = res.body.data.cards.flatMap((c) => c.props.map((p) => p.cg_projection)).sort((a, b) => b - a)
  assert.deepEqual(kept, [52, 51, 50])
  assert.equal(res.body.data.generated_at, NOW)
})

test('invalid token is treated as free', async () => {
  const res = await call('prizepicks_props', 'forged-token')
  assert.equal(res.body.preview, true)
  assert.equal(countProps(res.body.data), 3)
})

test('free account gets preview; missing profile row = free', async () => {
  for (const tok of ['tok-free', 'tok-noprofile']) {
    const res = await call('strikeout_projections', tok)
    assert.equal(res.body.preview, true)
    assert.equal(res.body.data.projections.length, 3)
    assert.deepEqual(res.body.data.projections.map((r) => r.rating), [9, 8, 7])
    assert.equal(res.body.lockedCount, 7)
  }
})

test('paid tiers get the full snapshot', async () => {
  for (const tok of ['tok-kbo', 'tok-owner', 'tok-combined']) {
    const res = await call('prizepicks_props', tok)
    assert.equal(res.body.preview, false)
    assert.equal(res.body.lockedCount, 0)
    assert.equal(countProps(res.body.data), 18)
  }
})

test('single-sport KBO tier does not unlock WNBA or NFL', async () => {
  const w = await call('wnba_projections_standard', 'tok-kbo')
  assert.equal(w.body.preview, true)
  const n = await call('nfl_projections', 'tok-kbo')
  assert.equal(n.body.preview, true)
  assert.equal(n.body.data.length, 3)
  assert.equal(n.body.lockedCount, 12)
  const o = await call('nfl_projections', 'tok-owner')
  assert.equal(o.body.preview, false)
  assert.equal(o.body.data.length, 15)
})

test('WNBA preview keeps top 3 prop lines across players', async () => {
  const res = await call('wnba_projections_standard')
  const props = res.body.data.flatMap((p) => p.ppAllProps)
  assert.equal(props.length, 3)
  assert.equal(res.body.lockedCount, 10 - 3)
  assert.deepEqual(res.body.data.map((p) => p.name).sort(), ['W2', 'W3', 'W4'])
})

test('matchups preview keeps the slate but strips projections/lines', async () => {
  const res = await call('matchup_data')
  const g = res.body.data.matchups[0]
  assert.deepEqual(g.props, [])
  assert.equal(g.market, null)
  assert.equal(g.away_pitcher.line, undefined)
  assert.equal(g.away_pitcher.k_projection, undefined)
  assert.equal(g.away_pitcher.profile.era, 3.1)
  assert.equal(res.body.lockedCount, 2)
})

test('graded history: free keeps settled results, trims pending picks', async () => {
  const res = await call('graded_props_history')
  assert.equal(res.body.data.graded.length, 20)
  assert.equal(res.body.data.pending.length, 3)
  assert.equal(res.body.lockedCount, 6)
})

test('public-stat datasets are returned in full to free users', async () => {
  const r = await call('pitcher_rankings')
  assert.equal(r.body.preview, false)
  assert.equal(r.body.data.length, 12)
  const p = await call('wnba_players')
  assert.equal(p.body.data.length, 30)
})

test('unknown / non-whitelisted datasets and methods are rejected', async () => {
  for (const ds of ['prop_results', 'pitcher_logs', 'user_profiles', '', '../secrets', 'constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    const res = await call(ds)
    assert.equal(res.statusCode, 400, ds)
  }
  const post = await call('prizepicks_props', null, 'POST')
  assert.equal(post.statusCode, 405)
})

test('unpublished table returns 404', async () => {
  const original = TABLES.nfl_lineups
  delete TABLES.nfl_lineups
  const res = await call('nfl_lineups', 'tok-owner')
  assert.equal(res.statusCode, 404)
  TABLES.nfl_lineups = original
})

test('every whitelisted dataset produces a response for free and paid', async () => {
  for (const ds of Object.keys(DATASETS)) {
    if (!(DATASETS[ds].table in TABLES)) continue
    const free = await call(ds)
    const paid = await call(ds, 'tok-owner')
    assert.equal(free.statusCode, 200, ds)
    assert.equal(paid.statusCode, 200, ds)
    assert.equal(paid.body.preview, false, ds)
  }
})
