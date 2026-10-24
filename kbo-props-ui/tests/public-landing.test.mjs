import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { HERO_LANDING_SPORT_ID } from '../src/landingSports.js'
import { nflHubRows, nhlHubRows } from '../src/memberHub.js'
import {
  BOARD_QA_ALLOWLIST,
  isGoalScorerStat,
  publicBoardRows,
  publicLandingIncludesReviews,
  publicTopHitRows,
} from '../src/publicBoard.js'

const landing = readFileSync(new URL('../src/PublicLanding.jsx', import.meta.url), 'utf8')
const hub = readFileSync(new URL('../src/CgpropzLanding.jsx', import.meta.url), 'utf8')

function log(length, value) {
  return Array.from({ length }, () => value)
}

test('public rows reuse the board filters and do not apply a QA name allowlist', () => {
  assert.equal(BOARD_QA_ALLOWLIST, null)
  assert.equal(isGoalScorerStat('Anytime Goal Scorer'), true)
  assert.equal(isGoalScorerStat('Points'), false)

  const nfl = nflHubRows([
    { player: 'Jaxon Smith-Njigba', prop: 'Receptions', line: 6.5, projection: 7.2, line_type: 'standard', recent: [8, 7, 6, 9, 5, 8, 7, 6, 10, 4, 8, 7] },
    { player: 'Sam Darnold', prop: 'Pass Yards', line: 220.5, projection: 240, line_type: 'standard', recent: log(12, 250) },
    { player: 'Out Player', prop: 'Receptions', line: 4.5, projection: 6, line_type: 'standard', injury: 'OUT', recent: log(12, 8) },
    { player: 'Goblin Only', prop: 'Receptions', line: 3.5, projection: 6, line_type: 'goblin', recent: log(12, 8) },
  ])
  const visible = publicBoardRows(nfl).map((row) => row.player)
  assert.equal(visible.includes('Jaxon Smith-Njigba'), true)
  assert.equal(visible.includes('Sam Darnold'), true)
  assert.equal(visible.includes('Out Player'), false)
  assert.equal(visible.includes('Goblin Only'), false)

  const leaders = publicTopHitRows(nfl).map((row) => row.player)
  assert.equal(leaders.includes('Jaxon Smith-Njigba'), true)
  assert.equal(leaders.includes('Sam Darnold'), true)
  assert.equal(leaders.includes('Out Player'), false)

  const nhl = publicBoardRows(nhlHubRows([
    { player: 'Goal Guy', prop: 'Goal Scorer', line: 0.5, projection: 0.4, oddsType: 'standard', recent: log(12, 1), rankEligible: true },
    { player: 'Skater', prop: 'Points', line: 0.5, projection: 0.9, oddsType: 'standard', recent: [1, 0, 1, 1, 0, 1, 1, 1, 0, 1, 1, 0], rankEligible: true },
    { player: 'Demon Skater', prop: 'Points', line: 0.5, projection: 0.9, oddsType: 'demon', recent: log(12, 1), rankEligible: true },
  ]))
  assert.deepEqual(nhl.map((row) => row.player), ['Skater'])
  assert.equal(publicTopHitRows(nhlHubRows([
    { player: 'Goal Guy', prop: 'Anytime Goal Scorer', line: 0.5, projection: 0.6, oddsType: 'standard', recent: log(12, 1) },
  ])).length, 0)
})

test('the public landing has no reviews section', () => {
  assert.equal(publicLandingIncludesReviews(), false)
  assert.equal(landing.includes('Testimonials'), false)
  assert.equal(landing.includes('TestimonialForm'), false)
  assert.equal(/What members say/i.test(landing), false)
  assert.equal(landing.includes('data-c="reviews"'), false)
  assert.equal(/\bSAMPLE\b/.test(landing), false)
  assert.equal(/PLACEHOLDER/.test(landing), false)
  assert.equal(/PrizePicks/.test(landing), false)
})

test('the public landing features NFL on the hero, phone, and sport tabs', () => {
  assert.equal(HERO_LANDING_SPORT_ID, 'nfl')
  assert.match(landing, /useState\(HERO_LANDING_SPORT_ID\)/)
  assert.equal(/setSportId\(withRows\.id\)/.test(landing), false)
  assert.equal(/setHitSportId\(withHits\.id\)/.test(landing), false)
})

test('the public landing does not open a Stripe Checkout Session on load', () => {
  assert.equal(landing.includes('prefetchWeeklyCheckoutUrl'), false)
  assert.equal(landing.includes('requestWeeklyCheckoutUrl'), false)
  const start = landing.slice(landing.indexOf('const startWeekly'), landing.indexOf('const buyLifetime'))
  assert.match(start, /openWeeklyCheckoutUrl/)
  assert.ok(start.indexOf('requireAge()') < start.indexOf('openWeeklyCheckoutUrl'))
  assert.match(landing, /HERO_LANDING_SPORT_ID|HERO_SPORT/)
})

test('free visitors use the public landing and paid members keep the Sports Hub', () => {
  assert.match(hub, /MemberCommandCenter/)
  assert.match(hub, /if \(isPaid\)/)
  assert.match(hub, /<PublicLanding/)
  assert.equal(hub.includes('Testimonials'), false)
})

test('landing matchup sheet labels the spread team and shows a CG pick-em as PK', async () => {
  const { matchupMarketText } = await import('../src/publicBoard.js')
  const carPhi = { awayTeam: 'CAR', homeTeam: 'PHI', awayScore: 22, homeScore: 22, spread: { line: -3, projection: 0 }, total: { line: 39, projection: 44 } }
  assert.deepEqual(matchupMarketText(carPhi), {
    spread: { line: 'CAR -3.0', projection: 'PK' },
    total: { line: '39.0', projection: '44.0' },
  })
  const houJax = { awayTeam: 'HOU', homeTeam: 'JAX', spread: { line: 2.5, projection: 3 }, total: { line: 42, projection: 45 } }
  assert.deepEqual(matchupMarketText(houJax).spread, { line: 'JAX -2.5', projection: 'JAX -3.0' })
  const missing = { awayTeam: 'NO', homeTeam: 'NYG', spread: { line: null, projection: null }, total: {} }
  assert.deepEqual(matchupMarketText(missing), {
    spread: { line: '—', projection: '—' },
    total: { line: '—', projection: '—' },
  })
  assert.match(landing, /boardApi\.matchupMarketText\(game\)\.spread/)
})
