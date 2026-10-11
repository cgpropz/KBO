import test from 'node:test'
import assert from 'node:assert/strict'
import {
  GAME_CARD_PROBS_ENABLED,
  PLAY_EDGE_POINTS,
  cardView,
  footerLine,
  isPlay,
  tileTone,
  winSplit,
} from '../src/nfl/gameCardModel.js'

const game = {
  awayTeam: 'BUF',
  homeTeam: 'KC',
  weekday: 'Sunday',
  gametime: '16:25',
  awayScore: 24,
  homeScore: 21,
  spread: { line: -3.5, projection: -6, edge: 2.5 },
  total: { line: 47.5, projection: 45, edge: -2.5 },
  moneyline: { modelProbability: 0.42 },
}

test('tint, play wording, and win probability stay behind the default-off flag', () => {
  assert.equal(GAME_CARD_PROBS_ENABLED, false)
  assert.equal(PLAY_EDGE_POINTS, 1)
  const view = cardView(game)
  assert.equal(view.wins, null)
  assert.equal(view.spreadTone, '')
  assert.equal(view.totalTone, '')
  assert.equal(view.footer, 'Our number vs the book')
  assert.equal(view.spreadBook, '-3.5')
  assert.equal(view.spreadOurs, '-6.0')
  assert.equal(footerLine(game, false).includes('play'), false)
  assert.equal(footerLine(game, false).includes('edge'), false)
  assert.equal(footerLine(game, false).includes('Lean'), false)
})

test('the flag reveals the lean, the edge, and the win split', () => {
  const view = cardView(game, true)
  assert.deepEqual(view.wins, { awayPct: 58, homePct: 42 })
  assert.equal(view.footer, 'Lean BUF -3.5 · edge +2.5 · play')
  assert.equal(winSplit({ moneyline: {} }), null)
})

test('a difference under one point is no play and does not tint', () => {
  const quiet = {
    awayTeam: 'DAL',
    homeTeam: 'NYG',
    spread: { line: -2.5, projection: -3, edge: 0.5 },
    total: { line: 44.5, projection: 45, edge: 0.5 },
  }
  assert.equal(isPlay(quiet), false)
  assert.equal(tileTone(-3, -2.5), '')
  assert.equal(footerLine(quiet, false), 'Our number vs the book')
  assert.equal(footerLine(quiet, true), 'Our number vs the book · no play')
  assert.equal(cardView(game).spreadTone, '')
  assert.equal(cardView(game, true).spreadTone, 'under')
})

test('our number tints green above the book and red when it is under', () => {
  assert.equal(tileTone(-6, -3.5), 'under')
  assert.equal(tileTone(-1, -3.5), 'over')
  assert.equal(tileTone(48, 45.5), 'over')
  assert.equal(tileTone(43, 45.5), 'under')
  assert.equal(tileTone(null, 45.5), '')
})

test('missing scores and a missing win probability stay hidden', () => {
  const game = { awayTeam: 'SEA', homeTeam: 'SF', spread: {}, total: {} }
  const blank = cardView(game, true)
  assert.equal(blank.scores, null)
  assert.equal(blank.wins, null)
  assert.equal(isPlay(game), false)
})
