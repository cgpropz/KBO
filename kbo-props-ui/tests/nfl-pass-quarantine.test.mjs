import assert from 'node:assert/strict'
import test from 'node:test'
import { handleDataRequest, showPassClusterFromRequest, _clearCache } from '../api/data.js'
import { selectFreeSharpOddsPreview, shapeForTier } from '../api/_dataAccess.js'
import { bearerFor, installJwtSecret } from './access-token.mjs'
import { selectFreeTop3 } from '../src/freeTopPicks.js'
import { isNflPassClusterStat, normalizeNflStat, withoutNflPassCluster } from '../src/nflPassQuarantine.js'
import { nflHubRows } from '../src/memberHub.js'
import { publicFreeTopRows } from '../src/publicBoard.js'

installJwtSecret()

const FUTURE = '2099-06-01T23:00:00Z'
const NOW = '2026-10-26T16:00:00Z'

function row(overrides) {
  return {
    player: 'Player',
    prop: 'Receptions',
    line: 4.5,
    projection: 6.2,
    line_type: 'standard',
    start_time: FUTURE,
    ...overrides,
  }
}

const BOARD = [
  row({ player: 'Passer', prop: 'Pass Yards', line: 220.5, projection: 310 }),
  row({ player: 'Attempts', prop: 'Pass Attempts', line: 30.5, projection: 38 }),
  row({ player: 'Completions', prop: 'Completions', line: 20.5, projection: 28 }),
  row({ player: 'Combo', prop: 'Pass + Rush Yards', line: 250.5, projection: 320 }),
  row({ player: 'Touchdowns', prop: 'Pass TDs', line: 1.5, projection: 2.4 }),
  row({ player: 'Scramble', prop: 'Pass+Rush+Rec TDs', line: 1.5, projection: 2.2 }),
  row({ player: 'Back', prop: 'Rush Yards', line: 50.5, projection: 80 }),
  row({ player: 'Catch', prop: 'Receiving Yards', line: 60.5, projection: 84 }),
]

test('pass cluster aliases match the board names and leave the neighboring stats', () => {
  for (const stat of [
    'Pass Yards', 'Passing Yards', 'Pass Yds',
    'Pass Attempts', 'Passing Attempts',
    'Pass Completions', 'Completions',
    'Pass+Rush Yds', 'Pass + Rush Yards', 'Passing and Rushing Yards',
  ]) {
    assert.equal(isNflPassClusterStat(stat), true, stat)
  }
  for (const stat of ['Pass TDs', 'Pass+Rush+Rec TDs', 'Rush Yards', 'Receiving Yards', 'Receptions', 'Rush Attempts']) {
    assert.equal(isNflPassClusterStat(stat), false, stat)
  }
  assert.equal(normalizeNflStat('Pass+Rush+Rec TDs'), 'pass + rush + rec tds')
})

test('the paid NFL board hides the pass cluster until pass=all, and other sports keep every row', () => {
  const paid = shapeForTier('nfl_projections', BOARD, 'combined', { now: new Date(NOW) })
  assert.equal(paid.preview, false)
  assert.deepEqual(paid.data.map((item) => item.player).sort(), ['Back', 'Catch', 'Scramble', 'Touchdowns'])
  const revealed = shapeForTier('nfl_projections', BOARD, 'combined', { showPassCluster: true, now: new Date(NOW) })
  assert.equal(revealed.data.some((item) => item.player === 'Passer' && item.projection === 310), true)
  assert.equal(revealed.data.length, BOARD.length)
  const nhl = shapeForTier('nhl_projections', [
    { player: 'Skater', prop: 'Points', line: 0.5, projection: 1.2, oddsType: 'standard', rankEligible: true },
    { player: 'Odd Name', prop: 'Pass Yards', line: 200.5, projection: 240, oddsType: 'standard', rankEligible: true },
  ], 'combined', { now: new Date(NOW) })
  assert.deepEqual(nhl.data.map((item) => item.player).sort(), ['Odd Name', 'Skater'])
})

