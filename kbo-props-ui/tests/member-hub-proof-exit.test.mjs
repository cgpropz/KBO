import assert from 'node:assert/strict'
import test from 'node:test'
import { proofShouldFail } from '../scripts/memberHubProofExit.mjs'

const painted = { medianFirstCardMs: 900 }
const missed = { medianFirstCardMs: null }

test('a prod page that does not paint is reported and does not fail the proof', () => {
  const result = proofShouldFail({
    previewPages: { nflDashboard: painted, nhlDashboard: painted },
    prodPages: { nflDashboard: missed, nhlDashboard: painted },
    previewColdStatuses: [200, 200],
    domPromo: false,
    oddsClean: true,
    strikeoutOk: true,
  })
  assert.equal(result.fail, false)
  assert.deepEqual(result.prodFailed, ['nflDashboard'])
})

test('preview paint, cold status, promo rows, and odds checks still fail the proof', () => {
  const base = {
    previewPages: { nflDashboard: painted },
    prodPages: { nflDashboard: missed },
    previewColdStatuses: [200, 200],
    domPromo: false,
    oddsClean: true,
    strikeoutOk: true,
  }
  assert.equal(proofShouldFail({ ...base, previewPages: { nflDashboard: missed } }).fail, true)
  assert.equal(proofShouldFail({ ...base, previewColdStatuses: [200, 500] }).fail, true)
  assert.equal(proofShouldFail({ ...base, domPromo: true }).fail, true)
  assert.equal(proofShouldFail({ ...base, oddsClean: false }).fail, true)
  assert.equal(proofShouldFail({ ...base, strikeoutOk: false }).fail, true)
  assert.equal(proofShouldFail({ ...base, previewPages: {} }).fail, true)
})
