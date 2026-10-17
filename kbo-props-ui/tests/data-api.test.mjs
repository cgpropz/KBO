// Unit tests for the server-gated data endpoint (api/data.js) using a mocked
// Supabase client. No network, no credentials.
// Run: npm run test:api
import assert from 'node:assert/strict'
import { test, beforeEach } from 'node:test'
import { handleDataRequest, _clearCache, _lastGoodWrite, _setTimeouts, _standardFilterRuns, timeouts, cacheWindows, SNAPSHOT_READ_MS, CLIENT_FETCH_MS, BOARD_READ_BUDGET_MS, boardReadBudgetMs, stepBudgetMs, lastGoodMaxAgeMs, lastGoodMemoryAt, PRIVATE_DATA_CACHE } from '../api/data.js'
import {
  DATASETS,
  FILTER_STANDARD_BEFORE_FREE_PREVIEW,
  FREE_ROW_LIMIT,
  NFL_FREE_PREVIEW_ENABLED,
  isNbaDataset,
  isNhlDataset,
  nflFreeTotalEdgesEnabled,
  previewNflGameMarkets,
  shapeForTier,
  _tierShapeFilters,
} from '../api/_dataAccess.js'
import { _setBoardCopyFetch } from '../api/_boardCopy.js'
import { bearerFor, installJwtSecret } from './access-token.mjs'

installJwtSecret()
const bearer = (name) => `Bearer ${bearerFor(name)}`

const NOW = '2026-09-25T12:00:00Z'
const DEFAULT_TIMEOUTS = {
  snapshotReadMs: timeouts.snapshotReadMs,
  tierLookupMs: timeouts.tierLookupMs,
  lastGoodReadMs: timeouts.lastGoodReadMs,
}

function kboBoard(nCards = 6, propsPerCard = 3) {
  return {
    generated_at: NOW,
    total_props: nCards * propsPerCard,
    cards: Array.from({ length: nCards }, (_, c) => ({
      name: `Player ${c}`, team: 'LG', opponent: 'KT', type: c % 2 ? 'batter' : 'pitcher',
      games: [{ date: '2026-09-01', hrr: c }],
      recent_values: [c, c + 1],
      props: Array.from({ length: propsPerCard }, (_, p) => {
        const confidence = c * 10 + p
        const row = {
          stat: `S${p}`,
          line: 1.5,
          // Ratio score matches the old confidence numbers so the top-3 assertion
          // still names the same rows. Confidence itself is not the rank key.
          projection: (confidence * 1.5) / 50,
          cg_projection: confidence,
          avg: 12,
          hit_rate_l10: 50,
          recommendation: 'OVER',
          odds_type: 'standard',
        }
        if (c === 0 && p === 0) {
          row.cg_projection = 95
          row.projection = 1.2
          row.recommendation = 'UNDER'
          row.avg = 8
        }
        return row
      }),
    })),
  }
}

