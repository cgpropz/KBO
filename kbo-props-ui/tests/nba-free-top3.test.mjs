import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test, { afterEach, beforeEach } from 'node:test'
import { NBA_MIN_AVG_MINUTES, NBA_MIN_GAMES, nbaAccessDecision, nbaHighRisk, shapeForTier } from '../api/_dataAccess.js'
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
]

test('the free NBA top 3 switch is off by default; the tab and copy follow it', () => {
  assert.equal(NBA_FREE_PREVIEW_ENABLED, false)
  assert.equal(LANDING_SPORTS.some((sport) => sport.id === 'nba'), false)
  assert.equal(freePreviewBoardList(), 'KBO, WNBA, NFL, and NHL')
  assert.equal(/\bNBA\b/.test(freeTierFaqAnswer()), false)
  assert.equal(/WNBA, NFL, NBA, and NHL boards/.test(JSON.stringify(publicFaqs())), false)
})

test('access: off denies free callers; on opens only the free top 3 dataset before nba_public', () => {
  const base = { emailResolved: true, email: null, tierResolved: true, tier: 'free', flagResolved: true, nbaPublic: false }
  // Off (the default): unchanged, NBA is full access only.
  assert.equal(nbaAccessDecision(base), 'deny')
  assert.equal(nbaAccessDecision({ ...base, freeTop3Dataset: true }), 'deny')
  assert.equal(nbaAccessDecision({ ...base, nbaPublic: true }), 'deny')
  assert.equal(nbaAccessDecision({ ...base, nbaPublic: true, tier: 'monthly' }), 'full')
  assert.equal(nbaAccessDecision({ ...base, tier: 'monthly' }), 'deny')
  // On, before nba_public: preview of nba_projections_standard only.
  const on = { ...base, freePreview: true }
  assert.equal(nbaAccessDecision({ ...on, freeTop3Dataset: true }), 'preview')
  assert.equal(nbaAccessDecision({ ...on, tier: 'kbo', freeTop3Dataset: true }), 'preview')
  assert.equal(nbaAccessDecision({ ...on, tier: 'monthly', freeTop3Dataset: true }), 'preview')
  assert.equal(nbaAccessDecision({ ...on, freeTop3Dataset: false }), 'deny')
  assert.equal(nbaAccessDecision({ ...on, flagResolved: false, freeTop3Dataset: true }), 'preview')
  // On, after nba_public: like the other sports.
  assert.equal(nbaAccessDecision({ ...on, nbaPublic: true }), 'preview')
  assert.equal(nbaAccessDecision({ ...on, nbaPublic: true, tier: 'monthly' }), 'full')
  // Auth and tier failures stay closed either way.
  assert.equal(nbaAccessDecision({ ...on, emailResolved: false, freeTop3Dataset: true }), 'deny')
  assert.equal(nbaAccessDecision({ ...on, tierResolved: false, freeTop3Dataset: true }), 'deny')
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
  for (const ds of ['nba_players', 'nba_dvp_pg', 'nba_correlations']) {
    const denied = await anonymous(ds)
    assert.equal(denied.statusCode, 403, ds)
  }
  const forged = mockRes()
  await handleDataRequest({ method: 'GET', query: { ds: 'nba_projections_standard' }, headers: { authorization: 'Bearer forged' } }, forged, snapshotClient(false))
  assert.equal(forged.statusCode, 403)
})
