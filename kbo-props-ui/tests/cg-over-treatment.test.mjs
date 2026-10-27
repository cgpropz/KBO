import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cgScore } from '../src/cgScore.js'
import {
  CALIBRATED_DISPLAY_LABEL,
  CG_OVER_DISPLAY_CAP,
  FLEX_BREAKEVEN_PCT,
  OVER_UNPROVEN_EDGE,
  PUBLISHED_OVER_HIT_PCT,
  PUBLISHED_OVER_N,
  UNPROVEN_OVER_LABEL,
  UNPROVEN_OVER_TITLE,
  cgOverChrome,
  cgOverFlags,
  highCgOverUnproven,
  printedCgScore,
} from '../src/cgOverTreatment.js'
import { selectFreeTop3 } from '../src/freeTopPicks.js'
import { freeTop3CgHtml, renderSportFreeTop3 } from '../scripts/freeTop3Html.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (path) => readFileSync(join(root, path), 'utf8')
const OFF = {}
const BADGE_ON = { VITE_FLAG_SIDE_AWARE_UNPROVEN_BADGE: 'true' }
const DAMPEN_ON = { VITE_FLAG_CG_OVER_DISPLAY_DAMPENER: 'true' }

test('both overs flags default off', () => {
  assert.equal(cgOverFlags(OFF).unproven, false)
  assert.equal(cgOverFlags(OFF).dampener, false)
  assert.equal(cgOverFlags({ VITE_FLAG_SIDE_AWARE_UNPROVEN_BADGE: 'false' }).unproven, false)
  assert.equal(cgOverFlags({ FLAG_CG_OVER_DISPLAY_DAMPENER: 'false' }).dampener, false)
  assert.equal(cgOverFlags({ VITE_FLAG_SIDE_AWARE_UNPROVEN_BADGE: 'TRUE' }).unproven, true)
  assert.equal(cgOverFlags({ FLAG_SIDE_AWARE_UNPROVEN_BADGE: 'true' }).unproven, true)
  assert.equal(cgOverFlags({ VITE_FLAG_CG_OVER_DISPLAY_DAMPENER: 'true' }).dampener, true)
  assert.equal(cgOverFlags({ VITE_FLAG_SIDE_AWARE_UNPROVEN_BADGE: '1' }).unproven, false)
})

test('unproven copy matches the rank note: no lock, no guarantee, no percent', () => {
  assert.equal(UNPROVEN_OVER_LABEL, 'Unproven')
  assert.equal(OVER_UNPROVEN_EDGE, 20)
  assert.equal(FLEX_BREAKEVEN_PCT, 54.25)
  assert.equal(PUBLISHED_OVER_HIT_PCT, 48.7)
  assert.equal(PUBLISHED_OVER_N, 1620)
  assert.match(UNPROVEN_OVER_TITLE, /model-ranked edges, not a proven cash rate/)
  assert.doesNotMatch(UNPROVEN_OVER_TITLE, /\b(lock|locks|locked|guarantee|guaranteed)\b/i)
  assert.doesNotMatch(UNPROVEN_OVER_TITLE, /\d+(\.\d+)?%/)
  assert.equal(CALIBRATED_DISPLAY_LABEL, 'Calibrated display (beta)')
  assert.doesNotMatch(CALIBRATED_DISPLAY_LABEL, /\b(lock|guarantee)\b/i)
})

test('badge is side-aware at |CG-50| >= 20 and uses the published over window', () => {
  assert.equal(highCgOverUnproven(70, 'OVER'), true)
  assert.equal(highCgOverUnproven(70, 'over'), true)
  assert.equal(highCgOverUnproven(90, null), true)
  assert.equal(highCgOverUnproven(69.99, 'OVER'), false)
  assert.equal(highCgOverUnproven(30, 'UNDER'), false)
  assert.equal(highCgOverUnproven(10, 'UNDER'), false)
  assert.equal(highCgOverUnproven(90, 'UNDER'), false)
  assert.equal(highCgOverUnproven(50, 'OVER'), false)
  assert.equal(highCgOverUnproven(90, 'OVER', { trailingHitPct: 54.25 }), false)
  assert.equal(highCgOverUnproven(90, 'OVER', { trailingHitPct: 54.24 }), true)
  assert.equal(highCgOverUnproven(90, 'OVER', { trailingN: 49 }), false)
  assert.equal(highCgOverUnproven(90, 'OVER', { trailingN: 50 }), true)

  assert.equal(cgOverChrome(90, 'OVER', OFF).badge, null)
  const on = cgOverChrome(90, 'OVER', BADGE_ON)
  assert.equal(on.badge.label, 'Unproven')
  assert.equal(on.dampened, false)
  assert.equal(on.display, null)
  assert.equal(cgOverChrome(90, 'UNDER', BADGE_ON).badge, null)
  assert.equal(cgOverChrome(69.9, 'OVER', BADGE_ON).badge, null)
  assert.equal(cgOverChrome(90, 'OVER', {
    ...BADGE_ON,
    VITE_FLAG_OVER_TRAILING_HIT: '60',
    VITE_FLAG_OVER_TRAILING_N: '200',
  }).badge, null)
})