const TABLES = {
  prizepicks_props: kboBoard(),
  strikeout_projections: { generated_at: NOW, projections: Array.from({ length: 10 }, (_, i) => ({ name: `P${i}`, rating: i, line: 4.5, odds_type: 'standard' })), team_so_per_g: { LG: 7 } },
  batter_projections: { generated_at: NOW, projections: Array.from({ length: 8 }, (_, i) => ({ name: `B${i}`, cg_projection: i, odds_type: 'standard' })) },
  matchup_data: { generated_at: NOW, matchups: [{ away: 'LG', home: 'KT', props: [{ name: 'x', line: 3.5 }, { name: 'y', line: 1.5 }], market: { total: 8.5 }, away_pitcher: { name: 'A', line: 17.5, k_projection: 19.9, profile: { era: 3.1 } }, home_pitcher: { name: 'H', profile: { era: 4 } } }] },
  pitcher_rankings: Array.from({ length: 12 }, (_, i) => ({ name: `R${i}`, rk: i + 1 })),
  graded_props_history: { generated_at: NOW, summary: { hit: 10 }, graded: Array.from({ length: 20 }, (_, i) => ({ id: i })), pending: Array.from({ length: 9 }, (_, i) => ({ id: i })) },
  wnba_projections_standard: Array.from({ length: 5 }, (_, i) => ({
    name: `W${i}`, propProjectionByStat: { Points: 10 + i },
    ppAllProps: [{ stat: 'Points', line: 10, projection: 10 + i * 2 }, { stat: 'Rebounds', line: 5, projection: 4 }],
    ...(i === 0 ? { recentGames: [{ date: '2026-09-01', points: 18 }] } : {}),
  })),
  wnba_players: Array.from({ length: 30 }, (_, i) => ({ name: `W${i}` })),
  wnba_lineups: Array.from({ length: 6 }, (_, i) => ({ game: i })),
  nfl_projections: Array.from({ length: 15 }, (_, i) => ({
    player: `N${i}`, line: 50, projection: 40 + i, line_type: 'standard',
    ...(i === 0 ? { recent: [11, 22, 33], gameDates: ['2026-09-07'], profile: { toi: 18 } } : {}),
  })),
  nfl_lineups: Array.from({ length: 4 }, (_, i) => ({ game: i })),
  nfl_game_markets: {
    generated_at: NOW,
    provider: 'unabated',
    status: 'ok',
    model: { proven: false, label: 'Not a proven spread, total, or moneyline formula' },
    week: 4,
    games: Array.from({ length: 6 }, (_, i) => ({
      id: `g${i}`,
      awayTeam: 'ARI',
      homeTeam: 'NYG',
      spread: { edge: i },
      total: { edge: i - 1 },
      moneyline: { edge: 0.5 },
    })),
  },
  correlations_kbo: {
    sport: 'kbo', minShared: 15,
    pairs: [{ player: 'A', stat: 'Strikeouts', partner: 'B', partnerStat: 'Hits+Runs+RBIs', agreement: 0.72, n: 18 }],
  },
  correlations_wnba: {
    sport: 'wnba', minShared: 8,
    pairs: [{ player: 'W', stat: 'Points', partner: 'X', partnerStat: 'Rebounds', agreement: 0.25, n: 10 }],
  },
  correlations_nfl: {
    sport: 'nfl', minShared: 8,
    pairs: [{ player: 'Q', stat: 'Pass Yards', partner: 'R', partnerStat: 'Receiving Yards', agreement: 0.81, n: 9 }],
  },
  nfl_sharp_odds: {
    generated_at: NOW,
    provider: 'unabated',
    status: 'ok',
    message: 'matched',
    records: Array.from({ length: 8 }, (_, i) => ({ player: `S${i}`, prop: 'Receptions', pp_line: 4.5, ev_pct: i })),
  },
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

async function call(ds, token, method = 'GET', query = {}) {
  const res = mockRes()
  const req = { method, query: { ds, ...query }, headers: token ? { authorization: bearer(token) } : {} }
  await handleDataRequest(req, res, mockClient())
  return res
}

const countProps = (board) => board.cards.reduce((n, c) => n + c.props.length, 0)

beforeEach(() => {
  _clearCache()
  _setBoardCopyFetch(null)
  delete process.env.BLOB_READ_WRITE_TOKEN
})

test('anonymous caller gets only the top 3 KBO board lines + locked count', async () => {
  const res = await call('prizepicks_props')
  assert.equal(res.statusCode, 200)
  assert.equal(res.headers['cache-control'], 's-maxage=60, stale-while-revalidate=300, stale-if-error=1800')
  assert.equal(res.body.preview, true)
  assert.equal(res.body.tier, 'free')
  assert.equal(countProps(res.body.data), FREE_ROW_LIMIT)
  assert.equal(res.body.lockedCount, 18 - FREE_ROW_LIMIT)
  // best model ratios are kept (Player 5: scores 50, 51, 52).
  // The confidence-95 under on Player 0 is not one of them.
  const kept = res.body.data.cards.flatMap((c) => c.props.map((p) => p.cg_projection)).sort((a, b) => b - a)
  assert.deepEqual(kept, [52, 51, 50])
  assert.equal(res.body.data.generated_at, NOW)
  assert.equal(res.body.source, 'supabase')
})

test('member snapshots and signed-in previews are not edge cached', async () => {
  const paid = await call('prizepicks_props', 'tok-kbo')
  assert.equal(paid.body.preview, false)
  assert.equal(paid.headers['cache-control'], PRIVATE_DATA_CACHE)
  const authedFree = await call('prizepicks_props', 'tok-free')
  assert.equal(authedFree.body.preview, true)
  // A preview to a signed-in caller may be a lookup blip; the browser must not keep it.
  assert.equal(authedFree.headers['cache-control'], 'private, no-store, max-age=0')
  const publicRankings = await call('pitcher_rankings')
  assert.equal(publicRankings.body.preview, false)
  assert.equal(publicRankings.headers['cache-control'], 's-maxage=60, stale-while-revalidate=300, stale-if-error=1800')
})

test('board payloads keep the last 10 chart games and omit the rest of the log', async () => {
  const board = await call('nfl_projections', 'tok-owner')
  const n0 = board.body.data.find((row) => row.player === 'N0')
  assert.deepEqual(n0.recent, [11, 22, 33])
  assert.equal(n0.gameDates, undefined)
  assert.equal(n0.profile, undefined)
  const page = await call('nfl_projections', 'tok-owner', 'GET', { player: 'N0' })
  assert.equal(page.body.data.length, 1)
  assert.deepEqual(page.body.data[0].recent, [11, 22, 33])
  assert.deepEqual(page.body.data[0].gameDates, ['2026-09-07'])
  assert.equal(page.body.data[0].profile.toi, 18)
  const hidden = await call('nfl_projections', undefined, 'GET', { player: 'N0' })
  assert.deepEqual(hidden.body.data, [])

  const kbo = await call('prizepicks_props', 'tok-kbo')
  assert.ok(kbo.body.data.cards.every((card) => card.games === undefined && Array.isArray(card.recent_values)))
  assert.deepEqual(kbo.body.data.cards[0].recent_values, [0, 1])
  const kboPage = await call('prizepicks_props', 'tok-kbo', 'GET', { player: 'Player 0' })
  assert.equal(kboPage.body.data.cards.length, 1)
  assert.equal(kboPage.body.data.cards[0].games[0].hrr, 0)
  const kboHidden = await call('prizepicks_props', undefined, 'GET', { player: 'Player 0' })
  assert.deepEqual(kboHidden.body.data.cards, [])

  const wnba = await call('wnba_projections_standard', 'tok-owner')
  assert.equal(wnba.body.data.find((row) => row.name === 'W0').recentGames[0].points, 18)
  const wnbaPage = await call('wnba_projections_standard', 'tok-owner', 'GET', { player: 'W0' })
  assert.equal(wnbaPage.body.data.length, 1)
  assert.equal(wnbaPage.body.data[0].recentGames[0].points, 18)

  const markets = await call('nfl_game_markets', 'tok-owner')
  assert.equal(markets.body.data.games.length, 6)
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
  if (NFL_FREE_PREVIEW_ENABLED) {
    assert.equal(n.body.data.length, 3)
    assert.equal(n.body.lockedCount, 12)
  } else {
    assert.deepEqual(n.body.data, [])
    assert.equal(n.body.lockedCount, 15)
  }
  const o = await call('nfl_projections', 'tok-owner')
  assert.equal(o.body.preview, false)
  assert.equal(o.body.data.length, 15)
})

test('anonymous NFL free preview returns the top 3 lines and hides total edges', async () => {
  assert.equal(NFL_FREE_PREVIEW_ENABLED, true)
  for (const token of [undefined, 'tok-free', 'tok-kbo']) {
    const props = await call('nfl_projections', token)
    assert.equal(props.statusCode, 200)
    assert.equal(props.body.preview, true)
    if (!token) assert.equal(props.body.tier, 'free')
    assert.deepEqual(props.body.data.map((row) => row.player), ['N14', 'N13', 'N12'])
    assert.equal(props.body.lockedCount, 12)
    const odds = await call('nfl_sharp_odds', token)
    assert.equal(odds.statusCode, 200)
    assert.equal(odds.body.preview, true)
    assert.deepEqual(odds.body.data.records.map((row) => row.ev_pct), [7, 6, 5])
    assert.equal(odds.body.data.message, 'matched')
    assert.equal(odds.body.lockedCount, 5)
    const markets = await call('nfl_game_markets', token)
    assert.equal(markets.statusCode, 200)
    assert.equal(markets.body.preview, true)
    assert.deepEqual(markets.body.data.games.map((game) => game.spread.edge), [5, 4, 3])
    assert.equal(markets.body.data.provider, 'unabated')
    assert.equal(markets.body.lockedCount, 3)
    for (const game of markets.body.data.games) {
      assert.equal(Object.hasOwn(game.total, 'edge'), false)
      assert.equal(game.spread.edge > 0, true)
    }
  }
  const lineups = await call('nfl_lineups')
  assert.equal(lineups.body.preview, true)
  assert.equal(lineups.body.data.length, 3)
  const wnba = await call('wnba_projections_standard')
  assert.equal(wnba.body.data.flatMap((player) => player.ppAllProps).length, 3)
  const paid = await call('nfl_projections', 'tok-owner')
  assert.equal(paid.body.preview, false)
  assert.equal(paid.body.data.length, 15)
  const paidOdds = await call('nfl_sharp_odds', 'tok-owner')
  assert.equal(paidOdds.body.data.records.length, 8)
  const paidMarkets = await call('nfl_game_markets', 'tok-owner')
  assert.equal(paidMarkets.body.data.games.length, 6)
  assert.equal(paidMarkets.body.data.games[0].total.edge, -1)
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

test('NFL sharp odds preview keeps the best EV rows and the snapshot message', async () => {
  const res = await call('nfl_sharp_odds')
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.preview, true)
  assert.equal(res.body.data.status, 'ok')
  assert.equal(res.body.data.message, 'matched')
  assert.equal(res.body.data.provider, 'unabated')
  if (NFL_FREE_PREVIEW_ENABLED) {
    assert.deepEqual(res.body.data.records.map((row) => row.ev_pct), [7, 6, 5])
    assert.equal(res.body.lockedCount, 5)
  } else {
    assert.deepEqual(res.body.data.records, [])
    assert.equal(res.body.lockedCount, 8)
  }
  const paid = await call('nfl_sharp_odds', 'tok-owner')
  assert.equal(paid.body.preview, false)
  assert.equal(paid.body.data.records.length, 8)
})

test('NFL sharp odds preview prefers Flex PP edge over sportsbook EV', async () => {
  const original = TABLES.nfl_sharp_odds
  TABLES.nfl_sharp_odds = {
    generated_at: NOW,
    provider: 'unabated',
    status: 'ok',
    message: 'matched',
    records: [
      { player: 'LowEdge', ev_pct: 9, pp_edge_flex: 0.2 },
      { player: 'HighEdge', ev_pct: -4, pp_edge_flex: 6 },
      { player: 'Mid', ev_pct: 1, pp_edge_flex: 3 },
      { player: 'Legacy', ev_pct: 8 },
    ],
  }
  try {
    const res = await call('nfl_sharp_odds')
    if (NFL_FREE_PREVIEW_ENABLED) {
      // Rows with pp_edge_flex sort on that number, so HighEdge (edge 6, EV -4)
      // beats LowEdge (edge 0.2, EV 9). A legacy row with only ev_pct still sorts on EV.
      assert.deepEqual(res.body.data.records.map((row) => row.player), ['Legacy', 'HighEdge', 'Mid'])
      assert.equal(res.body.lockedCount, 1)
    } else {
      assert.deepEqual(res.body.data.records, [])
      assert.equal(res.body.lockedCount, 4)
    }
  } finally {
    TABLES.nfl_sharp_odds = original
  }
})

test('NFL free game markets withhold total edges unless the flag is on', () => {
  assert.equal(nflFreeTotalEdgesEnabled({}), false)
  assert.equal(nflFreeTotalEdgesEnabled({ NFL_FREE_TOTAL_EDGES_ENABLED: 'false' }), false)
  assert.equal(nflFreeTotalEdgesEnabled({ NFL_FREE_TOTAL_EDGES_ENABLED: 'true' }), true)

  const payload = {
    provider: 'unabated',
    model: { proven: false, label: 'Not proven' },
    week: 5,
    games: [
      { id: 'total-only', awayTeam: 'KC', homeTeam: 'BUF', spread: { edge: 0.4, line: -3 }, total: { edge: 9.5, line: 44.5, projection: 54 }, moneyline: { edge: 0.2 } },
      { id: 'spread', awayTeam: 'PHI', homeTeam: 'DAL', spread: { edge: 4.2, line: -7 }, total: { edge: 0.1, line: 41, projection: 41.1 }, moneyline: { edge: 1 } },
      { id: 'mid', awayTeam: 'DET', homeTeam: 'GB', spread: { edge: 2.5, line: -1 }, total: { edge: 6, line: 47, projection: 53 }, moneyline: { edge: 0 } },
      { id: 'low', awayTeam: 'SF', homeTeam: 'SEA', spread: { edge: 1.1, line: 3 }, total: { edge: 1, line: 40, projection: 41 }, moneyline: { edge: 0.3 } },
    ],
  }

  const preview = previewNflGameMarkets(payload)
  assert.deepEqual(preview.data.games.map((game) => game.id), ['spread', 'mid', 'low'])
  assert.equal(preview.lockedCount, 1)
  assert.equal(preview.data.provider, 'unabated')
  for (const game of preview.data.games) {
    assert.equal(Object.hasOwn(game.total, 'edge'), false)
    assert.equal(game.spread.edge > 0, true)
    assert.notEqual(game.total.line, undefined)
    assert.notEqual(game.total.projection, undefined)
  }
  assert.equal(JSON.stringify(preview.data).includes('"edge":9.5'), false)
  assert.equal(JSON.stringify(preview.data).includes('"edge":6'), false)
  // The cached snapshot paid readers share is not mutated.
  assert.equal(payload.games[0].total.edge, 9.5)
  assert.equal(payload.games[1].total.edge, 0.1)

  const restored = previewNflGameMarkets(payload, { totalEdges: true })
  assert.deepEqual(restored.data.games.map((game) => game.id), ['total-only', 'mid', 'spread'])
  assert.equal(restored.data.games[0].total.edge, 9.5)
  assert.equal(restored.data.games[1].spread.edge, 2.5)

  for (const tier of ['owner', 'combined', 'weekly', 'monthly', 'season', 'pro', 'all']) {
    const paid = shapeForTier('nfl_game_markets', payload, tier)
    assert.equal(paid.preview, false)
    assert.equal(paid.lockedCount, 0)
    assert.equal(paid.data, payload)
    assert.equal(paid.data.games[0].total.edge, 9.5)
    assert.equal(paid.data.games.length, 4)
  }
})

test('NFL game markets preview keeps the biggest edges and the model label', async () => {
  const res = await call('nfl_game_markets')
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.preview, true)
  assert.equal(res.body.data.provider, 'unabated')
  assert.equal(res.body.data.model.proven, false)
  if (NFL_FREE_PREVIEW_ENABLED) {
    assert.deepEqual(res.body.data.games.map((game) => game.spread.edge), [5, 4, 3])
    assert.equal(res.body.lockedCount, 3)
  } else {
    assert.deepEqual(res.body.data.games, [])
    assert.equal(res.body.lockedCount, 6)
  }
  const paid = await call('nfl_game_markets', 'tok-owner')
  assert.equal(paid.body.preview, false)
  assert.equal(paid.body.data.games.length, 6)
})

test('correlation files hide pair rates from free callers and from the wrong sport tier', async () => {
  const free = await call('correlations_kbo')
  assert.equal(free.statusCode, 200)
  assert.equal(free.body.preview, true)
  assert.deepEqual(free.body.data.pairs, [])
  assert.equal(free.body.lockedCount, 1)

  const kbo = await call('correlations_kbo', 'tok-kbo')
  assert.equal(kbo.body.preview, false)
  assert.equal(kbo.body.data.pairs[0].agreement, 0.72)

  const wrongSport = await call('correlations_nfl', 'tok-kbo')
  assert.equal(wrongSport.body.preview, true)
  assert.deepEqual(wrongSport.body.data.pairs, [])
  assert.equal(wrongSport.body.lockedCount, 1)

  const owner = await call('correlations_nfl', 'tok-owner')
  assert.equal(owner.body.preview, false)
  assert.equal(owner.body.data.pairs.length, 1)

  assert.equal(isNbaDataset('nba_correlations'), true)
  assert.equal(isNbaDataset('correlations_kbo'), false)
  assert.equal(isNhlDataset('nhl_correlations'), true)
  const nbaDoc = { pairs: [{ player: 'A', stat: 'Points', partner: 'B', partnerStat: 'Rebounds', agreement: 0.7, n: 16 }] }
  const nbaOwner = shapeForTier('nba_correlations', nbaDoc, 'owner')
  assert.equal(nbaOwner.preview, true)
  assert.deepEqual(nbaOwner.data.pairs, [])
  const nhlOwner = shapeForTier('nhl_correlations', nbaDoc, 'owner')
  assert.equal(nhlOwner.preview, false)
  assert.equal(nhlOwner.data.pairs.length, 1)
  const nhlFree = shapeForTier('nhl_correlations', nbaDoc, 'free')
  assert.equal(nhlFree.preview, true)
  assert.deepEqual(nhlFree.data.pairs, [])
  assert.equal(nhlFree.lockedCount, 1)
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

test('slow snapshot read returns 503 upstream_timeout instead of hanging', async () => {
  const prev = { ...timeouts }
  _setTimeouts({ snapshotReadMs: 40, tierLookupMs: 40 })
  try {
    const client = mockClient()
    const originalFrom = client.from.bind(client)
    client.from = (table) => {
      const chain = originalFrom(table)
      if (table === 'user_profiles') return chain
      return {
        select() { return this },
        eq() { return this },
        abortSignal() { return this },
        maybeSingle() {
          return new Promise(() => { /* never resolves — simulates Supabase hang */ })
        },
      }
    }
    const res = mockRes()
    const started = Date.now()
    await handleDataRequest(
      { method: 'GET', query: { ds: 'wnba_projections_standard' }, headers: {} },
      res,
      client,
    )
    const elapsed = Date.now() - started
    assert.equal(res.statusCode, 503)
    assert.equal(res.body.code, 'upstream_timeout')
    assert.match(res.body.message || '', /timed out/i)
    assert.ok(elapsed < 1500, `timed out too slowly: ${elapsed}ms`)
  } finally {
    _setTimeouts(prev)
  }
})

test('board clocks are public and never include prop rows', async () => {
  const client = mockClient()
  client.from = (table) => {
    const chain = {
      select() { return chain },
      eq() { return chain },
      async maybeSingle() {
        if (table !== 'board_status') return { data: null, error: null }
        return {
          data: {
            data: {
              boards: [{
                sport: 'nfl',
                board_updated_at: NOW,
                injuries_checked_at: null,
                prop_count: 4,
                stale: false,
                cards: [{ name: 'Paid Player', line: 64.5 }],
                props: [{ player: 'Paid Player' }],
              }],
              cards: [{ name: 'Also paid' }],
            },
            updated_at: NOW,
          },
          error: null,
        }
      },
    }
    return chain
  }
  const res = mockRes()
  await handleDataRequest({ method: 'GET', query: { ds: 'board_status' }, headers: {} }, res, client)
  assert.equal(res.statusCode, 200)
  assert.match(res.headers['cache-control'], /public/)
  assert.equal(res.body.preview, undefined)
  assert.deepEqual(res.body.boards.map((row) => row.sport), ['kbo', 'wnba', 'nfl', 'nba', 'nhl'])
  const nfl = res.body.boards.find((row) => row.sport === 'nfl')
  assert.equal(nfl.prop_count, 4)
  assert.equal(nfl.board_updated_at, NOW)
  assert.equal(JSON.stringify(res.body).includes('Paid Player'), false)
  for (const row of res.body.boards) {
    assert.deepEqual(Object.keys(row).sort(), ['board_updated_at', 'injuries_checked_at', 'prop_count', 'sport', 'stale'])
  }
})

test('snapshot reads finish in time for last-good inside the 12s client window', () => {
  assert.equal(SNAPSHOT_READ_MS, 4_500)
  assert.equal(CLIENT_FETCH_MS, 12_000)
  assert.equal(DEFAULT_TIMEOUTS.snapshotReadMs, SNAPSHOT_READ_MS)
  assert.equal(DEFAULT_TIMEOUTS.tierLookupMs, 4_000)
  assert.ok(DEFAULT_TIMEOUTS.snapshotReadMs + DEFAULT_TIMEOUTS.lastGoodReadMs < CLIENT_FETCH_MS)
  // A split board is a head read plus a chunk read. Those two slices plus
  // last-good would pass 12s if each used its own full timer.
  assert.ok(SNAPSHOT_READ_MS * 2 + DEFAULT_TIMEOUTS.lastGoodReadMs >= CLIENT_FETCH_MS)
  assert.equal(BOARD_READ_BUDGET_MS, 10_500)
  assert.equal(boardReadBudgetMs(), BOARD_READ_BUDGET_MS)
  assert.ok(boardReadBudgetMs() < CLIENT_FETCH_MS)
  const start = 0
  const deadline = start + boardReadBudgetMs()
  const afterHead = start + SNAPSHOT_READ_MS
  const chunkMs = stepBudgetMs(deadline, SNAPSHOT_READ_MS, afterHead)
  const afterChunks = afterHead + chunkMs
  const lastMs = stepBudgetMs(deadline, DEFAULT_TIMEOUTS.lastGoodReadMs, afterChunks)
  assert.ok(afterChunks + lastMs - start < CLIENT_FETCH_MS)
  assert.ok(afterChunks + lastMs <= deadline)
})

test('a slow head and an out-of-budget chunk read serve last-good or 503, never a partial board', async () => {
  const prev = { ...timeouts }
  _setTimeouts({ snapshotReadMs: 80, lastGoodReadMs: 80, tierLookupMs: 400 })
  const version = '2026-10-17T12:00:00Z'
  const stored = [
    { player: 'StoredOnly', projection: 4, line: 2.5, rankEligible: true, oddsType: 'standard', generated_at: new Date().toISOString() },
    { player: 'Second', projection: 3, line: 2.5, rankEligible: true, oddsType: 'standard' },
  ]
  const partial = [{ player: 'PartialOnly', projection: 9, line: 1, rankEligible: true }]
  function client({ storage }) {
    let chunkStarted = false
    return {
      chunkStarted: () => chunkStarted,
      auth: {
        async getUser() {
          return { data: { user: { id: 'u-owner', email: 'owner@example.com' } }, error: null }
        },
      },
      storage,
      from(table) {
        const chain = {
          select() { return chain },
          eq() { return chain },
          in() { return chain },
          abortSignal() { return chain },
          maybeSingle() {
            if (table === 'user_profiles') return Promise.resolve({ data: { tier: 'owner' }, error: null })
            return new Promise((resolve) => {
              setTimeout(() => resolve({
                data: {
                  id: 1,
                  updated_at: version,
                  data: {
                    snapshotChunks: { version, generated_at: version, kind: 'list', ids: [10, 11] },
                  },
                },
                error: null,
              }), 40)
            })
          },
          then(resolve, reject) {
            chunkStarted = true
            return new Promise((done) => {
              setTimeout(() => done({
                data: [{
                  id: 10,
                  updated_at: version,
                  data: { version, generated_at: version, index: 0, kind: 'list', rows: partial },
                }],
                error: null,
              }), 400)
            }).then(resolve, reject)
          },
        }
        return chain
      },
    }
  }
  try {
    const withStorage = client({
      storage: {
        from() {
          return {
            async download() {
              return {
                data: { text: async () => JSON.stringify({ data: stored, updated_at: new Date().toISOString() }) },
                error: null,
              }
            },
          }
        },
      },
    })
    const storedRes = mockRes()
    const started = Date.now()
    await handleDataRequest(
      { method: 'GET', query: { ds: 'nhl_projections' }, headers: { authorization: bearer('tok-owner') } },
      storedRes,
      withStorage,
    )
    assert.equal(withStorage.chunkStarted(), true)
    assert.equal(storedRes.statusCode, 200)
    assert.equal(storedRes.body.preview, false)
    assert.deepEqual(storedRes.body.data.map((row) => row.player), ['StoredOnly', 'Second'])
    assert.equal(JSON.stringify(storedRes.body).includes('PartialOnly'), false)
    assert.ok(Date.now() - started < 2000)

    _clearCache()
    const withoutStorage = client({ storage: undefined })
    const emptyRes = mockRes()
    await handleDataRequest(
      { method: 'GET', query: { ds: 'nhl_projections' }, headers: { authorization: bearer('tok-owner') } },
      emptyRes,
      withoutStorage,
    )
    assert.equal(withoutStorage.chunkStarted(), true)
    assert.equal(emptyRes.statusCode, 503)
    assert.equal(emptyRes.body.code, 'upstream_timeout')
    assert.equal(emptyRes.body.data, undefined)
    assert.equal(JSON.stringify(emptyRes.body).includes('PartialOnly'), false)
  } finally {
    _setTimeouts(prev)
    _clearCache()
  }
})

test('the shared deadline cuts the storage read short of its own limit', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() })
  const version = '2026-10-17T12:00:00Z'
  const drain = () => new Promise((resolve) => { setImmediate(resolve) })
  let chunkStarted = false
  let storageStartedAt = 0
  let storageFinished = false
  const client = {
    auth: {
      async getUser() {
        return { data: { user: { id: 'u-owner', email: 'owner@example.com' } }, error: null }
      },
    },
    storage: {
      from() {
        return {
          download() {
            storageStartedAt = Date.now()
            return new Promise((resolve) => {
              setTimeout(() => {
                storageFinished = true
                resolve({
                  data: {
                    text: async () => JSON.stringify({
                      data: [{ player: 'StoredOnly', projection: 4, line: 2.5, rankEligible: true, generated_at: new Date().toISOString() }],
                      updated_at: new Date().toISOString(),
                    }),
                  },
                  error: null,
                })
              }, 2_000)
            })
          },
        }
      },
    },
    from(table) {
      const chain = {
        select() { return chain },
        eq() { return chain },
        in() { return chain },
        abortSignal() { return chain },
        maybeSingle() {
          if (table === 'user_profiles') return Promise.resolve({ data: { tier: 'owner' }, error: null })
          return new Promise((resolve) => {
            setTimeout(() => resolve({
              data: {
                id: 1,
                updated_at: version,
                data: { snapshotChunks: { version, generated_at: version, kind: 'list', ids: [10, 11] } },
              },
              error: null,
            }), 4_400)
          })
        },
        then(resolve, reject) {
          chunkStarted = true
          return new Promise(() => {}).then(resolve, reject)
        },
      }
      return chain
    },
  }
  try {
    const res = mockRes()
    const started = Date.now()
    const pending = handleDataRequest(
      { method: 'GET', query: { ds: 'nhl_projections' }, headers: { authorization: bearer('tok-owner') } },
      res,
      client,
    )
    await drain()
    t.mock.timers.tick(4_400)
    await drain()
    t.mock.timers.tick(SNAPSHOT_READ_MS)
    await drain()
    assert.equal(chunkStarted, true)
    assert.ok(storageStartedAt > started)
    const storageMs = stepBudgetMs(started + boardReadBudgetMs(), timeouts.lastGoodReadMs, storageStartedAt)
    assert.ok(storageMs < timeouts.lastGoodReadMs)
    assert.ok(storageMs < 2_000)
    t.mock.timers.tick(storageMs)
    await drain()
    await pending
    assert.equal(storageFinished, false)
    assert.equal(res.statusCode, 503)
    assert.equal(res.body.code, 'upstream_timeout')
    assert.equal(res.body.data, undefined)
    assert.equal(JSON.stringify(res.body).includes('StoredOnly'), false)
    assert.ok(Date.now() - storageStartedAt < timeouts.lastGoodReadMs)
  } finally {
    t.mock.timers.reset()
    _clearCache()
  }
})

