import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { TIP_LABEL, UNPROVEN_LABEL, laneAt, stampTipLanes, tipKeys, tipRowClass } from '../src/tipFirst.js'

const keyOf = (row) => row.id

test('the first three CG-ranked rows are the tip and the rest are unproven', () => {
  const ranked = [
    { id: 'a', score: 91 },
    { id: 'b', score: 80 },
    { id: 'c', score: 70 },
    { id: 'd', score: 40 },
  ]
  const stamped = stampTipLanes(ranked, tipKeys(ranked, keyOf), keyOf)
  assert.deepEqual(stamped.map((row) => row.tipLane), ['tip', 'tip', 'tip', 'unproven'])
  assert.deepEqual(stamped.map((row) => row.score), [91, 80, 70, 40])
  assert.equal(ranked[0].tipLane, undefined)
})

test('a prop filter cannot promote a later rank into the tip', () => {
  const ranked = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]
  const filtered = [{ id: 'd' }, { id: 'e' }]
  const stamped = stampTipLanes(filtered, tipKeys(ranked, keyOf), keyOf)
  assert.deepEqual(stamped.map((row) => [row.id, row.tipLane]), [['d', 'unproven'], ['e', 'unproven']])
})

test('rows that survive the filter keep their original tip identity', () => {
  const ranked = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]
  const filtered = [{ id: 'c' }, { id: 'a' }]
  const stamped = stampTipLanes(filtered, tipKeys(ranked, keyOf), keyOf)
  assert.deepEqual(stamped.map((row) => row.tipLane), ['tip', 'tip'])
})

test('landing modes mark the free top 3 and the ranked switcher', () => {
  assert.deepEqual([0, 1, 2, 3].map((index) => laneAt(index, 'free')), ['tip', 'tip', 'tip', 'tip'])
  assert.deepEqual([0, 1, 2, 3].map((index) => laneAt(index, 'ranked')), ['tip', 'tip', 'tip', 'unproven'])
  assert.equal(laneAt(0, null), null)
  assert.equal(tipRowClass('unproven', 'pl-tr'), 'pl-tr is-unproven')
  assert.equal(tipRowClass(null, 'pl-tr'), 'pl-tr')
})

test('tip labels make no cash-rate claim', () => {
  assert.equal(TIP_LABEL, "Today's tip")
  assert.equal(UNPROVEN_LABEL, 'Unproven')
  assert.doesNotMatch(`${TIP_LABEL} ${UNPROVEN_LABEL}`, /\d|%|cash|lock|guarantee/i)
  const source = readFileSync(new URL('../src/tipFirst.js', import.meta.url), 'utf8')
  assert.equal(source.includes('cgScore'), false)
  assert.equal(source.includes('nflCgScore'), false)
})

test('the hub, landing, and free top 3 feature the tip and name the rest Unproven', () => {
  const hub = readFileSync(new URL('../src/MemberCommandCenter.jsx', import.meta.url), 'utf8')
  const preview = hub.slice(hub.indexOf('hub-preview'), hub.indexOf('Player drilldown'))
  assert.match(hub, /hub-tip-kicker">\{TIP_LABEL\}/)
  assert.match(preview, /<h2>\{UNPROVEN_LABEL\}<\/h2>/)
  assert.equal(preview.includes('Board preview'), false)
  assert.match(preview, /lane="unproven"/)
  assert.match(preview, /<p className="hub-unproven" role="note">\{UNPROVEN_RANK_NOTE\}<\/p>/)

  const landing = readFileSync(new URL('../src/PublicLanding.jsx', import.meta.url), 'utf8')
  assert.equal(landing.includes('Board preview'), false)
  assert.match(landing, /<BoardTable rows=\{hitRows\}[^>]*lanes="free"/)
  assert.match(landing, /<BoardTable rows=\{switchRows\}[^>]*lanes="ranked"/)
  assert.match(landing, /<BoardTable rows=\{gameRows\} sport="nfl" \/>/)

  const free = readFileSync(new URL('../src/FreePicksPreview.jsx', import.meta.url), 'utf8')
  assert.match(free, /<LaneMark lane="tip" \/>/)
  assert.match(free, /\{UNPROVEN_RANK_NOTE\}/)
})