test('free top 3 skips the pass cluster even when those rows score highest and pass=all is set', () => {
  const free = shapeForTier('nfl_projections', BOARD, 'free', { showPassCluster: true, now: new Date(NOW) })
  assert.equal(free.preview, true)
  assert.equal(free.data.some((item) => ['Passer', 'Attempts', 'Completions', 'Combo'].includes(item.player)), false)
  assert.ok(free.data.length > 0)
  assert.ok(free.data.length <= 3)
  assert.equal(free.lineEdges.some((item) => item.player === 'Passer'), true)
  const picked = selectFreeTop3(nflHubRows(BOARD), 'nfl', new Date(NOW)).map((item) => item.player)
  assert.equal(picked.includes('Passer'), false)
  assert.equal(picked.includes('Attempts'), false)
  const landing = publicFreeTopRows(nflHubRows(BOARD), 3, new Date(NOW)).map((item) => item.player)
  assert.equal(landing.includes('Passer'), false)
  const other = publicFreeTopRows([
    { player: 'Wnba', sport: 'wnba', stat: 'Points', line: 20.5, projection: 28, score: 80, line_type: 'standard' },
  ])
  assert.deepEqual(other.map((item) => item.player), ['Wnba'])
})

test('PP Odds hides the same stats on the default board and in the free preview', () => {
  const records = [
    { player: 'Passer', prop: 'Passing Yards', recommendation: 'OVER', pp_line: 220.5, matched_line: 220.5, line_match: 'exact', pp_edge_flex: 40, line_type: 'standard' },
    { player: 'Back', prop: 'Rush Yards', recommendation: 'OVER', pp_line: 40.5, matched_line: 40.5, line_match: 'exact', pp_edge_flex: 4, line_type: 'standard' },
    { player: 'Catch', prop: 'Receptions', recommendation: 'OVER', pp_line: 5.5, matched_line: 5.5, line_match: 'exact', pp_edge_flex: 3, line_type: 'standard' },
  ]
  const paid = shapeForTier('nfl_sharp_odds', { records, message: 'matched' }, 'combined')
  assert.deepEqual(paid.data.records.map((item) => item.player), ['Back', 'Catch'])
  assert.equal(paid.data.message, 'matched')
  const revealed = shapeForTier('nfl_sharp_odds', { records, message: 'matched' }, 'combined', { showPassCluster: true })
  assert.deepEqual(revealed.data.records.map((item) => item.player), ['Passer', 'Back', 'Catch'])
  const free = shapeForTier('nfl_sharp_odds', { records }, 'free', { showPassCluster: true })
  assert.equal(free.data.records.some((item) => item.player === 'Passer'), false)
  assert.deepEqual(selectFreeSharpOddsPreview(records, 'nfl').map((item) => item.player), ['Back', 'Catch'])
  assert.equal(withoutNflPassCluster('nhl_sharp_odds', { records }).records.length, 3)
})

function mockRes() {
  return {
    statusCode: 200, headers: {}, body: undefined,
    setHeader(key, value) { this.headers[key.toLowerCase()] = value },
    status(code) { this.statusCode = code; return this },
    json(obj) { this.body = obj; return this },
  }
}

test('pass=all on the data route restores the cluster for a paid NFL board only', async () => {
  assert.equal(showPassClusterFromRequest({ query: { pass: 'all' } }), true)
  assert.equal(showPassClusterFromRequest({ query: { pass: 'ALL' } }), true)
  assert.equal(showPassClusterFromRequest({ query: { lines: 'all' } }), false)
  _clearCache()
  const rows = BOARD.map((item) => ({ ...item }))
  const client = {
    auth: { async getUser() { throw new Error('auth.getUser must not run') } },
    from(table) {
      const chain = {
        select() { return chain },
        eq() { return chain },
        abortSignal() { return chain },
        async maybeSingle() {
          if (table === 'user_profiles') return { data: { tier: 'owner' }, error: null }
          return { data: { data: structuredClone(rows), updated_at: NOW }, error: null }
        },
      }
      return chain
    },
  }
  const hidden = mockRes()
  await handleDataRequest(
    { method: 'GET', query: { ds: 'nfl_projections' }, headers: { authorization: `Bearer ${bearerFor('tok-owner')}` } },
    hidden,
    client,
  )
  assert.equal(hidden.statusCode, 200)
  assert.equal(hidden.body.preview, false)
  assert.equal(hidden.body.data.some((item) => item.player === 'Passer'), false)
  const shown = mockRes()
  await handleDataRequest(
    { method: 'GET', query: { ds: 'nfl_projections', pass: 'all' }, headers: { authorization: `Bearer ${bearerFor('tok-owner')}` } },
    shown,
    client,
  )
  assert.equal(shown.body.data.some((item) => item.player === 'Passer'), true)
  assert.equal(shown.body.data.find((item) => item.player === 'Passer').projection, 310)
})