test('the snapshot read starts before the tier lookup finishes', async () => {
  for (const ds of ['prizepicks_props', 'nhl_projections']) {
    let released = false
    let release
    const gate = new Promise((resolve) => { release = () => { released = true; resolve() } })
    let sawSnapshot = false
    const client = {
      auth: {
        async getUser() {
          throw new Error('auth.getUser must not run')
        },
      },
      from(table) {
        const chain = {
          select() { return chain },
          eq() { return chain },
          abortSignal() { return chain },
          async maybeSingle() {
            if (table === 'user_profiles') {
              await gate
              return { data: { tier: 'owner' }, error: null }
            }
            assert.equal(released, false, table)
            sawSnapshot = true
            const payload = table === 'nhl_projections'
              ? [{ player: 'Skater', prop: 'Points', line: 0.5, projection: 1, oddsType: 'standard', rankEligible: true }]
              : structuredClone(TABLES[table])
            return { data: { data: payload, updated_at: NOW }, error: null }
          },
        }
        return chain
      },
    }
    _clearCache()
    const res = mockRes()
    const pending = handleDataRequest(
      { method: 'GET', query: { ds }, headers: { authorization: bearer('tok') } },
      res,
      client,
    )
    await new Promise((resolve) => setTimeout(resolve, 30))
    assert.equal(sawSnapshot, true, ds)
    release()
    await pending
    assert.equal(res.statusCode, 200, ds)
    assert.equal(res.body.preview, false, ds)
  }
})

