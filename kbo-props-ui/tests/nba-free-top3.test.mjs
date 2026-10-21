import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test, { afterEach, beforeEach } from 'node:test'
import { NBA_MIN_AVG_MINUTES, NBA_MIN_GAMES, NBA_OWNER_EMAIL, NBA_PREVIEW_PLAYER_FIELDS, nbaAccessDecision, nbaHighRisk, shapeForTier } from '../api/_dataAccess.js'
import { _clearCache, _setNbaFreePreview, handleDataRequest } from '../api/data.js'
import { cgScore } from '../src/cgScore.js'
import { freePreviewBoardList, freeTierFaqAnswer } from '../src/freePreviewCopy.js'
import { LANDING_SPORTS } from '../src/landingSports.js'
import { NBA_FREE_PREVIEW_ENABLED } from '../src/nbaPreviewFlag.js'
import { nbaPublicRows, rowsFromSnapshot } from '../src/publicBoard.js'
import { publicFaqs } from '../src/publicFaqs.js'
import { applyNbaFreeCopy } from '../scripts/nbaFreeCopy.mjs'
import { renderNbaPlayerPropsPage } from '../scripts/publicPages.mjs'

const FUTURE = '2099-10-21T23:00:00Z'
const uiRoot = join(import.meta.dirname, '..')

function player(name, props, extra = {}) {
  return {
    name, team: 'BOS', matched: true, projectionStatus: 'projected', gp: 60, avgMins: 32,
    espnInjuryChecked: true, espnInjuryStatus: null,
    recentGames: [{ pts: 30, min: 34 }],
    propProjectionByStat: { Points: 30, Rebounds: 9 },
    ...extra,
    ppAllProps: props.map((p) => ({ start_time: FUTURE, odds_type: 'standard', ...p })),
  }
}

const BOARD = [
  player('Huge Edge', [{ stat: 'Points', line: 4.5, projection: 30 }, { stat: 'Rebounds', line: 30.5, projection: 2 }]),
  player('Big Edge', [{ stat: 'Points', line: 10.5, projection: 30 }]),
  player('Small Edge', [{ stat: 'Rebounds', line: 6.5, projection: 7.1 }]),
  player('Mid Edge', [{ stat: 'Assists', line: 5.5, projection: 7.5 }]),
  player('Goblin', [{ stat: 'Points', line: 2.5, projection: 40, odds_type: 'goblin' }]),
  player('Pulled', [{ stat: 'Points', line: 3.5, projection: 40, pp_status: 'removed' }]),
]

const RISKY = [
  player('Unmatched', [{ stat: 'Points', line: 1.5, projection: 40 }], { matched: false }),
  player('Pending', [{ stat: 'Points', line: 1.5, projection: 40 }], { projectionStatus: 'pending' }),
  player('Few Games', [{ stat: 'Points', line: 1.5, projection: 40 }], { gp: NBA_MIN_GAMES - 1 }),
  player('Low Minutes', [{ stat: 'Points', line: 1.5, projection: 40 }], { avgMins: NBA_MIN_AVG_MINUTES - 0.1 }),
  player('No Minutes', [{ stat: 'Points', line: 1.5, projection: 40 }], { avgMins: null }),
  // ESPN injury tags (nba/availability.py).
  player('Tag Out', [{ stat: 'Points', line: 1.5, projection: 40 }], { espnInjuryStatus: 'Out' }),
  player('Tag Doubtful', [{ stat: 'Points', line: 1.5, projection: 40 }], { espnInjuryStatus: 'Doubtful' }),
  player('Tag Questionable', [{ stat: 'Points', line: 1.5, projection: 40 }], { espnInjuryStatus: 'Questionable' }),
  player('Tag DTD', [{ stat: 'Points', line: 1.5, projection: 40 }], { espnInjuryStatus: 'Day-To-Day' }),
  player('Tag GTD', [{ stat: 'Points', line: 1.5, projection: 40 }], { espnInjuryStatus: 'GTD' }),
  player('Tag Suspended', [{ stat: 'Points', line: 1.5, projection: 40 }], { espnInjuryStatus: 'Suspended' }),
  player('Not Checked', [{ stat: 'Points', line: 1.5, projection: 40 }], { espnInjuryChecked: false }),
  player('No Check Field', [{ stat: 'Points', line: 1.5, projection: 40 }], { espnInjuryChecked: undefined }),
]

