import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { handleDataRequest, _clearCache } from '../api/data.js'
import { shapeForTier } from '../api/_dataAccess.js'
import { _setKboHold, applyKboHold, kboHold, kboHoldActive, KBO_HOLD_MESSAGE } from '../api/_kboHold.js'
import { kboHubRows, playableRows, topHubRows } from '../src/memberHub.js'
import { scoreFor } from '../src/kboBoardScore.js'
import { keepSlipRow } from '../src/slipAvailability.js'
import { prizepicksPulled } from '../src/nhl/pointsGate.js'

const FILE = kboHold()
// Far-future expiry so these cases do not depend on the clock; expiry has its own test.
const HOLD = { active: true, since: '2026-10-20T00:30:00Z', expires_at: '2099-01-01T00:00:00Z', message: KBO_HOLD_MESSAGE }
const START = '2026-10-20T18:30:00+09:00'
const prop = (stat, line, projection) => ({ stat, line, projection, odds_type: 'standard', recommendation: 'OVER', rating: 80 })
// 7:31 PM ET build: stale lines, no pull confirmation (Cloudflare 429s).
function staleBoard(pull) {
  return {
    generated_at: '2026-10-19T23:31:00Z',
    ...(pull ? { prizepicks_pull: pull } : {}),
    cards: [
      { name: 'Dong Won Park', team: 'LG', opponent: 'Kia', start_time: START, game_date: '2026-10-20', props: [prop('Total Bases', 0.5, 0.97)] },
      { name: 'Harold Castro', team: 'Kia', opponent: 'LG', start_time: START, game_date: '2026-10-20', props: [prop('Hitter Fantasy Score', 6, 8.87)] },
    ],
  }
}
const projections = (pull) => ({ ...(pull ? { prizepicks_pull: pull } : {}), projections: [
  { name: 'Oller', prop: 'Strikeouts', line: 5.5, projection: 6.1, rating: 70, odds_type: 'standard' },
] })
const fresh = (checked_at) => ({ status: 'fresh', checked_at, pulled_props: 0 })

test('committed hold file is on, with the Lines not posted yet message', () => {
  assert.equal(FILE.active, true)
  assert.equal(FILE.message, 'Lines not posted yet')
  assert.ok(Number.isFinite(Date.parse(FILE.since)))
  assert.equal(FILE.expires_at, '2026-10-20T16:00:00Z')
})

test('hold marks every KBO prop pulled and nothing else', () => {
  const held = applyKboHold('prizepicks_props', staleBoard(), HOLD)
  assert.deepEqual(held.kbo_hold, { active: true, since: HOLD.since, expires_at: HOLD.expires_at, message: 'Lines not posted yet' })
  const props = held.cards.flatMap((c) => c.props)
  assert.equal(props.length, 2)
  for (const p of props) {
    assert.equal(prizepicksPulled(p), true)
    assert.equal(p.pulled_reason, 'kbo_hold')
    assert.equal(scoreFor(p), null)
  }
  // Projection, line and rating are untouched (no formula, score or price change).
  assert.deepEqual(props.map((p) => [p.projection, p.line, p.rating]), [[0.97, 0.5, 80], [8.87, 6, 80]])
  const k = applyKboHold('strikeout_projections', projections(), HOLD)
  assert.equal(k.projections.every(prizepicksPulled), true)
  assert.equal(keepSlipRow(k.projections[0]), false)
})

test('held board: member board, free top 3 and hub are empty', () => {
  const held = applyKboHold('prizepicks_props', staleBoard(), HOLD)
  const paid = shapeForTier('prizepicks_props', held, 'owner')
  assert.deepEqual(paid.data.cards, [])
  assert.equal(paid.data.kbo_hold.active, true)
  const free = shapeForTier('prizepicks_props', held, 'free')
  assert.deepEqual(free.data.cards, [])
  assert.equal(free.lockedCount, 0)
  assert.equal(free.data.kbo_hold.message, 'Lines not posted yet')
  assert.deepEqual(topHubRows(playableRows(kboHubRows(held)), 3), [])
  const ks = shapeForTier('strikeout_projections', applyKboHold('strikeout_projections', projections(), HOLD), 'free')
  assert.deepEqual(ks.data.projections, [])
  // Board QA 9:20 PM: under the hold the free preview locked count is 0 (it was 9 batter, 4 K).
  assert.equal(ks.lockedCount, 0)
  const batters = { projections: Array.from({ length: 12 }, (_, i) => ({ name: `B${i}`, prop: 'Total Bases', line: 0.5, projection: 1 + i / 10, odds_type: 'standard' })) }
  const bp = shapeForTier('batter_projections', applyKboHold('batter_projections', batters, HOLD), 'free')
  assert.deepEqual([bp.data.projections.length, bp.lockedCount], [0, 0])
  const ks4 = { projections: Array.from({ length: 7 }, (_, i) => ({ name: `P${i}`, prop: 'Strikeouts', line: 4.5, projection: 5 + i / 10, odds_type: 'standard' })) }
  const kp = shapeForTier('strikeout_projections', applyKboHold('strikeout_projections', ks4, HOLD), 'free')
  assert.deepEqual([kp.data.projections.length, kp.lockedCount], [0, 0])
  // Not held: the usual top 3 + locked remainder.
  const open = shapeForTier('batter_projections', batters, 'free')
  assert.deepEqual([open.data.projections.length, open.lockedCount], [3, 9])
})