test('shapeForTier walks standard lines only when the cache has not already', () => {
  const rows = [
    { player: 'A', line: 1, projection: 2, line_type: 'standard' },
    { player: 'B', line: 1, projection: 2, line_type: 'goblin' },
  ]
  const filtered = shapeForTier('nfl_projections', rows, 'combined')
  assert.equal(filtered.data.length, 1)
  const cached = shapeForTier('nfl_projections', rows, 'combined', { alreadyStandard: true })
  assert.equal(cached.data.length, 2)
  assert.equal(cached.preview, false)
})

function nflClient({ tier = 'owner', rows = TABLES.nfl_projections } = {}) {
  return {
    auth: {
      async getUser() {
        throw new Error('auth.getUser must not run')
      },
    },
    from(table) {
      const chain = {
        select() { return chain },
        eq() { return chain },
        abortSignal() { return chain },
        async maybeSingle() {
          if (table === 'user_profiles') return { data: { tier }, error: null }
          return { data: { data: structuredClone(rows), updated_at: NOW }, error: null }
        },
      }
      return chain
    },
  }
}

test('the standard-line filter runs once per cached board', async () => {
  const rows = [
    ...structuredClone(TABLES.nfl_projections),
    { player: 'Gob', line: 1, projection: 2, line_type: 'goblin' },
  ]
  const req = { method: 'GET', query: { ds: 'nfl_projections' }, headers: { authorization: bearer('tok-owner') } }
  const first = mockRes()
  await handleDataRequest(req, first, nflClient({ rows }))
  assert.equal(first.statusCode, 200)
  assert.equal(first.body.preview, false)
  assert.equal(first.body.data.some((row) => row.player === 'Gob'), false)
  assert.equal(first.body.data.length, TABLES.nfl_projections.length)
  assert.equal(_standardFilterRuns(), 1)
  assert.equal(_tierShapeFilters(), 0)
  const second = mockRes()
  await handleDataRequest(req, second, nflClient({ rows }))
  assert.equal(_standardFilterRuns(), 1)
  assert.equal(_tierShapeFilters(), 0)
  assert.equal(second.body.data.length, first.body.data.length)
})

