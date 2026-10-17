import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  CORRELATION_TOOLTIP_NFL,
  FLEX_VARIANCE,
  PAIRS_WELL_LABEL,
  SAME_GAME_WARNING,
  SLIP_BETA_FOOTER,
  WORKS_AGAINST_LABEL,
  correlationTooltip,
  sharesTeamOrGame,
  slipSharesTeamOrGame,
} from '../src/slipBetaCopy.js'

const board = readFileSync(new URL('../src/SlipBoard.jsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('../src/SlipBoard.css', import.meta.url), 'utf8')

test('the approved beta labels, tooltip, warning, and footer stay exact', () => {
  assert.equal(PAIRS_WELL_LABEL, 'Pairs well · Beta')
  assert.equal(WORKS_AGAINST_LABEL, 'Works against · Beta')
  assert.equal(
    CORRELATION_TOOLTIP_NFL,
    'Beta / informational. Based on how these stats have moved together in past NFL games (2021-2026). It\'s a research aid, not a prediction or a guarantee, and it\'s still being tested. Rankings stay on CG Score.',
  )
  assert.equal(correlationTooltip('nfl'), CORRELATION_TOOLTIP_NFL)
  assert.match(correlationTooltip('kbo'), /past KBO games/)
  assert.doesNotMatch(correlationTooltip('wnba'), /NFL games/)
  assert.equal(
    SAME_GAME_WARNING,
    'Same-game heads-up: PrizePicks lineups need players from at least 2 different teams. Lineups with players from the same team or game may pay a different (often lower) payout than the standard rates. Always check the payout shown in the PrizePicks app before you submit.',
  )
  assert.match(FLEX_VARIANCE, /especially in Flex/)
  assert.match(SLIP_BETA_FOOTER, /not affiliated with, endorsed by, or sponsored by PrizePicks or Underdog/)
  assert.match(SLIP_BETA_FOOTER, /21\+ to use CGPropz/)
  assert.match(SLIP_BETA_FOOTER, /1-800-GAMBLER/)
  assert.doesNotMatch(SLIP_BETA_FOOTER, /partner|official partner|powered by/i)
})

test('the slip builder shows the beta labels and hides performance numbers', () => {
  assert.match(board, /PAIRS_WELL_LABEL/)
  assert.match(board, /WORKS_AGAINST_LABEL/)
  assert.match(board, /correlationTooltip\(sport\)/)
  assert.match(board, /SAME_GAME_WARNING/)
  assert.match(board, /FLEX_VARIANCE/)
  assert.match(board, /SLIP_BETA_FOOTER/)
  assert.equal(board.includes('formatAgreement'), false)
  assert.equal(board.includes('Break-even'), false)
  assert.equal(board.includes('lift'), false)
  assert.doesNotMatch(board, /partner/i)
  assert.match(css, /\.b2-corr-title/)
})

test('same-team and same-game slips are the ones that get the warning', () => {
  const qb = { name: 'QB', team: 'DET', opponent: 'CHI' }
  const wr = { name: 'WR', team: 'DET', opponent: 'CHI' }
  const other = { name: 'RB', team: 'CHI', opponent: 'DET' }
  const away = { name: 'CB', team: 'GB', opponent: 'MIN' }
  assert.equal(sharesTeamOrGame(qb, wr), true)
  assert.equal(sharesTeamOrGame(qb, other), true)
  assert.equal(sharesTeamOrGame(qb, away), false)
  assert.equal(slipSharesTeamOrGame([qb]), false)
  assert.equal(slipSharesTeamOrGame([qb, wr]), true)
  assert.equal(slipSharesTeamOrGame([qb, away]), false)
})
