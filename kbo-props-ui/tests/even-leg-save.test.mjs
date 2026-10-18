import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { legHasUnchosenSide, legNeedsSide, slipNeedsSide, cleanSavedLeg } from '../src/savedSlipPayload.js'
import { isNeutralHubRow, topHitRateRows, topHubRows } from '../src/memberHub.js'

test('an EVEN or missing side needs a pick before saving', () => {
  assert.equal(legNeedsSide({ side: 'EVEN' }), true)
  assert.equal(legNeedsSide({}), true)
  for (const side of ['OVER', 'UNDER', 'MORE', 'LESS', 'over']) assert.equal(legNeedsSide({ side }), false)
  assert.equal(slipNeedsSide([{ side: 'OVER' }, { side: 'EVEN' }]), true)
  assert.equal(slipNeedsSide([{ side: 'OVER' }, { side: 'LESS' }]), false)
})

test('the API refuses an explicit EVEN leg; legacy side-less legs keep old behavior', () => {
  assert.equal(legHasUnchosenSide({ side: 'EVEN' }), true)
  assert.equal(legHasUnchosenSide({ side: 'neutral' }), true)
  assert.equal(legHasUnchosenSide({}), false)
  assert.equal(legHasUnchosenSide({ side: 'UNDER' }), false)
  // the silent default this guards against
  assert.equal(cleanSavedLeg({ side: 'EVEN' }).side, 'OVER')
  const api = fs.readFileSync(new URL('../api/saved-slips.js', import.meta.url), 'utf8')
  assert.ok(api.indexOf('legHasUnchosenSide') < api.indexOf('buildSavedSlipRow(req.body'), 'guard runs before the row is built')
})

test('SlipOptimizer and the Strikeout tray block EVEN legs and show the hint', () => {
  const so = fs.readFileSync(new URL('../src/SlipOptimizer.jsx', import.meta.url), 'utf8')
  assert.ok(!/side === 'EVEN' \? 'OVER'/.test(so), 'no EVEN -> OVER default left')
  assert.match(so, /disabled=\{savingSlip \|\| !user \|\| needsSide\(selectedArr\)\}/)
  assert.match(so, /disabled=\{needsSide\(slip\.indices\)\}/)
  assert.match(so, /data-testid="slip-pick-side"/)
  const k = fs.readFileSync(new URL('../src/StrikeoutProjections.jsx', import.meta.url), 'utf8')
  assert.match(k, /onClick=\{sendToSlipBuilder\} disabled=\{slipNeedsSide\(parlayPicks\)\}/)
  assert.match(k, /data-testid="tray-pick-side"/)
})

const row = (player, score, projection, line, extra = {}) => ({
  player, stat: 'Points', line, projection, score, side: projection > line ? 'OVER' : projection < line ? 'UNDER' : null,
  hitRate: 0.9, hitRateN: 10, recent: [9, 9, 9, 9, 9, 9, 9, 9, 9, 9], ...extra,
})

test('hub top lists drop exact-50 and on-the-line rows and keep real edges in order', () => {
  assert.equal(isNeutralHubRow(row('A', 50, 10, 9.5)), true)
  assert.equal(isNeutralHubRow(row('A', 61, 9.5, 9.5)), true)
  assert.equal(isNeutralHubRow(row('A', 61, 10, 9.5)), false)
  const rows = [row('Even', 50, 9.5, 9.5), row('Big', 80, 14, 9.5), row('OnLine', 70, 9.5, 9.5), row('Mid', 60, 11, 9.5)]
  assert.deepEqual(topHubRows(rows, 5).map((r) => r.player), ['Big', 'Mid'])
  assert.ok(!topHitRateRows(rows, 5).some((r) => r.player === 'Even' || r.player === 'OnLine'))
})