test('an anonymous strikeout preview is standard lines only', async () => {
  const rows = {
    projections: [
      { name: 'Naile', line: 17.5, projection: 20, odds_type: 'goblin', prop: 'Strikeouts', rating: 200 },
      { name: 'A', line: 5, projection: 4, odds_type: 'standard', prop: 'Strikeouts', rating: 40 },
      { name: 'B', line: 5, projection: 3, odds_type: 'standard', prop: 'Strikeouts', rating: 30 },
      { name: 'C', line: 5, projection: 2, odds_type: 'standard', prop: 'Strikeouts', rating: 20 },
    ],
  }
  const req = { method: 'GET', query: { ds: 'strikeout_projections' }, headers: {} }
  const free = mockRes()
  await handleDataRequest(req, free, nflClient({ rows }))
  assert.equal(FILTER_STANDARD_BEFORE_FREE_PREVIEW, true)
  assert.equal(free.body.preview, true)
  assert.equal(free.body.data.projections.some((row) => row.name === 'Naile'), false)
  assert.deepEqual(free.body.data.projections.map((row) => row.name), ['A', 'B', 'C'])
  assert.equal(_standardFilterRuns(), 1)
  const paid = mockRes()
  await handleDataRequest(
    { method: 'GET', query: { ds: 'strikeout_projections' }, headers: { authorization: bearer('tok-owner') } },
    paid,
    nflClient({ rows }),
  )
  assert.equal(paid.body.preview, false)
  assert.equal(paid.body.data.projections.some((row) => row.name === 'Naile'), false)
  assert.equal(_standardFilterRuns(), 1)
})

test('the NBA full path drops non-standard props', async () => {
  const players = [
    { name: 'Std', ppAllProps: [{ stat: 'Points', odds_type: 'standard', line: 20, projection: 22 }] },
    { name: 'Demon', ppAllProps: [{ stat: 'Points', odds_type: 'demon', line: 15, projection: 30 }] },
  ]
  const client = {
    auth: {
      async getUser() {
        throw new Error('auth.getUser must not run')
      },
    },
    from(table) {
      const chain = {
        select() { return chain },
        eq() { return chain },
        abortSignal() { return chain },
        async maybeSingle() {
          if (table === 'user_profiles') return { data: { tier: 'owner' }, error: null }
          if (table === 'app_flags') return { data: { value: false }, error: null }
          return { data: { data: structuredClone(players), updated_at: NOW }, error: null }
        },
      }
      return chain
    },
  }
  const res = mockRes()
  await handleDataRequest(
    { method: 'GET', query: { ds: 'nba_projections_standard' }, headers: { authorization: bearer('tok-owner') } },
    res,
    client,
  )
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.preview, false)
  assert.deepEqual(res.body.data.map((row) => row.name), ['Std'])
})

test('a profile timeout with no paid cache returns the free preview', async () => {
  const prev = { ...timeouts }
  _setTimeouts({ tierLookupMs: 40 })
  const nhl = Array.from({ length: 6 }, (_, i) => ({
    player: `S${i}`, prop: 'Points', line: 0.5, projection: 1, oddsType: 'standard', rankEligible: true,
  }))
  try {
    for (const ds of ['prizepicks_props', 'nhl_projections']) {
      const client = {
        auth: {
          async getUser() {
            throw new Error('auth.getUser must not run')
          },
        },
        from(table) {
          const chain = {
            select() { return chain },
            eq() { return chain },
            abortSignal() { return chain },
            maybeSingle() {
              if (table === 'user_profiles') return new Promise(() => {})
              const payload = table === 'nhl_projections' ? nhl : structuredClone(TABLES[table])
              return Promise.resolve({ data: { data: payload, updated_at: NOW }, error: null })
            },
          }
          return chain
        },
      }
      _clearCache()
      const res = mockRes()
      await handleDataRequest(
        { method: 'GET', query: { ds }, headers: { authorization: bearer('tok-fan') } },
        res,
        client,
      )
      assert.equal(res.statusCode, 503, ds)
      assert.equal(res.body.code, 'tier_pending', ds)
      assert.equal(res.body.preview, undefined, ds)
      assert.equal(res.body.data, undefined, ds)
    }
  } finally {
    _setTimeouts(prev)
    _clearCache()
  }
})