test('the free NBA top 3 switch is off by default; the tab and copy follow it', () => {
  assert.equal(NBA_FREE_PREVIEW_ENABLED, false)
  assert.equal(LANDING_SPORTS.some((sport) => sport.id === 'nba'), false)
  assert.equal(freePreviewBoardList(), 'KBO, WNBA, NFL, and NHL')
  assert.equal(/\bNBA\b/.test(freeTierFaqAnswer()), false)
  assert.equal(/WNBA, NFL, NBA, and NHL boards/.test(JSON.stringify(publicFaqs())), false)
})

test('access: off denies non-all-access; on opens only the free top 3 dataset, including after nba_public', () => {
  const base = { emailResolved: true, email: null, tierResolved: true, tier: 'free', flagResolved: true, nbaPublic: false }
  // Off (the default): full access only. nba_public does not open a preview.
  assert.equal(nbaAccessDecision(base), 'deny')
  assert.equal(nbaAccessDecision({ ...base, freeTop3Dataset: true }), 'deny')
  assert.equal(nbaAccessDecision({ ...base, nbaPublic: true }), 'deny')
  assert.equal(nbaAccessDecision({ ...base, nbaPublic: true, freeTop3Dataset: true }), 'deny')
  assert.equal(nbaAccessDecision({ ...base, nbaPublic: true, tier: 'monthly' }), 'full')
  assert.equal(nbaAccessDecision({ ...base, tier: 'monthly' }), 'deny')
  // Flag on, switch off: signed-out, Discord-only, and legacy kbo stay denied.
  // Combined and weekly stay full.
  const launched = { ...base, nbaPublic: true, email: 'fan@example.com' }
  assert.equal(nbaAccessDecision({ ...launched, email: null, tier: 'free' }), 'deny')
  assert.equal(nbaAccessDecision({ ...launched, tier: 'discord' }), 'deny')
  assert.equal(nbaAccessDecision({ ...launched, tier: 'kbo' }), 'deny')
  assert.equal(nbaAccessDecision({ ...launched, tier: 'wnba' }), 'deny')
  assert.equal(nbaAccessDecision({ ...launched, tier: 'combined' }), 'full')
  assert.equal(nbaAccessDecision({ ...launched, tier: 'weekly' }), 'full')
  // On, before nba_public: preview of nba_projections_standard only.
  const on = { ...base, freePreview: true }
  assert.equal(nbaAccessDecision({ ...on, freeTop3Dataset: true }), 'preview')
  assert.equal(nbaAccessDecision({ ...on, tier: 'kbo', freeTop3Dataset: true }), 'preview')
  assert.equal(nbaAccessDecision({ ...on, tier: 'monthly', freeTop3Dataset: true }), 'preview')
  assert.equal(nbaAccessDecision({ ...on, freeTop3Dataset: false }), 'deny')
  assert.equal(nbaAccessDecision({ ...on, flagResolved: false, freeTop3Dataset: true }), 'preview')
  // On, after nba_public: still only the free top 3 dataset. Other datasets deny.
  assert.equal(nbaAccessDecision({ ...on, nbaPublic: true }), 'deny')
  assert.equal(nbaAccessDecision({ ...on, nbaPublic: true, freeTop3Dataset: true }), 'preview')
  assert.equal(nbaAccessDecision({ ...on, nbaPublic: true, tier: 'discord', freeTop3Dataset: true }), 'preview')
  assert.equal(nbaAccessDecision({ ...on, nbaPublic: true, tier: 'kbo', freeTop3Dataset: true }), 'preview')
  assert.equal(nbaAccessDecision({ ...on, nbaPublic: true, tier: 'combined' }), 'full')
  assert.equal(nbaAccessDecision({ ...on, nbaPublic: true, tier: 'weekly' }), 'full')
  assert.equal(nbaAccessDecision({ ...on, nbaPublic: true, tier: 'monthly' }), 'full')
  // Auth and tier failures stay closed either way.
  assert.equal(nbaAccessDecision({ ...on, emailResolved: false, freeTop3Dataset: true }), 'deny')
  assert.equal(nbaAccessDecision({ ...on, tierResolved: false, freeTop3Dataset: true }), 'deny')
  assert.equal(nbaAccessDecision({ ...on, nbaPublic: true, tierResolved: false, freeTop3Dataset: true }), 'deny')
})

