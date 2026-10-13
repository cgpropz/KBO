import test from 'node:test'
import assert from 'node:assert/strict'
import { NHL_AGS_BACKTEST, SCORE_LINE, formatBacktestBand } from '../src/nhl/agsScore.js'

test('the explainer is the short league-average line', () => {
  assert.equal(SCORE_LINE, '50 = league-average scorer')
})

test('the backtest bands are the approved NHL table', () => {
  assert.equal(NHL_AGS_BACKTEST.label, 'Backtest')
  assert.deepEqual(
    NHL_AGS_BACKTEST.bands.map((band) => [band.band, band.n, band.hitPct]),
    [
      ['<25', 5385, 5.0],
      ['25-50', 6678, 10.8],
      ['50-75', 5979, 19.8],
      ['75-100', 3460, 28.8],
      ['100+', 737, 34.7],
    ],
  )
  assert.equal(NHL_AGS_BACKTEST.bands.reduce((sum, band) => sum + band.n, 0), 22239)
  assert.match(NHL_AGS_BACKTEST.smallSample, /Small sample/)
  assert.equal(NHL_AGS_BACKTEST.responsible, '21+ · Play responsibly')
})

test('each band shows the hit rate with n beside it', () => {
  assert.equal(formatBacktestBand(NHL_AGS_BACKTEST.bands[0]), '<25 5.0% · n=5,385')
  assert.equal(formatBacktestBand(NHL_AGS_BACKTEST.bands[4]), '100+ 34.7% · n=737')
})
