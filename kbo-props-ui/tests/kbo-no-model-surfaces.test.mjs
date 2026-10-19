import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DATASETS } from '../api/_dataAccess.js'
import { kboModelProjection, pregameSide } from '../src/kboBoardScore.js'
import { kboHubRows } from '../src/memberHub.js'

const src = (file) => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')

// Moon Jeong-bin FS 4.5 on the 10/20 slate: no model number. batter_projections
// no-data rows carry no formula_source field at all.
const moonBp = { name: 'Moon Jeong-bin', prop: 'Fantasy Score', line: 4.5, odds_type: 'standard', projection: null, rating: null }

test('kboModelProjection: null, empty and none are no model number; 0 and real numbers stay', () => {
  assert.equal(kboModelProjection(moonBp), null)
  assert.equal(kboModelProjection({ ...moonBp, projection: '' }), null)
  assert.equal(kboModelProjection({ line: 4.5 }), null)
  assert.equal(kboModelProjection({ projection: 6.84, formula_source: 'none' }), null)
  assert.equal(kboModelProjection({ projection: 0.97, formula_source: 'current' }), 0.97)
  assert.equal(kboModelProjection({ projection: 0 }), 0)
})

test('(1) KBO slip loader skips no-model rows before num()', () => {
  const s = src('slipSports.js')
  const body = s.slice(s.indexOf('async function loadKboProps'), s.indexOf('function lineTypePresent'))
  assert.match(body, /const projection = kboModelProjection\(row\)/)
  assert.doesNotMatch(body, /const projection = num\(row\?\.projection\)/)
  assert.match(s, /import \{ kboModelProjection \} from '\.\/kboBoardScore\.js'/)
})

test('(2) member hub / landing KBO rows skip null, empty and none props', () => {
  const card = (props) => ({ cards: [{ name: 'Moon Jeong-bin', team: 'Kia', opponent: 'LG', props }] })
  const base = { stat: 'Hitter Fantasy Score', line: 4.5, odds_type: 'standard', avg: 3.1, recommendation: 'NO LINE' }
  assert.deepEqual(kboHubRows(card([{ ...base, projection: null, rating: null, cg_projection: null }])), [])
  assert.deepEqual(kboHubRows(card([{ ...base, projection: '' }])), [])
  assert.deepEqual(kboHubRows(card([{ ...base, projection: 5, rating: 55.6, formula_source: 'none' }])), [])
  const kept = kboHubRows(card([{ ...base, projection: 6.84, rating: 68.4, cg_projection: 80, recommendation: 'OVER', formula_source: 'tuned' }]))
  assert.equal(kept.length, 1)
  assert.equal(kept[0].side, 'OVER')
})

test('(3) Batter and Strikeout pages compute rating/side only from a real projection', () => {
  for (const file of ['BatterProjections.jsx', 'StrikeoutProjections.jsx']) {
    const s = src(file)
    assert.match(s, /const projection = kboModelProjection\(p\);/, file)
    assert.doesNotMatch(s, /const projection = Number\(p\.projection\);/, file)
    assert.match(s, /rating: liveLine && projection != null \? kboRating\(/, file)
    assert.match(s, /rawRating: liveLine && projection != null \? kboRawRating\(/, file)
  }
  assert.match(src('BatterProjections.jsx'), /pregameSide\(projection, liveLine\)/)
})

test("nit: projection preview treats '' like null", () => {
  const res = DATASETS.batter_projections.free({
    projections: [
      { ...moonBp, projection: '', rating: 99 },
      { ...moonBp, name: 'Null', rating: 98 },
      { name: 'Dong Won Park', prop: 'Total Bases', line: 0.5, projection: 0.97, rating: 96.6 },
    ],
  })
  assert.deepEqual(res.data.projections.map((r) => r.name), ['Dong Won Park'])
})

test('MatchupDeepDive: no-model rows get no edge or side; a 0 projection stays valid', () => {
  const s = src('MatchupDeepDive.jsx')
  assert.match(s, /import \{ kboModelProjection, pregameSide \} from '\.\/kboBoardScore'/)
  assert.match(s, /const projection = kboModelProjection\(prop\);/)
  assert.doesNotMatch(s, /const projection = Number\(prop\?\.projection\);/)
  assert.match(s, /const edge = projection != null \? projection - liveLine : null;/)
  assert.match(s, /const recommendation = pregameSide\(projection, liveLine\);/)
  assert.match(s, /edge: edge != null \? Number\(edge\.toFixed\(2\)\) : null,/)
  // Same logic on the rows: Moon FS 4.5 (null) vs a real 0 projection.
  const liveLine = 4.5
  const rowFor = (prop) => {
    const projection = kboModelProjection(prop)
    const edge = projection != null ? projection - liveLine : null
    return { edge: edge != null ? Number(edge.toFixed(2)) : null, recommendation: pregameSide(projection, liveLine) }
  }
  assert.deepEqual(rowFor({ name: 'Moon Jeong-bin', projection: null, edge: -4.5 }), { edge: null, recommendation: 'NO LINE' })
  assert.deepEqual(rowFor({ projection: '' }), { edge: null, recommendation: 'NO LINE' })
  assert.deepEqual(rowFor({ projection: 0 }), { edge: -4.5, recommendation: 'UNDER' })
  assert.deepEqual(rowFor({ projection: 6.84 }), { edge: 2.34, recommendation: 'OVER' })
})