test('hold clears on its own after a fresh pull with live lines, or when turned off', () => {
  // A fetch error or confirmed-empty pull keeps it.
  assert.equal(kboHoldActive('prizepicks_props', staleBoard({ status: 'confirmed_empty', checked_at: '2026-10-20T01:00:00Z' }), HOLD), true)
  assert.equal(kboHoldActive('prizepicks_props', staleBoard({ status: 'fetch_error', checked_at: '2026-10-20T01:00:00Z' }), HOLD), true)
  // A fresh pull from before the hold does not clear it.
  assert.equal(kboHoldActive('prizepicks_props', staleBoard(fresh('2026-10-19T23:30:00Z')), HOLD), true)
  // A fresh pull after the hold with every prop pulled still has no lines.
  const allPulled = staleBoard(fresh('2026-10-20T03:00:00Z'))
  allPulled.cards.forEach((c) => c.props.forEach((p) => Object.assign(p, { removed: true, pp_status: 'removed' })))
  assert.equal(kboHoldActive('prizepicks_props', allPulled, HOLD), true)
  // Lines re-posted: fresh pull after `since` with a live prop.
  const back = staleBoard(fresh('2026-10-20T03:00:00Z'))
  assert.equal(kboHoldActive('prizepicks_props', back, HOLD), false)
  assert.equal(applyKboHold('prizepicks_props', back, HOLD), back)
  assert.equal(kboHoldActive('batter_projections', projections(fresh('2026-10-20T03:00:00Z')), HOLD), false)
  // Flag removed or off.
  assert.equal(kboHoldActive('prizepicks_props', staleBoard(), null), false)
  assert.equal(kboHoldActive('prizepicks_props', staleBoard(), { ...HOLD, active: false }), false)
  // Other datasets and sports are never touched.
  const wnba = [{ name: 'W', ppAllProps: [prop('Points', 10, 12)] }]
  assert.equal(applyKboHold('wnba_projections_standard', wnba, HOLD), wnba)
})

function mockClient(tables) {
  return {
    auth: { async getUser() { return { data: { user: null }, error: { message: 'invalid JWT' } } } },
    from(table) {
      const chain = {
        select() { return chain },
        eq() { return chain },
        async maybeSingle() {
          if (!(table in tables)) return { data: null, error: null }
          return { data: { data: structuredClone(tables[table]), updated_at: '2026-10-19T23:31:00Z' }, error: null }
        },
      }
      return chain
    },
  }
}

async function call(ds, tables) {
  const res = { statusCode: 200, headers: {}, body: undefined, setHeader(k, v) { this.headers[k.toLowerCase()] = v }, status(c) { this.statusCode = c; return this }, json(o) { this.body = o; return this } }
  await handleDataRequest({ method: 'GET', query: { ds }, headers: {} }, res, mockClient(tables))
  return res
}

test('/api/data serves the held KBO board to logged-out visitors', async () => {
  _setKboHold(HOLD)
  _clearCache()
  const res = await call('prizepicks_props', { prizepicks_props: staleBoard() })
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body.data.cards, [])
  assert.equal(res.body.data.kbo_hold.message, 'Lines not posted yet')
  _clearCache()
  const back = await call('prizepicks_props', { prizepicks_props: staleBoard(fresh('2026-10-20T03:00:00Z')) })
  assert.ok(back.body.data.cards.length > 0)
  assert.equal(back.body.data.kbo_hold, undefined)
  _setKboHold(FILE)
})

