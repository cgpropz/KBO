import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { shapeForTier } from '../api/_dataAccess.js'
import { nflCgScore } from '../src/nfl/nflLineFloors.js'
import {
  LINE_EDGE_LIMIT,
  PUBLIC_LINE_EDGE_KEYS,
  biggestLineEdges,
  formatLineGap,
  landingLineEdges,
  lineEdgeMagnitude,
  lineEdgeSigned,
  publicLineEdgeRow,
} from '../src/lineEdges.js'
import { XWEEK_PROMO_LINE } from '../src/promoCopy.js'
import { lineEdgesFromSnapshot } from '../src/publicBoard.js'
import { homeRootInner } from '../scripts/homeShell.mjs'

const landing = readFileSync(new URL('../src/PublicLanding.jsx', import.meta.url), 'utf8')
const moduleSrc = readFileSync(new URL('../src/LineEdgesModule.jsx', import.meta.url), 'utf8')
const FUTURE = '2099-06-01T23:00:00Z'

function row(overrides) {
  return {
    player: 'Player',
    stat: 'Receptions',
    line: 4.5,
    projection: 6.5,
    score: 70,
    line_type: 'standard',
    side: 'OVER',
    start: FUTURE,
    ...overrides,
  }
}

test('ranks playable standard lines by absolute gap, not by CG Score', () => {
  const rows = [
    row({ player: 'High Score', line: 4.5, projection: 6.5, score: 99 }),
    row({ player: 'Standard Under', stat: 'Pass Yards', line: 280.5, projection: 210, score: 30, side: 'UNDER' }),
    row({ player: 'Mid', line: 8.5, projection: 12, score: 80 }),
    row({ player: 'Demon Under', stat: 'Points', line: 25.5, projection: 2, score: 95, odds_type: 'demon', side: 'UNDER' }),
    row({ player: 'Goblin Over', stat: 'Rush Yards', line: 20.5, projection: 90, score: 100, line_type: 'goblin', side: 'OVER' }),
    row({ player: 'Out Player', line: 10.5, projection: 40, score: 90, injury: 'OUT' }),
    row({ player: 'Started', line: 10.5, projection: 40, score: 90, start: '2020-01-01T00:00:00Z' }),
    row({ player: 'On The Line', line: 5.5, projection: 5.5, score: 50, side: null }),
    row({ player: 'Goal Scorer', stat: 'Anytime Goal Scorer', line: 0.5, projection: 1.4, score: 90 }),
    row({ player: 'Any Yards', stat: 'Receiving Yards', line: 0.5, projection: 12, score: 90 }),
    row({ player: 'Pulled', line: 10.5, projection: 30, score: 88, pp_status: 'removed' }),
  ]
  const picked = biggestLineEdges(rows)
  assert.equal(LINE_EDGE_LIMIT, 5)
  assert.deepEqual(picked.map((item) => item.player), ['Standard Under', 'Mid', 'High Score'])
  assert.equal(lineEdgeMagnitude(picked[0]), 70.5)
  assert.ok(picked[0].side === 'UNDER')
  for (const name of ['Demon Under', 'Goblin Over', 'Out Player', 'Started', 'On The Line', 'Goal Scorer', 'Any Yards', 'Pulled']) {
    assert.equal(picked.some((item) => item.player === name), false, name)
  }
})

test('an existing edge field outranks a larger projection-minus-line gap', () => {
  const stored = row({ player: 'Stored', line: 4.5, projection: 14.5, edge: -8, side: 'UNDER' })
  const computed = row({ player: 'Computed', line: 4.5, projection: 9.5 })
  assert.equal(lineEdgeSigned(stored), -8)
  assert.equal(lineEdgeSigned(computed), 5)
  assert.deepEqual(biggestLineEdges([computed, stored]).map((item) => item.player), ['Stored', 'Computed'])
  const bait = row({ player: 'Sharp Bait', line: 4.5, projection: 5, pp_edge_flex: 99, score: 100 })
  assert.equal(biggestLineEdges([bait, computed])[0].player, 'Computed')
  const zero = row({ player: 'Zero Edge', line: 4.5, projection: 20, edge: 0 })
  assert.equal(biggestLineEdges([zero, computed]).some((item) => item.player === 'Zero Edge'), false)
})