test('a burst of 8 concurrent requests shares one profile lookup and returns no previews', async () => {
  _clearCache()
  let profiles = 0
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const client = {
    auth: {
      async getUser() {
        throw new Error('auth.getUser must not run')
      },
    },
    from(table) {
      const chain = {
        select() { return chain },
        eq() { return chain },
        abortSignal() { return chain },
        maybeSingle() {
          if (table === 'user_profiles') {
            profiles += 1
            return gate.then(() => ({ data: { tier: 'combined' }, error: null }))
          }
          return Promise.resolve({
            data: { data: structuredClone(TABLES.prizepicks_props), updated_at: NOW },
            error: null,
          })
        },
      }
      return chain
    },
  }
  const pending = Array.from({ length: 8 }, () => {
    const res = mockRes()
    return handleDataRequest(
      { method: 'GET', query: { ds: 'prizepicks_props' }, headers: { authorization: bearer('tok-fan') } },
      res,
      client,
    ).then(() => res)
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(profiles, 1)
  release()
  const results = await Promise.all(pending)
  assert.equal(profiles, 1)
  for (const res of results) {
    assert.equal(res.statusCode, 200)
    assert.equal(res.body.preview, false)
    assert.equal(res.body.tier, 'combined')
    assert.ok(countProps(res.body.data) > FREE_ROW_LIMIT)
  }
})

test('standard PrizePicks lines are kept and goblin rows are dropped before the free trim', () => {
  const strikeouts = {
    generated_at: NOW,
    projections: [
      { name: 'James Naile', prop: 'Pitching Outs', line: 16.5, rating: 99, odds_type: 'goblin' },
      { name: 'Standard A', prop: 'Strikeouts', line: 5.5, rating: 40, odds_type: 'standard' },
      { name: 'Standard B', prop: 'Strikeouts', line: 4.5, rating: 30, odds_type: 'standard' },
      { name: 'Standard C', prop: 'Strikeouts', line: 6.5, rating: 20, odds_type: 'standard' },
      { name: 'Standard D', prop: 'Strikeouts', line: 3.5, rating: 10, odds_type: 'standard' },
    ],
  }
  const free = shapeForTier('strikeout_projections', strikeouts, 'free')
  const freeNames = free.data.projections.map((row) => row.name)
  assert.equal(freeNames.includes('James Naile'), false)
  assert.deepEqual(freeNames, ['Standard A', 'Standard B', 'Standard C'])
  assert.equal(free.preview, true)
  assert.equal(free.lockedCount, 1)
  assert.equal(strikeouts.projections[0].name, 'James Naile')

  const paid = shapeForTier('strikeout_projections', strikeouts, 'combined')
  assert.equal(paid.preview, false)
  assert.equal(paid.data.projections.some((row) => row.odds_type === 'goblin'), false)
  assert.equal(paid.data.projections.length, 4)

  const cards = {
    generated_at: NOW,
    cards: [{
      name: 'Pitcher',
      props: [
        { stat: 'Pitching Outs', line: 16.5, projection: 20, cg_projection: 99, odds_type: 'goblin', recommendation: 'OVER' },
        { stat: 'Strikeouts', line: 5.5, projection: 6, cg_projection: 40, odds_type: 'standard', recommendation: 'OVER' },
      ],
    }],
  }
  const kbo = shapeForTier('prizepicks_props', cards, 'free')
  const props = kbo.data.cards.flatMap((card) => card.props)
  assert.equal(props.some((prop) => prop.odds_type === 'goblin'), false)
  assert.equal(props.length, 1)
  assert.equal(props[0].stat, 'Strikeouts')

  const nhl = shapeForTier('nhl_projections', [
    { player: 'Goblin', prop: 'Points', line: 0.5, projection: 2, oddsType: 'goblin', rankEligible: true },
    { player: 'Standard', prop: 'Points', line: 0.5, projection: 1, oddsType: 'standard', rankEligible: true },
  ], 'free')
  assert.equal(nhl.data.some((row) => row.oddsType === 'goblin'), false)
  assert.equal(nhl.data[0].player, 'Standard')

  const markets = {
    generated_at: NOW,
    games: [
      { id: 'late', awayTeam: 'A', homeTeam: 'B', spread: { edge: 1 }, total: { edge: 9 }, moneyline: { edge: 0 } },
      { id: 'early', awayTeam: 'C', homeTeam: 'D', spread: { edge: 4 }, total: { edge: 0.2 }, moneyline: { edge: 0 } },
    ],
  }
  const ranked = shapeForTier('nfl_game_markets', markets, 'free')
  const direct = previewNflGameMarkets(markets)
  assert.deepEqual(ranked.data.games.map((game) => game.id), direct.data.games.map((game) => game.id))
  const paidMarkets = shapeForTier('nfl_game_markets', markets, 'combined')
  assert.equal(paidMarkets.data, markets)
})

test('one in-flight read serves a burst for the same table', async () => {
  _clearCache()
  let reads = 0
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const client = mockClient()
  const original = client.from.bind(client)
  client.from = (table) => {
    const chain = original(table)
    if (table !== 'nfl_projections') return chain
    return {
      select() { return this },
      eq() { return this },
      abortSignal() { return this },
      maybeSingle() {
        reads += 1
        return gate.then(() => ({
          data: { data: structuredClone(TABLES.nfl_projections), updated_at: NOW },
          error: null,
        }))
      },
    }
  }
  const req = { method: 'GET', query: { ds: 'nfl_projections' }, headers: { authorization: bearer('tok-owner') } }
  const a = mockRes()
  const b = mockRes()
  const pending = Promise.all([
    handleDataRequest(req, a, client),
    handleDataRequest({ ...req, headers: { ...req.headers } }, b, client),
  ])
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.equal(reads, 1)
  release()
  await pending
  assert.equal(a.statusCode, 200)
  assert.equal(b.statusCode, 200)
  assert.equal(a.body.preview, false)
  assert.equal(b.body.data.length, a.body.data.length)
})

test('a board older than 60s is served while one refresh runs', async () => {
  const prevFresh = cacheWindows.freshMs
  cacheWindows.freshMs = 0
  try {
    _clearCache()
    const first = mockRes()
    await handleDataRequest(
      { method: 'GET', query: { ds: 'nfl_projections' }, headers: { authorization: bearer('tok-owner') } },
      first,
      mockClient(),
    )
    assert.equal(first.statusCode, 200)
    let reads = 0
    let release
    const gate = new Promise((resolve) => { release = resolve })
    const slow = mockClient()
    const original = slow.from.bind(slow)
    slow.from = (table) => {
      const chain = original(table)
      if (table !== 'nfl_projections') return chain
      return {
        select() { return this },
        eq() { return this },
        abortSignal() { return this },
        maybeSingle() {
          reads += 1
          return gate.then(() => chain.maybeSingle())
        },
      }
    }
    const started = Date.now()
    const second = mockRes()
    await handleDataRequest(
      { method: 'GET', query: { ds: 'nfl_projections' }, headers: { authorization: bearer('tok-owner') } },
      second,
      slow,
    )
    assert.equal(second.statusCode, 200)
    assert.equal(second.body.preview, false)
    assert.ok(Date.now() - started < 200, 'stale copy waited on the refresh')
    assert.equal(reads, 1)
    release()
    await new Promise((resolve) => setTimeout(resolve, 20))
  } finally {
    cacheWindows.freshMs = prevFresh
    _clearCache()
  }
})

test('a copy older than 30 min is not served from memory', async () => {
  const prevWindows = { ...cacheWindows }
  const prevTimeouts = { ...timeouts }
  cacheWindows.freshMs = 0
  cacheWindows.staleMs = 0
  _setTimeouts({ snapshotReadMs: 30, tierLookupMs: 30, lastGoodReadMs: 30 })
  try {
    _clearCache()
    const first = mockRes()
    await handleDataRequest(
      { method: 'GET', query: { ds: 'nfl_lineups' }, headers: { authorization: bearer('tok-owner') } },
      first,
      mockClient(),
    )
    assert.equal(first.statusCode, 200)
    const client = mockClient()
    const profiles = mockClient().from('user_profiles')
    client.from = (table) => {
      if (table === 'user_profiles') return profiles
      return {
        select() { return this },
        eq() { return this },
        abortSignal() { return this },
        maybeSingle() { return new Promise(() => {}) },
      }
    }
    const second = mockRes()
    await handleDataRequest(
      { method: 'GET', query: { ds: 'nfl_lineups' }, headers: { authorization: bearer('tok-owner') } },
      second,
      client,
    )
    assert.equal(second.statusCode, 503)
    assert.equal(second.body.code, 'upstream_timeout')
  } finally {
    Object.assign(cacheWindows, prevWindows)
    _setTimeouts(prevTimeouts)
    _clearCache()
  }
})

function freshLastGood(table) {
  const data = structuredClone(TABLES[table])
  if (data && typeof data === 'object' && !Array.isArray(data)) data.generated_at = new Date().toISOString()
  return {
    from() {
      return {
        async download() {
          return {
            data: { text: async () => JSON.stringify({ data, updated_at: new Date().toISOString() }) },
            error: null,
          }
        },
      }
    },
  }
}

test('a storage copy is not served from memory after its age limit', async (t) => {
  const prev = { ...timeouts }
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() })
  _setTimeouts({ snapshotReadMs: 40, tierLookupMs: 500, lastGoodReadMs: 200 })
  const drain = () => new Promise((resolve) => { setImmediate(resolve) })
  const maxAge = lastGoodMaxAgeMs('nhl_projections')
  const left = 60_000
  const generatedAt = new Date(Date.now() - maxAge + left).toISOString()
  const stored = [{ player: 'StoredOnly', projection: 4, line: 2.5, rankEligible: true, oddsType: 'standard', generated_at: generatedAt }]
  let downloads = 0
  const client = {
    auth: {
      async getUser() {
        return { data: { user: { id: 'u-owner', email: 'owner@example.com' } }, error: null }
      },
    },
    storage: {
      from() {
        return {
          download() {
            downloads += 1
            return Promise.resolve({
              data: { text: async () => JSON.stringify({ data: stored, updated_at: generatedAt }) },
              error: null,
            })
          },
        }
      },
    },
    from(table) {
      const chain = {
        select() { return chain },
        eq() { return chain },
        abortSignal() { return chain },
        maybeSingle() {
          if (table === 'user_profiles') return Promise.resolve({ data: { tier: 'owner' }, error: null })
          return new Promise(() => {})
        },
      }
      return chain
    },
  }
  const req = { method: 'GET', query: { ds: 'nhl_projections' }, headers: { authorization: bearer('tok-owner') } }
  try {
    const first = mockRes()
    const firstRead = handleDataRequest(req, first, client)
    await drain()
    t.mock.timers.tick(40)
    await drain()
    await firstRead
    assert.equal(first.statusCode, 200)
    assert.equal(first.body.data[0].player, 'StoredOnly')
    assert.equal(downloads, 1)

    const second = mockRes()
    await handleDataRequest(req, second, client)
    assert.equal(second.statusCode, 200)
    assert.equal(second.body.data[0].player, 'StoredOnly')
    assert.equal(downloads, 1)

    t.mock.timers.tick(left + 1_000)
    await drain()
    const third = mockRes()
    const thirdRead = handleDataRequest(req, third, client)
    await drain()
    t.mock.timers.tick(40)
    await drain()
    await thirdRead
    assert.equal(third.statusCode, 503)
    assert.equal(third.body.code, 'upstream_timeout')
    assert.equal(third.body.data, undefined)
    assert.ok(left + 1_000 < cacheWindows.staleMs)
  } finally {
    t.mock.timers.reset()
    _setTimeouts(prev)
    _clearCache()
  }
})

test('a timed-out KBO or WNBA read serves last-good instead of 503', async () => {
  const prev = { ...timeouts }
  _setTimeouts({ snapshotReadMs: 30, tierLookupMs: 30, lastGoodReadMs: 200 })
  try {
    for (const ds of ['wnba_projections_standard', 'prizepicks_props', 'strikeout_projections', 'batter_projections', 'wnba_lineups']) {
      _clearCache()
      const client = mockClient()
      const profiles = mockClient().from('user_profiles')
      client.storage = freshLastGood(ds)
      client.from = (table) => {
        if (table === 'user_profiles') return profiles
        return {
          select() { return this },
          eq() { return this },
          abortSignal() { return this },
          maybeSingle() { return new Promise(() => {}) },
        }
      }
      const res = mockRes()
      await handleDataRequest(
        { method: 'GET', query: { ds }, headers: { authorization: bearer('tok-owner') } },
        res,
        client,
      )
      assert.equal(res.statusCode, 200, ds)
      assert.equal(res.body.preview, false, ds)
      assert.ok(res.body.data, ds)
    }
  } finally {
    _setTimeouts(prev)
    _clearCache()
  }
})