test('dampener is display-only, overs only, capped, and default k is 0.7', () => {
  assert.equal(cgOverFlags(OFF).k, 0.7)
  assert.equal(cgOverFlags({ VITE_FLAG_CG_OVER_DISPLAY_DAMPENER_K: '0.5' }).k, 0.5)
  assert.equal(cgOverFlags({ FLAG_CG_OVER_DISPLAY_DAMPENER_K: '0.7' }).k, 0.7)
  assert.equal(cgOverFlags({ VITE_FLAG_CG_OVER_DISPLAY_DAMPENER_K: '0.6' }).k, 0.7)
  assert.equal(CG_OVER_DISPLAY_CAP, 80)

  const off = cgOverChrome(90, 'OVER', OFF)
  assert.equal(off.dampened, false)
  assert.equal(printedCgScore(90, 'OVER', { env: OFF }), 90)

  const k70 = cgOverChrome(90, 'OVER', DAMPEN_ON)
  assert.equal(k70.display, 78)
  assert.equal(k70.label, CALIBRATED_DISPLAY_LABEL)
  assert.match(k70.rawTitle, /Raw CG Score 90\.0/)
  assert.equal(k70.badge, null)

  const k50 = cgOverChrome(90, 'OVER', { ...DAMPEN_ON, VITE_FLAG_CG_OVER_DISPLAY_DAMPENER_K: '0.5' })
  assert.equal(k50.display, 70)
  assert.equal(cgOverChrome(100, 'OVER', DAMPEN_ON).display, 80)
  assert.equal(cgOverChrome(100, 'OVER', { ...DAMPEN_ON, VITE_FLAG_CG_OVER_DISPLAY_DAMPENER_K: '0.5' }).display, 75)
  assert.equal(cgOverChrome(20, 'UNDER', DAMPEN_ON).dampened, false)
  assert.equal(printedCgScore(20, 'UNDER', { symmetric: true, env: DAMPEN_ON }), 80)
  assert.equal(printedCgScore(90, 'OVER', { symmetric: true, env: DAMPEN_ON }), 78)
  assert.equal(cgScore(18, 10, 'Points'), 90)
})

test('free top 3 and board rank keys stay on the raw CG Score', () => {
  const rows = [
    { player: 'Higher', stat: 'Hits', projection: 2, line: 0.5, score: 99 },
    { player: 'Cap', stat: 'Hits', projection: 1.8, line: 0.5, score: 96 },
    { player: 'Seventy', stat: 'Hits', projection: 1.4, line: 0.5, score: 70 },
    { player: 'Under', stat: 'Hits', projection: 0.4, line: 0.5, score: 22 },
  ]
  assert.deepEqual(selectFreeTop3(rows, 'kbo', new Date('2026-10-16T16:00:00Z')).map((row) => row.player), ['Higher', 'Cap', 'Seventy'])

  const ranking = [
    'src/freeTopPicks.js',
    'src/publicBoard.js',
    'src/memberHub.js',
    'src/cgScore.js',
    'src/boardSort.js',
    'src/slipRank.js',
    'src/nfl/nflLineFloors.js',
    'api/_dataAccess.js',
  ]
  for (const path of ranking) {
    assert.equal(read(path).includes('cgOverTreatment'), false, path)
  }
  assert.match(read('api/_dataAccess.js'), /return Number\.isFinite\(p\) && l > 0 \? \(p \/ l\) \* 50 : -Infinity/)
  assert.match(read('src/publicBoard.js'), /b\.row\.score - a\.row\.score/)
  assert.match(read('src/freeTopPicks.js'), /b\.score - a\.score/)
  assert.match(read('src/memberHub.js'), /b\.score - a\.score/)
  assert.match(read('src/nfl/NflProjections.jsx'), /compareNflScores\(a\.score, a\.rawScore, b\.score, b\.rawScore\)/)
  assert.match(read('src/CgScoreExplainer.jsx'), /cgOverChrome/)
  assert.match(read('src/CgScoreExplainer.jsx'), /calibrated display \(beta\)/)
})

test('static free top 3 keeps the raw CG unless a display flag is passed', () => {
  const row = { score: 88.04, side: 'OVER' }
  assert.equal(freeTop3CgHtml(row, OFF), '88.0')
  const html = renderSportFreeTop3({
    sport: { id: 'nfl', name: 'NFL' },
    rows: [{ player: 'A', stat: 'Hits', line: 0.5, side: 'OVER', score: 88.04, team: 'KC', start: '2026-10-20T09:30:00Z' }],
    now: Date.parse('2026-10-19T22:00:00Z'),
  })
  assert.match(html, /CG Score 88\.0/)
  assert.equal(html.includes('cg-score-unproven'), false)
  assert.equal(html.includes('cg-score-calibrated'), false)

  const marked = freeTop3CgHtml(row, {
    VITE_FLAG_SIDE_AWARE_UNPROVEN_BADGE: 'true',
    VITE_FLAG_CG_OVER_DISPLAY_DAMPENER: 'true',
    VITE_FLAG_CG_OVER_DISPLAY_DAMPENER_K: '0.7',
  })
  assert.match(marked, /^76\.6 /)
  assert.match(marked, /class="cg-score-unproven"/)
  assert.match(marked, />Unproven</)
  assert.match(marked, /Calibrated display \(beta\)/)
  assert.match(marked, /Raw CG Score 88\.0/)
  assert.doesNotMatch(marked, /\b(lock|locks|guarantee|guaranteed)\b/i)
})