test('ties keep board order, and the list never grows past five', () => {
  const rows = [1, 2, 3, 4, 5, 6].map((gap) => row({
    player: `Gap ${gap}`,
    line: 10,
    projection: 10 + gap,
    score: 60,
  }))
  const same = [
    row({ player: 'First', line: 10, projection: 14, score: 10 }),
    row({ player: 'Second', line: 10, projection: 14, score: 99 }),
  ]
  assert.deepEqual(biggestLineEdges(same).map((item) => item.player), ['First', 'Second'])
  assert.equal(biggestLineEdges(rows).length, 5)
  assert.deepEqual(biggestLineEdges(rows).map((item) => item.player), ['Gap 6', 'Gap 5', 'Gap 4', 'Gap 3', 'Gap 2'])
  assert.equal(biggestLineEdges(rows, { limit: 3 }).length, 3)
  assert.equal(biggestLineEdges(rows, { limit: 9 }).length, 5)
})

test('the public row keeps free-preview fields only', () => {
  const raw = row({
    recent: [111.7, 222.3],
    ratio: 9.87,
    price: -137,
    pp_edge_flex: 40,
    rawScore: 140,
    riskPlayer: { matched: true },
    games: [{ points: 3 }],
  })
  const pub = publicLineEdgeRow(biggestLineEdges([raw])[0])
  assert.deepEqual(Object.keys(pub).sort(), [...PUBLIC_LINE_EDGE_KEYS].filter((key) => key !== 'start' || pub.start).sort())
  for (const key of ['recent', 'ratio', 'price', 'pp_edge_flex', 'rawScore', 'riskPlayer', 'games']) {
    assert.equal(Object.hasOwn(pub, key), false, key)
  }
  assert.equal(JSON.stringify(pub).includes('111.7'), false)
  assert.equal(JSON.stringify(pub).includes('9.87'), false)
  assert.equal(formatLineGap(pub.edge), '+2')
  assert.equal(formatLineGap(-3), '−3')
})

test('an NBA high-risk player does not take a line-edge slot', () => {
  const safe = {
    matched: true,
    projectionStatus: 'projected',
    gp: 40,
    avgMins: 30,
    espnInjuryChecked: true,
  }
  const rows = [
    row({ player: 'Risky', sport: 'nba', stat: 'Points', line: 10.5, projection: 28, score: 80, riskPlayer: { ...safe, espnInjuryStatus: 'out' } }),
    row({ player: 'Safe', sport: 'nba', stat: 'Points', line: 10.5, projection: 14, score: 60, riskPlayer: safe }),
  ]
  assert.deepEqual(biggestLineEdges(rows).map((item) => item.player), ['Safe'])
})

test('a free preview without lineEdges is not relabeled as the biggest gaps', () => {
  const top3 = [row({ player: 'Only Public', line: 4.5, projection: 8 })]
  assert.deepEqual(landingLineEdges({ preview: true, rows: top3, lineEdges: null }), [])
  assert.equal(landingLineEdges({ preview: true, status: 'ready' }).length, 0)
  const ranked = landingLineEdges({ preview: false, rows: top3 })
  assert.equal(ranked[0].player, 'Only Public')
  assert.equal(Object.hasOwn(ranked[0], 'recent'), false)
})