test('the next good KBO read writes one last-good copy and a later timeout serves it', async () => {
  const stored = new Map()
  let uploads = 0
  const client = mockClient()
  client.storage = {
    from() {
      return {
        upload(path, body) {
          uploads += 1
          stored.set(path, JSON.parse(Buffer.from(body).toString('utf8')))
          return Promise.resolve({ error: null })
        },
        async download(path) {
          const body = stored.get(path)
          if (!body) return { data: null, error: { message: 'missing' } }
          return { data: { text: async () => JSON.stringify(body) }, error: null }
        },
      }
    },
  }
  const first = mockRes()
  await handleDataRequest(
    { method: 'GET', query: { ds: 'prizepicks_props' }, headers: { authorization: bearer('tok-kbo') } },
    first,
    client,
  )
  await _lastGoodWrite('prizepicks_props')
  assert.equal(first.body.preview, false)
  assert.equal(uploads, 1)
  assert.equal(stored.has('prizepicks_props.json'), true)
  assert.ok(stored.get('prizepicks_props.json').data.cards.length > 3)
  const freshAt = new Date().toISOString()
  stored.get('prizepicks_props.json').data.generated_at = freshAt
  stored.get('prizepicks_props.json').updated_at = freshAt

  const second = mockRes()
  await handleDataRequest(
    { method: 'GET', query: { ds: 'prizepicks_props' }, headers: { authorization: bearer('tok-kbo') } },
    second,
    client,
  )
  await _lastGoodWrite('prizepicks_props')
  assert.equal(uploads, 1)

  const prev = { ...timeouts }
  _setTimeouts({ snapshotReadMs: 30, tierLookupMs: 200, lastGoodReadMs: 200 })
  const profiles = mockClient().from('user_profiles')
  client.from = (table) => {
    if (table === 'user_profiles') return profiles
    return {
      select() { return this },
      eq() { return this },
      abortSignal() { return this },
      maybeSingle() { return new Promise(() => {}) },
    }
  }
  try {
    _clearCache()
    const timedOut = mockRes()
    await handleDataRequest(
      { method: 'GET', query: { ds: 'prizepicks_props' }, headers: { authorization: bearer('tok-kbo') } },
      timedOut,
      client,
    )
    assert.equal(timedOut.statusCode, 200)
    assert.equal(timedOut.body.preview, false)
    assert.ok(timedOut.body.data.cards.length > 3)
    assert.equal(uploads, 1)
  } finally {
    _setTimeouts(prev)
    _clearCache()
  }
})

test('an empty KBO board is not saved as a last-good copy', async () => {
  let uploads = 0
  const client = mockClient()
  const original = client.from.bind(client)
  client.from = (table) => {
    if (table !== 'prizepicks_props' && table !== 'strikeout_projections') return original(table)
    const chain = {
      select() { return chain },
      eq() { return chain },
      async maybeSingle() {
        const data = table === 'prizepicks_props'
          ? { generated_at: NOW, cards: [] }
          : { generated_at: NOW, projections: [] }
        return { data: { data, updated_at: NOW }, error: null }
      },
    }
    return chain
  }
  client.storage = {
    from() {
      return { upload() { uploads += 1; return Promise.resolve({ error: null }) } }
    },
  }
  for (const ds of ['prizepicks_props', 'strikeout_projections']) {
    _clearCache()
    uploads = 0
    const res = mockRes()
    await handleDataRequest(
      { method: 'GET', query: { ds }, headers: { authorization: bearer('tok-kbo') } },
      res,
      client,
    )
    await _lastGoodWrite(ds)
    assert.equal(res.statusCode, 200, ds)
    assert.equal(uploads, 0, ds)
  }
})

test('a changed board version or updated_at rewrites the last-good copy', async () => {
  const prevFresh = cacheWindows.freshMs
  cacheWindows.freshMs = 0
  let uploads = 0
  let generated = '2026-10-17T12:00:00.000Z'
  let updated = generated
  const client = mockClient()
  const original = client.from.bind(client)
  client.from = (table) => {
    if (table !== 'prizepicks_props') return original(table)
    const chain = {
      select() { return chain },
      eq() { return chain },
      async maybeSingle() {
        return {
          data: {
            data: { generated_at: generated, cards: [{ name: 'A', props: [{ stat: 'Strikeouts', line: 5.5, projection: 6 }] }] },
            updated_at: updated,
          },
          error: null,
        }
      },
    }
    return chain
  }
  client.storage = {
    from() {
      return { upload() { uploads += 1; return Promise.resolve({ error: null }) } }
    },
  }
  const read = async () => {
    const res = mockRes()
    await handleDataRequest(
      { method: 'GET', query: { ds: 'prizepicks_props' }, headers: { authorization: bearer('tok-kbo') } },
      res,
      client,
    )
    await new Promise((resolve) => setImmediate(resolve))
    await _lastGoodWrite('prizepicks_props')
    return res
  }
  try {
    _clearCache()
    await read()
    assert.equal(uploads, 1)
    await read()
    assert.equal(uploads, 1)
    generated = '2026-10-17T13:00:00.000Z'
    await read()
    assert.equal(uploads, 2)
    updated = '2026-10-17T13:00:01.000Z'
    await read()
    assert.equal(uploads, 3)
  } finally {
    cacheWindows.freshMs = prevFresh
    _clearCache()
  }
})

test('a slow last-good upload does not delay the response', async () => {
  let release
  const hung = new Promise((resolve) => { release = () => resolve({ error: null }) })
  const client = mockClient()
  client.storage = {
    from() {
      return { upload() { return hung } }
    },
  }
  const started = Date.now()
  const res = mockRes()
  await handleDataRequest(
    { method: 'GET', query: { ds: 'prizepicks_props' }, headers: { authorization: bearer('tok-kbo') } },
    res,
    client,
  )
  const elapsed = Date.now() - started
  release()
  await _lastGoodWrite('prizepicks_props')
  assert.equal(res.statusCode, 200)
  assert.ok(elapsed < 500, `response waited ${elapsed}ms`)
})

test('board clocks fall back when the status table is missing', async () => {
  const client = {
    from() {
      const chain = {
        select() { return chain },
        eq() { return chain },
        async maybeSingle() {
          return { data: null, error: { message: 'relation board_status does not exist' } }
        },
      }
      return chain
    },
  }
  const res = mockRes()
  await handleDataRequest({ method: 'GET', query: { ds: 'board_status' }, headers: {} }, res, client)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.boards.length, 5)
  assert.equal(JSON.stringify(res.body).includes('cards'), false)
})

