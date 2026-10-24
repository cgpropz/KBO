import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { kboRawRating, scoreFor } from '../src/kboBoardScore.js'
import { kboHubRows, topHubRows } from '../src/memberHub.js'
import { isPlayableBoardLine } from '../src/standardBoard.js'
import { selectFreeTop3 } from '../src/freeTopPicks.js'
import { compareSlipRows, naturalSide, rawSlipCg, shownCg, slipCg } from '../src/slipBoardModel.js'
import { averageCg, legCg } from '../src/slipRank.js'

// Live 10/20 KBO slate (LG vs Kia), standard + demon lines. cg_projection is
// the confidence number; it ranked Kim/Castro/Park Hae-min above Park TB.
const prop = (stat, line, projection, cg_projection, odds_type = 'standard') => ({
  stat, line, projection, cg_projection, odds_type, rating: null, recommendation: projection > line ? 'OVER' : 'UNDER',
})
const slate = { cards: [
  { name: 'Dong Won Park', team: 'LG', opponent: 'Kia', props: [prop('Total Bases', 0.5, 0.97, 78)] },
  { name: 'Harold Castro', team: 'Kia', opponent: 'LG', props: [prop('Hitter Fantasy Score', 6, 8.87, 83), prop('Hits+Runs+RBIs', 2, 2.36, 80)] },
  { name: 'Kim Do-yeong', team: 'Kia', opponent: 'LG', props: [prop('Hitter Fantasy Score', 6.5, 8.96, 85), prop('Hits+Runs+RBIs', 2.5, 2.4, 95, 'demon')] },
  { name: 'Park Hae-min', team: 'LG', opponent: 'Kia', props: [prop('Hitter Fantasy Score', 5, 6.84, 99), prop('Hits+Runs+RBIs', 1.5, 1.52, 99, 'demon')] },
  { name: 'Moon Jeong-bin', team: 'Kia', opponent: 'LG', props: [{ stat: 'Hitter Fantasy Score', line: 4.5, projection: null, cg_projection: null, odds_type: 'standard' }] },
] }
const EXPECTED = ['Dong Won Park|Total Bases', 'Harold Castro|Hitter Fantasy Score', 'Kim Do-yeong|Hitter Fantasy Score']
const key = (r) => `${r.player}|${r.stat}`

test('(1) member hub / landing KBO rows rank by the CG Score, standard lines only', () => {
  const rows = kboHubRows(slate)
  assert.equal(rows.some((r) => r.stat === 'Hits+Runs+RBIs' && r.player === 'Kim Do-yeong'), false)
  assert.equal(rows.find((r) => r.player === 'Dong Won Park').score, scoreFor(slate.cards[0].props[0]))
  assert.deepEqual(topHubRows(rows, 3).map(key), EXPECTED)
})

test('(1) FreePicksPreview KBO rows use scoreFor and hide demon and goblin unders', () => {
  const s = readFileSync(new URL('../src/FreePicksPreview.jsx', import.meta.url), 'utf8')
  const body = s.slice(s.indexOf('function kboRows'), s.indexOf('function nflFreeScore'))
  assert.equal(body.includes('prop?.cg_projection'), false)
  assert.match(body, /const cg = scoreFor\(prop\)/)
  assert.match(body, /score: cg == null \? -Infinity : cg/)
  assert.match(body, /rawScore: kboRawRating\(/)
  assert.match(body, /if \(!isPlayableBoardLine\(prop\)\) return;/)
  // Same rule, applied to the slate: Park TB, Castro FS, Kim FS.
  // Kim's demon is an under. Park Hae-min's demon over stays, below the top 3.
  const rows = slate.cards.flatMap((card) => card.props
    .filter((p) => isPlayableBoardLine(p))
    .map((p) => ({ player: card.name, stat: p.stat, line: p.line, projection: p.projection, score: scoreFor(p) ?? -Infinity, rawScore: kboRawRating(p.projection, p.line, p.stat) })))
  assert.deepEqual(selectFreeTop3(rows, 'kbo', new Date('2026-10-19T23:30:00Z')).map(key), EXPECTED)
})

test('(2) KBO slip CG is bounded 0-100; raw score breaks ties at the cap', () => {
  const park = { sport: 'kbo', name: 'Dong Won Park', projection: 1.316, line: 0.5, prop: 'Total Bases' }
  const other = { sport: 'kbo', name: 'A Other', projection: 1.1, line: 0.5, prop: 'Total Bases' }
  assert.equal(slipCg(park), 100)
  assert.equal(shownCg(park), 100)
  assert.equal(naturalSide(park), 'MORE')
  assert.ok(rawSlipCg(park) > rawSlipCg(other))
  assert.ok(compareSlipRows(park, other) < 0)
  assert.equal(slipCg({ ...park, projection: -1 }), 0)
  assert.equal(naturalSide({ ...park, projection: -1 }), 'LESS')
  // Below the cap the score is unchanged.
  assert.equal(slipCg({ sport: 'kbo', projection: 8.87, line: 6, prop: 'Hitter Fantasy Score' }), scoreFor({ projection: 8.87, line: 6, stat: 'Hitter Fantasy Score' }))
})

test('(2) KBO slip leg and card average stay inside 0-100', () => {
  const park = { sport: 'kbo', projection: 1.316, line: 0.5, prop: 'Total Bases' }
  assert.equal(legCg(park, 'MORE'), 100)
  assert.equal(legCg(park, 'LESS'), 0)
  const castro = { sport: 'kbo', projection: 8.87, line: 6, prop: 'Hitter Fantasy Score', side: 'MORE' }
  const avg = averageCg([{ ...park, side: 'MORE' }, castro])
  assert.ok(avg <= 100)
  assert.equal(avg, (100 + legCg(castro, 'MORE')) / 2)
  // Other sports unchanged.
  assert.equal(legCg({ sport: 'wnba', projection: 5.68, line: 2.5, prop: 'Assists' }, 'MORE'), (5.68 / 2.5) * 50)
})