test('the free NFL preview still ranks CG Score, and lineEdges is a separate gap list', () => {
  const bigUnderScore = nflCgScore(200, 300.5, 'Pass Yards')
  const rushScore = nflCgScore(16, 12.5, 'Rush Attempts')
  assert.ok(rushScore > bigUnderScore)
  const board = [
    { player: 'Big Under', prop: 'Pass Yards', line: 300.5, projection: 200, line_type: 'standard', start_time: FUTURE, recent: [111.7] },
    { player: 'Catches', prop: 'Receptions', line: 6.5, projection: 8, line_type: 'standard', start_time: FUTURE },
    { player: 'Targets', prop: 'Rec Targets', line: 5.5, projection: 7.2, line_type: 'standard', start_time: FUTURE },
    { player: 'Rushes', prop: 'Rush Attempts', line: 12.5, projection: 16, line_type: 'standard', start_time: FUTURE },
    { player: 'Goblin Under', prop: 'Rush Yards', line: 20.5, projection: 2, line_type: 'goblin', start_time: FUTURE },
    { player: 'Out Player', prop: 'Pass Yards', line: 200.5, projection: 280, line_type: 'standard', injury: 'OUT', start_time: FUTURE },
    { player: 'Started', prop: 'Pass Yards', line: 180.5, projection: 260, line_type: 'standard', start_time: '2020-01-01T00:00:00Z' },
    { player: 'Sharp Bait', prop: 'Receptions', line: 4.5, projection: 5, line_type: 'standard', pp_edge_flex: 500, start_time: FUTURE },
  ]
  const free = shapeForTier('nfl_projections', board, 'free', { now: new Date('2026-10-24T12:00:00Z') })
  const paid = shapeForTier('nfl_projections', board, 'combined', { now: new Date('2026-10-24T12:00:00Z') })
  assert.equal(free.preview, true)
  assert.equal(free.data.some((item) => item.player === 'Big Under'), false)
  assert.equal(free.data.some((item) => item.player === 'Goblin Under'), false)
  assert.equal(free.lineEdges[0].player, 'Big Under')
  assert.equal(free.lineEdges[0].edge, 200 - 300.5)
  assert.equal(free.lineEdges.some((item) => item.player === 'Goblin Under'), false)
  assert.equal(free.lineEdges.some((item) => item.player === 'Out Player'), false)
  assert.equal(free.lineEdges.some((item) => item.player === 'Started'), false)
  assert.ok(free.lineEdges.findIndex((item) => item.player === 'Sharp Bait') > 0)
  assert.equal(JSON.stringify(free.lineEdges).includes('111.7'), false)
  assert.equal(JSON.stringify(free.lineEdges).includes('pp_edge_flex'), false)
  assert.equal(paid.preview, false)
  assert.equal(paid.lineEdges, undefined)
  assert.equal(lineEdgesFromSnapshot('nfl', board, null, { now: new Date('2026-10-24T12:00:00Z') })[0].player, 'Big Under')
})

test('the homepage module sits above the free top 3 and carries the weekly offer', () => {
  assert.equal(XWEEK_PROMO_LINE, 'First week $4.99 with code XWEEK (auto-fills at checkout), then $9.99/wk, cancel anytime.')
  assert.match(moduleSrc, /id="line-edges"/)
  assert.match(moduleSrc, /Biggest line edges/)
  assert.match(moduleSrc, /XWEEK_PROMO_LINE/)
  assert.equal(/\bguarante/i.test(moduleSrc), false)
  assert.equal(/\block(?:ed|s|ing)?\b/i.test(moduleSrc), false)
  assert.equal(/PrizePicks/.test(moduleSrc), false)
  assert.ok(landing.indexOf('id="line-edges"') === -1)
  assert.match(landing, /<LineEdgesModule/)
  assert.ok(landing.indexOf('<section className="pl-hero">') < landing.indexOf('<LineEdgesModule'))
  assert.ok(landing.indexOf('<LineEdgesModule') < landing.indexOf('id="free-top-3"'))
  const shell = homeRootInner()
  assert.ok(shell.indexOf('id="line-edges"') < shell.indexOf('id="free-top-3"'))
  assert.match(shell, /<h2>Biggest line edges<\/h2>/)
  assert.ok(shell.includes(XWEEK_PROMO_LINE))
})
