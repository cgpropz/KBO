import assert from 'node:assert/strict'
import test from 'node:test'
import { nbaAccessDecision, shapeForTier } from '../api/_dataAccess.js'
import { cgScore } from '../src/cgScore.js'
import { freePreviewBoardList, freeTierFaqAnswer } from '../src/freePreviewCopy.js'
import { LANDING_SPORTS } from '../src/landingSports.js'
import { NBA_FREE_PREVIEW_ENABLED } from '../src/nbaPreviewFlag.js'
import { nbaPublicRows, rowsFromSnapshot } from '../src/publicBoard.js'
import { renderNbaPlayerPropsPage } from '../scripts/publicPages.mjs'

const FUTURE = '2099-10-21T23:00:00Z'

function player(name, props) {
  return { name, team: 'BOS', recentGames: [], ppAllProps: props.map((p) => ({ start_time: FUTURE, odds_type: 'standard', ...p })) }
}

const BOARD = [
  player('Huge Edge', [{ stat: 'Points', line: 4.5, projection: 30 }]),
  player('Big Edge', [{ stat: 'Points', line: 10.5, projection: 30 }]),
  player('Small Edge', [{ stat: 'Rebounds', line: 6.5, projection: 7.1 }]),
  player('Mid Edge', [{ stat: 'Assists', line: 5.5, projection: 7.5 }]),
  player('Goblin', [{ stat: 'Points', line: 2.5, projection: 40, odds_type: 'goblin' }]),
  player('Pulled', [{ stat: 'Points', line: 3.5, projection: 40, pp_status: 'removed' }]),
]

test('the free NBA top 3 is on for the opening weeks and follows the other sports', () => {
  assert.equal(NBA_FREE_PREVIEW_ENABLED, true)
  const base = { emailResolved: true, email: null, tierResolved: true, tier: 'free', flagResolved: true, nbaPublic: true }
  assert.equal(nbaAccessDecision(base), 'preview')
  assert.equal(nbaAccessDecision({ ...base, tier: 'kbo' }), 'preview')
  assert.equal(nbaAccessDecision({ ...base, tier: 'monthly' }), 'full')
  // Turning the switch off puts NBA back to full-access only.
  assert.equal(nbaAccessDecision({ ...base, freePreview: false }), 'deny')
  assert.equal(nbaAccessDecision({ ...base, tier: 'monthly', freePreview: false }), 'full')
  // nba_public still gates everyone but the owner; a failed flag read stays closed.
  assert.equal(nbaAccessDecision({ ...base, nbaPublic: false }), 'deny')
  assert.equal(nbaAccessDecision({ ...base, flagResolved: false }), 'deny')
  assert.equal(nbaAccessDecision({ ...base, emailResolved: false }), 'deny')
})

test('the server preview keeps 3 standard, live NBA props', () => {
  const shaped = shapeForTier('nba_projections_standard', BOARD, 'free')
  assert.equal(shaped.preview, true)
  const props = shaped.data.flatMap((p) => p.ppAllProps.map((prop) => ({ name: p.name, ...prop })))
  assert.equal(props.length, 3)
  for (const name of ['Goblin', 'Pulled']) assert.equal(props.some((p) => p.name === name), false, name)
})

test('landing NBA rows use the board CG Score bounded 0-100 with the raw score as tiebreak', () => {
  assert.ok(LANDING_SPORTS.some((sport) => sport.id === 'nba' && sport.ds === 'nba_projections_standard'))
  const rows = nbaPublicRows(BOARD)
  for (const row of rows) {
    assert.ok(row.score >= 0 && row.score <= 100, `${row.player} ${row.score}`)
    assert.equal(row.rawScore, cgScore(row.projection, row.line, row.stat))
  }
  const huge = rows.find((row) => row.player === 'Huge Edge')
  assert.equal(huge.score, 100)
  assert.ok(huge.rawScore > 100)
  const visible = rowsFromSnapshot('nba', BOARD, null).map((row) => row.player)
  assert.equal(visible.includes('Goblin'), false)
  assert.equal(visible.includes('Pulled'), false)
})

test('copy says NBA has a free top 3 and no longer says there is no free NBA preview', () => {
  assert.equal(freePreviewBoardList(true, true), 'KBO, WNBA, NFL, NBA, and NHL')
  assert.equal(freePreviewBoardList(false, false), 'KBO, WNBA, and NHL')
  assert.match(freeTierFaqAnswer(), /KBO, WNBA, NFL, NBA, and NHL boards/)
  const { html, faqPage } = renderNbaPlayerPropsPage()
  assert.equal(html.includes('There is no free NBA preview'), false)
  assert.equal(/NBA has no free preview/.test(html), false)
  const answer = faqPage.mainEntity.find((q) => q.name === 'Are there free NBA picks?').acceptedAnswer.text
  assert.match(answer, /^Yes, for the opening weeks of the season\./)
})
