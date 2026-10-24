import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { UNPROVEN_RANK_NOTE } from '../src/freePreviewCopy.js'
import { kboHubRows, nflHubRows } from '../src/memberHub.js'
import { FREE_TOP_LIMIT, publicFreeTopRows } from '../src/publicBoard.js'
import { homeRootInner } from '../scripts/homeShell.mjs'

const landing = readFileSync(new URL('../src/PublicLanding.jsx', import.meta.url), 'utf8')

function log(length, value) {
  return Array.from({ length }, () => value)
}

test('#free-top-3 ranks by CG Score, not by L10 hit rate', () => {
  const rows = nflHubRows([
    // Perfect L10 but the smallest gap to the line: the lowest CG Score.
    { player: 'Hit Leader', prop: 'Receptions', line: 4.5, projection: 4.7, line_type: 'standard', recent: log(12, 9) },
    { player: 'Big Edge', prop: 'Rush Yards', line: 40.5, projection: 75, line_type: 'standard', recent: log(12, 10) },
    { player: 'Mid Edge', prop: 'Rec Yards', line: 50.5, projection: 66, line_type: 'standard', recent: log(12, 10) },
    { player: 'Small Edge', prop: 'Pass Yards', line: 220.5, projection: 232, line_type: 'standard', recent: log(12, 200) },
    { player: 'Goblin Line', prop: 'Rush Yards', line: 20.5, projection: 90, line_type: 'goblin', recent: log(12, 80) },
    { player: 'Out Player', prop: 'Rush Yards', line: 30.5, projection: 90, line_type: 'standard', injury: 'OUT', recent: log(12, 80) },
    { player: 'Pulled Line', prop: 'Rush Yards', line: 30.5, projection: 90, line_type: 'standard', pp_status: 'removed', recent: log(12, 80) },
  ])
  const top = publicFreeTopRows(rows)
  assert.equal(FREE_TOP_LIMIT, 3)
  assert.equal(top.length, 3)
  const expected = rows
    .filter((row) => ['Big Edge', 'Mid Edge', 'Small Edge', 'Hit Leader'].includes(row.player))
    .sort((a, b) => (b.score - a.score) || ((b.rawScore ?? -Infinity) - (a.rawScore ?? -Infinity)))
    .slice(0, 3)
    .map((row) => row.player)
  assert.deepEqual(top.map((row) => row.player), expected)
  for (const name of ['Goblin Line', 'Out Player', 'Pulled Line']) {
    assert.equal(top.some((row) => row.player === name), false, name)
  }
  for (let i = 1; i < top.length; i += 1) assert.ok(top[i - 1].score >= top[i].score)
})

test('ties on a capped CG Score break on the raw score, then board order', () => {
  const rows = [
    { player: 'A', stat: 'Points', line: 10.5, projection: 20, score: 100, rawScore: 140 },
    { player: 'B', stat: 'Points', line: 10.5, projection: 22, score: 100, rawScore: 180 },
    { player: 'C', stat: 'Points', line: 10.5, projection: 18, score: 100 },
    { player: 'D', stat: 'Points', line: 10.5, projection: 18, score: 100 },
    { player: 'N', stat: 'Points', line: 10.5, projection: 10.5, score: 50 },
  ]
  assert.deepEqual(publicFreeTopRows(rows, 4).map((row) => row.player), ['B', 'A', 'C', 'D'])
  assert.equal(publicFreeTopRows(rows, 10).some((row) => row.player === 'N'), false)
})

test('KBO free top 3 leaves out pulled and unmodeled props and keeps standard lines only', () => {
  const card = (name, props) => ({ name, team: 'LG', opponent: 'KIA', games: [], props })
  const rows = kboHubRows({
    cards: [
      card('Live One', [{ stat: 'Hits', line: 0.5, projection: 1.2, odds_type: 'standard' }]),
      card('Pulled One', [{ stat: 'Hits', line: 0.5, projection: 1.4, odds_type: 'standard', pp_status: 'removed' }]),
      card('No Model', [{ stat: 'Hits', line: 0.5, projection: null, odds_type: 'standard' }]),
      card('Demon One', [{ stat: 'Hits', line: 1.5, projection: 2.4, odds_type: 'demon' }]),
    ],
  })
  const names = publicFreeTopRows(rows).map((row) => row.player)
  assert.ok(names.includes('Live One'))
  for (const name of ['Pulled One', 'No Model', 'Demon One']) assert.equal(names.includes(name), false, name)
})

test('the landing section reads the CG Score ranking and no longer says highest hit rates', () => {
  assert.match(landing, /<section id="free-top-3">/)
  assert.match(landing, /boardApi\.publicFreeTopRows\(/)
  assert.equal(landing.includes('publicTopHitRows'), false)
  assert.match(landing, /<h2>Today's free top 3<\/h2>/)
  assert.equal(/highest hit rates/i.test(landing), false)
  assert.equal(/Sorted by L10 hit rate/i.test(landing), false)
  const shell = homeRootInner()
  assert.match(shell, /<h2>Today's free top 3<\/h2>/)
  assert.equal(/highest hit rates/i.test(shell), false)
})

test('ranks outside the free top 3 are labeled as model-ranked edges, with no cash rate', () => {
  assert.equal(UNPROVEN_RANK_NOTE, 'Ranks outside the free top 3 are model-ranked edges, not a proven cash rate.')
  assert.doesNotMatch(UNPROVEN_RANK_NOTE, /\b(lock|locks|locked|guarantee|guaranteed)\b/i)
  assert.doesNotMatch(UNPROVEN_RANK_NOTE, /\d+(\.\d+)?%|\$\d|cash rate of/i)

  const free = landing.slice(landing.indexOf('id="free-top-3"'), landing.indexOf('id="matchup"'))
  const boards = landing.slice(landing.indexOf('id="boards"'), landing.indexOf('id="pricing"'))
  assert.match(free, /<p className="pl-unproven" role="note">\{UNPROVEN_RANK_NOTE\}<\/p>/)
  assert.match(boards, /<p className="pl-unproven" role="note">\{UNPROVEN_RANK_NOTE\}<\/p>/)
  assert.equal(landing.includes('cashRate'), false)

  const hub = readFileSync(new URL('../src/MemberCommandCenter.jsx', import.meta.url), 'utf8')
  const preview = hub.slice(hub.indexOf('hub-preview'), hub.indexOf('Player drilldown'))
  assert.match(preview, /<p className="hub-unproven" role="note">\{UNPROVEN_RANK_NOTE\}<\/p>/)
  assert.equal(preview.includes('cashRate'), false)
  assert.doesNotMatch(preview, /cash rate of|%\s*cash/i)

  const shell = homeRootInner()
  assert.ok(shell.indexOf(UNPROVEN_RANK_NOTE) > shell.indexOf('free-top3-end'))
  assert.equal(shell.split(UNPROVEN_RANK_NOTE).length - 1, 1)
})
