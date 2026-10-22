import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { memberBoardPhase, sportUnlockedFor } from '../src/memberBoardPhase.js'

const owner = { email: 'cgpropz@gmail.com' }
const member = { email: 'member@example.com' }

test('a signed-out visitor gets the free preview', () => {
  assert.equal(memberBoardPhase({
    signedIn: false,
    tierConfirmed: true,
    sportUnlocked: false,
    refreshing: false,
    exhausted: false,
  }), 'free')
})

test('a pending plan check shows the member loading state', () => {
  assert.equal(memberBoardPhase({
    signedIn: true,
    tierConfirmed: false,
    sportUnlocked: false,
    refreshing: false,
    exhausted: false,
  }), 'loading')
})

test('a member refresh in flight shows the member loading state', () => {
  assert.equal(memberBoardPhase({
    signedIn: true,
    tierConfirmed: true,
    sportUnlocked: true,
    refreshing: true,
    exhausted: false,
  }), 'loading')
})

test('retries that run out show the exhausted member state', () => {
  assert.equal(memberBoardPhase({
    signedIn: true,
    tierConfirmed: false,
    sportUnlocked: true,
    refreshing: false,
    exhausted: true,
  }), 'exhausted')
  assert.equal(memberBoardPhase({
    signedIn: true,
    tierConfirmed: true,
    sportUnlocked: true,
    refreshing: false,
    exhausted: true,
  }), 'exhausted')
})

test('a confirmed free plan gets the paywall', () => {
  assert.equal(memberBoardPhase({
    signedIn: true,
    tierConfirmed: true,
    sportUnlocked: false,
    refreshing: false,
    exhausted: false,
  }), 'free')
  assert.equal(memberBoardPhase({
    signedIn: true,
    tierConfirmed: true,
    sportUnlocked: false,
    refreshing: true,
    exhausted: true,
  }), 'free')
})

test('a confirmed member with a quiet board sees the full board', () => {
  assert.equal(memberBoardPhase({
    signedIn: true,
    tierConfirmed: true,
    sportUnlocked: true,
    refreshing: false,
    exhausted: false,
  }), 'member')
})

test('sport access stays per sport, and NBA follows the owner account', () => {
  assert.equal(sportUnlockedFor('kbo', 'kbo', member), true)
  assert.equal(sportUnlockedFor('nfl', 'kbo', member), false)
  assert.equal(sportUnlockedFor('nhl', 'combined', member), true)
  assert.equal(sportUnlockedFor('nba', 'owner', member), false)
  assert.equal(sportUnlockedFor('nba', 'free', owner), true)
  // All-Access member: unlocked only once the NBA access check is open.
  assert.equal(sportUnlockedFor('nba', 'combined', member, true), true)
  assert.equal(sportUnlockedFor('nba', 'combined', member, false), false)
  assert.equal(sportUnlockedFor('nba', 'combined', member), false)
  assert.equal(sportUnlockedFor('nba', 'free', null, true), false)
})

test('every sport board holds the paywall until the plan is confirmed', () => {
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
  const status = readFileSync(new URL('../src/MemberBoardStatus.jsx', import.meta.url), 'utf8')
  assert.match(status, /Loading your member board…/)
  assert.match(status, /board-spinner/)
  assert.match(status, /Couldn't load your member board/)
  assert.match(status, /Retry/)
  for (const file of boards) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
    assert.match(source, /MemberBoardStatus/, file)
    assert.match(source, /useMemberBoardPhase/, file)
    assert.match(source, /phase === 'loading' \|\| phase === 'exhausted'/, file)
    if (source.includes('MemberPreviewNotice') || source.includes('Free preview:') || source.includes('Unlock the Full Board')) {
      assert.match(source, /showPaywall/, file)
      assert.match(source, /phase === 'free'/, file)
    }
  }
  const hub = readFileSync(new URL('../src/MemberCommandCenter.jsx', import.meta.url), 'utf8')
  assert.match(hub, /Loading your member board…/)
  assert.match(hub, /board-spinner/)
  assert.match(hub, /planPending/)
  assert.match(hub, /Couldn\\?'t load your member board/)
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
  assert.match(app, /tierConfirmed && tier === 'free'/)
})
