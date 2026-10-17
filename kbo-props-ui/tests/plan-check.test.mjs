import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { PLAN_CHECK_LIMIT_MS, settlePlanCheck } from '../src/planCheck.js'
import { memberBoardPhase, memberSeesQuietPreview } from '../src/memberBoardPhase.js'

test('a plan check that finishes is ok', async () => {
  assert.equal(await settlePlanCheck(async () => 'done', 50), 'ok')
})

test('a plan check that throws is an error', async () => {
  assert.equal(await settlePlanCheck(async () => { throw new Error('client') }, 50), 'error')
})

test('a plan check that hangs times out', async () => {
  const outcome = await settlePlanCheck(() => new Promise(() => {}), 30)
  assert.equal(outcome, 'timeout')
})

test('the member plan check is limited to about 8-10 seconds', () => {
  assert.equal(PLAN_CHECK_LIMIT_MS >= 8_000 && PLAN_CHECK_LIMIT_MS <= 10_000, true)
  const auth = readFileSync(new URL('../src/AuthContext.jsx', import.meta.url), 'utf8')
  assert.match(auth, /settlePlanCheck/)
  assert.match(auth, /planCheckExhausted/)
  assert.match(auth, /retryPlanCheck/)
  assert.match(auth, /getSession\(\)/)
  assert.equal(auth.includes(".finally(() => {\n      if (userRef.current?.id === userId) setTierConfirmed(true);"), false)
  const hub = readFileSync(new URL('../src/MemberCommandCenter.jsx', import.meta.url), 'utf8')
  assert.match(hub, /planCheckExhausted/)
  assert.match(hub, /retryPlanCheck/)
  const status = readFileSync(new URL('../src/MemberBoardStatus.jsx', import.meta.url), 'utf8')
  assert.match(status, /retryPlanCheck/)
  assert.match(status, /Couldn't load your member board/)
})

test('a timed-out plan check is exhausted instead of the free paywall', () => {
  assert.equal(memberBoardPhase({
    signedIn: true,
    tierConfirmed: false,
    sportUnlocked: false,
    refreshing: false,
    exhausted: true,
  }), 'exhausted')
})

test('a confirmed member on a quiet preview sees the free-preview label', () => {
  assert.equal(memberSeesQuietPreview('member', true, false), true)
  assert.equal(memberSeesQuietPreview('member', true, undefined), true)
  assert.equal(memberSeesQuietPreview('member', true, true), false)
  assert.equal(memberSeesQuietPreview('loading', true, false), false)
  assert.equal(memberSeesQuietPreview('free', true, false), false)
  assert.equal(memberSeesQuietPreview('member', false, false), false)
  const boards = [
    'src/KboPropBoard.jsx',
    'src/StrikeoutProjections.jsx',
    'src/BatterProjections.jsx',
    'src/PropTracker.jsx',
    'src/nba/NbaDashboard.jsx',
    'src/nba/NbaEdge.jsx',
    'src/wnba/Dashboard.jsx',
    'src/wnba/Projections.jsx',
    'src/nfl/NflProjections.jsx',
    'src/nfl/NflPropLines.jsx',
    'src/nfl/NflSharpOdds.jsx',
    'src/nfl/NflLineups.jsx',
    'src/nfl/NflGameMarkets.jsx',
    'src/nhl/NhlProjections.jsx',
    'src/nhl/NhlPropLines.jsx',
    'src/nhl/NhlLineups.jsx',
  ]
  for (const file of boards) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
    assert.match(source, /QuietMemberPreview/, file)
    assert.equal(source.includes('preview && !refreshing'), false, file)
  }
  const notice = readFileSync(new URL('../src/MemberPreviewNotice.jsx', import.meta.url), 'utf8')
  assert.match(notice, /Free preview/)
  assert.match(notice, /Retry/)
  assert.match(notice, /retryPlanCheck/)
})
