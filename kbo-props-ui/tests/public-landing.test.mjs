import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { HERO_LANDING_SPORT_ID, LANDING_SPORTS, LOCKED_LANDING_SPORTS } from '../src/landingSports.js'
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
const memberHub = readFileSync(new URL('../src/MemberCommandCenter.jsx', import.meta.url), 'utf8')

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

test('the public landing features the NFL free top 3 and does not tab through other sports', () => {
  assert.equal(HERO_LANDING_SPORT_ID, 'nfl')
  assert.deepEqual(LANDING_SPORTS.map((sport) => sport.id), ['nfl'])
  assert.deepEqual(LOCKED_LANDING_SPORTS.map((sport) => sport.id), ['kbo', 'wnba', 'nhl'])
  assert.equal(landing.includes('role="tab"'), false)
  assert.equal(landing.includes('KBO · NFL'), false)
  assert.match(landing, /freeTop\.length < 3/)
  assert.match(landing, /LOCKED_LANDING_SPORTS/)
  assert.equal(/setSportId\(withRows\.id\)/.test(landing), false)
  assert.equal(/setHitSportId\(withHits\.id\)/.test(landing), false)
})

test('the public landing does not open a Stripe Checkout Session on load', () => {
  assert.equal(landing.includes('prefetchWeeklyCheckoutUrl'), false)
  assert.match(landing, /requestWeeklyCheckoutUrl/)
  assert.match(landing, /HERO_LANDING_SPORT_ID|HERO_SPORT/)
})

test('free visitors use the public landing and paid members keep the Sports Hub', () => {
  assert.match(hub, /MemberCommandCenter/)
  assert.match(hub, /if \(isPaid\)/)
  assert.match(hub, /<PublicLanding/)
  assert.equal(hub.includes('Testimonials'), false)
})

test('signed-out landing fetches only the NFL free board', () => {
  assert.match(landing, /loadDataset\(HERO_SPORT\.ds/)
  assert.equal(landing.includes('nfl_game_markets'), false)
  assert.equal(landing.includes('whenVisibleOrIdle'), false)
  assert.equal(landing.includes('sport.lineups'), false)
  assert.equal(landing.includes('HERO_SPORT.lineups'), false)
  assert.equal(landing.includes("status: 'locked'"), false)
  assert.equal(landing.includes('prizepicks_props'), false)
  assert.equal(landing.includes('wnba_projections'), false)
  assert.equal(landing.includes('nhl_projections'), false)
  assert.match(landing, /publicSwitcherRows\(boards\.nfl\?\.rows \|\| \[\], 3\)/)
})

test('the member hub loads the open sport and does not prefetch the rest', () => {
  assert.equal(memberHub.includes('8000'), false)
  assert.equal(/SPORTS\.forEach\(\(sport, index\)/.test(memberHub), false)
  assert.match(memberHub, /status: sport\.id === activeId \? 'loading' : 'idle'/)
  assert.match(memberHub, /if \(active\) loadSport\(active\)/)
  assert.match(memberHub, /useState\(DEFAULT_MEMBER_SPORT\)/)
  assert.equal(memberHub.includes('readMemberSportChoice'), false)
  assert.match(memberHub, /FETCH_BUDGET_MS \+ 500/)
})