// Switch off: the pre-launch matrix, except a public flag no longer returns
// preview. Non-all-access is deny even when nba_public is on.
const MAIN_ALL_ACCESS = new Set(['owner', 'pro', 'monthly', 'weekly', 'season', 'all', 'combined'])
function mainDecision({ emailResolved, email, tierResolved, tier, flagResolved, nbaPublic }) {
  if (emailResolved !== true) return 'deny'
  const normalized = typeof email === 'string' ? email.trim().toLowerCase() : ''
  if (normalized === NBA_OWNER_EMAIL) return 'full'
  if (flagResolved !== true || nbaPublic !== true) return 'deny'
  if (tierResolved !== true) return 'deny'
  if (MAIN_ALL_ACCESS.has(tier)) return 'full'
  return 'deny'
}

test('access with the switch off denies non-all-access even when nba_public is on', () => {
  const tiers = ['free', 'discord', 'kbo', 'wnba', 'legacy', 'monthly', 'weekly', 'season', 'pro', 'all', 'combined', 'owner', null]
  const bools = [true, false, undefined]
  let checked = 0
  for (const emailResolved of bools) for (const tierResolved of bools) for (const flagResolved of bools)
    for (const nbaPublic of bools) for (const freeTop3Dataset of [true, false]) for (const tier of tiers)
      for (const email of [null, 'someone@example.com', NBA_OWNER_EMAIL]) {
        const input = { emailResolved, email, tierResolved, tier, flagResolved, nbaPublic, freeTop3Dataset, freePreview: false }
        assert.equal(nbaAccessDecision(input), mainDecision(input), JSON.stringify(input))
        checked += 1
      }
  assert.ok(checked > 1000)
})

test('HIGH RISK players never take a free NBA slot', () => {
  for (const p of RISKY) assert.equal(nbaHighRisk(p), true, p.name)
  assert.equal(nbaHighRisk(BOARD[0]), false)
  assert.equal(nbaHighRisk(player('Edge', [], { gp: NBA_MIN_GAMES, avgMins: NBA_MIN_AVG_MINUTES })), false)
  const shaped = shapeForTier('nba_projections_standard', [...RISKY, ...BOARD], 'free')
  const names = shaped.data.map((p) => p.name)
  for (const p of RISKY) assert.equal(names.includes(p.name), false, p.name)
  const onlyRisky = shapeForTier('nba_projections_standard', RISKY, 'free')
  assert.equal(onlyRisky.data.flatMap((p) => p.ppAllProps).length, 0)
})

test('the server preview keeps 3 standard, live NBA props and nothing else for those players', () => {
  const shaped = shapeForTier('nba_projections_standard', BOARD, 'free')
  assert.equal(shaped.preview, true)
  const props = shaped.data.flatMap((p) => p.ppAllProps.map((prop) => ({ name: p.name, ...prop })))
  assert.equal(props.length, 3)
  for (const name of ['Goblin', 'Pulled']) assert.equal(props.some((p) => p.name === name), false, name)
  const huge = shaped.data.find((p) => p.name === 'Huge Edge')
  assert.deepEqual(huge.ppAllProps.map((p) => p.stat), ['Points'])
  for (const p of shaped.data) {
    assert.equal(p.propProjectionByStat, undefined)
    assert.equal(p.recentGames, undefined)
    assert.equal(p.team, 'BOS')
  }
  // No live line: the fallback rows carry no props at all.
  const started = BOARD.map((p) => ({ ...p, ppAllProps: p.ppAllProps.map((prop) => ({ ...prop, start_time: '2000-01-01T00:00:00Z' })) }))
  const fallback = shapeForTier('nba_projections_standard', started, 'free')
  assert.ok(fallback.data.length <= 3)
  for (const p of fallback.data) {
    assert.deepEqual(p.ppAllProps, [])
    assert.equal(p.propProjectionByStat, undefined)
  }
})

test('landing NBA rows use the board CG Score bounded 0-100 with the raw score as tiebreak', () => {
  const rows = nbaPublicRows(BOARD)
  for (const row of rows) {
    assert.ok(row.score >= 0 && row.score <= 100, `${row.player} ${row.score}`)
    assert.equal(row.rawScore, cgScore(row.projection, row.line, row.stat))
  }
  const huge = rows.find((row) => row.player === 'Huge Edge' && row.stat === 'Points')
  assert.equal(huge.score, 100)
  assert.ok(huge.rawScore > 100)
  const visible = rowsFromSnapshot('nba', BOARD, null).map((row) => row.player)
  assert.equal(visible.includes('Goblin'), false)
  assert.equal(visible.includes('Pulled'), false)
})

