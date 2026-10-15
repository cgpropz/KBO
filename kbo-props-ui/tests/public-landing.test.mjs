import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { nflHubRows, nhlHubRows } from '../src/memberHub.js'
import {
  BOARD_QA_ALLOWLIST,
  isGoalScorerStat,
  publicBoardRows,
  publicLandingIncludesReviews,
  publicPhoneRows,
  publicTopHitRows,
  publicTopL5Rows,
} from '../src/publicBoard.js'

const landing = readFileSync(new URL('../src/PublicLanding.jsx', import.meta.url), 'utf8')
const sports = readFileSync(new URL('../src/landingSports.js', import.meta.url), 'utf8')
const hub = readFileSync(new URL('../src/CgpropzLanding.jsx', import.meta.url), 'utf8')
const gate = readFileSync(new URL('../src/whenVisibleOrIdle.js', import.meta.url), 'utf8')
const hero = landing.slice(landing.indexOf('className="pl-hero'), landing.indexOf('id="free-top-3"'))

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
    { player: 'Skater', prop: 'Points', line: 0.5, projection: 0.8, oddsType: 'standard', recent: [1, 0, 1, 1, 0, 1, 1, 1, 0, 1, 1, 0], rankEligible: true },
    { player: 'Demon Skater', prop: 'Points', line: 0.5, projection: 0.9, oddsType: 'demon', recent: log(12, 1), rankEligible: true },
  ]))
  assert.deepEqual(nhl.map((row) => row.player), ['Skater'])
  assert.equal(publicTopHitRows(nhlHubRows([
    { player: 'Goal Guy', prop: 'Anytime Goal Scorer', line: 0.5, projection: 0.6, oddsType: 'standard', recent: log(12, 1) },
  ])).length, 0)
})

test('the public landing uses v1 copy and does not invent reviews or stats', () => {
  assert.equal(publicLandingIncludesReviews(), false)
  assert.equal(landing.includes('Testimonials'), false)
  assert.equal(landing.includes('TestimonialForm'), false)
  assert.match(landing, /What members say/)
  assert.match(landing, /REVIEWS\.length > 0/)
  assert.equal(landing.includes('PLACEHOLDER'), false)
  assert.equal(landing.includes('No invented reviews'), false)
  assert.match(hero, /Every prop line/)
  assert.equal(/PrizePicks|DraftKings|FanDuel|Underdog|sportsbook/i.test(hero), false)
  assert.equal(/\bSAMPLE\b/.test(landing), false)
  assert.equal(landing.includes('[ # ]'), false)
  assert.equal(landing.includes('Props scored daily'), false)
  assert.equal(landing.includes('Avg. rating'), false)
  assert.equal(landing.includes('subscriber-count'), false)
  assert.equal(landing.includes('>Members<'), false)
  assert.equal((landing.match(/src="\/favicon\.svg"/g) || []).length, 1)
  assert.match(landing, /useState\('NFL'\)/)
  assert.match(sports, /HERO_LANDING_SPORT_ID = 'nfl'/)
  assert.match(landing, /loading="lazy"/)
  assert.match(landing, /fitImage\(/)
})

test('last-5 hit rates need a real five-game log', () => {
  const rows = nflHubRows([
    { player: 'Long', prop: 'Receptions', line: 5.5, projection: 7, line_type: 'standard', recent: log(12, 8) },
    { player: 'Five', prop: 'Receptions', line: 5.5, projection: 7, line_type: 'standard', recent: log(5, 8) },
    { player: 'Short', prop: 'Receptions', line: 5.5, projection: 7, line_type: 'standard', recent: log(4, 8) },
  ])
  const leaders = publicTopL5Rows(rows)
  assert.deepEqual(leaders.map((row) => row.player), ['Five', 'Long'])
  const five = leaders.find((row) => row.player === 'Five')
  const long = leaders.find((row) => row.player === 'Long')
  assert.equal(five.l10, null)
  assert.equal(five.l5.hits <= five.l5.games, true)
  assert.ok(long.l10)
  assert.equal(long.l10.hits <= long.l10.games, true)
  assert.equal(publicPhoneRows(rows).some((row) => row.player === 'Short'), true)
  assert.equal(publicPhoneRows(rows, 2).length, 2)
})

test('the public landing does not open a Stripe Checkout Session on load', () => {
  assert.equal(landing.includes('prefetchWeeklyCheckoutUrl'), false)
  assert.match(landing, /requestWeeklyCheckoutUrl/)
  assert.match(landing, /HERO_LANDING_SPORT_ID|HERO_SPORT/)
})

test('other landing boards load on scroll, not on a timer', () => {
  assert.match(landing, /whenVisible\(/)
  assert.equal(/whenVisibleOrIdle\(/.test(landing), false)
  assert.equal(gate.includes('onPageIdle'), false)
  assert.equal(gate.includes('AFTER_LOAD'), false)
  assert.match(gate, /scroll/)
  assert.match(gate, /afterPaint/)
})

test('free visitors use the public landing and paid members keep the Sports Hub', () => {
  assert.match(hub, /MemberCommandCenter/)
  assert.match(hub, /if \(isPaid\)/)
  assert.match(hub, /<PublicLanding/)
  assert.equal(hub.includes('Testimonials'), false)
})