test('board shows Lines not posted yet while held', () => {
  const s = readFileSync(new URL('../src/KboPropBoard.jsx', import.meta.url), 'utf8')
  assert.match(s, /<EmptyBoard nextGame=\{snapshot\.next_game\} hold=\{snapshot\.kbo_hold\} \/>/)
  assert.match(s, /hold\.message \|\| 'Lines not posted yet'/)
  const api = readFileSync(new URL('../api/data.js', import.meta.url), 'utf8')
  assert.match(api, /const presented = applyKboHold\(ds, board\);/)
  assert.match(api, /shapeForTier\(ds, applyKboHold\(ds, tierPayload\.payload\), tier,/)
})

test('hold expires at expires_at (12:00 PM ET 10/20) and cannot stick', () => {
  const hold = { ...FILE }
  const before = new Date('2026-10-20T15:59:00Z')
  const after = new Date('2026-10-20T16:00:00Z')
  assert.equal(kboHoldActive('prizepicks_props', staleBoard(), hold, before), true)
  assert.equal(kboHoldActive('prizepicks_props', staleBoard(), hold, after), false)
  const board = staleBoard()
  assert.equal(applyKboHold('prizepicks_props', board, hold, after), board)
  // A hold with no readable expiry is off.
  const { expires_at: _drop, ...noExpiry } = hold
  assert.equal(kboHoldActive('prizepicks_props', staleBoard(), noExpiry, before), false)
  assert.equal(kboHoldActive('prizepicks_props', staleBoard(), { ...hold, expires_at: 'soon' }, before), false)
})

test('/api/data stops holding once the hold has expired, even for a cached board row', async () => {
  _setKboHold({ ...HOLD, expires_at: '2000-01-01T00:00:00Z' })
  _clearCache()
  const res = await call('prizepicks_props', { prizepicks_props: staleBoard() })
  assert.ok(res.body.data.cards.length > 0)
  assert.equal(res.body.data.kbo_hold, undefined)
  _setKboHold(FILE)
})

test('hold clears stored lines in matchup_data (paid and free) until it is off or expires', async () => {
  const md = { matchups: [{ away: 'LG', home: 'Kia', away_pitcher: { name: 'Shirakawa', line: 5.5, k_projection: 5.9 }, home_pitcher: { name: 'Oller', line: 5.5, k_projection: 6.1 },
    props: [{ name: 'Oller', prop: 'Strikeouts', line: 5.5, projection: 6.1, edge: 0.6, recommendation: 'OVER' }] }] }
  const held = applyKboHold('matchup_data', md, HOLD)
  const g = held.matchups[0]
  assert.deepEqual([g.props[0].line, g.props[0].edge, g.props[0].recommendation, g.props[0].projection], [null, null, 'NO LINE', 6.1])
  assert.deepEqual([g.away_pitcher.line, g.home_pitcher.line, g.home_pitcher.k_projection], [null, null, 6.1])
  assert.equal(held.kbo_hold.active, true)
  assert.equal(applyKboHold('matchup_data', md, { ...HOLD, active: false }), md)
  assert.equal(applyKboHold('matchup_data', md, { ...HOLD, expires_at: '2000-01-01T00:00:00Z' }), md)
  _setKboHold(HOLD)
  _clearCache()
  const res = await call('matchup_data', { matchup_data: md })
  assert.equal(res.statusCode, 200)
  assert.equal(JSON.stringify(res.body.data).includes('"line":5.5'), false)
  _setKboHold(FILE)
})

test('free matchup_data lockedCount is 0 under the hold and never counts pulled or line-less rows', async () => {
  const md = { matchups: [{ away: 'LG', home: 'Kia', away_pitcher: { name: 'Carrasco', line: 5.5 }, home_pitcher: { name: 'Shirakawa', line: 4.5 },
    props: [
      { name: 'Oller', prop: 'Strikeouts', line: 5.5, projection: 6.1 },
      { name: 'Kim Do-yeong', prop: 'Fantasy Score', line: 6.5, projection: 8.96, removed: true, pp_status: 'removed' },
      { name: 'Castro', prop: 'Fantasy Score', line: null, projection: 8.87, recommendation: 'NO LINE' },
      { name: 'Park', prop: 'Total Bases', line: 0.5, projection: 0.97, pp_status: 'REMOVED' },
    ] }] }
  _setKboHold(HOLD)
  _clearCache()
  const held = await call('matchup_data', { matchup_data: md })
  assert.equal(held.statusCode, 200)
  assert.equal(held.body.preview, true)
  assert.equal(held.body.lockedCount, 0)
  assert.deepEqual(held.body.data.matchups[0].props, [])
  _setKboHold({ ...HOLD, active: false })
  _clearCache()
  const open = await call('matchup_data', { matchup_data: md })
  assert.equal(open.body.preview, true)
  // Only Oller has a live line; pulled and NO LINE rows are not counted.
  assert.equal(open.body.lockedCount, 1)
  _setKboHold(FILE)
  _clearCache()
})