test('copy says there is no free NBA preview while the switch is off, and says so when on', () => {
  assert.equal(freePreviewBoardList(true, true), 'KBO, WNBA, NFL, NBA, and NHL')
  assert.equal(freePreviewBoardList(false, false), 'KBO, WNBA, and NHL')
  const { html, faqPage } = renderNbaPlayerPropsPage()
  assert.match(html, /There is no free NBA preview/)
  assert.equal(html.includes('{{'), false)
  const answer = faqPage.mainEntity.find((q) => q.name === 'Are there free NBA picks?').acceptedAnswer.text
  assert.match(answer, /^No\. NBA has no free preview/)

  for (const file of ['content/nba-player-props.md', 'content/guides/cg-score.md', 'content/guides/start-here.md']) {
    const raw = readFileSync(join(uiRoot, file), 'utf8')
    const on = applyNbaFreeCopy(raw, true)
    const off = applyNbaFreeCopy(raw, false)
    for (const text of [on, off]) assert.equal(/\{\{[#^/]nba-free\}\}/.test(text), false, file)
    assert.match(on, /opening weeks/, file)
    assert.equal(/opening weeks/.test(off), false, file)
  }
  const onPage = applyNbaFreeCopy(readFileSync(join(uiRoot, 'content/nba-player-props.md'), 'utf8'), true)
  assert.match(onPage, /"text": "Yes, for the opening weeks of the season\./)
  assert.match(onPage, /For the opening weeks, NBA is also in the \[homepage free top 3\]\(\/#free-top-3\)/)
})

function mockRes() {
  return {
    statusCode: 200, headers: {}, body: undefined,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v },
    status(code) { this.statusCode = code; return this },
    json(obj) { this.body = obj; return this },
  }
}

function snapshotClient(nbaPublic) {
  return {
    auth: { getUser: () => Promise.resolve({ data: { user: null }, error: { message: 'invalid JWT' } }) },
    from(table) {
      const filters = {}
      const chain = {
        select() { return chain },
        eq(col, val) { filters[col] = val; return chain },
        abortSignal() { return chain },
        maybeSingle() {
          if (table === 'app_flags') return Promise.resolve({ data: { value: nbaPublic }, error: null })
          if (String(table).startsWith('nba_')) return Promise.resolve({ data: { data: [...RISKY, ...BOARD], updated_at: '2026-10-20T00:00:00Z' }, error: null })
          return Promise.resolve({ data: null, error: null })
        },
      }
      return chain
    },
  }
}

async function anonymous(ds, nbaPublic = false) {
  const res = mockRes()
  await handleDataRequest({ method: 'GET', query: { ds }, headers: {} }, res, snapshotClient(nbaPublic))
  return res
}

beforeEach(() => _clearCache())
afterEach(() => _setNbaFreePreview(NBA_FREE_PREVIEW_ENABLED))

test('/api/data: logged-out NBA stays 403 while the switch is off', async () => {
  _setNbaFreePreview(false)
  for (const ds of ['nba_projections_standard', 'nba_players']) {
    const res = await anonymous(ds)
    assert.equal(res.statusCode, 403, ds)
    assert.equal(res.body.data, undefined)
  }
})

test('/api/data: with the switch on, logged-out callers get the 3-row NBA preview and nothing else', async () => {
  _setNbaFreePreview(true)
  const res = await anonymous('nba_projections_standard')
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.preview, true)
  const props = res.body.data.flatMap((p) => p.ppAllProps)
  assert.equal(props.length, 3)
  for (const p of RISKY) assert.equal(res.body.data.some((row) => row.name === p.name), false, p.name)
  for (const ds of ['nba_players', 'nba_teams', 'nba_dvp_pg', 'nba_correlations']) {
    const denied = await anonymous(ds)
    assert.equal(denied.statusCode, 403, ds)
  }
  const forged = mockRes()
  await handleDataRequest({ method: 'GET', query: { ds: 'nba_projections_standard' }, headers: { authorization: 'Bearer forged' } }, forged, snapshotClient(false))
  assert.equal(forged.statusCode, 403)
})

test('capped NBA ties break on the raw score, then board order (same as the landing and #312)', () => {
  // Both picks sit at the 100 cap; Later Bigger has the larger raw score.
  const board = [
    player('Early Smaller', [{ stat: 'Points', line: 10.5, projection: 30 }]),
    player('Filler A', [{ stat: 'Rebounds', line: 6.5, projection: 7.1 }]),
    player('Filler B', [{ stat: 'Rebounds', line: 6.5, projection: 7.0 }]),
    player('Later Bigger', [{ stat: 'Points', line: 4.5, projection: 30 }]),
  ]
  const shaped = shapeForTier('nba_projections_standard', board, 'free')
  const names = shaped.data.map((p) => p.name)
  assert.ok(names.includes('Later Bigger'))
  assert.ok(names.includes('Early Smaller'))
  assert.ok(names.includes('Filler A'))
  assert.equal(names.includes('Filler B'), false)
  const landing = nbaPublicRows(board).sort((a, b) => (b.score - a.score) || (b.rawScore - a.rawScore))
  assert.equal(landing[0].player, 'Later Bigger')
  assert.equal(names[0], 'Later Bigger')
})

test('/api/data: ?player= on the NBA preview reads only the trimmed row', async () => {
  _setNbaFreePreview(true)
  const res = mockRes()
  await handleDataRequest({ method: 'GET', query: { ds: 'nba_projections_standard', player: 'Huge Edge' }, headers: {} }, res, snapshotClient(false))
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.preview, true)
  assert.equal(res.body.data.length, 1)
  const row = res.body.data[0]
  assert.equal(row.name, 'Huge Edge')
  assert.deepEqual(row.ppAllProps.map((p) => p.stat), ['Points'])
  assert.equal(row.propProjectionByStat, undefined)
  assert.equal(row.recentGames, undefined)
  // A hidden player is not reachable by name.
  const hidden = mockRes()
  await handleDataRequest({ method: 'GET', query: { ds: 'nba_projections_standard', player: 'Goblin' }, headers: {} }, hidden, snapshotClient(false))
  assert.equal(hidden.statusCode, 200)
  assert.deepEqual(hidden.body.data, [])
  // With nba_public on and the switch off, a free caller's ?player= is denied.
  _setNbaFreePreview(false)
  _clearCache()
  const launched = mockRes()
  await handleDataRequest({ method: 'GET', query: { ds: 'nba_projections_standard', player: 'Huge Edge' }, headers: {} }, launched, snapshotClient(true))
  assert.equal(launched.statusCode, 403)
  assert.equal(launched.body.error, 'Forbidden')
  assert.equal(launched.body.data, undefined)
})

test('/api/data: switch off denies every NBA dataset when nba_public is on', async () => {
  _setNbaFreePreview(false)
  for (const ds of ['nba_projections_standard', 'nba_players', 'nba_teams', 'nba_dvp_pg']) {
    const res = await anonymous(ds, true)
    assert.equal(res.statusCode, 403, ds)
    assert.equal(res.body.error, 'Forbidden', ds)
    assert.equal(res.body.data, undefined, ds)
  }
})

test('/api/data: switch on still previews only the free top 3 when nba_public is on', async () => {
  _setNbaFreePreview(true)
  const res = await anonymous('nba_projections_standard', true)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.preview, true)
  assert.equal(res.body.data.flatMap((p) => p.ppAllProps).length, 3)
  for (const ds of ['nba_players', 'nba_teams', 'nba_dvp_pg']) {
    const denied = await anonymous(ds, true)
    assert.equal(denied.statusCode, 403, ds)
    assert.equal(denied.body.error, 'Forbidden', ds)
    assert.equal(denied.body.data, undefined, ds)
  }
})

test('NBA preview rows keep only the allowlisted player fields', () => {
  const board = BOARD.map((p) => ({ ...p, athleteId: '42', image: 'x.png', dvpSlot: 'PG', dvpOpponent: 'NY', avgMins: 33, gp: 61, someNewModelField: 7, espnInjuryChecked: true }))
  const shaped = shapeForTier('nba_projections_standard', board, 'free')
  assert.ok(shaped.data.length > 0)
  for (const row of shaped.data) {
    for (const key of Object.keys(row)) {
      assert.ok(key === 'ppAllProps' || NBA_PREVIEW_PLAYER_FIELDS.includes(key), key)
    }
    assert.equal(row.athleteId, '42')
    assert.equal(row.image, 'x.png')
    for (const key of ['avgMins', 'gp', 'dvpSlot', 'someNewModelField', 'matched', 'projectionStatus']) assert.equal(key in row, false, key)
  }
})

test('the ESPN tags do not use field names the member boards read', () => {
  const hub = readFileSync(join(uiRoot, 'src/memberHub.js'), 'utf8') + readFileSync(join(uiRoot, 'src/slipSports.js'), 'utf8')
  assert.equal(/espnInjury/.test(hub), false)
  assert.equal(nbaHighRisk(player('Tagged', [], { espnInjuryStatus: 'Questionable' })), true)
  assert.equal(nbaHighRisk(player('Checked', [])), false)
})