test('a stale nba_players refresh stores the joined player list', async () => {
  let chunkReads = 0
  const client = {
    auth: {
      async getUser() {
        return { data: { user: { id: 'u-owner', email: 'CGPropz@gmail.com' } }, error: null }
      },
    },
    from(table) {
      const chain = {
        select() { return chain },
        eq() { return chain },
        gt() { return chain },
        order() { return chain },
        abortSignal() { return chain },
        maybeSingle() {
          if (table === 'user_profiles') return Promise.resolve({ data: { tier: 'owner' }, error: null })
          if (table === 'app_flags') return Promise.resolve({ data: { value: false }, error: null })
          return Promise.resolve({
            data: { data: { nbaPlayerChunks: 2 }, updated_at: '2026-10-07T00:00:00Z' },
            error: null,
          })
        },
        then(resolve, reject) {
          const generation = chunkReads
          chunkReads += 1
          return Promise.resolve({
            data: [
              { id: 2, data: [{ athleteId: generation === 0 ? 'a' : 'a2' }], updated_at: '2026-10-07T00:00:00Z' },
              { id: 3, data: [{ athleteId: 'b' }], updated_at: '2026-10-07T00:00:00Z' },
            ],
            error: null,
          }).then(resolve, reject)
        },
      }
      return chain
    },
  }
  const req = { method: 'GET', query: { ds: 'nba_players' }, headers: { authorization: bearer('tok-owner') } }
  const first = mockRes()
  await handleDataRequest(req, first, client)
  assert.equal(first.statusCode, 200)
  assert.deepEqual(first.body.data.map((row) => row.athleteId), ['a', 'b'])
  assert.equal(chunkReads, 1)

  const prevFresh = cacheWindows.freshMs
  cacheWindows.freshMs = 0
  try {
    const second = mockRes()
    await handleDataRequest(req, second, client)
    assert.deepEqual(second.body.data.map((row) => row.athleteId), ['a', 'b'])
    const started = Date.now()
    while (chunkReads < 2) {
      if (Date.now() - started > 1000) throw new Error('background refresh did not read chunks')
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
    cacheWindows.freshMs = prevFresh
    const third = mockRes()
    await handleDataRequest(req, third, client)
    assert.deepEqual(third.body.data.map((row) => row.athleteId), ['a2', 'b'])
    assert.equal(chunkReads, 2)
  } finally {
    cacheWindows.freshMs = prevFresh
  }
})

test('a failed nba_players refresh keeps the last good in-memory copy for the fallback', async () => {
  let phase = 'good'
  let chunkReads = 0
  const client = {
    auth: {
      async getUser() {
        return { data: { user: { id: 'u-owner', email: 'CGPropz@gmail.com' } }, error: null }
      },
    },
    storage: {
      from() {
        return {
          async download() {
            return {
              data: {
                text: async () => JSON.stringify({
                  data: [{ athleteId: 'stored' }],
                  updated_at: new Date().toISOString(),
                }),
              },
              error: null,
            }
          },
        }
      },
    },
    from(table) {
      const chain = {
        select() { return chain },
        eq() { return chain },
        gt() { return chain },
        order() { return chain },
        abortSignal() { return chain },
        maybeSingle() {
          if (table === 'user_profiles') return Promise.resolve({ data: { tier: 'owner' }, error: null })
          if (table === 'app_flags') return Promise.resolve({ data: { value: false }, error: null })
          return Promise.resolve({
            data: { data: { nbaPlayerChunks: 2 }, updated_at: '2026-10-07T00:00:00Z' },
            error: null,
          })
        },
        then(resolve, reject) {
          chunkReads += 1
          const rows = phase === 'good'
            ? [
              { id: 2, data: [{ athleteId: 'a' }], updated_at: '2026-10-07T00:00:00Z' },
              { id: 3, data: [{ athleteId: 'b' }], updated_at: '2026-10-07T00:00:00Z' },
            ]
            : [{ id: 2, data: { version: 'other', players: [{ athleteId: 'partial' }] }, updated_at: '2026-10-07T00:00:00Z' }]
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject)
        },
      }
      return chain
    },
  }
  const req = { method: 'GET', query: { ds: 'nba_players' }, headers: { authorization: bearer('tok-owner') } }
  const first = mockRes()
  await handleDataRequest(req, first, client)
  assert.deepEqual(first.body.data.map((row) => row.athleteId), ['a', 'b'])

  const prevFresh = cacheWindows.freshMs
  cacheWindows.freshMs = 0
  phase = 'bad'
  try {
    const second = mockRes()
    await handleDataRequest(req, second, client)
    assert.deepEqual(second.body.data.map((row) => row.athleteId), ['a', 'b'])
    const started = Date.now()
    while (chunkReads < 2) {
      if (Date.now() - started > 1000) throw new Error('background refresh did not read chunks')
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    await new Promise((resolve) => setTimeout(resolve, 30))
    const third = mockRes()
    await handleDataRequest(req, third, client)
    assert.equal(third.statusCode, 200)
    assert.deepEqual(third.body.data.map((row) => row.athleteId), ['a', 'b'])
    assert.equal(JSON.stringify(third.body).includes('partial'), false)
    assert.equal(JSON.stringify(third.body).includes('stored'), false)
  } finally {
    cacheWindows.freshMs = prevFresh
  }
})

test('a fresh private vercel copy is served before supabase and stays gated', async () => {
  const fresh = new Date().toISOString()
  const board = {
    generated_at: fresh,
    cards: [{
      name: 'James Naile',
      props: [
        { stat: 'Pitching Outs', line: 16.5, projection: 20, cg_projection: 99, odds_type: 'goblin', recommendation: 'OVER' },
        { stat: 'Strikeouts', line: 5.5, projection: 6, cg_projection: 40, odds_type: 'standard', recommendation: 'OVER' },
        { stat: 'Hits Allowed', line: 4.5, projection: 5, cg_projection: 30, odds_type: 'standard', recommendation: 'OVER' },
        { stat: 'Walks', line: 1.5, projection: 2, cg_projection: 20, odds_type: 'standard', recommendation: 'OVER' },
        { stat: 'Earned Runs', line: 2.5, projection: 3, cg_projection: 10, odds_type: 'standard', recommendation: 'OVER' },
        { stat: 'Home Runs Allowed', line: 0.5, projection: 1, cg_projection: 8, odds_type: 'standard', recommendation: 'OVER' },
      ],
    }],
  }
  let fetches = 0
  let supabaseReads = 0
  process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_store123'
  _setBoardCopyFetch(async (url, init) => {
    fetches += 1
    assert.match(String(url), /https:\/\/store123\.private\.blob\.vercel-storage\.com\/boards\/prizepicks_props\.json\?cache=0$/)
    assert.equal(init.headers.authorization, 'Bearer vercel_blob_rw_store123')
    return { ok: true, status: 200, json: async () => ({ data: board, updated_at: fresh }) }
  })
  const client = mockClient()
  const original = client.from.bind(client)
  client.from = (table) => {
    const chain = original(table)
    if (table !== 'prizepicks_props') return chain
    return {
      select() { return this },
      eq() { return this },
      abortSignal() { return this },
      async maybeSingle() {
        supabaseReads += 1
        await new Promise((resolve) => setTimeout(resolve, 700))
        return { data: { data: structuredClone(TABLES.prizepicks_props), updated_at: fresh }, error: null }
      },
    }
  }
  const started = Date.now()
  const paid = mockRes()
  await handleDataRequest(
    { method: 'GET', query: { ds: 'prizepicks_props' }, headers: { authorization: bearer('tok-kbo') } },
    paid,
    client,
  )
  const copyMs = Date.now() - started
  assert.equal(paid.statusCode, 200)
  assert.equal(paid.body.source, 'vercel')
  assert.equal(paid.body.preview, false)
  assert.equal(paid.body.tier, 'kbo')
  assert.equal(fetches, 1)
  assert.equal(supabaseReads, 0)
  assert.ok(copyMs < 400, `vercel copy took ${copyMs}ms`)
  const paidProps = paid.body.data.cards.flatMap((card) => card.props)
  assert.equal(paidProps.some((prop) => prop.odds_type === 'goblin'), false)
  assert.equal(paidProps.length, 5)

  _clearCache()
  const free = mockRes()
  await handleDataRequest(
    { method: 'GET', query: { ds: 'prizepicks_props' }, headers: { authorization: bearer('tok-free') } },
    free,
    client,
  )
  assert.equal(free.body.source, 'vercel')
  assert.equal(free.body.preview, true)
  assert.equal(free.body.tier, 'free')
  assert.ok(free.body.lockedCount > 0)
  assert.equal(free.body.data.cards.flatMap((card) => card.props).some((prop) => prop.odds_type === 'goblin'), false)

  _clearCache()
  delete process.env.BLOB_READ_WRITE_TOKEN
  _setBoardCopyFetch(async () => {
    throw new Error('blob should not be read without a token')
  })
  const slowStarted = Date.now()
  const slow = mockRes()
  await handleDataRequest(
    { method: 'GET', query: { ds: 'prizepicks_props' }, headers: { authorization: bearer('tok-kbo') } },
    slow,
    client,
  )
  const supabaseMs = Date.now() - slowStarted
  assert.equal(slow.body.source, 'supabase')
  assert.equal(slow.body.preview, false)
  assert.equal(supabaseReads, 1)
  assert.ok(supabaseMs >= 700, `supabase read took ${supabaseMs}ms`)
  console.log(`board copy timing: supabase ${supabaseMs}ms, vercel ${copyMs}ms`)
})

test('a stale or missing vercel copy falls through to supabase', async () => {
  const stale = new Date(Date.now() - (13 * 60 * 60 * 1000)).toISOString()
  let fetches = 0
  process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_store123'
  _setBoardCopyFetch(async () => {
    fetches += 1
    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: { generated_at: stale, cards: [{ name: 'Old', props: [{ stat: 'Strikeouts', line: 5.5, odds_type: 'standard' }] }] },
        updated_at: stale,
      }),
    }
  })
  const res = mockRes()
  await handleDataRequest(
    { method: 'GET', query: { ds: 'prizepicks_props' }, headers: { authorization: bearer('tok-kbo') } },
    res,
    mockClient(),
  )
  assert.equal(fetches, 1)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.source, 'supabase')
  assert.equal(res.body.data.generated_at, NOW)

  _clearCache()
  _setBoardCopyFetch(async () => ({ ok: false, status: 404, json: async () => ({}) }))
  const missing = mockRes()
  await handleDataRequest(
    { method: 'GET', query: { ds: 'prizepicks_props' }, headers: {} },
    missing,
    mockClient(),
  )
  assert.equal(missing.body.source, 'supabase')
  assert.equal(missing.body.preview, true)
})

test('nfl totals from the vercel copy keep the same ranking', async () => {
  const fresh = new Date().toISOString()
  const markets = structuredClone(TABLES.nfl_game_markets)
  markets.generated_at = fresh
  process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_store123'
  _setBoardCopyFetch(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ data: markets, updated_at: fresh }),
  }))
  const free = mockRes()
  await handleDataRequest(
    { method: 'GET', query: { ds: 'nfl_game_markets' }, headers: {} },
    free,
    mockClient(),
  )
  const ranked = previewNflGameMarkets(markets)
  assert.equal(free.body.source, 'vercel')
  assert.deepEqual(free.body.data.games.map((game) => game.id), ranked.data.games.map((game) => game.id))

  _clearCache()
  const paid = mockRes()
  await handleDataRequest(
    { method: 'GET', query: { ds: 'nfl_game_markets' }, headers: { authorization: bearer('tok-owner') } },
    paid,
    mockClient(),
  )
  assert.equal(paid.body.preview, false)
  assert.equal(paid.body.source, 'vercel')
  assert.deepEqual(paid.body.data.games.map((game) => game.id), markets.games.map((game) => game.id))
})
